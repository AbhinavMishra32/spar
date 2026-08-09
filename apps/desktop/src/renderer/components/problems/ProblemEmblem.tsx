import { useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * A problem's mark: a small solid chip, stamped rather than drawn.
 *
 * Generated from the problem itself rather than fetched — a remote art service
 * would put a round trip and a problem id on the path of drawing a list, and
 * would leave a grid full of holes offline.
 *
 * Two decisions are worth defending because the obvious version of this
 * component is worse than both.
 *
 * **The shape is the subject, and it is the only thing that means anything.**
 * Every graph problem wears the same silhouette, every string problem another,
 * hashed from the problem's first tag so it is stable across sources: Codeforces'
 * `graphs` and a Spar challenge tagged Graphs stamp the same chip. Within a
 * subject, seeded facets tell two problems apart.
 *
 * **It is monochrome.** Difficulty is already said twice on every card — by the
 * band pill and by the filter that put the card there — and saying it a third
 * time in saturated colour turns a list of problems into a shelf of trophies.
 * The chip is ink at low alpha over whatever surface it lands on, which is how
 * the rest of Spar's chrome is built and why it needs no dark-mode branch.
 */

/** FNV-1a, then a small xorshift PRNG so every draw from a seed is repeatable. */
function seedFrom(value: string): () => number {
  let hash = hashOf(value);
  let state = hash >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function hashOf(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/* Geometry. Everything is built at radius `R` around (50,50) in a 100-unit box,
   and the corners are rounded by stroking each silhouette with its own fill at
   `JOIN` width and a round line join — which costs one attribute instead of arc
   maths per vertex, and rounds a triangle's points as happily as an octagon's. */
const R = 33;
const JOIN = 10;

function polygon(count: number, rotation: number, radius = R): string {
  return Array.from({ length: count }, (_, index) => {
    const angle = ((rotation + (360 / count) * index) * Math.PI) / 180;
    return `${(50 + Math.cos(angle) * radius).toFixed(2)},${(50 + Math.sin(angle) * radius).toFixed(2)}`;
  }).join(" ");
}

/**
 * The silhouettes, in a fixed order that must never be reshuffled: a problem's
 * shape is an index into this list, so moving an entry re-stamps every chip in
 * the app. New shapes go on the end.
 *
 * All of them are convex and all of them are close to the same area. Spikier
 * forms — stars, crosses — were tried and thrown out: at 40px beside a title they
 * read as badges awarded for something rather than as a mark identifying a
 * subject, which is exactly the tone this list must not take.
 */
const SHAPES: string[] = [
  polygon(24, 0), // a circle, near enough, and the fallback for an untagged problem
  polygon(6, 0), // hexagon, flat-top
  polygon(4, -45), // square
  polygon(4, -90), // diamond
  polygon(3, -90, R * 1.14), // triangle, grown to carry the same visual weight
  polygon(5, -90), // pentagon
  polygon(8, -67.5), // octagon
  polygon(7, -90), // heptagon
  polygon(6, 30), // hexagon, pointy-top
  polygon(5, 90), // pentagon, inverted
  polygon(10, -90), // decagon
  polygon(3, 90, R * 1.14), // triangle, inverted
];

/** Ink over the surface behind it, at the alphas the rest of the chrome uses.
 *  `color-mix` against `--foreground` rather than a fixed grey, so the chip is
 *  correct in both themes without either knowing about the other. */
const ink = (percent: number) => `color-mix(in oklab, var(--foreground) ${percent}%, transparent)`;

export type ProblemEmblemProps = {
  /** Stable identity: the same string must always stamp the same chip. */
  seed: string;
  /** What the problem is about. Decides the silhouette; empty falls back to the
   *  circle, which is honest — an untagged problem has no subject to show. */
  subject: string;
  size?: number;
  className?: string;
  /** Off below about 28px, where the facets close up into a smudge. */
  detail?: boolean;
};

export function ProblemEmblem({ className, detail = true, seed, size = 40, subject }: ProblemEmblemProps) {
  const art = useMemo(() => {
    const key = normalize(subject);
    // Index 0 — the circle — is reserved for a problem with nothing to say about
    // itself, rather than being handed out by a hash of the empty string.
    const shape = SHAPES[key ? hashOf(key) % SHAPES.length : 0]!;
    const random = seedFrom(seed);
    /* Facets: two or three straight cuts across the face at seeded angles. This
       is the whole of what distinguishes two problems on the same subject, and it
       is deliberately the quietest thing on the chip — identity you notice on the
       second look, not decoration you notice on the first. */
    const facets = Array.from({ length: 2 + Math.floor(random() * 2) }, () => {
      const angle = random() * Math.PI;
      const offset = (random() - 0.5) * 34;
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      return {
        x1: (50 - ny * offset - nx * 60).toFixed(1),
        y1: (50 + nx * offset - ny * 60).toFixed(1),
        x2: (50 - ny * offset + nx * 60).toFixed(1),
        y2: (50 + nx * offset + ny * 60).toFixed(1),
      };
    });
    return { shape, facets, uid: `pe${hashOf(seed).toString(36)}` };
  }, [seed, subject]);

  const { uid } = art;

  return (
    <svg
      aria-hidden="true"
      className={cn("shrink-0 select-none", className)}
      height={size}
      viewBox="0 0 100 100"
      width={size}
    >
      <defs>
        {/* Lit from above and settling into the lower edge. Two alphas of the same
            ink, which is all the relief a 40px chip can hold without turning into
            a button. */}
        <linearGradient id={`face-${uid}`} x1="0.25" x2="0.7" y1="0" y2="1">
          <stop offset="0%" stopColor={ink(26)} />
          <stop offset="100%" stopColor={ink(15)} />
        </linearGradient>
        <clipPath id={`clip-${uid}`}>
          <polygon points={art.shape} stroke="#000" strokeLinejoin="round" strokeWidth={JOIN} />
        </clipPath>
      </defs>

      {/* The body. Filled and stroked with the same paint, which is what rounds
          the corners without touching the point list. */}
      <polygon
        fill={`url(#face-${uid})`}
        points={art.shape}
        stroke={`url(#face-${uid})`}
        strokeLinejoin="round"
        strokeWidth={JOIN}
      />

      <g clipPath={`url(#clip-${uid})`}>
        {detail && art.facets.map((facet, index) => (
          <line key={index} stroke={ink(8)} strokeWidth="1" x1={facet.x1} x2={facet.x2} y1={facet.y1} y2={facet.y2} />
        ))}

        {/* The bevel, in one stroke. The silhouette outlined and pushed down
            leaves a lighter line on the top inside edge only — the difference
            between a flat shape and a stamped one, and as far as this goes.
            White rather than `--background`: the chip is ink over the card, so it
            is darker than the card in the light theme and lighter in the dark one,
            and a top edge lit from the page would point the wrong way in one of
            them. Light is light in both. */}
        <polygon
          fill="none"
          points={art.shape}
          stroke="#fff"
          strokeLinejoin="round"
          strokeOpacity="0.4"
          strokeWidth="2.5"
          transform="translate(0 2.2)"
        />
      </g>

      {/* The rim, last, so nothing inside paints over it. */}
      <polygon fill="none" points={art.shape} stroke={ink(22)} strokeLinejoin="round" strokeWidth="1.25" />
    </svg>
  );
}

/** A tag reduced to the thing two sources would agree on: LeetCode's
 *  `hash-table`, Codeforces' `data structures` and a Spar concept titled
 *  "Hash Table" all have to hash to one shape or the shape means nothing. */
function normalize(subject: string): string {
  return subject.toLowerCase().replace(/[^a-z0-9]/g, "");
}
