import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LearnerProgress, RatingPoint } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime, shortTime } from "@/lib/format";
import { Panel } from "../common/Page";
import { approximateRating, sparRating, type ContestSite } from "@/lib/ratingScale";
import { SourceGlyph } from "../common/SourceGlyph";

/**
 * The rating, as the page's masthead.
 *
 * This is the one number Spar is for, so it opens the page. It stays a panel,
 * like the two under it: what was wrong with this page was never that it had
 * cards on it, it was that it had eight of them, all the same height, none of
 * them first. The ranking is size and content rather than a change of material —
 * this is four figures and a curve, and the assignment below it is drawn twice
 * as tall because it is the thing you came to act on.
 *
 * Everything on the collapsed face is a fact about where the learner stands:
 * the figure at display size, the move since the last point, the contest
 * scales it approximately corresponds to, and a curve you can read a shape off.
 * Nothing here is a caption. Clicking it opens the history — every change and
 * what moved it — which is what lets the face stay four figures and a line.
 *
 * `eyebrow` is the page's own line above the figure, and `footer` is whatever it
 * wants to hang under the same rule. Home puts the date in one and its four
 * counts in the other, so the whole standing of the learner is one block of type
 * with one rule under it rather than three stacked boxes.
 *
 * The chart is deliberately unlabelled on the x axis. These points are attempts,
 * not days; spacing them by time would draw a flat line through a week off and a
 * cliff through a long session, and neither is what happened.
 */
export function RatingHero({ api, eyebrow, footer, progress }: { api?: SparApi | undefined; eyebrow?: React.ReactNode; footer?: React.ReactNode; progress: LearnerProgress }) {
  const [open, setOpen] = useState(false);
  const sites = useContestSites(api);
  const history = progress.ratingHistory;
  const previous = history.length > 1 ? history[history.length - 2] : undefined;
  /* The move is computed in the band it is shown in. Taking the difference of the
     underlying ratings and printing it beside a figure on a different scale would
     put a "+14" next to a number that went up by 10. */
  const rating = sparRating(progress.rating.rating);
  const delta = previous ? rating - sparRating(previous.rating) : null;

  return (
    /* Monochrome, and no `--tone` set anywhere on it. The figure was drawn in a
       band colour for a while, on the argument that a contest rating is read by
       its colour first. That is true of a site that ranks you against other
       people; here there is nobody else, so all the colour did was make the one
       number on the page look like a logo and move under the reader for reasons
       they had no legend for. The curve reads `var(--tone, currentColor)` and so
       falls back to the foreground on its own. */
    <Panel className="overflow-hidden">
      {eyebrow && <p className="px-5 pt-3 text-ui text-muted-foreground">{eyebrow}</p>}

      <button
        aria-expanded={open}
        /* No hover fill on the block itself. A masthead that lights up under the
           pointer reads as a row in a list, and this is not one — the disclosure
           lives on the label, which is the only part of this that is a control
           rather than a reading. */
        className="group flex w-full items-end justify-between gap-6 px-5 pb-4 pt-1.5 text-left outline-none transition-colors hover:bg-accent/15 focus-visible:bg-accent/15"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <div className="min-w-0">
          <span className="flex items-center gap-1 text-ui text-muted-foreground transition-colors group-hover:text-foreground">
            Spar Rating
            <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
          </span>

          <span className="mt-0.5 flex items-baseline gap-2.5">
            <strong className="text-[2.6rem] font-semibold leading-none tabular-nums tracking-[-0.05em]">{rating}</strong>
            {delta !== null && delta !== 0 && (
              <span className={cn("text-content font-medium tabular-nums", delta > 0 ? "text-[var(--success)]" : "text-muted-foreground")}>
                {delta > 0 ? "+" : ""}{delta}
              </span>
            )}
            {/* Titled, because the word is a claim about an interval and the
                interval is a number Spar has. Anyone who wants it spelled out
                opens the panel, where it is printed rather than hinted. */}
            {progress.rating.provisional && (
              <span
                className="rounded-[var(--radius-md)] border-[length:var(--hairline)] border-[var(--border-surface-strong)] bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-ui-sm text-muted-foreground"
                title={`Spar puts you between ${sparRating(progress.rating.rating - progress.rating.deviation)} and ${sparRating(progress.rating.rating + progress.rating.deviation)}. The figure settles as more challenges are graded.`}
              >
                Provisional
              </span>
            )}
          </span>

          {/* What the number means somewhere the learner already has a feel for.
              On the collapsed face, because "am I a 1600 on LeetCode yet" is the
              question the headline figure is being read to answer. Labelled
              approximate and rounded, because it is a translation of Spar's own
              evidence and not a score either site has given anybody — and named
              per connected source, so it answers for the accounts this learner
              actually has. See `useContestSites` and `approximateRating`. */}
          <span className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-ui-sm text-muted-foreground">Roughly</span>
            {sites.map((site) => (
              <Equivalent key={site} label={SITE_NAME[site]} source={site} value={approximateRating(progress.rating.rating, site)} />
            ))}
          </span>
        </div>

        <div className="hidden w-[19rem] shrink-0 sm:block">
          <RatingChart className="h-16" points={history} />
          {/* What moved it last, and when. This used to read "7 changes", which
              the curve beside it already says and says better — the thing the
              learner cannot get from the shape is which challenge did it. */}
          <span className="mt-1 flex items-baseline justify-between gap-3 text-ui-sm text-muted-foreground">
            <span className="truncate">{progress.rating.reason || (history.length > 1 ? `${history.length} changes` : "First rating")}</span>
            <span className="shrink-0">{relativeTime(progress.rating.occurredAt)}</span>
          </span>
        </div>
      </button>

      {open && (
        /* The chart is the history. Listing every change under it was a list
           with one row per attempt — fine at five points, a page of identical
           rows at fifty — so each point carries its own reason and gives it
           up on hover instead. Nothing is hidden that was not already
           impossible to read. */
        <div className="border-t-[length:var(--hairline)] border-[var(--border-surface-strong)] px-5 pb-4 pt-4">
          <RatingChart className="h-28" points={history} showInterval showPoints />
          <Reading progress={progress} />
        </div>
      )}

      {footer && <div className="border-t-[length:var(--hairline)] border-[var(--border-surface-strong)]">{footer}</div>}
    </Panel>
  );
}

