/**
 * The hero's dot field, as a fragment shader.
 *
 * The field is Spar's mark at page scale: the same grid of dots, the same
 * diagonal running through it. Three things happen on top of that.
 *
 * **It swells under the pointer.** Each dot's radius is a Gaussian of its
 * distance to the cursor, so the field bulges rather than a handful of dots
 * snapping to a bigger size.
 *
 * **It splits into red and cyan.** A white dot is drawn three times — once per
 * channel — the copies pushed apart along the line from the cursor. Where all
 * three overlap you get white; where they don't you get the fringe a fast lens
 * leaves. The split is strongest in a ring at arm's length from the cursor and
 * at the edges of the screen, which is where a real lens puts it.
 *
 * **It answers a click.** A band travels out from where you pressed, swelling
 * dots as it passes and taking the aberration with it.
 *
 * **Two dots find each other.** Every so often, two dots somewhere in the grid
 * pick themselves out and swell; the dots between them then light in from both
 * ends and meet in the middle; a small ring opens where they met; and all of it
 * lets go. Nothing is ever drawn between them — no line, no bolt. It is dots
 * the whole way through, which is the only way it belongs to this page.
 *
 * **And the camera goes to it.** While a connection is live the whole field
 * closes in on it and slides it towards the middle of the screen, eased in over
 * the charge and out over the settle — so the move arrives slightly before the
 * event and leaves after it.
 *
 * Kept in its own file because it is the one piece of this site that is a
 * program rather than markup, and it is easier to read whole.
 */

