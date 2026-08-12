/**
 * Spar's mark: the five-by-five grid the app icon is drawn from.
 *
 * The geometry is the desktop app's `SparDots`, on purpose — same grid, same
 * fill, same taper — so the glyph in the nav here and the one that animates
 * during a test run in the app are the same object rather than two drawings of
 * it. Dots are largest and brightest along the leading diagonal and fall away
 * towards the two off-corners.
 */

/** Dots per side. */
const GRID = 5;
/** Largest dot as a fraction of the grid step, from the icon renderer. */
const DOT_FILL = 0.78;
/** How far size and tone fall off the diagonal at rest, from the icon renderer. */
const TAPER = 0.55;

/* Laid out in a 100-unit box, inset by the largest dot's radius so the grid
   fills it — the icon's squircle padding would read as lost alignment inline. */
const step = 100 / (GRID - 1 + DOT_FILL);
const radius = (step * DOT_FILL) / 2;

export type MarkDot = {
  key: number;
  cx: number;
  cy: number;
  /** Resting scale, identical to the icon's taper. */
  rest: number;
  /** Resting alpha. Compressed against the icon's, which is never drawn small. */
  tone: number;
  /** Position along the diagonal, 0 top-left to 1 bottom-right. Drives delay. */
  along: number;
};

export const markDots: readonly MarkDot[] = Array.from({ length: GRID * GRID }, (_, index) => {
  const row = Math.floor(index / GRID);
  const column = index % GRID;
  const rest = 1 - (TAPER * Math.abs(row - column)) / (GRID - 1);
  return {
    key: index,
    cx: radius + column * step,
    cy: radius + row * step,
    rest,
    tone: 0.45 + 0.55 * rest,
    along: (row + column) / (2 * (GRID - 1)),
  };
});

export const markRadius = radius;

/** One cycle of the wave, in seconds, and how much of it the band's travel takes. */
const WAVE_DURATION = 1.5;
const WAVE_TRAVEL = 0.55;

export function Mark({
  size = 22,
  animated = false,
  className,
}: {
  size?: number;
  /** Runs the app's diagonal wave. Off by default: a logo should hold still. */
  animated?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
      className={className}
      style={{ display: "block", flexShrink: 0 }}
    >
      {markDots.map((dot) => (
        <circle
          key={dot.key}
          cx={dot.cx}
          cy={dot.cy}
          r={radius}
          style={{
            transformOrigin: `${dot.cx}px ${dot.cy}px`,
            transform: `scale(${dot.rest})`,
            opacity: dot.tone,
            ...(animated
              ? {
                  animationName: "spar-dots-wave",
                  animationDuration: `${WAVE_DURATION}s`,
                  animationIterationCount: "infinite",
                  animationTimingFunction: "ease-in-out",
                  animationDelay: `${-WAVE_DURATION * (1 - WAVE_TRAVEL * dot.along)}s`,
                }
              : {}),
            ["--dot-rest" as string]: dot.rest,
            ["--dot-tone" as string]: dot.tone,
          }}
        />
      ))}
    </svg>
  );
}

/** The mark beside the wordmark. The one lockup the site uses. */
export function Wordmark({ size = 22, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Mark size={size} animated={animated} />
      <span
        className="font-display text-[1.06rem] leading-none"
        style={{ fontWeight: "var(--brand-weight, 600)", letterSpacing: "-0.02em" }}
      >
        Spar
      </span>
    </span>
  );
}
