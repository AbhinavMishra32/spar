import { cn } from "@/lib/utils";

/** The five-by-five grid the app icon is drawn from, animated.
 *
 *  The icon's resting state already has a direction: dots are largest and
 *  brightest along the leading diagonal and taper towards the two off-corners.
 *  Every pattern here is that same diagonal put in motion, so a loading state
 *  reads as the mark coming alive rather than as a spinner that happens to be
 *  made of dots.
 *
 *  Motion is CSS only — a per-dot `animation-delay` off the dot's diagonal
 *  position. Nothing ticks in JavaScript, which matters because these run during
 *  exactly the moments the app is busy doing something else. */

const GRID = 5;
/** Largest dot as a fraction of the grid step, from the icon renderer. */
const DOT_FILL = 0.78;
/** How far size and tone fall off the diagonal at rest, from the icon renderer. */
const TAPER = 0.55;

export type DotPattern =
  /** A band travelling down the diagonal — the mark waking up. For work that is
   *  actively producing something: a test run, a page being opened. */
  | "wave"
  /** One brighter pass with a longer gap behind it. For longer waits where a
   *  continuous wave would read as busier than the app actually is. */
  | "sweep"
  /** The whole grid breathing, diagonal intact. For reading and thinking, where
   *  there is no progress to imply. */
  | "pulse"
  /** The resting mark. What reduced-motion collapses to, and usable on its own
   *  as a small brand glyph. */
  | "still";

/* The dot geometry, in a 100-unit box. Unlike the app icon there is no squircle
   to sit inside, so the grid is inset by just the largest dot's radius and fills
   the box — an inline loader with the icon's shadow padding baked in would look
   like it had lost its alignment. */
const step = 100 / (GRID - 1 + DOT_FILL);
const radius = (step * DOT_FILL) / 2;
const dots = Array.from({ length: GRID * GRID }, (_, index) => {
  const row = Math.floor(index / GRID);
  const column = index % GRID;
  const distance = Math.abs(row - column) / (GRID - 1);
  const rest = 1 - TAPER * distance;
  return {
    key: index,
    cx: radius + column * step,
    cy: radius + row * step,
    /** Resting scale, identical to the icon's taper. */
    rest,
    /* The icon ties tone to size, but the icon is never smaller than 16px square
       in total. Here a 16px loader gives each dot about three pixels, and at the
       icon's alpha the off-diagonal corners simply vanish — leaving a mark that
       reads as a diagonal line rather than as a grid. So the tone range is
       compressed and the diagonal is carried by size, which survives being
       small. */
    restTone: 0.45 + 0.55 * rest,
    /** Position along the diagonal, 0 at the top-left corner and 1 at the
     *  bottom-right. Drives the delay, so a band travels corner to corner. */
    along: (row + column) / (2 * (GRID - 1)),
  };
});

const DURATION: Record<Exclude<DotPattern, "still">, number> = {
  wave: 1.5,
  sweep: 2.2,
  pulse: 1.8,
};
/** How much of the cycle the travel occupies. The rest is the band off-screen,
 *  which is what separates one pass from the next. */
const TRAVEL = 0.55;

export function SparDots({
  pattern = "wave",
  size = 20,
  label,
  className,
}: {
  pattern?: DotPattern;
  /** Rendered size in px. Legible from about 14px up. */
  size?: number;
  /** Announced to screen readers. Omit for decoration next to its own text. */
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn("spar-dots inline-block shrink-0 align-middle", className)}
      style={{ width: size, height: size }}
      {...(label ? { role: "status", "aria-label": label } : { "aria-hidden": true })}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} fill="currentColor">
        {dots.map((dot) => (
          <circle
            key={dot.key}
            cx={dot.cx}
            cy={dot.cy}
            r={radius}
            /* Scale about the dot's own centre rather than the box's. */
            style={{
              transformOrigin: `${dot.cx}px ${dot.cy}px`,
              transform: `scale(${dot.rest})`,
              opacity: dot.restTone,
              ...(pattern === "still"
                ? {}
                : {
                    animationName: `spar-dots-${pattern}`,
                    animationDuration: `${DURATION[pattern]}s`,
                    animationIterationCount: "infinite",
                    animationTimingFunction: "ease-in-out",
                    animationDelay: `${-DURATION[pattern] * (1 - TRAVEL * dot.along)}s`,
                  }),
              // Read by the keyframes so each dot departs from and returns to its
              // own resting values, instead of the grid collapsing to a uniform
              // one every cycle.
              ["--dot-rest" as string]: dot.rest,
              ["--dot-tone" as string]: dot.restTone,
            }}
          />
        ))}
      </svg>
    </span>
  );
}

/** The dot mark beside a line of text, at text size. The pairing turns up often
 *  enough — every "doing something…" line in the app — to be worth naming, and
 *  it keeps the gap and the muted tone consistent between them. */
export function SparDotsLine({
  children,
  pattern = "wave",
  size = 18,
  className,
}: {
  children: React.ReactNode;
  pattern?: DotPattern;
  size?: number;
  className?: string;
}) {
  return (
    <p className={cn("flex items-center gap-2 text-ui text-muted-foreground", className)}>
      <SparDots pattern={pattern} size={size} />
      {children}
    </p>
  );
}
