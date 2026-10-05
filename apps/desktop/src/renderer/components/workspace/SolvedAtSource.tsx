import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity, ArrowBigUp, ArrowLeft, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Code2, Copy,
  Cpu, Loader2, RotateCw, Timer, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { plainMath } from "@/lib/tex";
import type {
  PracticeSampleCode, PracticeSolution, PracticeSolutionSummary, PracticeSubmissionStats, SolvedAtSource, SparApi,
} from "../../../shared/api";
import { Colorized, Markdown } from "../agent/Markdown";
import { LANGUAGE_LABEL, LanguageGlyph, languageOf } from "../common/LanguageGlyph";
import { LeetCodeGlyph } from "../common/SourceGlyph";
import { Segmented } from "@/components/ui/segmented";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * What LeetCode knows after an accepted verdict, told the way Spar tells
 * things: where the run landed among everyone else's in the same language, a
 * solution from any point on that spread, and how other people wrote it up.
 *
 * It only exists once the problem is solved. Before that, other people's code
 * is the answer key, and a coach that keeps it one click away has stopped
 * measuring anything.
 */

type Metric = "runtime" | "memory";
type Api = Pick<SparApi, "solvedAtSource" | "sourceSampleCode" | "sourceSolutions" | "sourceSolution" | "openExternal">;

/* ---- Loading ------------------------------------------------------------ */

/**
 * The challenge's accepted LeetCode submission, re-read whenever `version`
 * moves (a submission just landed). LeetCode computes the histogram a few
 * seconds after the verdict, so an empty one is asked for again a few times
 * before the panel settles for the numbers alone.
 */
export function useSolvedAtSource(api: Api | undefined, challengeId: string | null, version: number | string = 0) {
  const [solved, setSolved] = useState<SolvedAtSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    /* A different challenge clears at once; a re-read of the same one keeps
       what is on screen until the new answer arrives, so the ring does not
       blink out every time a submission is made. */
    if (shownFor.current !== challengeId) {
      shownFor.current = challengeId;
      setSolved(null);
    }
    if (!api || !challengeId || typeof api.solvedAtSource !== "function") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const load = async () => {
      setLoading(true);
      try {
        const next = await api.solvedAtSource({ challengeId });
        if (!alive) return;
        setSolved(next);
        if (next?.stats && !next.stats.runtime.distribution.length && tries < 4) {
          tries += 1;
          timer = setTimeout(() => void load(), 2_000 * tries);
        }
      } catch {
        if (alive) setSolved(null);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [api, challengeId, version, retry]);

  return { solved, loading, reload: useCallback(() => setRetry((value) => value + 1), []) };
}

/* ---- The circle next to the view switch --------------------------------- */

/**
 * The way in: a ring the size of the switch beside it, filled to how much of
 * LeetCode the run was faster than. It answers "how did it land" before it is
 * clicked, which is most of what anyone opens the panel to find out.
 */
export function SolvedRing({ solved, active, fresh = false, onClick }: {
  solved: SolvedAtSource;
  active: boolean;
  /** Just solved in this sitting: the ring draws itself in and calls once. */
  fresh?: boolean;
  onClick(): void;
}) {
  const reduce = useReducedMotion();
  const percentile = solved.stats?.runtime.percentile ?? null;
  const fraction = percentile === null ? 1 : Math.max(0.02, Math.min(1, percentile / 100));
  const radius = 11;
  const circumference = 2 * Math.PI * radius;
  const language = solved.stats ? languageName(solved.stats) : "";
  const label = percentile === null
    ? "Solved on LeetCode — see how others wrote it"
    : `Faster than ${Math.round(percentile)}% of ${language} runs — see how others wrote it`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          animate={{ opacity: 1, scale: 1 }}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "relative grid size-7 shrink-0 place-items-center rounded-full outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring/60",
            active
              ? "bg-background shadow-[0_1px_2px_oklch(0%_0_0/8%),0_0_0_0.5px_var(--border-strong)] dark:bg-[color-mix(in_oklab,var(--foreground)_14%,transparent)]"
              : "bg-[var(--color-background-elevated-secondary)] hover:bg-[color-mix(in_oklab,var(--foreground)_8%,var(--color-background-elevated-secondary))]",
          )}
          initial={reduce ? false : { opacity: 0, scale: 0.6 }}
          onClick={onClick}
          transition={{ type: "spring", visualDuration: 0.4, bounce: 0.35 }}
          type="button"
        >
          {fresh && !reduce && (
            <motion.span
              animate={{ opacity: 0, scale: 1.9 }}
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full bg-[var(--success)]"
              initial={{ opacity: 0.35, scale: 1 }}
              transition={{ duration: 1.1, ease: [0.22, 0.61, 0.36, 1], delay: 0.35 }}
            />
          )}
          <svg aria-hidden className="absolute inset-0 size-full -rotate-90" viewBox="0 0 28 28">
            <circle cx="14" cy="14" fill="none" r={radius} stroke="color-mix(in oklab, var(--success) 18%, transparent)" strokeWidth="2" />
            <motion.circle
              animate={{ strokeDashoffset: circumference * (1 - fraction) }}
              cx="14"
              cy="14"
              fill="none"
              initial={reduce ? false : { strokeDashoffset: circumference }}
              r={radius}
              stroke="var(--success)"
              strokeDasharray={circumference}
              strokeLinecap="round"
              strokeWidth="2"
              transition={{ duration: 0.9, ease: [0.22, 0.61, 0.36, 1], delay: 0.15 }}
            />
          </svg>
          <Check className="relative size-3 text-[var(--success)]" strokeWidth={2.75} />
        </motion.button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/* ---- The panel ---------------------------------------------------------- */

