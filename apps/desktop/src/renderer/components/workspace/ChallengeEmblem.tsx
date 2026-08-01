import { useMemo } from "react";
import type { ActiveQuestion } from "@spar/domain";
import { cn } from "@/lib/utils";

/**
 * Every challenge gets its own emblem, generated from its id rather than fetched.
 * A remote art API would put a network round-trip — and the challenge id — on the
 * path of opening a challenge, and would leave a hole in the UI offline. Seeding
 * from the id gives the same properties people want from random art (each one
 * unique, none of them designed by hand) while staying instant and stable: the
 * same challenge always wears the same face.
 */

/** FNV-1a over the id, then a small xorshift PRNG so every draw is repeatable. */
function seedFrom(value: string): () => number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  let state = hash >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/** Difficulty anchors the hue so the emblem reads as a rank at a glance. */
const DIFFICULTY_HUE: Record<ActiveQuestion["difficulty"], number> = {
  foundation: 158,
  developing: 42,
  proficient: 268,
  advanced: 356,
};

type Ring = { radius: number; dash: string; width: number; opacity: number; spin: number };
type Shard = { points: string; opacity: number };

export function ChallengeEmblem({
  question,
  size = 56,
  className,
  animated = true,
}: {
  question: Pick<ActiveQuestion, "id" | "difficulty" | "ordinal">;
  size?: number;
  className?: string;
  animated?: boolean;
}) {
  const art = useMemo(() => {
    const random = seedFrom(question.id);
    const baseHue = DIFFICULTY_HUE[question.difficulty];
    // Drift stays narrow so difficulty remains readable across challenges.
    const hue = (baseHue + Math.round(random() * 36) - 18 + 360) % 360;
    const partnerHue = (hue + 24 + Math.round(random() * 44)) % 360;

    const rings: Ring[] = Array.from({ length: 3 }, (_, index) => {
      const radius = 30 + index * 9;
      const segments = 6 + Math.floor(random() * 10);
      const arc = (2 * Math.PI * radius) / segments;
      const filled = arc * (0.25 + random() * 0.5);
      return {
        radius,
        dash: `${filled.toFixed(1)} ${(arc - filled).toFixed(1)}`,
        width: 1 + random() * 1.6,
        opacity: 0.75 - index * 0.16,
        spin: (index % 2 === 0 ? 1 : -1) * (26 + random() * 26),
      };
    });

    const shards: Shard[] = Array.from({ length: 3 + Math.floor(random() * 3) }, () => {
      const corners = 3 + Math.floor(random() * 2);
      const spread = 12 + random() * 16;
      const originAngle = random() * Math.PI * 2;
      const points = Array.from({ length: corners }, (_, corner) => {
        const angle = originAngle + (corner / corners) * Math.PI * 2 + random() * 0.5;
        const distance = spread * (0.55 + random() * 0.75);
        return `${(64 + Math.cos(angle) * distance).toFixed(1)},${(64 + Math.sin(angle) * distance).toFixed(1)}`;
      }).join(" ");
      return { points, opacity: 0.16 + random() * 0.28 };
    });

    const spokes = Array.from({ length: 10 + Math.floor(random() * 10) }, () => {
      const angle = random() * Math.PI * 2;
      const inner = 20 + random() * 8;
      const outer = inner + 3 + random() * 9;
      return {
        x1: (64 + Math.cos(angle) * inner).toFixed(1),
        y1: (64 + Math.sin(angle) * inner).toFixed(1),
        x2: (64 + Math.cos(angle) * outer).toFixed(1),
        y2: (64 + Math.sin(angle) * outer).toFixed(1),
        opacity: 0.2 + random() * 0.5,
      };
    });

    return { hue, partnerHue, rings, shards, spokes, uid: question.id.replace(/[^a-z0-9]/gi, "").slice(0, 10) };
  }, [question.id, question.difficulty]);

  const core = `hsl(${art.hue} 72% 56%)`;
  const partner = `hsl(${art.partnerHue} 74% 62%)`;

  return (
    <svg
      aria-hidden="true"
      className={cn("shrink-0 select-none", className)}
      height={size}
      viewBox="0 0 128 128"
      width={size}
    >
      <defs>
        <radialGradient id={`core-${art.uid}`} cx="38%" cy="32%" r="78%">
          <stop offset="0%" stopColor={partner} stopOpacity="0.95" />
          <stop offset="55%" stopColor={core} stopOpacity="0.85" />
          <stop offset="100%" stopColor={core} stopOpacity="0.28" />
        </radialGradient>
        {/* The metallic sweep that makes it read as struck rather than printed. */}
        <linearGradient id={`sheen-${art.uid}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="42%" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.18" />
        </linearGradient>
        <clipPath id={`clip-${art.uid}`}>
          <circle cx="64" cy="64" r="52" />
        </clipPath>
      </defs>

      <circle cx="64" cy="64" r="52" fill={`url(#core-${art.uid})`} />

      <g clipPath={`url(#clip-${art.uid})`}>
        {art.shards.map((shard, index) => (
          <polygon key={index} fill="#fff" fillOpacity={shard.opacity} points={shard.points} />
        ))}
      </g>

      {art.rings.map((ring, index) => (
        <circle
          key={index}
          cx="64"
          cy="64"
          fill="none"
          r={ring.radius}
          stroke="#fff"
          strokeDasharray={ring.dash}
          strokeLinecap="round"
          strokeOpacity={ring.opacity}
          strokeWidth={ring.width}
          style={
            animated
              ? { transformOrigin: "64px 64px", animation: `emblem-spin ${Math.abs(ring.spin)}s linear infinite ${ring.spin < 0 ? "reverse" : ""}` }
              : undefined
          }
        />
      ))}

      <g>
        {art.spokes.map((spoke, index) => (
          <line
            key={index}
            stroke="#fff"
            strokeLinecap="round"
            strokeOpacity={spoke.opacity}
            strokeWidth="1.5"
            x1={spoke.x1}
            x2={spoke.x2}
            y1={spoke.y1}
            y2={spoke.y2}
          />
        ))}
      </g>

      <circle cx="64" cy="64" r="52" fill={`url(#sheen-${art.uid})`} />
      <circle cx="64" cy="64" fill="none" r="52" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.5" />
      <circle cx="64" cy="64" fill="none" r="57" stroke={core} strokeOpacity="0.4" strokeWidth="1" />

      <text
        dominantBaseline="central"
        fill="#fff"
        fillOpacity="0.96"
        fontFamily="var(--font-sans)"
        fontSize="34"
        fontWeight="600"
        letterSpacing="-1"
        textAnchor="middle"
        x="64"
        y="66"
      >
        {question.ordinal}
      </text>
    </svg>
  );
}
