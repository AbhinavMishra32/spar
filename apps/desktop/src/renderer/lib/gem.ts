/**
 * A challenge's gem, as numbers: silhouette, body, flashes of colour, glints.
 *
 * Opal's stones are the reference for the idea — each one yours, collected, with
 * play-of-colour moving inside it — and deliberately not for the rendering. A
 * photographic stone would be the only realistic object in an app drawn in flat
 * surfaces and hairlines, and would sit on a problem page like a sticker. So this
 * is the stone reduced to what makes it read as one: a pebble outline, a body
 * colour, soft patches of colour inside it, one highlight, and a hairline rim.
 *
 * Three inputs decide it, and each one decides something different, so two gems
 * can be compared at a glance:
 *
 * - **Difficulty is the kind of stone.** A foundation challenge is a pale milk
 *   stone with two soft pastel flashes; an advanced one is a dark fire stone with
 *   six hot ones and a few glints. The harder the challenge, the darker the body,
 *   the more colour in it and the more going on — rarity you can see.
 * - **The topic is the cut.** Every challenge on the same subject shares a
 *   silhouette family — egg, pebble, cushion, drop, tumbled, round — hashed from
 *   the primary concept's parent, so trees look like trees across a history.
 * - **The id is everything else.** Where the flashes sit, their exact hues, the
 *   small wobble of the outline and its tilt. The same challenge always wears the
 *   same stone; no two challenges wear the same one.
 *
 * Pure and deterministic: no DOM, no randomness that is not seeded.
 */

export type GemDifficulty = "foundation" | "developing" | "proficient" | "advanced";

export type Gem = {
  /** The outline, a closed cubic path in a 100-unit box around (50, 50). */
  path: string;
  body: string;
  /** Darker edge of the body, for the dome's shading. */
  rim: string;
  flashes: { cx: number; cy: number; r: number; color: string; opacity: number }[];
  flecks: { cx: number; cy: number; r: number; color: string }[];
  glints: { x: number; y: number; size: number }[];
  /** The highlight: an ellipse near the top-left of the dome. */
  highlight: { cx: number; cy: number; rx: number; ry: number; rotate: number; opacity: number };
  /** How much the flashes are blurred, in box units. Lower on harder stones,
   *  whose colour is sharper-edged. */
  blur: number;
  /** Light or dark body, for anything drawn on top of it. */
  tone: "light" | "dark";
  kind: string;
  cut: string;
  /** The stone's own name: a seeded word and its kind, e.g. "Steadfast Crystal". */
  name: string;
};

/* Words for a stone's name. Calm rather than triumphant — this is a record of
   work, not a loot drop. Order is identity: new words go on the end. */
const WORDS = [
  "Steadfast", "Quiet", "Patient", "Bright", "Tidewater", "Northern", "Lantern", "Hollow",
  "Morning", "Ember", "Glacier", "Harbor", "Meadow", "Cinder", "Signal", "Orbit",
  "Drift", "Keystone", "Riverine", "Summit", "Beacon", "Lumen", "Thistle", "Aurora",
];

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

type Stone = {
  kind: string;
  body: [number, number, number];
  rim: [number, number, number];
  /** Flash hues, before the seed moves them. */
  hues: number[];
  lightness: number;
  chroma: number;
  flashes: number;
  /** Small sharp spots of colour over the soft flashes — the intricacy that
   *  grows with difficulty. */
  flecks: number;
  glints: number;
  blur: number;
  tone: "light" | "dark";
};

/* Colours in OKLCH so a stone's flashes are equally bright whatever their hue —
   an HSL yellow beside an HSL blue is two different brightnesses pretending to
   be one. */
const STONES: Record<GemDifficulty, Stone> = {
  foundation: { kind: "Milk stone", body: [0.94, 0.02, 240], rim: [0.8, 0.035, 250], hues: [160, 210, 340], lightness: 0.84, chroma: 0.12, flashes: 3, flecks: 0, glints: 0, blur: 7, tone: "light" },
  developing: { kind: "Crystal", body: [0.8, 0.075, 220], rim: [0.6, 0.1, 235], hues: [185, 140, 250, 300], lightness: 0.78, chroma: 0.17, flashes: 4, flecks: 3, glints: 0, blur: 6, tone: "light" },
  proficient: { kind: "Black opal", body: [0.27, 0.06, 275], rim: [0.17, 0.05, 275], hues: [295, 250, 195, 150, 335], lightness: 0.68, chroma: 0.21, flashes: 5, flecks: 5, glints: 1, blur: 5.5, tone: "dark" },
  advanced: { kind: "Fire stone", body: [0.3, 0.11, 32], rim: [0.18, 0.08, 28], hues: [55, 35, 80, 18, 140, 70], lightness: 0.78, chroma: 0.19, flashes: 6, flecks: 8, glints: 3, blur: 4.5, tone: "dark" },
};

const oklch = ([l, c, h]: [number, number, number]) => `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(3)} ${h.toFixed(0)})`;

/* The cuts, as harmonics of a circle: r(θ) = 1 + Σ aₙ·cos(nθ + φₙ). A second
   harmonic stretches it into an oval, a first makes one end fuller (egg, drop),
   a fourth squares it off (cushion), odd ones make it lumpy (pebble, tumbled).
   Order is identity — a topic's cut is an index into this list — so new cuts go
   on the end. */
