import { useId, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LearnerProgress, RatingPoint } from "@spar/domain";
import { cn } from "@/lib/utils";
import { relativeTime, shortTime } from "@/lib/format";
import { Panel } from "../common/Page";
import { approximateRating } from "./ratingScale";
import { SourceGlyph } from "../common/SourceGlyph";

/**
 * The rating, with its uncertainty attached rather than explained: the
 * provisional flag, the move since the last point, and a curve you can read a
 * shape off.
 *
 * Clicking it opens the history — every change, what moved it, and by how much.
 * That is the whole reason the collapsed state can be three figures and a line:
 * the argument is one click away rather than printed over the top of it.
 *
 * The chart is deliberately unlabelled on the x axis. These points are attempts,
 * not days; spacing them by time would draw a flat line through a week off and a
 * cliff through a long session, and neither is what happened.
 */
export function RatingBand({ progress }: { progress: LearnerProgress }) {
  const [open, setOpen] = useState(false);
  const history = progress.ratingHistory;
  const previous = history.length > 1 ? history[history.length - 2] : undefined;
  const delta = previous ? progress.rating.rating - previous.rating : null;

  return (
    <Panel className="overflow-hidden">
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-6 px-5 py-4 text-left outline-none transition-colors hover:bg-accent/20"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-ui text-muted-foreground">
            Spar Rating
            <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <strong className="text-[2rem] font-semibold leading-none tabular-nums tracking-[-0.045em]">{progress.rating.rating}</strong>
            {delta !== null && delta !== 0 && (
              <span className={cn("text-content tabular-nums", delta > 0 ? "text-[var(--success)]" : "text-muted-foreground")}>
                {delta > 0 ? "+" : ""}{delta}
              </span>
            )}
            {progress.rating.provisional && <span className="text-ui text-muted-foreground">Provisional</span>}
          </div>
        </div>

        <div className="hidden w-[15rem] shrink-0 sm:block">
          <RatingChart points={history} />
          <div className="mt-1 flex justify-between text-ui-sm text-muted-foreground/70">
            <span>{history.length > 1 ? `${history.length} changes` : "First rating"}</span>
            <span>{relativeTime(progress.rating.occurredAt)}</span>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t-[length:var(--hairline)] border-[var(--border-surface-strong)]">
          {/* Full width and taller: the collapsed sparkline is a shape, this is
              the actual series, with every point on it addressable below. */}
          <div className="px-5 pt-4">
            <RatingChart className="h-28" points={history} showPoints />
          </div>

          <div className="mt-3 flex flex-col">
            {[...history].reverse().map((point, index, all) => {
              const before = all[index + 1];
              const move = before ? point.rating - before.rating : null;
              return (
                <div className="flex items-baseline gap-3 px-5 py-2 text-ui" key={point.id}>
                  <span className="w-11 shrink-0 tabular-nums font-medium">{point.rating}</span>
                  <span className={cn("w-9 shrink-0 tabular-nums text-ui-sm", move && move > 0 ? "text-[var(--success)]" : "text-muted-foreground/70")}>
                    {move === null ? "—" : `${move > 0 ? "+" : ""}${move}`}
                  </span>
                  <span className="min-w-0 flex-1 text-muted-foreground">{point.reason || "No reason recorded"}</span>
                  <span className="shrink-0 tabular-nums text-ui-sm text-muted-foreground/65">{shortTime(point.occurredAt)}</span>
                </div>
              );
            })}
          </div>

          {/* What the number means somewhere the learner already has a feel for.
              Labelled approximate and rounded coarsely, because it is a
              translation of Spar's own evidence and not a score either site
              has given anybody. */}
          <div className="mt-2 flex items-center gap-5 border-t-[length:var(--hairline)] border-[var(--border-surface-strong)] px-5 py-3">
            <span className="text-ui-sm text-muted-foreground/70">Roughly equivalent to</span>
            <Equivalent label="LeetCode" source="leetcode" value={approximateRating(progress.rating.rating, "leetcode")} />
            <Equivalent label="Codeforces" source="codeforces" value={approximateRating(progress.rating.rating, "codeforces")} />
          </div>
        </div>
      )}
    </Panel>
  );
}

function Equivalent({ label, source, value }: { label: string; source: "leetcode" | "codeforces"; value: number }) {
  return (
    <span className="flex items-center gap-1.5 text-ui" title={`Approximate ${label} rating`}>
      <SourceGlyph className="size-3.5" source={source} />
      <span className="tabular-nums">~{value}</span>
    </span>
  );
}

/**
 * The curve. Filled under the line, because the area is what makes a rise read
 * as a rise at this size; the last point is always marked because "where am I
 * now" is the question the chart is answering.
 *
 * A flat history still draws a line rather than an empty box — one rating is a
 * true fact about the learner and deserves to be shown as one.
 */
export function RatingChart({ className, points, showPoints = false }: { className?: string | undefined; points: RatingPoint[]; showPoints?: boolean }) {
  const gradient = useId();
  const shape = useMemo(() => {
    const values = points.length > 1 ? points : points.length ? [points[0]!, points[0]!] : [];
    if (!values.length) return null;
    /* Padded so a flat run does not sit on the floor of the box and a single
       change does not fill it top to bottom. */
    const ratings = values.map((point) => point.rating);
    const low = Math.min(...ratings);
    const high = Math.max(...ratings);
    const span = Math.max(high - low, 40);
    const middle = (high + low) / 2;
    const min = middle - span * 0.75;
    const max = middle + span * 0.75;
    const coordinates = values.map((point, index) => ({
      x: (index / (values.length - 1)) * 100,
      y: 40 - ((point.rating - min) / (max - min)) * 36 - 2,
    }));
    return {
      line: coordinates.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" "),
      area: `M0 40 ${coordinates.map((point) => `L${point.x} ${point.y}`).join(" ")} L100 40 Z`,
      points: coordinates,
      last: coordinates[coordinates.length - 1]!,
    };
  }, [points]);

  if (!shape) return null;

  /* The curve is drawn into a stretched box — preserveAspectRatio="none" is what
     lets one component be a 56px sparkline and a 112px chart without two sets of
     coordinates. Stretching scales geometry, though, not just strokes, so a
     circle in that box comes out an ellipse and non-scaling-stroke does not save
     it: it protects the stroke width, not the shape. The markers are therefore
     HTML positioned over the SVG by percentage, where a round dot stays round. */
  const marks = showPoints ? shape.points : [shape.last];

  return (
    <div className={cn("relative", className ?? "h-14")}>
      <svg aria-label="Spar Rating over time" className="size-full overflow-visible" preserveAspectRatio="none" role="img" viewBox="0 0 100 40">
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="text-foreground" d={shape.area} fill={`url(#${gradient})`} />
        <path className="text-border" d="M0 39.5H100" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path
          className="text-foreground/70"
          d={shape.line}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {marks.map((point, index) => (
        <span
          aria-hidden
          className={cn(
            "absolute -translate-x-1/2 -translate-y-1/2 rounded-full",
            index === marks.length - 1 ? "size-[6px] bg-foreground" : "size-[4px] bg-foreground/45",
          )}
          key={index}
          style={{ left: `${point.x}%`, top: `${(point.y / 40) * 100}%` }}
        />
      ))}
    </div>
  );
}