export const VERTEX_SHADER = /* glsl */ `#version 300 es
// One triangle, big enough to cover the viewport. Cheaper than a quad and
// avoids the diagonal seam a two-triangle quad can show under interpolation.
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

/** How many clicks are in the air at once. The oldest is overwritten, so you
 *  can keep clicking and keep getting waves — the field is a toy, and a toy
 *  that cancels what you are doing the moment you do it again is not one. */
#define RIPPLES 7

/** How many arcs can be travelling at once. */
#define ARCS 3


uniform vec2  uRes;      // viewport, CSS px
uniform float uDpr;      // device pixel ratio the canvas is backed at
uniform vec2  uPointer;  // smoothed pointer, CSS px, y down
uniform float uActive;   // 0..1, how present the pointer is
uniform float uTime;     // seconds
uniform float uSpacing;  // grid step, CSS px
uniform float uBase;     // resting dot radius at full tone, CSS px
uniform float uMotion;   // 0 when the visitor asked for reduced motion
uniform vec3  uClicks[RIPPLES]; // per ripple: xy where it landed, z its age
uniform vec2  uDrift;    // parallax offset, CSS px, from the pointer's travel
// An arc is a four-point path through the grid. Two vec4s carry the points and
// one float carries its age; nothing carries a line, because there isn't one.
uniform vec4  uArcA[ARCS];   // p0.xy, p1.xy
uniform vec4  uArcB[ARCS];   // p2.xy, p3.xy
uniform float uArcAge[ARCS]; // seconds since it struck, or below zero for idle
uniform vec3  uFocus;    // xy of whatever the field is attending to, z how much

out vec4 outColor;

/** How far the pointer's swell reaches, CSS px. */
const float INFLUENCE = 215.0;
/** Where the aberration ring sits relative to the pointer, and how wide it is. */
const float RING_AT = 110.0;
const float RING_WIDTH = 92.0;
/** The four beats, in seconds. The charge is the long one on purpose: two dots
 *  quietly swelling for over a second is what makes the join read as something
 *  that was coming rather than something that flashed. */
const float ARC_CHARGE = 1.3;
const float ARC_JOIN = 0.85;
const float ARC_BURST = 0.5;
const float ARC_SETTLE = 1.15;
const float ARC_LIFE = 3.8;
/** How far the burst's ring opens before it is gone, CSS px. */
const float ARC_BURST_REACH = 118.0;
/** How near a dot has to be to the path to be taken up by it, CSS px. Wide, so
 *  the arc has shoulders and is not a one-dot-thick wire. */
const float ARC_REACH = 34.0;

/** How fast a click's band travels, CSS px per second, and how long it lives. */
const float RIPPLE_SPEED = 720.0;
const float RIPPLE_LIFE = 2.1;

/** Antialiased coverage of a disc of radius r, at offset d from its centre. */
float disc(vec2 d, float r) {
  return 1.0 - smoothstep(r - 1.1, r + 1.1, length(d));
}

/** How far along a segment a point sits, and how far off it. */
vec2 segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return vec2(h * length(ba), length(pa - ba * h));
}

float easeOut(float t) {
  return 1.0 - pow(1.0 - t, 3.0);
}

/** Two dots finding each other, in four beats.
 *
 *  Nothing is ever drawn between them. Every frame of this is dots — which ones
 *  are lit, how big they are, and when their turn comes — because the mark is a
 *  grid of dots and anything laid over it in a different medium is a second
 *  thing on the page rather than the same thing doing something.
 *
 *    charge  two dots somewhere in the field pick themselves out and swell,
 *            slowly, while nothing else happens. This is the beat that makes
 *            the rest read as deliberate rather than ambient.
 *    join    the dots between them light in from both ends at once and meet in
 *            the middle. Both ends moving is what makes it a connection rather
 *            than a signal being sent one way.
 *    burst   a small ring opens from where they met and is gone almost at once.
 *    settle  everything lets go together, slower than it arrived.
 */
float arcsAt(vec2 s) {
  float lit = 0.0;
  for (int i = 0; i < ARCS; i++) {
    float age = uArcAge[i];
    if (age < 0.0 || age > ARC_LIFE) continue;

    vec2 p0 = uArcA[i].xy;
    vec2 p1 = uArcA[i].zw;
    vec2 p2 = uArcB[i].xy;
    vec2 p3 = uArcB[i].zw;

    float l0 = length(p1 - p0);
    float l1 = length(p2 - p1);
    float l2 = length(p3 - p2);
    float total = max(l0 + l1 + l2, 1e-4);

    // Nearest point on the route, and how far along the route it is.
    vec2 a = segment(s, p0, p1);
    vec2 b = segment(s, p1, p2);
    vec2 c = segment(s, p2, p3);
    float across = a.y;
    float along = a.x;
    if (b.y < across) { across = b.y; along = l0 + b.x; }
    if (c.y < across) { across = c.y; along = l0 + l1 + c.x; }

    // The four beats, each a 0..1 of its own.
    float charge = clamp(age / ARC_CHARGE, 0.0, 1.0);
    float join = clamp((age - ARC_CHARGE) / ARC_JOIN, 0.0, 1.0);
    float burst = clamp((age - ARC_CHARGE - ARC_JOIN) / ARC_BURST, 0.0, 1.0);
    float over = clamp((age - ARC_CHARGE - ARC_JOIN - ARC_BURST) / ARC_SETTLE, 0.0, 1.0);

    float near = exp(-(across * across) / (ARC_REACH * ARC_REACH));
    float atStart = exp(-(dot(s - p0, s - p0)) / (ARC_REACH * ARC_REACH));
    float atEnd = exp(-(dot(s - p3, s - p3)) / (ARC_REACH * ARC_REACH));

    // Beat one. Slow, and only the two of them.
    float ends = (atStart + atEnd) * (0.15 + 0.85 * easeOut(charge));

    // Beat two. Depth is zero at either end and one in the middle, so a single
    // front fills the route inwards from both sides at the same time.
    float u = along / total;
    float depth = min(u, 1.0 - u) * 2.0;
    float reach = easeOut(join);
    float bridge = near * smoothstep(depth, depth + 0.14, reach);

    // Beat three, from where the two halves met.
    vec2 met = (p1 + p2) * 0.5;
    float ring = easeOut(burst) * ARC_BURST_REACH;
    float shell = exp(-pow((length(s - met) - ring) / 26.0, 2.0)) * (1.0 - burst) * step(0.001, burst);

    // Beat four, over everything.
    float alive = 1.0 - easeOut(over);

    lit += (ends * 1.55 + bridge * 1.15 + shell * 0.85) * alive;
  }
  return min(lit, 1.4);
}

/** Every live ripple, summed.
 *
 *  Measured at the fragment rather than at each dot's centre, so it is computed
 *  once for the whole neighbourhood instead of seven times inside a nine-cell
 *  loop. At the width these bands run, a dot cannot tell the difference. */
float ripplesAt(vec2 s) {
  float total = 0.0;
  for (int i = 0; i < RIPPLES; i++) {
    float age = uClicks[i].z;
    if (age >= RIPPLE_LIFE) continue;
    float front = (distance(s, uClicks[i].xy) - age * RIPPLE_SPEED) / 105.0;
    total += exp(-front * front) * (1.0 - age / RIPPLE_LIFE);
  }
  // Overlapping fronts should build, but two arriving together must not blow
  // the dot out to a white blob.
  return min(total, 1.6);
}

/** The layer behind: sparser, dimmer, and further from the pointer's parallax.
 *  One cell rather than nine — these dots never swell, so they never reach past
 *  their own square and the neighbours cannot contribute anything. */
float backdrop(vec2 s, float spacing, float radius, float tone) {
  vec2 center = (floor(s / spacing) + 0.5) * spacing;
  return tone * disc(s - center, radius);
}

void main() {
  // Work in CSS pixels with y running down, so the pointer needs no conversion.
  vec2 s = gl_FragCoord.xy / uDpr;
  s.y = uRes.y - s.y;

  // A lens is sharpest in the middle. This is the only aberration present when
  // nobody is pointing at anything, and it is what keeps the resting field from
  // looking like a flat halftone.
  float edge = length(s - uRes * 0.5) / max(uRes.x, uRes.y);
  edge = edge * edge * 1.7;

  float ripple = ripplesAt(s);
  float arc = arcsAt(s);

  vec2 toPointer = s - uPointer;
  vec2 dir = normalize(toPointer + vec2(1e-4));

  // The camera. Not a bulge around the event — the whole field moves. It closes
  // in uniformly about the connection and slides so that the connection drifts
  // towards the middle of the screen, which is what a camera does when it takes
  // an interest in something. Being global is the entire point: a local warp
  // reads as the surface deforming, and a surface that deforms around an event
  // is a lens sitting on the page rather than a camera looking at it.
  //
  // Applied before any layer is sampled, so all three move together, and before
  // the parallax, so leaning and looking stay independent of each other.
  s = uFocus.xy + (s - uFocus.xy) * (1.0 - 0.085 * uFocus.z);
  s += (uFocus.xy - uRes * 0.5) * 0.17 * uFocus.z;

  // Two layers behind the field, offset against it as the pointer moves. The
  // grid is the same grid at every depth — the parallax is doing the work, not
  // a different pattern — and the far one is slow enough to read as distance
  // rather than as a second thing sliding about.
  float far = backdrop(s + uDrift * 2.4, uSpacing * 3.1, uBase * 0.34, 0.1);
  float mid = backdrop(s + uDrift, uSpacing * 1.7, uBase * 0.42, 0.14);
  vec3 acc = vec3(max(far, mid));

  // The near layer moves against them, so the whole thing has a front and a
  // back rather than sliding as one sheet.
  s -= uDrift * 0.5;
  vec2 home = floor(s / uSpacing);

  // The neighbours matter: a swollen dot reaches past its own cell, and a dot
  // pushed sideways by the channel offset reaches further still.
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 center = (home + vec2(float(i), float(j)) + 0.5) * uSpacing;
      vec2 d = s - center;

      // Resting state: the mark's diagonal, run across the whole field as a
      // slow band so the page has a pulse without anything moving.
      float diagonal = (center.x + center.y) * 0.0044;
      float wave = 0.5 + 0.5 * sin(diagonal - uTime * 0.62);
      // Enough contrast that the band is something you can watch cross the
      // page, rather than a gradient you have to be told is moving.
      float radius = uBase * (0.42 + 0.52 * wave * uMotion);
      float tone = 0.14 + 0.3 * wave * uMotion;

      // The swell.
      float reach = distance(center, uPointer) / INFLUENCE;
      float prox = exp(-reach * reach * 1.6) * uActive;
      radius += prox * uBase * 2.6;
      tone += prox * 1.25;

      // The bands from every click still in the air.
      radius += ripple * uBase * 1.35;
      tone += ripple * 0.95;

      // And whatever an arc has just taken up. Mostly in brightness rather than
      // in size — past about twice the resting radius these stop being dots
      // that lit up and start being blobs, and the grid loses its grain.
      radius += arc * uBase * 1.75;
      tone += arc * 1.15;

      // Aberration. Strongest in a ring around the pointer — a dot directly
      // under the cursor is the one thing you are looking at, so it stays
      // white and the split happens around it.
      float fromRing = (distance(center, uPointer) - RING_AT) / RING_WIDTH;
      float ring = exp(-fromRing * fromRing) * uActive;

      // All three channels are the same disc, moved apart. Equal radii is what
      // keeps the dot white: the copies agree everywhere except a rim the width
      // of the shift, so the fringe is an edge on a white dot rather than a
      // tint through it — per-channel radii instead of offsets turn the whole
      // field orange, because the largest channel is the outermost everywhere.
      //
      // Every term is a fraction of the dot's own radius, so the proportion
      // holds as the field swells, and a 2px offset never tears a 1.5px
      // resting dot into three separate coloured ones.
      vec2 shift = dir * radius * (0.26 * ring + 0.1 * edge + 0.2 * ripple);

      tone = clamp(tone, 0.0, 1.0);
      acc = max(acc, tone * vec3(
        disc(d + shift, radius),
        disc(d, radius),
        disc(d - shift, radius)
      ));
    }
  }

  // Premultiplied: the canvas is transparent, so the page's rails and anything
  // else behind it stay visible between the dots.
  float alpha = max(acc.r, max(acc.g, acc.b));
  outColor = vec4(acc, alpha);
}
`;