const SITE_NAME: Record<ContestSite, string> = { leetcode: "LeetCode", codeforces: "Codeforces" };

/**
 * Which scales the learner is actually shown themselves on.
 *
 * The translation used to name LeetCode and Codeforces unconditionally, which
 * made it a fact about Spar's code rather than about this learner: somebody who
 * has only ever connected Codeforces was told a LeetCode number they have no
 * account behind. So it follows the practice sources, and it follows them live —
 * connecting or dropping one is an event the main process emits, and this reads
 * it the same way Settings does rather than waiting for the window to be
 * reopened.
 *
 * With nothing connected it shows both, because the sites are still the two
 * scales the figure is being read against, and an empty row under "Roughly"
 * would be a worse answer than a general one.
 */
function useContestSites(api: SparApi | undefined): ContestSite[] {
  const [connected, setConnected] = useState<ContestSite[] | null>(null);

  const read = useCallback(async () => {
    if (!api) return;
    const inventory = await api.practiceSources();
    setConnected(inventory.filter((item) => item.state === "connected").map((item) => item.source));
  }, [api]);

  useEffect(() => { void read().catch(() => setConnected(null)); }, [read]);
  useEffect(() => api?.onPracticeSourceEvent(() => { void read().catch(() => undefined); }), [api, read]);

  return connected?.length ? [...connected].sort(SITE_ORDER) : ["codeforces", "leetcode"];
}

/* Codeforces first wherever both are shown: it is the scale the rating is
   estimated on, so it is the translation with nothing lost in it. */
function SITE_ORDER(a: ContestSite, b: ContestSite) {
  return (a === "codeforces" ? 0 : 1) - (b === "codeforces" ? 0 : 1);
}

/* Both figures are translations of the same estimate, and they are not equally
   approximate. The estimate is made on the Codeforces scale, so that number is
   the estimate — it carries no "~". LeetCode is interpolated between anchors and
   says so. Printing a tilde on both would have been the tidier row and the less
   honest one. */
function Equivalent({ label, source, value }: { label: string; source: ContestSite; value: number }) {
  const approximate = source !== "codeforces";
  return (
    <span className="flex items-center gap-1.5 text-ui" title={approximate ? `Approximate ${label} rating` : `${label} rates problems on this scale, so this is the same estimate`}>
      <SourceGlyph className="size-4" source={source} />
      <span className="tabular-nums font-medium text-foreground">{approximate ? "~" : ""}{value}</span>
    </span>
  );
}

/**
 * What the chart is actually claiming, in two sentences.
 *
 * Both come straight out of the rating system rather than being written about
 * it. The band is the rating deviation, so the interval is quoted as the numbers
 * the estimate carries; the even-money line is the definition of a Codeforces
 * problem rating, which is the one falsifiable thing Spar says about this figure
 * and the reason the estimate is run on that scale at all.
 *
 * Here rather than on the collapsed face because it is an explanation, and the
 * face is for facts. Somebody who wants to know what "Provisional" means has
 * already clicked.
 */