/**
 * Laid out the way the review brief is — the coach's reading first, then the
 * evidence for it, then what to do next — because it sits in the same column
 * and is the same kind of page: a look back at a solve, not a scoreboard.
 */
export function SolvedView({ api, challengeId, solved, onRetry, className }: {
  api: Api | undefined;
  challengeId: string;
  solved: SolvedAtSource;
  onRetry(): void;
  className?: string;
}) {
  const [reading, setReading] = useState<PracticeSolutionSummary | null>(null);
  const [picked, setPicked] = useState<{ metric: Metric; value: number } | null>(null);
  const sample = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const open = (url: string) => void api?.openExternal(url);

  /* Picking a column opens someone's code under the card and brings it into
     view; picking the same one again closes it. */
  const toggle = (next: { metric: Metric; value: number }) => {
    const same = picked?.metric === next.metric && picked.value === next.value;
    setPicked(same ? null : next);
    if (!same) requestAnimationFrame(() => setTimeout(() => sample.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" }), 60));
  };

  return (
    <div className={cn("relative h-full min-h-0 overflow-hidden", className)}>
      {/* The list stays mounted under the article, so coming back lands where
          the learner had scrolled to rather than at the top of the list. */}
      <motion.div
        animate={reading ? { opacity: 0, x: -24, filter: "blur(4px)" } : { opacity: 1, x: 0, filter: "blur(0px)" }}
        aria-hidden={Boolean(reading)}
        className={cn("app-scroll absolute inset-0 overflow-y-auto", reading && "pointer-events-none")}
        inert={Boolean(reading)}
        initial={false}
        transition={{ duration: reduce ? 0 : 0.28, ease: [0.32, 0.72, 0, 1] }}
      >
        <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-6 px-5 pb-10 pt-5">
          {solved.stats ? (
            <Section
              title="Where it landed"
              trailing={
                <button
                  className="inline-flex h-6 items-center gap-1 rounded-[var(--radius-md)] px-1.5 text-ui-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => open(solved.url)}
                  title="Open your submission on LeetCode"
                  type="button"
                >
                  <LeetCodeGlyph className="size-3" />
                  <ArrowUpRight className="size-3" />
                </button>
              }
            >
              <div className="flex flex-col divide-y divide-border/70 rounded-xl border border-border bg-card">
                <DotPlot icon={Timer} label="Runtime" language={languageName(solved.stats)} metric="runtime" onPick={(value) => toggle({ metric: "runtime", value })} picked={picked?.metric === "runtime" ? picked.value : null} stats={solved.stats} verb="faster than" />
                <DotPlot icon={Cpu} label="Memory" language={languageName(solved.stats)} metric="memory" onPick={(value) => toggle({ metric: "memory", value })} picked={picked?.metric === "memory" ? picked.value : null} stats={solved.stats} verb="leaner than" />
              </div>
              <div ref={sample} className="scroll-mb-4">
                <AnimatePresence initial={false} mode="popLayout">
                  {picked && (
                    <motion.div
                      animate={{ opacity: 1, y: 0 }}
                      className="pt-2"
                      exit={{ opacity: 0, y: -6 }}
                      initial={{ opacity: 0, y: -6 }}
                      key={`${picked.metric}:${picked.value}`}
                      transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
                    >
                      <SampleCode api={api} challengeId={challengeId} language={solved.stats.language} metric={picked.metric} onClose={() => setPicked(null)} value={picked.value} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Section>
          ) : (
            <Unavailable error={solved.error} onRetry={onRetry} />
          )}

          <Solutions api={api} challengeId={challengeId} languageTag={solutionTag(solved.languageTag)} onRead={setReading} />
        </div>
      </motion.div>

      <AnimatePresence>
        {reading && (
          <motion.div
            animate={{ opacity: 1, x: 0 }}
            className="absolute inset-0 z-[1] bg-background"
            exit={{ opacity: 0, x: 32 }}
            initial={{ opacity: 0, x: 32 }}
            key={reading.topicId}
            transition={{ duration: reduce ? 0 : 0.3, ease: [0.32, 0.72, 0, 1] }}
          >
            <Article
              api={api}
              challengeId={challengeId}
              languageTag={solved.languageTag}
              onBack={() => setReading(null)}
              onOpen={open}
              summary={reading}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A section heading in the History page's style: sentence case, with a quiet
 *  count beside it where there is one. */
function Section({ title, hint, trailing, children }: { title: string; hint?: string | undefined; trailing?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex min-h-7 items-baseline gap-2">
        <h2 className="text-content font-semibold tracking-[-0.01em]">{title}</h2>
        {hint && <span className="text-ui-sm tabular-nums text-muted-foreground/70">{hint}</span>}
        {trailing && <div className="ml-auto flex items-center gap-1.5 self-center">{trailing}</div>}
      </div>
      {children}
    </section>
  );
}

function Unavailable({ error, onRetry }: { error?: string | undefined; onRetry(): void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-3.5 py-3">
      <Activity className="mt-0.5 size-4 shrink-0 text-muted-foreground/70" />
      <div className="min-w-0 flex-1">
        <p className="text-ui font-medium">The comparison didn’t load</p>
        <p className="mt-0.5 text-ui-sm leading-[1.55] text-muted-foreground">{error ?? "LeetCode hasn’t sent the runtime and memory spread for this submission yet."}</p>
      </div>
      <button
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-ui-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={onRetry}
        type="button"
      >
        <RotateCw className="size-3.5" />
        Retry
      </button>
    </div>
  );
}

/* ---- Runtime and memory ------------------------------------------------- */

type Chart = { bars: Array<{ value: number; percent: number }>; mine: number; median: number; fastest: number; max: number };

/**
 * The spread, trimmed to where the runs actually are. LeetCode's tail runs to
 * buckets almost nobody landed in, which squeezes the part worth reading into a
 * sliver at the left; everything past 98% of runs is dropped unless the
 * learner's own is out there.
 */
function distribution(metric: PracticeSubmissionStats["runtime"], kind: Metric): Chart {
  const all = metric.distribution;
  if (!all.length) return { bars: [], mine: -1, median: -1, fastest: -1, max: 0 };
  const total = all.reduce((sum, bar) => sum + bar.percent, 0) || 1;

  let mine = kind === "runtime" && metric.value !== null ? all.findIndex((bar) => bar.value === metric.value) : -1;
  if (mine < 0 && metric.percentile !== null) {
    /* "Faster than 87%" means 87% landed in slower buckets, so the learner's
       is the first where the running share reaches the other 13%. */
    const target = total * (1 - metric.percentile / 100);
    let running = 0;
    mine = all.findIndex((bar) => (running += bar.percent) >= target - 1e-6);
  }

  let end = all.length;
  let median = -1;
  let running = 0;
  for (let index = 0; index < all.length; index += 1) {
    running += all[index]!.percent;
    if (median < 0 && running >= total * 0.5) median = index;
    if (running >= total * 0.98) { end = index + 1; break; }
  }
  end = Math.max(end, mine + 1, Math.min(all.length, 8));
  const bars = all.slice(0, end);
  /* The quickest bucket that is a real cluster rather than one lucky run. */
  const fastest = Math.max(0, bars.findIndex((bar) => bar.percent >= total * 0.02));
  return { bars, mine, median, fastest, max: Math.max(...bars.map((bar) => bar.percent)) };
}

/** Rows in the tallest column. Each dot is a slice of that column's share,
 *  so the shape is the bar chart's, drawn in Spar's own mark. */
const DOT_ROWS = 10;

/**
 * Where the run landed: a column of dots for each speed accepted runs came in
 * at, fastest on the left, as tall as the share of runs that landed there. The
 * learner's column is the green one. Pointing at a column reads it out;
 * clicking opens someone else's solution from it.
 */
function DotPlot({ stats, metric, icon: Icon, label, verb, language, picked, onPick }: {
  stats: PracticeSubmissionStats;
  metric: Metric;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  verb: string;
  language: string;
  picked: number | null;
  onPick(value: number): void;
}) {
  const reduce = useReducedMotion();
  const figure = stats[metric];
  const chart = useMemo(() => distribution(figure, metric), [figure, metric]);
  const [hover, setHover] = useState<number | null>(null);
  const [amount, unit] = splitDisplay(figure.display);
  const count = chart.bars.length;
  const shown = hover === null ? null : chart.bars[hover];
  const ticks = [0, chart.median, count - 1].filter((value, index, list) =>
    value >= 0 && list.indexOf(value) === index && (index !== 1 || (value / count > 0.16 && value / count < 0.84)));

  return (
    <div className="px-3.5 pb-2.5 pt-3">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="flex shrink-0 items-center gap-1.5 text-ui-sm text-muted-foreground"><Icon className="size-3.5" />{label}</span>
        <span className="min-w-0 flex-1 truncate text-right text-ui-sm text-muted-foreground">
          {shown ? (
            <>
              <span className="font-medium tabular-nums text-foreground">{formatBucket(shown.value, metric)}</span>
              {` · ${shown.percent < 0.1 ? "<0.1" : shown.percent.toFixed(1)}% of runs`}
              {hover === chart.mine && <span className="text-[var(--success)]"> · yours</span>}
            </>
          ) : figure.percentile !== null ? (
            <>{verb} <span className="font-medium tabular-nums text-[var(--success)]">{Math.round(figure.percentile)}%</span></>
          ) : null}
        </span>
        <span className="flex shrink-0 items-baseline gap-1">
          <span className="text-content font-semibold tabular-nums tracking-[-0.01em]">{amount || "—"}</span>
          {unit && <span className="text-ui-sm text-muted-foreground">{unit}</span>}
        </span>
      </div>

      {count ? (
        <>
          <div
            aria-label={`${label} spread of accepted ${language} runs`}
            className="mt-3 flex items-end justify-between gap-px"
            onPointerLeave={() => setHover(null)}
            role="group"
          >
            {chart.bars.map((bar, index) => {
              const mine = index === chart.mine;
              const lit = hover === index || (hover === null && picked === bar.value);
              const rows = bar.percent <= 0 ? 0 : Math.max(1, Math.round((bar.percent / (chart.max || 1)) * DOT_ROWS));
              return (
                <button
                  aria-label={`${formatBucket(bar.value, metric)}: ${bar.percent.toFixed(1)}% of accepted runs${mine ? " — yours" : ""}. Read one.`}
                  aria-pressed={picked === bar.value}
                  className="group relative flex min-w-0 flex-1 flex-col-reverse items-center gap-[3px] rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  key={bar.value}
                  onBlur={() => setHover(null)}
                  onClick={() => onPick(bar.value)}
                  onFocus={() => setHover(index)}
                  onPointerEnter={() => setHover(index)}
                  style={{ height: `${DOT_ROWS * 9}px` }}
                  type="button"
                >
                  {Array.from({ length: rows }, (_, row) => (
                    <motion.span
                      animate={{ opacity: 1, scale: 1 }}
                      className={cn(
                        "block size-[6px] shrink-0 rounded-full",
                        mine ? "bg-[var(--success)]" : lit ? "bg-foreground/60" : "bg-[color-mix(in_oklab,var(--foreground)_16%,transparent)]",
                      )}
                      initial={reduce ? false : { opacity: 0, scale: 0.2 }}
                      key={row}
                      transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1], delay: reduce ? 0 : Math.min(0.45, index * 0.012 + row * 0.02) }}
                    />
                  ))}
                  {mine && (
                    <span
                      className={cn(
                        "pointer-events-none absolute z-[1] whitespace-nowrap rounded-full bg-[var(--success)] px-1.5 py-px text-[10px] font-semibold leading-[1.4] text-white",
                        index / count < 0.08 ? "left-0" : index / count > 0.92 ? "right-0" : "left-1/2 -translate-x-1/2",
                      )}
                      style={{ bottom: `${rows * 9 + 3}px` }}
                    >
                      You
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="relative mt-2 h-4 font-mono text-[10.5px] tabular-nums text-muted-foreground/60">
            {ticks.map((index) => (
              <span
                className={cn("absolute top-0", index === 0 ? "left-0" : index === count - 1 ? "right-0" : "-translate-x-1/2")}
                key={index}
                style={index === 0 || index === count - 1 ? undefined : { left: `${((index + 0.5) / count) * 100}%` }}
              >
                {formatBucket(chart.bars[index]!.value, metric)}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-2 text-ui-sm text-muted-foreground">LeetCode hasn’t sent the {metric} spread for this submission yet.</p>
      )}
    </div>
  );
}

/** Someone else's accepted code from one bar of the spread, with a pager
 *  through the others LeetCode keeps for that bucket. */
function SampleCode({ api, challengeId, language, metric, value, onClose }: { api: Api | undefined; challengeId: string; language: string; metric: Metric; value: number; onClose(): void }) {
  const [skip, setSkip] = useState(0);
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; sample: PracticeSampleCode | null } | { status: "error"; message: string }>({ status: "loading" });

  useEffect(() => {
    if (!api) return;
    let alive = true;
    setState({ status: "loading" });
    api.sourceSampleCode({ challengeId, language, metric, value, skip })
      .then((sample) => { if (alive) setState({ status: "ready", sample }); })
      .catch((error: unknown) => { if (alive) setState({ status: "error", message: error instanceof Error ? error.message : String(error) }); });
    return () => { alive = false; };
  }, [api, challengeId, language, metric, value, skip]);

  const sample = state.status === "ready" ? state.sample : null;
  const spar = sparLanguage(language);

  return (
    <div className="code-block !my-0">
      <div className="code-block-header">
        <span className="code-block-language flex min-w-0 items-center gap-1.5">
          {spar ? <LanguageGlyph className="size-3.5 shrink-0" language={spar} /> : <Code2 className="size-3.5 shrink-0" />}
          <span className="truncate font-sans text-ui-sm text-foreground/85">Someone else’s {formatBucket(value, metric)} solution</span>
        </span>
        <div className="code-block-actions">
          {state.status === "loading" && <Loader2 className="size-3.5 animate-spin" />}
          <button aria-label="Previous solution from here" className="disabled:opacity-30" disabled={!sample?.hasPrevious || skip === 0} onClick={() => setSkip((current) => Math.max(0, current - 1))} type="button">
            <ChevronLeft className="size-3.5" />
          </button>
          <button aria-label="Another solution from here" className="disabled:opacity-30" disabled={!sample?.hasNext} onClick={() => setSkip((current) => current + 1)} type="button">
            <ChevronRight className="size-3.5" />
          </button>
          {sample && <CopyButton text={sample.code} />}
          <button aria-label="Close" onClick={onClose} type="button"><X className="size-3.5" /></button>
        </div>
      </div>
      {state.status === "error" ? (
        <p className="px-3 pb-3 font-sans text-ui-sm text-muted-foreground">{state.message}</p>
      ) : sample ? (
        <Colorized body={sample.code.replace(/\t/g, "    ")} className="!max-h-[22rem]" language={spar ?? language} />
      ) : state.status === "ready" ? (
        <p className="px-3 pb-3 font-sans text-ui-sm text-muted-foreground">LeetCode has no code kept for this bar. Try one beside it.</p>
      ) : (
        <CodeSkeleton />
      )}
    </div>
  );
}

/* ---- How others wrote it ------------------------------------------------ */

type Order = "hot" | "votes" | "recent";
const PAGE = 12;

/**
 * The problem's write-ups, as a list in the shape every other list on this
 * page takes — a card per item, the title first and who wrote it under it.
 * LeetCode's view counts and comment tallies are left out: they rank posts by
 * attention, and the question here is only which one to read.
 */
function Solutions({ api, challengeId, languageTag, onRead }: {
  api: Api | undefined;
  challengeId: string;
  languageTag: string;
  onRead(solution: PracticeSolutionSummary): void;
}) {
  const [order, setOrder] = useState<Order>("hot");
  const [mineOnly, setMineOnly] = useState(Boolean(languageTag));
  const [page, setPage] = useState<{ total: number; hasMore: boolean; solutions: PracticeSolutionSummary[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const spar = sparLanguage(languageTag);

  const load = useCallback(async (skip: number) => {
    if (!api) return;
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const next = await api.sourceSolutions({ challengeId, order, skip, first: PAGE, ...(mineOnly && languageTag ? { language: languageTag } : {}) });
      if (id !== request.current) return;
      setPage((current) => skip && current ? { ...next, solutions: [...current.solutions, ...next.solutions] } : next);
    } catch (reason) {
      if (id === request.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [api, challengeId, languageTag, mineOnly, order]);

  useEffect(() => { setPage(null); void load(0); }, [load]);

  return (
      <Section
        hint={page && page.total > 0 ? compact(page.total) : undefined}
        title="How others wrote it"
        trailing={
          <>
            {languageTag && spar && (
              <button
                aria-pressed={mineOnly}
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-[var(--radius-md)] border px-2 text-ui-sm",
                  mineOnly ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setMineOnly((value) => !value)}
                title={mineOnly ? `Only ${LANGUAGE_LABEL[spar]} — click for every language` : `Only solutions in ${LANGUAGE_LABEL[spar]}`}
                type="button"
              >
                <LanguageGlyph className={cn("size-3", !mineOnly && "grayscale")} language={spar} />
                {LANGUAGE_LABEL[spar]}
              </button>
            )}
            <Segmented<Order>
              ariaLabel="Order solutions"
              className="w-[11.5rem] [&_button]:h-6 [&_button]:px-1.5 [&_button]:text-ui-sm"
              onChange={setOrder}
              options={[{ value: "hot", label: "Popular" }, { value: "votes", label: "Top" }, { value: "recent", label: "Newest" }]}
              value={order}
            />
          </>
        }
      >

      {error && !page?.solutions.length ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-ui-sm text-muted-foreground">
          <span className="min-w-0 flex-1">{error}</span>
          <button className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] px-2 font-medium hover:bg-accent hover:text-foreground" onClick={() => void load(0)} type="button">
            <RotateCw className="size-3.5" /> Retry
          </button>
        </div>
      ) : !page && loading ? (
        <div className="flex flex-col divide-y divide-border/50">
          {Array.from({ length: 4 }, (_, index) => <RowSkeleton key={index} />)}
        </div>
      ) : page && !page.solutions.length ? (
        <p className="rounded-xl border border-dashed border-border px-3.5 py-5 text-center text-ui-sm text-muted-foreground">
          Nobody has posted a solution{mineOnly && spar ? ` in ${LANGUAGE_LABEL[spar]}` : ""} yet.
        </p>
      ) : page ? (
        <div className="flex flex-col divide-y divide-border/50">
          {page.solutions.map((solution, index) => (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              initial={{ opacity: 0, y: 4 }}
              key={solution.topicId}
              transition={{ duration: 0.24, delay: Math.min(0.2, (index % PAGE) * 0.025), ease: [0.22, 0.61, 0.36, 1] }}
            >
              <SolutionRow onRead={() => onRead(solution)} solution={solution} />
            </motion.div>
          ))}
          {page.hasMore && (
            <button
              className="mt-2 inline-flex items-center gap-1 self-start text-ui-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
              disabled={loading}
              onClick={() => void load(page.solutions.length)}
              type="button"
            >
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronDown className="size-3.5" />}
              {loading ? "Loading…" : "More"}
            </button>
          )}
        </div>
      ) : null}
      </Section>
  );
}

function SolutionRow({ solution, onRead }: { solution: PracticeSolutionSummary; onRead(): void }) {
  return (
    <button
      className="group -mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center gap-3 rounded-lg px-2 py-2.5 text-left outline-none hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onRead}
      type="button"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 text-ui font-medium leading-[1.45] text-foreground">{cleanTitle(solution.title)}</span>
        <Byline solution={solution} />
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground" />
    </button>
  );
}

/** Who wrote it, how many found it useful, and when — in one quiet line. */
function Byline({ solution }: { solution: PracticeSolutionSummary }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-ui-sm text-muted-foreground">
      <Avatar author={solution.author} className="size-4" official={solution.official} />
      <span className="truncate text-foreground/80" title={solution.author.username ? `@${solution.author.username}` : undefined}>{solution.official ? "LeetCode editorial" : solution.author.name}</span>
      <span aria-hidden className="text-muted-foreground/40">·</span>
      <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums" title={`${solution.upvotes.toLocaleString()} upvotes`}>
        <ArrowBigUp className="size-3.5" />{compact(solution.upvotes)}
      </span>
      {solution.createdAt && (
        <>
          <span aria-hidden className="text-muted-foreground/40">·</span>
          <span className="shrink-0">{postedAt(solution.createdAt)}</span>
        </>
      )}
    </span>
  );
}

/* ---- One write-up ------------------------------------------------------- */

function Article({ api, challengeId, summary, languageTag, onBack, onOpen }: {
  api: Api | undefined;
  challengeId: string;
  summary: PracticeSolutionSummary;
  languageTag: string;
  onBack(): void;
  onOpen(url: string): void;
}) {
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; solution: PracticeSolution } | { status: "error"; message: string }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    setState({ status: "loading" });
    api.sourceSolution({ challengeId, topicId: summary.topicId })
      .then((solution) => { if (alive) setState(solution ? { status: "ready", solution } : { status: "error", message: "LeetCode no longer has this solution." }); })
      .catch((error: unknown) => { if (alive) setState({ status: "error", message: error instanceof Error ? error.message : String(error) }); });
    return () => { alive = false; };
  }, [api, challengeId, summary.topicId, attempt]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onBack(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onBack]);

  const solution = state.status === "ready" ? state.solution : summary;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* One bar: the way back, who wrote it, and the original. The byline sits
          here rather than under the title so the write-up starts with its own
          words, the way a lesson does. */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <button
          aria-label="Back to solutions"
          className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onBack}
          title="Back"
          type="button"
        >
          <ArrowLeft className="size-4" />
        </button>
        <Byline solution={solution} />
        <button
          aria-label="Open on LeetCode"
          className="ml-auto grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => onOpen(summary.url)}
          title="Open on LeetCode"
          type="button"
        >
          <ArrowUpRight className="size-4" />
        </button>
      </div>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto flex w-full max-w-[46rem] flex-col gap-5 px-5 pb-12 pt-5">
          <h1 className="text-content-title font-semibold leading-[1.3] tracking-[-0.015em]">{cleanTitle(solution.title)}</h1>
          {state.status === "ready" ? (
            <ArticleBody content={state.solution.content} languageTag={languageTag} />
          ) : state.status === "error" ? (
            <div className="flex items-center gap-3 text-ui-sm text-muted-foreground">
              <span className="min-w-0 flex-1">{state.message}</span>
              <button className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] px-2 font-medium hover:bg-accent hover:text-foreground" onClick={() => setAttempt((value) => value + 1)} type="button">
                <RotateCw className="size-3.5" /> Retry
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {[92, 100, 76, 88, 40].map((width, index) => <span className="h-3 animate-pulse rounded bg-foreground/[0.06]" key={index} style={{ width: `${width}%` }} />)}
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

type Segment =
  | { kind: "prose"; text: string }
  | { kind: "code"; blocks: Array<{ label: string; body: string }> }
  | { kind: "image"; url: string; alt: string };

/**
 * A LeetCode write-up, in Spar's own prose and code blocks.
 *
 * The site's editor writes one fence per language back to back — ```Python3 [] —
 * and shows them as tabs. They are gathered into one tabbed block here too,
 * opened on the learner's language, because six languages stacked is a page
 * of scrolling past code they will not read.
 */
function ArticleBody({ content, languageTag }: { content: string; languageTag: string }) {
  const segments = useMemo(() => parseArticle(content), [content]);
  return (
    <div className="flex min-w-0 flex-col">
      {segments.map((segment, index) => segment.kind === "prose" ? (
        <Markdown
          className="text-thread [&_h1]:mb-1.5 [&_h1]:mt-6 [&_h1]:text-content [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:mt-6 [&_h2]:text-content [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-5 [&_h3]:text-thread [&_h3]:font-semibold [&>:first-child]:mt-0"
          key={index}
          source={proseMath(segment.text)}
        />
      ) : segment.kind === "image" ? (
        <img alt={segment.alt} className="my-3 max-h-[24rem] w-auto max-w-full self-start rounded-[var(--radius-lg)] ring-[0.5px] ring-[var(--border-strong)]" key={index} loading="lazy" referrerPolicy="no-referrer" src={segment.url} />
      ) : (
        <CodeTabs blocks={segment.blocks} key={index} languageTag={languageTag} />
      ))}
    </div>
  );
}

function CodeTabs({ blocks: written, languageTag }: { blocks: Array<{ label: string; body: string }>; languageTag: string }) {
  const preferred = sparLanguage(languageTag);
  /* A fence with no language is, on a solution filtered to the learner's
     language, almost always in it — read it that way rather than as "Code". */
  const blocks = useMemo(
    () => written.map((block) => (block.label || !preferred ? block : { ...block, label: LANGUAGE_LABEL[preferred] })),
    [written, preferred],
  );
  const [index, setIndex] = useState(() => Math.max(0, blocks.findIndex((block) => preferred && sparLanguage(block.label) === preferred)));
  const block = blocks[Math.min(index, blocks.length - 1)]!;
  const language = sparLanguage(block.label);

  return (
    <div className="code-block">
      <div className="code-block-header !pl-1.5">
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {blocks.length > 1 ? blocks.map((entry, at) => {
            const glyph = sparLanguage(entry.label);
            return (
              <button
                className={cn(
                  "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 font-sans text-ui-sm",
                  at === index ? "bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                key={`${entry.label}:${at}`}
                onClick={() => setIndex(at)}
                type="button"
              >
                {glyph && <LanguageGlyph className={cn("size-3", at !== index && "grayscale")} language={glyph} />}
                {entry.label || "Code"}
              </button>
            );
          }) : (
            <span className="code-block-language flex items-center gap-1.5">
              {language ? <LanguageGlyph className="size-3.5" language={language} /> : <Code2 className="size-3.5" />}
              <span className="font-sans text-ui-sm">{block.label || "Code"}</span>
            </span>
          )}
        </div>
        <div className="code-block-actions"><CopyButton text={block.body} /></div>
      </div>
      <Colorized body={block.body.replace(/\t/g, "    ")} language={language ?? (block.label.toLowerCase() || "text")} />
    </div>
  );
}

/**
 * LeetCode write-ups mark maths with dollars, `$$O(n \log n)$$` or `$O(1)$`.
 * Spar has no maths engine on purpose (see `lib/tex.ts`): it turns the notation
 * a practice app actually uses into characters. That is done here, before the
 * prose renderer sees the line, so a subscript like `x_i` is not read as
 * emphasis on the way. Code spans are left alone; a dollar there is a dollar.
 */
export function proseMath(prose: string): string {
  const math = (inner: string) => plainMath(`\\(${inner.replace(/\s*\n\s*/g, " ").trim()}\\)`);
  return prose
    .split(/(`[^`]*`)/)
    .map((part, index) => index % 2
      ? part
      : part
        .replace(/\$\$([\s\S]+?)\$\$/g, (_match, inner: string) => math(inner))
        .replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_match, before: string, inner: string) => `${before}${math(inner)}`))
    .join("");
}

function parseArticle(content: string): Segment[] {
  const segments: Segment[] = [];
  const prose: string[] = [];
  const flush = () => {
    const text = prose.join("\n").trim();
    if (text) segments.push({ kind: "prose", text });
    prose.length = 0;
  };
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fence = /^\s*(`{3,}|~{3,})\s*(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const label = fence[2]!.replace(/\[[^\]]*\]\s*$/, "").trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trim().startsWith(marker)) body.push(lines[index++]!);
      const block = { label, body: body.join("\n") };
      /* Back-to-back fences, with nothing but blank lines between them, are one
         block in several languages. */
      const last = segments[segments.length - 1];
      if (!prose.join("").trim() && last?.kind === "code") last.blocks.push(block);
      else { flush(); segments.push({ kind: "code", blocks: [block] }); }
      prose.length = 0;
      continue;
    }
    const image = /^\s*!\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)\s*$/.exec(line);
    if (image && /^https:\/\//.test(image[2]!)) {
      flush();
      segments.push({ kind: "image", alt: image[1] ?? "", url: image[2]! });
      continue;
    }
    /* An image in the middle of a sentence stays a link: the prose renderer
       draws links, not pictures. */
    prose.push(line.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)[^)]*\)/g, (_match, alt: string, url: string) => `[${alt || "image"}](${url})`));
  }
  flush();
  return segments;
}

/* ---- Small parts -------------------------------------------------------- */

function Avatar({ author, official, className }: { author: PracticeSolutionSummary["author"]; official: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (official) {
    return (
      <span className={cn("grid shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--warning)_14%,transparent)]", className)}>
        <LeetCodeGlyph className="size-1/2" />
      </span>
    );
  }
  const url = author.avatarUrl;
  const usable = url && !failed && !/default_avatar/i.test(url);
  if (usable) {
    return (
      <img
        alt=""
        className={cn("shrink-0 rounded-full bg-muted object-cover ring-[0.5px] ring-[var(--border-strong)]", className)}
        loading="lazy"
        onError={() => setFailed(true)}
        referrerPolicy="no-referrer"
        src={url}
      />
    );
  }
  const hue = [...(author.username || author.name)].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full text-[0.5rem] font-semibold", className)}
      style={{ background: `oklch(88% 0.06 ${hue})`, color: `oklch(38% 0.09 ${hue})` }}
    >
      {initials(author.name || author.username)}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_800);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button aria-label={copied ? "Copied" : "Copy code"} onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => undefined)} title={copied ? "Copied" : "Copy code"} type="button">
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function CodeSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-3 pb-4 pt-1">
      {[46, 72, 64, 30, 58, 40].map((width, index) => (
        <span className="h-2.5 animate-pulse rounded bg-foreground/[0.07]" key={index} style={{ width: `${width}%`, marginLeft: index % 3 ? "1.5rem" : 0 }} />
      ))}
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex flex-col gap-2 py-3">
      <span className="h-3 w-3/4 animate-pulse rounded bg-foreground/[0.07]" />
      <span className="flex items-center gap-1.5">
        <span className="size-4 animate-pulse rounded-full bg-foreground/[0.07]" />
        <span className="h-2.5 w-1/3 animate-pulse rounded bg-foreground/[0.05]" />
      </span>
    </div>
  );
}

/** The language in Spar's own name for it ("Python", not LeetCode's "Python3"). */
function languageName(stats: PracticeSubmissionStats) {
  const spar = sparLanguage(stats.language);
  return spar ? LANGUAGE_LABEL[spar] : stats.languageName || stats.language;
}

/**
 * A write-up's title without the noticeboard dressing — the emoji, the
 * `|| C++ || JAVA ||` separators — so a list of them reads as a list of ideas.
 */
function cleanTitle(title: string) {
  const parts = title
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .split(/\s*(?:\|{1,2}|·|•)\s*/)
    .map((part) => part.replace(/\s{2,}/g, " ").trim())
    /* "C++ || JAVA || PYTHON" says which tabs the code block has, which the
       code block already says. */
    .filter((part) => part && !LANGUAGE_NAME.test(part));
  const plain = parts.join(" · ").replace(/^[\s·:-]+|[\s·:-]+$/g, "").trim();
  return plain || title;
}

const LANGUAGE_NAME = /^(?:c\+\+|c|c#|java|python3?|javascript|js|typescript|ts|go|golang|rust|swift|ruby|kotlin|php|dart|scala|c\s*\/\s*c\+\+|(?:(?:c\+\+|c|java|python3?|javascript|js|typescript|ts|go|rust|kotlin|swift|ruby|c#|php|dart)\s*[/,&+]\s*)+(?:c\+\+|c|java|python3?|javascript|js|typescript|ts|go|rust|kotlin|swift|ruby|c#|php|dart))$/i;

/** LeetCode's language names (`python3`, `golang`, `Python3`, `C++`) as Spar's. */
function sparLanguage(value: string) {
  const token = value.trim().toLowerCase();
  if (!token) return null;
  return languageOf(token) ?? languageOf(token.replace(/\d+$/, "")) ?? null;
}

/** The Solutions board tags languages by slug, and Go is `go` there but
 *  `golang` on the submission. */
function solutionTag(language: string) {
  return language === "golang" ? "go" : language;
}

function formatBucket(value: number, metric: Metric) {
  if (metric === "runtime") return `${value} ms`;
  /* Memory buckets come in kilobytes on most problems; a small number is
     already megabytes. */
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)} MB` : `${value} MB`;
}

/** Recent posts relative, older ones dated — with the year once it is not this
 *  one, because a 2023 write-up reading "9 Jun" looks a week old. */
function postedAt(value: string) {
  const date = new Date(value);
  if (Date.now() - date.getTime() < 7 * 86_400_000) return relativeTime(value);
  return date.toLocaleDateString([], { month: "short", day: "numeric", ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
}

function splitDisplay(display: string): [string, string] {
  const match = /^\s*([\d.,]+)\s*(.*)$/.exec(display);
  return match ? [match[1]!, match[2]!.trim()] : [display, ""];
}

const COMPACT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
function compact(value: number) {
  return COMPACT.format(value);
}

function initials(name: string) {
  const parts = name.trim().split(/[\s_.-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase();
}

