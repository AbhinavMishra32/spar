/**
 * A challenge's stone, as numbers.
 *
 * Flat and illustrated rather than photographic: a realistic render would be the
 * only such object in an app drawn in surfaces and hairlines. Every stone is a
 * smooth, glossy orb with soft colour inside it, drawn as a stack of shapes
 * clipped to the outline — so the renderer is one loop and the variety lives
 * here.
 *
 * What decides what:
 *
 * - **The pattern is the seed's, weighted by difficulty.** How the colour moves
 *   inside: drifting clouds, a swirl, soft bands, two colours meeting, a ring
 *   of light, or a dark field of sparks. The busier ones turn up more often the
 *   harder the challenge was.
 * - **Difficulty is the colour family.** Pale, Tide, Dusk, Ember: light and soft
 *   for foundation work, deep and hot for advanced.
 * - **The topic is the cut.** Every challenge on a subject shares a silhouette
 *   family, so trees look like trees across a history.
 * - **The id is everything else** — hues within the family, the outline's
 *   wobble and tilt, where the colour sits and which way it turns.
 *
 * Pure and deterministic: no DOM, no randomness that is not seeded.
 */

export type GemDifficulty = "foundation" | "developing" | "proficient" | "advanced";
export type GemPattern = "cloud" | "swirl" | "bands" | "split" | "halo" | "sparks";

/** One filled shape inside the stone, clipped to its outline. */
export type GemLayer = {
  d: string;
  fill: string;
  opacity?: number;
  /** Gaussian blur, in box units. */
  blur?: number;
  /** Turns slowly with the stone's colour when the stone is animated. */
  spin?: boolean;
  /** Stroked instead of, or as well as, filled — swirl arms and bands. */
  line?: { color: string; opacity: number; width: number };
};

export type Gem = {
  /** The outline, a closed path in a 100-unit box around (50, 50). */
  path: string;
  layers: GemLayer[];
  /** Shading toward the rim, so the flat outline reads as a dome. */
  dome: { color: string; opacity: number } | null;
  highlight: { cx: number; cy: number; rx: number; ry: number; rotate: number; opacity: number } | null;
  glints: { x: number; y: number; size: number }[];
  /** The colour a large stone glows with. */
  glow: string;
  tone: "light" | "dark";
  pattern: GemPattern;
  /** "Swirl", "Halo"… */
  patternName: string;
  /** "Pale", "Tide", "Dusk", "Ember" — the colour family, from difficulty. */
  family: string;
  cut: string;
  /** The stone's name: a seeded word and its pattern, e.g. "Harbor Swirl". */
  name: string;
};

/* Words for a stone's name. Calm rather than triumphant — this is a record of
   work, not a loot drop. Order is identity: new words go on the end. */
const WORDS = [
  "Steadfast", "Quiet", "Patient", "Bright", "Tidewater", "Northern", "Lantern", "Hollow",
  "Morning", "Ember", "Glacier", "Harbor", "Meadow", "Cinder", "Signal", "Orbit",
  "Drift", "Keystone", "Riverine", "Summit", "Beacon", "Lumen", "Thistle", "Aurora",
];

const PATTERN_NAME: Record<GemPattern, string> = { cloud: "Cloud", swirl: "Swirl", bands: "Tide", split: "Twin", halo: "Halo", sparks: "Spark" };