function Reading({ progress }: { progress: LearnerProgress }) {
  const { rating, deviation, provisional } = progress.rating;
  const low = sparRating(rating - deviation);
  const high = sparRating(rating + deviation);
  return (
    <dl className="mt-3 grid gap-x-6 gap-y-1.5 border-t-[length:var(--hairline)] border-[var(--border-surface-strong)] pt-3 sm:grid-cols-2">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-ui-sm text-muted-foreground">Confidence</dt>
        <dd className="text-ui tabular-nums">
          {low}&thinsp;–&thinsp;{high}
          <span className="ml-1.5 text-ui-sm text-muted-foreground">{provisional ? "still wide" : "settled"}</span>
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-ui-sm text-muted-foreground">Even money against</dt>
        <dd className="text-ui tabular-nums">
          {approximateRating(rating, "codeforces")}
          <span className="ml-1.5 text-ui-sm text-muted-foreground">rated Codeforces</span>
        </dd>
      </div>
    </dl>
  );
}

/**
 * The curve.
 *
 * Three layers, all clipped to the same left-to-right sweep so the history is
 * laid down in the order it happened:
 *
 * The band is the rating deviation — Glicko-2's own statement of how well this
 * number is known, which every other rating UI throws away and prints as a
 * badge. It is wide at the start, because Spar knew nothing, and it closes as the
 * learner accumulates results; a curve inside a narrowing band is a far more
 * honest picture than a confident line, and it makes "Provisional" something you
 * can see rather than a word you are asked to take on trust.
 *
 * The area under the line is what makes a rise read as a rise at sparkline size.
 * The line is the estimate itself. The last point is always marked, because
 * "where am I now" is the question the chart is being read to answer.
 *
 * A flat history still draws a line rather than an empty box — one rating is a
 * true fact about the learner and deserves to be shown as one.
 */
