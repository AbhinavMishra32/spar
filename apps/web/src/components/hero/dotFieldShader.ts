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

uniform vec2  uRes;      // viewport, CSS px
uniform float uDpr;      // device pixel ratio the canvas is backed at
uniform vec2  uPointer;  // smoothed pointer, CSS px, y down
uniform float uActive;   // 0..1, how present the pointer is
uniform float uTime;     // seconds
uniform float uSpacing;  // grid step, CSS px
uniform float uBase;     // resting dot radius at full tone, CSS px
uniform float uMotion;   // 0 when the visitor asked for reduced motion
uniform vec3  uClick;    // xy of the last click, z = seconds since it landed

out vec4 outColor;

/** How far the pointer's swell reaches, CSS px. */
const float INFLUENCE = 215.0;
/** Where the aberration ring sits relative to the pointer, and how wide it is. */
const float RING_AT = 110.0;
const float RING_WIDTH = 92.0;
/** How fast a click's band travels, CSS px per second, and how long it lives. */
const float RIPPLE_SPEED = 780.0;
const float RIPPLE_LIFE = 1.7;

/** Antialiased coverage of a disc of radius r, at offset d from its centre. */
float disc(vec2 d, float r) {
  return 1.0 - smoothstep(r - 1.1, r + 1.1, length(d));
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

  vec2 toPointer = s - uPointer;
  vec2 dir = normalize(toPointer + vec2(1e-4));

  vec3 acc = vec3(0.0);
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

      // The click's band.
      float age = uClick.z;
      float ripple = 0.0;
      if (age < RIPPLE_LIFE) {
        float front = (distance(center, uClick.xy) - age * RIPPLE_SPEED) / 110.0;
        ripple = exp(-front * front) * (1.0 - age / RIPPLE_LIFE);
        radius += ripple * uBase * 2.2;
        tone += ripple * 0.85;
      }

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
      vec2 shift = dir * radius * (0.42 * ring + 0.18 * edge + 0.32 * ripple);

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