/** FNV-1a. */
export function hashOf(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Xorshift from a string, so every draw is repeatable. */
function seeded(value: string): () => number {
  let state = hashOf(value) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

type Lch = [number, number, number];
type Family = {
  name: string;
  body: Lch;
  rim: Lch;
  /** Accent hues before the seed turns them. */
  hues: number[];
  lightness: number;
  chroma: number;
  tone: "light" | "dark";
  glints: number;
  /** How often each pattern turns up at this difficulty. */
  weights: Record<GemPattern, number>;
};

/* Colours in OKLCH so accents are equally bright whatever their hue. */
const FAMILIES: Record<GemDifficulty, Family> = {
  foundation: {
    name: "Pale", body: [0.93, 0.025, 230], rim: [0.8, 0.04, 245], hues: [165, 210, 300, 85], lightness: 0.79, chroma: 0.14,
    tone: "light", glints: 0, weights: { cloud: 3, bands: 3, split: 2, swirl: 1, halo: 1, sparks: 0.3 },
  },
  developing: {
    name: "Tide", body: [0.78, 0.08, 218], rim: [0.58, 0.1, 235], hues: [192, 150, 240, 280], lightness: 0.75, chroma: 0.14,
    tone: "light", glints: 0, weights: { cloud: 2, bands: 2, split: 2, swirl: 2, halo: 1.5, sparks: 0.7 },
  },
  proficient: {
    name: "Dusk", body: [0.32, 0.07, 280], rim: [0.2, 0.05, 280], hues: [300, 250, 190, 335], lightness: 0.67, chroma: 0.19,
    tone: "dark", glints: 1, weights: { cloud: 1.5, bands: 1.5, split: 1.5, swirl: 2, halo: 2, sparks: 2 },
  },
  advanced: {
    name: "Ember", body: [0.36, 0.12, 30], rim: [0.2, 0.08, 28], hues: [48, 25, 75, 10], lightness: 0.73, chroma: 0.19,
    tone: "dark", glints: 2, weights: { cloud: 1, bands: 1, split: 1.5, swirl: 2, halo: 2.5, sparks: 3 },
  },
};

const oklch = ([l, c, h]: Lch, alpha?: number) =>
  `oklch(${(Math.min(0.99, Math.max(0.05, l)) * 100).toFixed(1)}% ${Math.max(0, c).toFixed(3)} ${(((h % 360) + 360) % 360).toFixed(0)}${alpha === undefined ? "" : ` / ${alpha}`})`;

/* The cuts, as harmonics of a circle: r(θ) = 1 + Σ aₙ·cos(nθ + φₙ). Order is
   identity — a topic's cut is an index into this list — so new cuts go on the
   end. */
const CUTS: { name: string; harmonics: [n: number, a: number][] }[] = [
  { name: "round", harmonics: [[2, 0.04], [3, 0.02]] },
  { name: "egg", harmonics: [[1, 0.1], [2, 0.16]] },
  { name: "pebble", harmonics: [[2, 0.13], [3, 0.07], [5, 0.02]] },
  { name: "cushion", harmonics: [[4, -0.09], [2, 0.05]] },
  { name: "drop", harmonics: [[1, 0.22], [2, 0.09], [3, 0.04]] },
  { name: "tumbled", harmonics: [[3, 0.1], [2, 0.08], [4, 0.04]] },
];

export function gemCut(subject: string): string {
  const key = subject.trim().toLowerCase();
  return CUTS[key ? hashOf(key) % CUTS.length : 0]!.name;
}

type Point = [number, number];
const f = (value: number) => value.toFixed(2);

/** Closed Catmull-Rom through the points, as cubic Béziers. */
function smoothPath(points: Point[]): string {
  const at = (index: number) => points[(index + points.length) % points.length]!;
  let d = `M${f(points[0]![0])},${f(points[0]![1])}`;
  for (let index = 0; index < points.length; index += 1) {
    const [p0, p1, p2, p3] = [at(index - 1), at(index), at(index + 1), at(index + 2)];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return `${d}Z`;
}

const circle = (cx: number, cy: number, r: number) => `M${f(cx - r)},${f(cy)}a${f(r)},${f(r)} 0 1,0 ${f(r * 2)},0a${f(r)},${f(r)} 0 1,0 ${f(-r * 2)},0`;

function pick<T extends string>(weights: Record<T, number>, roll: number): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = roll * total;
  for (const [key, weight] of entries) {
    cursor -= weight;
    if (cursor <= 0) return key;
  }
  return entries[entries.length - 1]![0];
}

/** An open polyline through the points — blurred, its corners never show. */
const line = (points: Point[]) => `M${points.map(([x, y]) => `${f(x)},${f(y)}`).join("L")}`;

export function makeGem({ seed, difficulty, subject = "", radius = 36 }: { seed: string; difficulty: GemDifficulty; subject?: string; radius?: number }): Gem {
  const random = seeded(seed);
  const family = FAMILIES[difficulty];
  const cut = CUTS.find((entry) => entry.name === gemCut(subject))!;
  /* Drawn from its own stream, so adding a pattern never re-rolls the shape
     of every stone that already exists. */
  const pattern = pick(family.weights, seeded(`${seed}:pattern`)());
  /* Hues swing widely per stone — the family sets how light and how vivid, the
     seed mostly decides which colours. */
  const drift = (random() - 0.5) * 90;
  const hue = (index: number, spread = 24) => family.hues[index % family.hues.length]! + drift + (random() - 0.5) * spread;
  const accent = (index: number, dl = 0): string => oklch([family.lightness + dl + (random() - 0.5) * 0.06, family.chroma, hue(index)]);
  const bright = (index: number) => oklch([Math.min(0.97, family.lightness + 0.17), family.chroma * 0.7, hue(index, 10)]);

  const tilt = (random() - 0.5) * 0.7;
  const harmonics = cut.harmonics.map(([n, a]) => ({ n, a: a * (0.75 + random() * 0.5), phase: n % 2 ? random() * Math.PI * 2 : n === 1 ? Math.PI / 2 : 0 }));
  const raw = Array.from({ length: 36 }, (_, index) => {
    const theta = (index / 36) * Math.PI * 2;
    return { theta: theta + tilt, r: 1 + harmonics.reduce((sum, { n, a, phase }) => sum + a * Math.cos(n * theta + phase), 0) };
  });
  const widest = Math.max(...raw.map((point) => point.r));
  const path = smoothPath(raw.map(({ theta, r }) => [50 + Math.cos(theta) * (r / widest) * radius, 50 + Math.sin(theta) * (r / widest) * radius]));

  /* Sparks sit on a darker field whatever the family, so the sparks read. */
  const body: Lch = pattern === "sparks"
    ? [family.tone === "dark" ? family.body[0] - 0.06 : 0.36, Math.max(family.body[1], 0.06), hue(0, 0)]
    : [family.body[0], family.body[1], family.body[2] + drift * 0.4];
  const layers: GemLayer[] = [{ d: path, fill: oklch(body) }];
  const at = (angle: number, distance: number): Point => [50 + Math.cos(angle) * distance, 50 + Math.sin(angle) * distance];
  const turn = random() * Math.PI * 2;
  let glow = accent(0);

  if (pattern === "cloud") {
    /* Soft discs of colour, blurred into each other. */
    const count = 3 + Math.floor(random() * 3);
    for (let index = 0; index < count; index += 1) {
      const [cx, cy] = at(random() * Math.PI * 2, Math.sqrt(random()) * radius * 0.6);
      layers.push({ d: circle(cx, cy, radius * (0.28 + random() * 0.28)), fill: accent(index), opacity: 0.88, blur: 6.5, spin: true });
    }
  } else if (pattern === "swirl") {
    /* Two or three arms curling out from near the middle. */
    const arms = 2 + Math.floor(random() * 2);
    const wind = (random() > 0.5 ? 1 : -1) * (2.2 + random() * 1.4);
    for (let arm = 0; arm < arms; arm += 1) {
      const start = turn + (arm / arms) * Math.PI * 2;
      const points = Array.from({ length: 24 }, (_, index) => at(start + (index / 23) * wind, radius * (0.05 + (index / 23) * 0.95)));
      layers.push({ d: line(points), fill: "none", line: { color: accent(arm), opacity: 0.95, width: radius * 0.34 }, blur: 3.6, spin: true });
    }
    layers.push({ d: circle(50, 50, radius * 0.18), fill: bright(0), opacity: 0.9, blur: 3, spin: true });
  } else if (pattern === "bands") {
    /* Soft stripes across the stone, gently waved. */
    const count = 3 + Math.floor(random() * 2);
    const gap = (radius * 2) / count;
    const wave = radius * (0.08 + random() * 0.14);
    for (let index = 0; index < count; index += 1) {
      const offset = -radius + gap * (index + 0.5);
      const points = Array.from({ length: 16 }, (_, step) => {
        const along = -radius * 1.4 + (step / 15) * radius * 2.8;
        const across = offset + Math.sin(step / 2.4 + index) * wave;
        return [50 + Math.cos(turn) * along - Math.sin(turn) * across, 50 + Math.sin(turn) * along + Math.cos(turn) * across] as Point;
      });
      layers.push({ d: line(points), fill: "none", line: { color: index % 2 ? bright(index) : accent(index), opacity: 0.9, width: gap * 0.62 }, blur: 3.2 });
    }
  } else if (pattern === "split") {
    /* Two colours meeting along a soft curved seam. */
    const bend = radius * (0.2 + random() * 0.4) * (random() > 0.5 ? 1 : -1);
    const shift = (random() - 0.5) * radius * 0.4;
    const c = Math.cos(turn), s = Math.sin(turn);
    const p = (along: number, across: number) => `${f(50 + c * along - s * across)},${f(50 + s * along + c * across)}`;
    const half = (sign: number) => `M${p(-radius * 1.5, shift)}Q${p(0, shift + bend)} ${p(radius * 1.5, shift)}L${p(radius * 1.5, sign * radius * 1.6)}L${p(-radius * 1.5, sign * radius * 1.6)}Z`;
    layers.push({ d: half(-1), fill: accent(0), opacity: 0.92, blur: 4.5 });
    layers.push({ d: half(1), fill: accent(1, -0.04), opacity: 0.92, blur: 4.5 });
    const [cx, cy] = at(turn - Math.PI / 2, radius * 0.1);
    layers.push({ d: circle(cx, cy, radius * 0.3), fill: bright(2), opacity: 0.55, blur: 6 });
  } else if (pattern === "halo") {
    /* A ring of light inside the stone around a small bright core. */
    const [cx, cy] = at(turn, radius * (0.08 + random() * 0.14));
    layers.push({ d: circle(cx, cy, radius * 0.72), fill: accent(1), opacity: 0.8, blur: 7 });
    layers.push({ d: circle(cx, cy, radius * (0.44 + random() * 0.12)), fill: "none", line: { color: bright(0), opacity: 0.95, width: radius * 0.14 }, blur: 2.4 });
    layers.push({ d: circle(cx, cy, radius * 0.16), fill: bright(2), opacity: 0.95, blur: 2.2 });
    glow = bright(0);
  } else {
    /* A dark field with a haze of colour and sparks scattered through it. */
    for (let index = 0; index < 2; index += 1) {
      const [cx, cy] = at(turn + index * Math.PI, radius * 0.3);
      layers.push({ d: circle(cx, cy, radius * 0.5), fill: accent(index), opacity: 0.55, blur: 8, spin: true });
    }
    const count = 14 + Math.floor(random() * 10);
    for (let index = 0; index < count; index += 1) {
      const [cx, cy] = at(random() * Math.PI * 2, Math.sqrt(random()) * radius * 0.85);
      layers.push({ d: circle(cx, cy, 0.5 + random() * 1.1), fill: random() > 0.35 ? "#fff" : bright(index), opacity: 0.55 + random() * 0.4, spin: true });
    }
  }

  const dark = pattern === "sparks" || family.tone === "dark";
  const glints = Array.from({ length: family.glints + (pattern === "sparks" ? 2 : 0) }, () => {
    const angle = random() * Math.PI * 2;
    const distance = (0.1 + random() * 0.4) * radius;
    return { x: 50 + Math.cos(angle) * distance, y: 50 + Math.sin(angle) * distance, size: 2.2 + random() * 2 };
  });

  return {
    path,
    layers,
    dome: { color: pattern === "sparks" ? oklch([0.12, 0.03, body[2]]) : oklch(family.rim), opacity: dark ? 0.85 : 0.55 },
    highlight: { cx: 50 - radius * 0.3, cy: 50 - radius * 0.42, rx: radius * 0.4, ry: radius * 0.15, rotate: -28 + (random() - 0.5) * 12, opacity: dark ? 0.3 : 0.55 },
    glints,
    glow,
    tone: dark ? "dark" : "light",
    pattern,
    patternName: PATTERN_NAME[pattern],
    family: family.name,
    cut: cut.name,
    name: `${WORDS[hashOf(`${seed}:name`) % WORDS.length]} ${PATTERN_NAME[pattern]}`,
  };
}