const CUTS: { name: string; harmonics: [n: number, a: number][] }[] = [
  { name: "round", harmonics: [[2, 0.04], [3, 0.02]] },
  { name: "egg", harmonics: [[1, 0.1], [2, 0.16]] },
  { name: "pebble", harmonics: [[2, 0.13], [3, 0.07], [5, 0.02]] },
  { name: "cushion", harmonics: [[4, -0.09], [2, 0.05]] },
  { name: "drop", harmonics: [[1, 0.22], [2, 0.09], [3, 0.04]] },
  { name: "tumbled", harmonics: [[3, 0.1], [2, 0.08], [4, 0.04]] },
];

/** Closed Catmull-Rom through the points, as cubic Béziers. */
function smoothPath(points: [number, number][]): string {
  const at = (index: number) => points[(index + points.length) % points.length]!;
  const f = (value: number) => value.toFixed(2);
  let d = `M${f(points[0]![0])},${f(points[0]![1])}`;
  for (let index = 0; index < points.length; index += 1) {
    const [p0, p1, p2, p3] = [at(index - 1), at(index), at(index + 1), at(index + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0]!)},${f(c1[1]!)} ${f(c2[0]!)},${f(c2[1]!)} ${f(p2[0])},${f(p2[1])}`;
  }
  return `${d}Z`;
}

export function gemCut(subject: string): string {
  const key = subject.trim().toLowerCase();
  return CUTS[key ? hashOf(key) % CUTS.length : 0]!.name;
}

export function makeGem({ seed, difficulty, subject = "", radius = 36 }: { seed: string; difficulty: GemDifficulty; subject?: string; radius?: number }): Gem {
  const random = seeded(seed);
  const stone = STONES[difficulty];
  const cut = CUTS.find((entry) => entry.name === gemCut(subject))!;

  /* The outline: the cut's harmonics, each nudged by the seed, with a random
     phase for the odd ones and a small tilt for the whole stone. Normalised to
     the widest point so every cut fills the same box. */
  const tilt = (random() - 0.5) * 0.7;
  const harmonics = cut.harmonics.map(([n, a]) => ({ n, a: a * (0.75 + random() * 0.5), phase: n % 2 ? random() * Math.PI * 2 : n === 1 ? Math.PI / 2 : 0 }));
  const samples = 36;
  const raw = Array.from({ length: samples }, (_, index) => {
    const theta = (index / samples) * Math.PI * 2;
    const r = 1 + harmonics.reduce((sum, { n, a, phase }) => sum + a * Math.cos(n * theta + phase), 0);
    return { theta: theta + tilt, r };
  });
  const widest = Math.max(...raw.map((point) => point.r));
  const points = raw.map(({ theta, r }) => [50 + Math.cos(theta) * (r / widest) * radius, 50 + Math.sin(theta) * (r / widest) * radius] as [number, number]);

  /* Flashes: soft discs of colour scattered inside the stone, blurred into each
     other. Hues come from the stone's own set, turned a little by the seed so
     two black opals are not the same black opal. */
  const drift = (random() - 0.5) * 40;
  const flashes = Array.from({ length: stone.flashes }, (_, index) => {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius * 0.62;
    const hue = (stone.hues[index % stone.hues.length]! + drift + (random() - 0.5) * 24 + 360) % 360;
    const lightness = stone.lightness + (random() - 0.5) * 0.08;
    return {
      cx: 50 + Math.cos(angle) * distance,
      cy: 50 + Math.sin(angle) * distance,
      r: radius * (0.3 + random() * 0.28),
      color: oklch([lightness, stone.chroma, hue]),
      opacity: stone.tone === "dark" ? 0.92 : 0.85,
    };
  });

  const flecks = Array.from({ length: stone.flecks }, () => {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius * 0.7;
    const hue = (stone.hues[Math.floor(random() * stone.hues.length)]! + drift + 360) % 360;
    return { cx: 50 + Math.cos(angle) * distance, cy: 50 + Math.sin(angle) * distance, r: radius * (0.07 + random() * 0.09), color: oklch([Math.min(0.95, stone.lightness + 0.08), stone.chroma, hue]) };
  });

  const glints = Array.from({ length: stone.glints }, () => {
    const angle = random() * Math.PI * 2;
    const distance = (0.25 + random() * 0.45) * radius;
    return { x: 50 + Math.cos(angle) * distance, y: 50 + Math.sin(angle) * distance, size: 2.2 + random() * 2.2 };
  });

  return {
    path: smoothPath(points),
    body: oklch(stone.body),
    rim: oklch(stone.rim),
    flashes,
    flecks,
    glints,
    highlight: { cx: 50 - radius * 0.3, cy: 50 - radius * 0.42, rx: radius * 0.42, ry: radius * 0.16, rotate: -28 + (random() - 0.5) * 12, opacity: stone.tone === "dark" ? 0.3 : 0.55 },
    blur: stone.blur,
    tone: stone.tone,
    kind: stone.kind,
    cut: cut.name,
    name: `${WORDS[hashOf(`${seed}:name`) % WORDS.length]} ${stone.kind.replace(/^\w/, (c) => c.toUpperCase()).replace(/ (\w)/g, (_, c: string) => ` ${c.toUpperCase()}`)}`,
  };
}