export function RatingChart({ className, points, showInterval = false, showPoints = false }: { className?: string | undefined; points: RatingPoint[]; showInterval?: boolean; showPoints?: boolean }) {
  const id = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const shape = useMemo(() => {
    const values = points.length > 1 ? points : points.length ? [points[0]!, points[0]!] : [];
    if (!values.length) return null;
    const ratings = values.map((point) => sparRating(point.rating));
    /* The current interval, in the band the figure is shown in. Defended against
       a point with no deviation on it: every row the store writes carries one,
       but a snapshot restored from a build that predates the column reads as
       undefined, and a chart that renders NaN paths draws nothing at all. */
    const current = values[values.length - 1]!;
    const spread = current.deviation || 0;
    const interval = [sparRating(current.rating - spread), sparRating(current.rating + spread)] as const;
    /* Scaled to the line, plus the one interval that is drawn. Fitting every
       point's interval was the first attempt and it made the chart useless: a
       fresh rating's deviation is ±350, several times the range the rating then
       moves through, so the curve came out a flat thread inside a grey slab and
       the band read as a background rather than as a measurement. */
    const low = Math.min(...ratings, ...(showInterval ? [interval[0]] : []));
    const high = Math.max(...ratings, ...(showInterval ? [interval[1]] : []));
    const span = Math.max(high - low, 40);
    const middle = (high + low) / 2;
    const min = middle - span * 0.75;
    const max = middle + span * 0.75;
    const y = (rating: number) => 40 - ((rating - min) / (max - min)) * 36 - 2;
    const coordinates = values.map((point, index) => ({
      x: (index / (values.length - 1)) * 100,
      y: y(ratings[index]!),
      rating: ratings[index]!,
    }));
    return {
      line: coordinates.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" "),
      area: `M0 40 ${coordinates.map((point) => `L${point.x} ${point.y}`).join(" ")} L100 40 Z`,
      interval: { top: y(interval[1]), bottom: y(interval[0]) },
      points: coordinates,
      series: values,
      last: coordinates[coordinates.length - 1]!,
    };
  }, [points, showInterval]);

  if (!shape) return null;

  /* The curve is drawn into a stretched box — preserveAspectRatio="none" is what
     lets one component be a 56px sparkline and a 112px chart without two sets of
     coordinates. Stretching scales geometry, though, not just strokes, so a
     circle in that box comes out an ellipse and non-scaling-stroke does not save
     it: it protects the stroke width, not the shape. The markers are therefore
     HTML positioned over the SVG by percentage, where a round dot stays round. */
  const marks = showPoints ? shape.points : [shape.last];
  /* The marks finish with the sweep rather than after it, so the whole draw is
     one gesture. The last one is held back a beat longer than the line takes,
     because it is the figure in the headline and it should be the thing that
     settles last. */
  const draw = showPoints ? 1000 : 820;

  return (
    <div className={cn("relative", className ?? "h-14")} style={{ ["--rating-draw" as string]: `${draw}ms` }}>
      <svg aria-label="Spar Rating over time" className="size-full overflow-visible" preserveAspectRatio="none" role="img" viewBox="0 0 100 40">
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          {/* Clipped in the box's own units, which `preserveAspectRatio="none"`
              stretches with everything else — so one rect scaled on x sweeps the
              full width at either height. */}
          <clipPath id={`${id}-sweep`}>
            <rect className="rating-curve-sweep" height="60" width="100" x="0" y="-10" />
          </clipPath>
          <clipPath id={`${id}-box`}>
            <rect height="40" width="100" x="0" y="0" />
          </clipPath>
        </defs>

        <path className="text-border" d="M0 39.5H100" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />

        {/* Everything inside takes its colour from --tone, which the masthead
            sets from the learner's band. `currentColor` rather than the variable
            at each use, so the gradient, the bracket and the line cannot drift
            apart — and a caller that sets no tone gets the foreground, which is
            exactly the old monochrome chart. */}
        <g clipPath={`url(#${id}-sweep)`} style={{ color: "var(--tone, currentColor)" }}>
          {/* The rating deviation, drawn once, at the end of the line — which is
              the only place it is a live fact rather than history. Glicko-2
              carries this interval and every other rating UI throws it away and
              prints a badge instead; here it is the width of the bracket the
              curve arrives in, which makes "Provisional" something you can see.
              A ribbon along the whole curve was the first attempt: the interval
              is wider than the range the rating moves through, so it read as a
              grey slab behind everything and the estimate was lost in it. */}
          {showInterval && (
          <g clipPath={`url(#${id}-box)`}>
            <rect fill="currentColor" fillOpacity="0.1" height={Math.max(shape.interval.bottom - shape.interval.top, 0.5)} width="1.8" x="98.2" y={shape.interval.top} />
            <path
              d={`M97 ${shape.interval.top}H100M97 ${shape.interval.bottom}H100`}
              stroke="currentColor"
              strokeLinecap="round"
              strokeOpacity="0.3"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          </g>
          )}
          <path d={shape.area} fill={`url(#${id}-fill)`} />
          <path
            d={shape.line}
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>

      {marks.map((point, index) => {
        const last = index === marks.length - 1;
        const entry = shape.series[index];
        const move = index > 0 && shape.series[index - 1] ? point.rating - shape.series[index - 1]!.rating : null;
        return (
          <span
            className="rating-mark absolute -translate-x-1/2 -translate-y-1/2"
            key={entry?.id ?? index}
            onMouseEnter={() => showPoints && setHovered(index)}
            onMouseLeave={() => showPoints && setHovered((current) => (current === index ? null : current))}
            /* Delayed by where it sits, so each dot lands as the sweep reaches
               it. The last is given the full draw plus a beat of its own. */
            style={{ left: `${point.x}%`, top: `${(point.y / 40) * 100}%`, ["--mark-delay" as string]: `${Math.round((point.x / 100) * draw) + (last ? 90 : 0)}ms` }}
          >
            <span
              aria-hidden
              className={cn(
                "block rounded-full transition-[transform,background-color]",
                last
                  ? "size-[6px] bg-[var(--tone,var(--color-foreground))] shadow-[0_0_0_3px_color-mix(in_oklab,var(--tone,var(--color-foreground))_20%,transparent)]"
                  : "size-[4px] bg-[color-mix(in_oklab,var(--tone,var(--color-foreground))_45%,transparent)]",
                hovered === index && "scale-150 bg-[var(--tone,var(--color-foreground))]",
              )}
            />
            {/* A hit target the size of a finger around a 4px dot, so a series
                of fifty is still hoverable one point at a time. */}
            {showPoints && <span className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2" />}
            {hovered === index && entry && (
              <span
                className={cn(
                  "pointer-events-none absolute bottom-[calc(100%+8px)] z-10 w-max max-w-[17rem] rounded-[var(--radius-md)] border-[length:var(--hairline)] border-[var(--border-surface-strong)] bg-popover px-2.5 py-1.5 shadow-[var(--app-shadow-menu)]",
                  /* Anchored inward at the ends, because a tooltip centred on
                     the first or last point hangs off the panel. */
                  point.x < 15 ? "left-0" : point.x > 85 ? "right-0" : "left-1/2 -translate-x-1/2",
                )}
              >
                <span className="flex items-baseline gap-2">
                  <span className="tabular-nums text-ui font-medium">{entry.rating}</span>
                  {move !== null && move !== 0 && (
                    <span className={cn("tabular-nums text-ui-sm", move > 0 ? "text-[var(--success)]" : "text-muted-foreground")}>
                      {move > 0 ? "+" : ""}{move}
                    </span>
                  )}
                  <span className="tabular-nums text-ui-sm text-muted-foreground/65">{shortTime(entry.occurredAt)}</span>
                </span>
                {entry.reason && <span className="mt-0.5 block text-ui leading-[1.5] text-muted-foreground">{entry.reason}</span>}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
