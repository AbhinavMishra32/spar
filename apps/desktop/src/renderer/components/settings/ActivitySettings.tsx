import { memo, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import type { ActivityReport, ActivitySolve, SparApi } from "../../../shared/api";
import { DropdownMenu, DropdownMenuCheckItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SparDots } from "@/components/common/SparDots";
import { cn } from "@/lib/utils";
import { Panel } from "../common/Page";
import { CodeforcesGlyph, LeetCodeGlyph } from "../common/SourceGlyph";
import { SettingsSection } from "./layout";

/**
 * The practice calendar: a year of days, each one showing how much was solved
 * and where it came from.
 *
 * A day is one blue, stronger the more was solved. Where it came from — a
 * week of LeetCode and a week of Spar's own challenges are different weeks — is
 * one hover away, and the source lens narrows the calendar to one of them.
 * A day with work but no solve gets a faint wash rather than nothing: it was a
 * day practised, and a calendar that shows it as empty is telling the learner
 * the struggle did not count.
 *
 * The sources are read from the report, not from a list here. `SOURCES` only
 * gives the known ones a name, a colour and a mark; a provider added later
 * arrives with a name derived from its id and a colour hashed from it, and every
 * part of the page picks it up.
 */

type SourceMeta = { id: string; name: string; color: string; Glyph: ComponentType<{ className?: string }> };

const SparGlyph = ({ className }: { className?: string }) => <SparDots className={cn("text-foreground", className)} pattern="pass" size={16} />;

const SOURCES: Record<string, Omit<SourceMeta, "id">> = {
  /* Spar's own ink, as everywhere else in the app: the mark is monochrome, and
     the two providers beside it are the only colour on the calendar. */
  spar: { name: "Spar", color: "var(--foreground)", Glyph: SparGlyph },
  leetcode: { name: "LeetCode", color: "#ffa116", Glyph: LeetCodeGlyph },
  /* The red bar of Codeforces' mark rather than its blue one: the calendar is
     blue, and a blue glow on a blue cell would not show. */
  codeforces: { name: "Codeforces", color: "#f44336", Glyph: CodeforcesGlyph },
};
const KNOWN = Object.keys(SOURCES);

function sourceMeta(id: string): SourceMeta {
  const known = SOURCES[id];
  if (known) return { id, ...known };
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  const name = id.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const color = `oklch(64% 0.14 ${hash})`;
  const Glyph = ({ className }: { className?: string }) => (
    <span className={cn("grid place-items-center rounded-[4px] text-[10px] font-semibold text-white", className)} style={{ background: color }}>{name[0]}</span>
  );
  return { id, name, color, Glyph };
}

/* How strong a cell of each level is, as a share of the source's colour mixed
   into the empty cell. Level 0 is the empty cell itself. */
const LEVEL_MIX = [0, 34, 56, 78, 100];
/* A day worked on with nothing solved: under the first level, so it reads as
   presence rather than as a small result. */
const PRACTISED_MIX = 16;
/** Space between cells, in px. The plot is sized from it, so the cells stay square. */
const GAP = 2;
const EMPTY = "var(--activity-empty)";
/** The calendar's one hue. Sources are told apart by the lens and the hover
 *  card, not by the cells, so a year reads as one ramp of effort. */
const HEAT = "var(--activity-heat)";

/* A provider's solves glow from the middle of the cell in the provider's
   colour, fading out into the blue: the cell's strength still says how much,
   and the warmth at its heart says where from. A day with two providers splits
   the glow left and right so neither hides the other. Spar is the blue itself. */
function glows(ids: string[]) {
  const spots = ids.length === 1 ? ["50% 50%"] : ids.map((_, index) => `${((index + 0.5) / ids.length) * 100}% 50%`);
  /* Soft, not a dot: strong at the middle and eased out to nothing by the
     cell's edge over several stops, so there is no ring where it ends. */
  const size = ids.length === 1 ? "closest-side" : "farthest-side";
  return ids.map((id, index) => {
    const tone = (alpha: number) => `color-mix(in oklab, ${sourceMeta(id).color} ${alpha}%, transparent)`;
    return `radial-gradient(${size} at ${spots[index]}, ${tone(95)} 0%, ${tone(70)} 30%, ${tone(32)} 65%, transparent 100%)`;
  });
}
const tint = (color: string, level: number) => (level <= 0 ? EMPTY : `color-mix(in oklab, ${color} ${LEVEL_MIX[level]}%, ${EMPTY})`);

type View = "daily" | "weekly" | "cumulative";
const VIEWS: Array<{ value: View; label: string }> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "cumulative", label: "Cumulative" },
];

type Tally = { solved: number; worked: number };
type Day = {
  key: string;
  date: Date;
  /** Solves and touched challenges per source. Only sources with activity. */
  by: Record<string, Tally>;
  solved: number;
  worked: number;
  titles: ActivitySolve[];
};

type Range = "past" | number;

const DAY_MS = 86_400_000;
const localDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parseDay = (day: string) => { const [year, month, date] = day.split("-").map(Number); return new Date(year!, month! - 1, date!); };
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const plural = (count: number, noun: string) => `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

export function ActivitySettings({ api }: { api: SparApi | undefined }) {
  const [report, setReport] = useState<ActivityReport | null>(null);

  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.activityReport().then((value) => { if (live) setReport(value); }).catch(() => undefined);
    return () => { live = false; };
  }, [api]);

  const days = useMemo(() => (report ? collect(report) : null), [report]);

  if (!report || !days) {
    return (
      <Panel className="-mx-3.5 flex items-center gap-2.5 px-3.5 py-6">
        <SparDots className="text-muted-foreground" pattern="pulse" size={16} />
        <span className="text-ui text-muted-foreground">{api ? "Reading your practice…" : "Activity is recorded in the desktop app."}</span>
      </Panel>
    );
  }
  return <Activity days={days} report={report} />;
}

function Activity({ days, report }: { days: Map<string, Day>; report: ActivityReport }) {
  const [range, setRange] = useState<Range>("past");
  const [view, setView] = useState<View>("daily");
  /* The lens the learner chose, and the one they are pointing at. Pointing
     previews without committing, so running the pointer down the source list
     reads as a quick comparison rather than a series of clicks. */
  const [lens, setLens] = useState<string | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const shown = peek ?? lens;

  const sources = useMemo(() => {
    const seen = new Set<string>(KNOWN);
    for (const day of days.values()) for (const id of Object.keys(day.by)) seen.add(id);
    return [...seen].map(sourceMeta);
  }, [days]);

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const key of days.keys()) set.add(Number(key.slice(0, 4)));
    return [...set].sort((a, b) => b - a);
  }, [days]);

  const grid = useMemo(() => buildGrid(days, range), [days, range]);
  const stats = useMemo(() => summarise(days, report), [days, report]);

  const inRange = grid.cells.filter((cell) => cell.inside && cell.day);
  const solvedInRange = inRange.reduce((sum, cell) => sum + (shown ? cell.day!.by[shown]?.solved ?? 0 : cell.day!.solved), 0);
  const lensName = shown ? sources.find((source) => source.id === shown)?.name : null;

  return (
    <>
      <StatStrip stats={stats} />

      <SettingsSection title="Calendar">
        <Panel className="-mx-3.5 px-3.5 pt-3 pb-3">
          <div className="flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-1 truncate text-ui text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums"><Count value={solvedInRange} /></span>
              <span className="truncate">{lensName ? `${lensName} solved` : "solved"}</span>
              <RangePicker onChange={setRange} range={range} years={years} />
            </p>
            <TextTabs<View> onChange={setView} options={VIEWS} value={view} />
          </div>

          <Chart epoch={`${lens ?? "all"}:${range}`} grid={grid} lens={shown} sources={sources} view={view} />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="-ml-1.5 flex flex-wrap items-center gap-0.5" onPointerLeave={() => setPeek(null)} role="radiogroup" aria-label="Show source">
              <LensChip active={lens === null} label="All" onPick={() => setLens(null)} onPoint={() => setPeek(null)} />
              {sources.map((source) => (
                <LensChip
                  active={lens === source.id}
                  color={source.color}
                  key={source.id}
                  label={source.name}
                  onPick={() => setLens((current) => (current === source.id ? null : source.id))}
                  onPoint={() => setPeek(source.id)}
                />
              ))}
            </div>
            {view === "daily" && <Legend sources={sources} />}
          </div>
        </Panel>
      </SettingsSection>

      <div className="grid gap-8 @md:grid-cols-2 @md:gap-6">
        <SettingsSection title="Sources">
          <SourceList days={days} lens={lens} onLens={setLens} onPeek={setPeek} sources={sources} solves={report.solves} />
        </SettingsSection>
        <SettingsSection title="Rhythm">
          <Rhythm days={days} lens={shown} report={report} />
        </SettingsSection>
      </div>
    </>
  );
}

/* ---- Data ---------------------------------------------------------------- */

function collect(report: ActivityReport) {
  const days = new Map<string, Day>();
  const at = (key: string) => {
    let day = days.get(key);
    if (!day) days.set(key, (day = { key, date: parseDay(key), by: {}, solved: 0, worked: 0, titles: [] }));
    return day;
  };
  const tally = (day: Day, source: string) => (day.by[source] ??= { solved: 0, worked: 0 });
  for (const row of report.days) {
    const day = at(row.day);
    tally(day, row.source).worked += row.worked;
    day.worked += row.worked;
  }
  for (const solve of report.solves) {
    const day = at(solve.day);
    tally(day, solve.source).solved += 1;
    day.solved += 1;
    day.titles.push(solve);
  }
  return days;
}

type Cell = { key: string; col: number; row: number; inside: boolean; future: boolean; today: boolean; day: Day | null };
type Grid = { cells: Cell[]; weeks: number; months: Array<{ col: number; label: string }>; columns: Cell[][] };

/** Weeks as columns, Sunday on top, the way every contribution calendar is read. */
function buildGrid(days: Map<string, Day>, range: Range): Grid {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const first = range === "past" ? addDays(today, -364) : new Date(range, 0, 1);
  const last = range === "past" ? today : new Date(range, 11, 31);
  const start = addDays(first, -first.getDay());
  const end = addDays(last, 6 - last.getDay());
  const weeks = Math.round((end.getTime() - start.getTime()) / DAY_MS / 7) + 1;
  const cells: Cell[] = [];
  const columns: Cell[][] = Array.from({ length: weeks }, () => []);
  const months: Grid["months"] = [];
  const todayKey = localDay(today);
  for (let col = 0; col < weeks; col += 1) {
    for (let row = 0; row < 7; row += 1) {
      const date = addDays(start, col * 7 + row);
      const key = localDay(date);
      const cell: Cell = { key, col, row, inside: date >= first && date <= last, future: date > today, today: key === todayKey, day: days.get(key) ?? null };
      cells.push(cell);
      columns[col]!.push(cell);
      if (cell.inside && date.getDate() === 1) months.push({ col, label: date.toLocaleDateString(undefined, { month: "short" }) });
    }
  }
  /* The first month is named from the first column even when its 1st fell
     before the range, unless the next label is too close to leave room. */
  if (!months.length || months[0]!.col > 2) months.unshift({ col: 0, label: first.toLocaleDateString(undefined, { month: "short" }) });
  return { cells, weeks, months: months.filter((month, index, all) => index === 0 || month.col - all[index - 1]!.col >= 3), columns };
}

type Stats = {
  solved: number;
  activeDays: number;
  current: number;
  longest: number;
  best: { count: number; day: string } | null;
};

function summarise(days: Map<string, Day>, report: ActivityReport): Stats {
  const active = [...days.values()].filter((day) => day.solved > 0 || day.worked > 0).map((day) => day.key).sort();
  let longest = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const key of active) {
    const date = parseDay(key);
    run = previous && Math.round((date.getTime() - previous.getTime()) / DAY_MS) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = date;
  }
  /* A streak is still alive on a day not yet practised: it ends at midnight,
     not at the start of the day. */
  const set = new Set(active);
  let cursor = new Date();
  if (!set.has(localDay(cursor))) cursor = addDays(cursor, -1);
  let current = 0;
  while (set.has(localDay(cursor))) { current += 1; cursor = addDays(cursor, -1); }

  let best: Stats["best"] = null;
  for (const day of days.values()) if (day.solved > (best?.count ?? 0)) best = { count: day.solved, day: day.key };
  return {
    solved: new Set(report.solves.map((solve) => solve.questionId)).size,
    activeDays: active.length,
    current,
    longest,
    best,
  };
}

/* ---- Overview ------------------------------------------------------------ */

/** Five figures on one card, divided by hairlines: the reading someone opens this
 *  page for, before the calendar explains it. */
function StatStrip({ stats }: { stats: Stats }) {
  const items: Array<{ label: string; value: number; unit?: string; note?: string }> = [
    { label: "Solved", value: stats.solved },
    { label: "Active days", value: stats.activeDays },
    { label: "Current streak", value: stats.current, unit: stats.current === 1 ? "day" : "days" },
    { label: "Longest streak", value: stats.longest, unit: stats.longest === 1 ? "day" : "days" },
    { label: "Best day", value: stats.best?.count ?? 0, ...(stats.best ? { note: shortDate(stats.best.day) } : {}) },
  ];
  return (
    <Panel className="-mx-3.5 grid grid-cols-2 divide-[var(--border-surface-strong)] @md:grid-cols-5 @md:divide-x-[length:var(--hairline)]">
      {items.map((item, index) => (
        <div className={cn("min-w-0 px-3 py-3.5 text-center", index === items.length - 1 && "col-span-2 @md:col-span-1")} key={item.label} title={item.note}>
          <p className="text-content font-medium tracking-[-0.01em] tabular-nums">
            <Count value={item.value} />
            {item.unit && <span className="ml-1 text-ui font-normal text-muted-foreground">{item.unit}</span>}
          </p>
          <p className="mt-0.5 truncate text-ui text-muted-foreground">{item.label}</p>
        </div>
      ))}
    </Panel>
  );
}

/** A figure that counts up to its value, writing straight to the DOM so a
 *  running number never re-renders the page under it. */
function Count({ value }: { value: number }) {
  const node = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    const element = node.current;
    if (!element) return;
    if (reduce) { element.textContent = value.toLocaleString(); from.current = value; return; }
    const controls = animate(from.current, value, {
      duration: 0.7,
      ease: [0.32, 0.72, 0, 1],
      onUpdate: (latest) => { element.textContent = Math.round(latest).toLocaleString(); },
    });
    from.current = value;
    return () => controls.stop();
  }, [value, reduce]);
  return <span ref={node}>0</span>;
}

/* ---- Controls ------------------------------------------------------------ */

/** Tabs as words, the lightest control that still says which view is up. */
function TextTabs<T extends string>({ onChange, options, value }: { onChange(value: T): void; options: Array<{ value: T; label: string }>; value: T }) {
  return (
    <div className="flex shrink-0 items-center gap-3" role="tablist">
      {options.map((option) => (
        <button
          aria-selected={option.value === value}
          className={cn(
            "relative text-ui font-medium outline-none transition-colors focus-visible:text-foreground",
            option.value === value ? "text-foreground" : "text-muted-foreground/70 hover:text-foreground",
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="tab"
          type="button"
        >
          {option.label}
          {option.value === value && (
            <motion.span className="absolute inset-x-0 -bottom-1 h-px rounded-full bg-foreground/70" layoutId="activity-tab" transition={{ type: "spring", stiffness: 520, damping: 40 }} />
          )}
        </button>
      ))}
    </div>
  );
}

function RangePicker({ onChange, range, years }: { onChange(range: Range): void; range: Range; years: number[] }) {
  const label = range === "past" ? "in the past year" : `in ${range}`;
  if (!years.length) return <span className="truncate">{label}</span>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex min-w-0 items-center gap-0.5 rounded-[var(--radius-md)] px-1 py-0.5 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring" type="button">
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        <DropdownMenuCheckItem checked={range === "past"} onSelect={() => onChange("past")}>Past year</DropdownMenuCheckItem>
        {years.map((year) => (
          <DropdownMenuCheckItem checked={range === year} key={year} onSelect={() => onChange(year)}>{year}</DropdownMenuCheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LensChip({ active, color, label, onPick, onPoint }: { active: boolean; color?: string; label: string; onPick(): void; onPoint(): void }) {
  return (
    <button
      aria-checked={active}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-ui outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onPick}
      onFocus={onPoint}
      onPointerEnter={onPoint}
      role="radio"
      type="button"
    >
      {color ? (
        <span className="size-2 rounded-[3px]" style={{ background: color }} />
      ) : (
        <span className="grid size-2 grid-cols-2 gap-px overflow-hidden rounded-[3px]">
          {KNOWN.map((id) => <span key={id} style={{ background: SOURCES[id]!.color }} />)}
          <span className="bg-foreground/30" />
        </span>
      )}
      {label}
    </button>
  );
}

function Legend({ sources }: { sources: SourceMeta[] }) {
  const color = HEAT;
  const marked = sources.filter((source) => source.id !== "spar");
  return (
    <div className="flex items-center gap-1.5 text-ui-sm text-muted-foreground">
      {marked.map((source) => (
        <span className="mr-1.5 inline-flex items-center gap-1.5" key={source.id} title={`Solved on ${source.name} that day`}>
          <span className="size-2.5 rounded-[2.5px]" style={{ background: `${glows([source.id])[0]}, ${tint(HEAT, 3)}` }} />
          {source.name}
        </span>
      ))}
      <span className="mr-1.5 inline-flex items-center gap-1.5" title="Worked on, nothing solved">
        <span className="size-2.5 rounded-[2.5px]" style={{ background: `color-mix(in oklab, ${color} ${PRACTISED_MIX}%, ${EMPTY})` }} />
        practised
      </span>
      Less
      {LEVEL_MIX.map((_, level) => (
        <span
          className="size-2.5 rounded-[2.5px]"
          key={level}
          style={{ background: tint(color, level) }}
        />
      ))}
      More
    </div>
  );
}

/* ---- Chart --------------------------------------------------------------- */

const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

type Hover = { col: number; row: number | null };

function Chart({ epoch, grid, lens, sources, view }: { epoch: string; grid: Grid; lens: string | null; sources: SourceMeta[]; view: View }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const box = useRef<HTMLDivElement>(null);
  /* Sized from the width it is given, so every cell is exactly square and the
     three views share one height. One observer for the whole plot. */
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const cell = width ? (width - (grid.weeks - 1) * GAP) / grid.weeks : 0;
  const height = cell * 7 + GAP * 6;

  /* One listener for the whole plot, reading the column and row off the pointer
     rather than off a handler per cell: four hundred cells with their own
     listeners is the kind of thing that makes a settings page feel heavy. */
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const col = Math.floor((event.clientX - rect.left + GAP / 2) / (cell + GAP));
    const row = view === "daily" ? Math.floor((event.clientY - rect.top + GAP / 2) / (cell + GAP)) : null;
    if (col < 0 || col >= grid.weeks || (row !== null && (row < 0 || row > 6))) return setHover(null);
    const target = row === null ? null : grid.columns[col]![row]!;
    if (target && !target.inside) return setHover(null);
    setHover((current) => (current?.col === col && current.row === row ? current : { col, row }));
  };

  return (
    <div className="mt-3 grid grid-cols-[1.625rem_minmax(0,1fr)] gap-x-1">
      <span />
      <div className="relative mb-1 h-4 text-ui-sm text-muted-foreground">
        {grid.months.map((month) => (
          <span className="absolute top-0 whitespace-nowrap" key={`${month.col}-${month.label}`} style={{ left: month.col * (cell + GAP) }}>{month.label}</span>
        ))}
      </div>

      <YAxis grid={grid} lens={lens} view={view} />

      <div className="relative" ref={box} style={{ height: height || undefined, aspectRatio: height ? undefined : `${grid.weeks} / 7` }}>
        <div className="absolute inset-0" onPointerLeave={() => setHover(null)} onPointerMove={point}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              animate={{ opacity: 1 }}
              className="absolute inset-0"
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              initial={{ opacity: 0 }}
              key={view}
            >
              {view === "daily" && <Heatmap epoch={epoch} grid={grid} lens={lens} sources={sources} />}
              {view === "weekly" && <WeeklyBars epoch={epoch} grid={grid} lens={lens} sources={sources} />}
              {view === "cumulative" && <Cumulative epoch={epoch} grid={grid} lens={lens} sources={sources} />}
            </motion.div>
          </AnimatePresence>
          <Pointer cell={cell} grid={grid} hover={hover} lens={lens} sources={sources} view={view} />
        </div>
      </div>
    </div>
  );
}

function YAxis({ grid, lens, view }: { grid: Grid; lens: string | null; view: View }) {
  const max = useMemo(() => (view === "weekly" ? weeklyMax(grid, lens) : view === "cumulative" ? cumulative(grid, lens).at(-1) ?? 0 : 0), [grid, lens, view]);
  /* Absolutely placed, so the labels' own line height can never make the row
     taller than the plot beside it and push them off the rows they name. */
  return (
    <div className="relative text-ui-sm leading-none text-muted-foreground">
      {view === "daily" ? (
        <div className="absolute inset-0 grid grid-rows-7">
          {DAY_LABELS.map((label, index) => <span className="flex items-center" key={index}>{label}</span>)}
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col justify-between text-right tabular-nums">
          <span>{max}</span>
          <span>0</span>
        </div>
      )}
    </div>
  );
}

/* The plot is memoised on what it draws, so hovering — which re-renders the
   chart around it — never touches the cells themselves. Choosing a lens or a
   range remounts it under a new `epoch`, and the entrance runs again as a
   diagonal wave: the one piece of motion that says "this is a different
   reading". Pointing at a lens only recolours, so a sweep down the list does not
   set off a wave per row. */
const Heatmap = memo(function Heatmap({ epoch, grid, lens, sources }: { epoch: string; grid: Grid; lens: string | null; sources: SourceMeta[] }) {
  const max = useMemo(() => Math.max(1, ...grid.cells.map((cell) => valueOf(cell.day, lens))), [grid, lens]);
  return (
    <div
      className="grid size-full"
      key={epoch}
      style={{ gap: GAP, gridTemplateColumns: `repeat(${grid.weeks}, minmax(0, 1fr))`, gridTemplateRows: "repeat(7, minmax(0, 1fr))", gridAutoFlow: "column" }}
    >
      {grid.cells.map((cell) => {
        if (!cell.inside) return <span key={cell.key} />;
        const value = valueOf(cell.day, lens);
        const level = value > 0 ? Math.max(1, Math.ceil((value / max) * 4)) : 0;
        let background = EMPTY;
        if (level > 0) {
          const providers = Object.entries(cell.day!.by)
            .filter(([id, tally]) => id !== "spar" && tally.solved > 0 && (!lens || id === lens))
            .map(([id]) => id)
            .sort((a, b) => order(a) - order(b));
          background = [...glows(providers), tint(HEAT, level)].join(", ");
        }
        else if (cell.day && workedOf(cell.day, lens) > 0) background = `color-mix(in oklab, ${HEAT} ${PRACTISED_MIX}%, ${EMPTY})`;
        return (
          <span
            className={cn("activity-cell rounded-[2.5px]", cell.future && "opacity-40", cell.today && "activity-today")}
            key={cell.key}
            style={{ background, ["--wave" as string]: `${cell.col * 9 + cell.row * 14}ms` }}
          />
        );
      })}
    </div>
  );
});

const WeeklyBars = memo(function WeeklyBars({ epoch, grid, lens, sources }: { epoch: string; grid: Grid; lens: string | null; sources: SourceMeta[] }) {
  const max = Math.max(1, weeklyMax(grid, lens));
  return (
    <div className="grid size-full items-end" key={epoch} style={{ gap: GAP, gridTemplateColumns: `repeat(${grid.weeks}, minmax(0, 1fr))` }}>
      {grid.columns.map((column, col) => {
        const totals = weekTotals(column, lens);
        const sum = Object.values(totals).reduce((a, b) => a + b, 0);
        return (
          <div
            className="activity-bar flex h-full flex-col-reverse overflow-hidden rounded-[2.5px]"
            key={col}
            style={{ ["--wave" as string]: `${col * 11}ms`, background: sum ? undefined : "transparent" }}
          >
            {sum === 0 && <span className="h-[2px] w-full rounded-full" style={{ background: EMPTY }} />}
            {sources.filter((source) => totals[source.id]).map((source) => (
              <span key={source.id} style={{ height: `${(totals[source.id]! / max) * 100}%`, background: source.color }} />
            ))}
          </div>
        );
      })}
    </div>
  );
});

/** Running totals, stacked by source: the shape of a year, where the steep weeks
 *  are the ones that mattered. */
const Cumulative = memo(function Cumulative({ epoch, grid, lens, sources }: { epoch: string; grid: Grid; lens: string | null; sources: SourceMeta[] }) {
  const layers = useMemo(() => {
    const shown = sources.filter((source) => !lens || source.id === lens).sort((a, b) => order(a.id) - order(b.id));
    const running = shown.map(() => 0);
    const tops: number[][] = shown.map(() => []);
    for (const column of grid.columns) {
      const totals = weekTotals(column, lens);
      let base = 0;
      shown.forEach((source, index) => {
        running[index]! += totals[source.id] ?? 0;
        base += running[index]!;
        tops[index]!.push(base);
      });
    }
    const max = Math.max(1, ...(tops.at(-1) ?? [0]));
    const x = (index: number) => ((index + 0.5) / grid.weeks) * 100;
    const y = (value: number) => 40 - (value / max) * 38;
    return shown.map((source, index) => {
      const top = tops[index]!;
      const below = index > 0 ? tops[index - 1]! : top.map(() => 0);
      const line = top.map((value, i) => `${i ? "L" : "M"}${x(i)} ${y(value)}`).join(" ");
      const back = below.map((value, i) => `L${x(i)} ${y(value)}`).reverse().join(" ");
      const area = `${line} ${back} Z`;
      return { source, line, area, empty: (top.at(-1) ?? 0) === (below.at(-1) ?? 0) };
    }).filter((layer) => !layer.empty);
  }, [grid, lens, sources]);

  return (
    <svg className="size-full overflow-visible" key={epoch} preserveAspectRatio="none" viewBox="0 0 100 40">
      <defs>
        <clipPath id="activity-sweep"><rect className="rating-curve-sweep" height="60" width="100" x="0" y="-10" /></clipPath>
      </defs>
      <path d="M0 39.75H100" stroke="var(--activity-empty)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <g clipPath="url(#activity-sweep)" style={{ ["--rating-draw" as string]: "900ms" }}>
        {layers.map(({ source, area, line }) => (
          <g key={source.id}>
            <path d={area} fill={`color-mix(in oklab, ${source.color} 22%, transparent)`} />
            <path d={line} fill="none" stroke={source.color} strokeLinejoin="round" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </g>
    </svg>
  );
});

/**
 * The hover: a ring that glides from cell to cell, and one card that follows it.
 * Both are single elements moved by springs, so reading across a row of the
 * calendar feels like dragging a lens over it rather than lighting up tooltips.
 */
function Pointer({ cell, grid, hover, lens, sources, view }: { cell: number; grid: Grid; hover: Hover | null; lens: string | null; sources: SourceMeta[]; view: View }) {
  const spring = { type: "spring", stiffness: 620, damping: 44, mass: 0.6 } as const;
  const column = hover ? grid.columns[hover.col]! : null;
  const cells = column ? (hover!.row === null ? column.filter((cell) => cell.inside) : [column[hover!.row]!]) : [];
  /* The ring sits on the cell's own box, from the same arithmetic the grid uses,
     so it outlines the cell rather than approximating it. */
  const pitch = cell + GAP;
  const left = hover ? hover.col * pitch : 0;
  const top = hover?.row ? hover.row * pitch : 0;
  const flip = hover ? hover.col > grid.weeks * 0.62 : false;
  const running = useMemo(() => (view === "cumulative" ? cumulative(grid, lens) : null), [grid, lens, view]);

  return (
    <AnimatePresence>
      {hover && cells.length > 0 && (
        <motion.div
          animate={{ opacity: 1 }}
          className="pointer-events-none absolute inset-0 z-10"
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          initial={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          <motion.span
            animate={{ left, top }}
            className={cn("absolute rounded-[2.5px]", view === "daily" ? "shadow-[0_0_0_1.5px_var(--foreground)]" : "bg-foreground/[0.06]")}
            initial={false}
            style={{ width: cell, height: hover.row === null ? "100%" : cell }}
            transition={spring}
          />
          <motion.div
            animate={{ left: left + cell / 2, top }}
            className="absolute"
            initial={false}
            transition={spring}
          >
            <div className={cn("absolute bottom-2 w-60", flip ? "right-0 translate-x-3" : "left-0 -translate-x-3")}>
              <DayCard cells={cells} lens={lens} running={running?.[hover.col] ?? null} sources={sources} weekly={hover.row === null} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DayCard({ cells, lens, running, sources, weekly }: { cells: Cell[]; lens: string | null; running: number | null; sources: SourceMeta[]; weekly: boolean }) {
  const first = cells[0]!;
  const by: Record<string, Tally> = {};
  const titles: ActivitySolve[] = [];
  for (const cell of cells) {
    if (!cell.day) continue;
    for (const [id, tally] of Object.entries(cell.day.by)) {
      if (lens && id !== lens) continue;
      const into = (by[id] ??= { solved: 0, worked: 0 });
      into.solved += tally.solved;
      into.worked += tally.worked;
    }
    titles.push(...cell.day.titles.filter((solve) => !lens || solve.source === lens));
  }
  const solved = Object.values(by).reduce((sum, tally) => sum + tally.solved, 0);
  const worked = Object.values(by).reduce((sum, tally) => sum + tally.worked, 0);
  const rows = sources.filter((source) => by[source.id]);
  const most = Math.max(1, ...rows.map((source) => by[source.id]!.solved));
  const date = parseDay(first.key);
  const heading = weekly
    ? `Week of ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

  return (
    <div className="menu-surface rounded-xl p-2.5 text-left shadow-xl">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-ui-sm text-muted-foreground">{heading}{first.today && !weekly ? " · today" : ""}</p>
        {running !== null && <p className="shrink-0 text-ui-sm text-muted-foreground tabular-nums">{running} total</p>}
      </div>
      <p className="mt-0.5 text-content font-medium tracking-[-0.01em] tabular-nums">
        {solved ? plural(solved, "solve") : worked ? "Practised, nothing solved" : first.future ? "Still to come" : "A day off"}
        {solved > 0 && worked > solved && <span className="ml-1.5 text-ui font-normal text-muted-foreground">of {worked} worked on</span>}
      </p>
      {rows.length > 0 && (
        <ul className="mt-2 space-y-1">
          {rows.map((source) => (
            <li className="flex items-center gap-2 text-ui" key={source.id}>
              <source.Glyph className="size-3.5 shrink-0" />
              <span className="w-[4.5rem] shrink-0 truncate text-muted-foreground">{source.name}</span>
              <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--activity-empty)]">
                <span className="block h-full rounded-full" style={{ width: `${(by[source.id]!.solved / most) * 100}%`, background: source.color }} />
              </span>
              <span className="w-5 shrink-0 text-right font-medium tabular-nums">{by[source.id]!.solved}</span>
            </li>
          ))}
        </ul>
      )}
      {titles.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t-[length:var(--hairline)] border-[var(--border-surface-strong)] pt-2">
          {titles.slice(0, 4).map((solve) => (
            <li className="flex items-center gap-1.5 text-ui-sm" key={`${solve.questionId}:${solve.day}`}>
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: sourceMeta(solve.source).color }} />
              {solve.displayId && <span className="shrink-0 text-muted-foreground tabular-nums">{solve.displayId}.</span>}
              <span className="truncate text-foreground/85">{solve.title}</span>
            </li>
          ))}
          {titles.length > 4 && <li className="text-ui-sm text-muted-foreground">and {titles.length - 4} more</li>}
        </ul>
      )}
    </div>
  );
}

const order = (id: string) => { const index = KNOWN.indexOf(id); return index === -1 ? KNOWN.length : index; };
const valueOf = (day: Day | null, lens: string | null) => (!day ? 0 : lens ? day.by[lens]?.solved ?? 0 : day.solved);
const workedOf = (day: Day, lens: string | null) => (lens ? day.by[lens]?.worked ?? 0 : day.worked);

function weekTotals(column: Cell[], lens: string | null) {
  const totals: Record<string, number> = {};
  for (const cell of column) {
    if (!cell.inside || !cell.day) continue;
    for (const [id, tally] of Object.entries(cell.day.by)) if ((!lens || id === lens) && tally.solved) totals[id] = (totals[id] ?? 0) + tally.solved;
  }
  return totals;
}
const weeklyMax = (grid: Grid, lens: string | null) => Math.max(0, ...grid.columns.map((column) => Object.values(weekTotals(column, lens)).reduce((a, b) => a + b, 0)));
function cumulative(grid: Grid, lens: string | null) {
  let running = 0;
  return grid.columns.map((column) => (running += Object.values(weekTotals(column, lens)).reduce((a, b) => a + b, 0)));
}

/* ---- Sources ------------------------------------------------------------- */

const DIFFICULTY_ORDER = ["easy", "foundation", "developing", "medium", "proficient", "hard", "advanced"];

function SourceList({ days, lens, onLens, onPeek, solves, sources }: {
  days: Map<string, Day>;
  lens: string | null;
  onLens(id: string | null): void;
  onPeek(id: string | null): void;
  solves: ActivitySolve[];
  sources: SourceMeta[];
}) {
  const rows = useMemo(() => {
    const today = new Date();
    return sources.map((source) => {
      const mine = solves.filter((solve) => solve.source === source.id);
      const distinct = new Set(mine.map((solve) => solve.questionId)).size;
      const levels = new Map<string, number>();
      for (const solve of mine) levels.set(solve.difficulty, (levels.get(solve.difficulty) ?? 0) + 1);
      const bands = [...levels.entries()].sort(([a], [b]) => DIFFICULTY_ORDER.indexOf(a) - DIFFICULTY_ORDER.indexOf(b));
      /* Twelve weeks of solves, for the spark: enough to show a habit forming or
         lapsing, short enough to read at a glance. */
      const spark = Array.from({ length: 12 }, (_, index) => {
        let count = 0;
        for (let offset = 0; offset < 7; offset += 1) count += days.get(localDay(addDays(today, -(11 - index) * 7 - offset)))?.by[source.id]?.solved ?? 0;
        return count;
      });
      return { source, distinct, bands, spark, last: mine.at(-1)?.day ?? null };
    }).sort((a, b) => b.distinct - a.distinct || order(a.source.id) - order(b.source.id));
  }, [days, solves, sources]);
  const most = Math.max(1, ...rows.flatMap((row) => row.spark));

  return (
    <ul className="-mx-2" onPointerLeave={() => onPeek(null)}>
      {rows.map(({ source, distinct, bands, spark, last }) => (
        <li key={source.id}>
          <button
            className={cn(
              "flex w-full items-center gap-3 rounded-[var(--radius-lg)] px-2 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring",
              lens === source.id && "bg-muted",
            )}
            onClick={() => onLens(lens === source.id ? null : source.id)}
            onFocus={() => onPeek(source.id)}
            onPointerEnter={() => onPeek(source.id)}
            type="button"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full border-[length:var(--hairline)] border-[var(--border-surface-strong)] bg-[var(--surface-primary)]">
              <source.Glyph className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-content font-medium tracking-[-0.01em]">{source.name}</span>
                <span className="shrink-0 text-ui text-muted-foreground tabular-nums"><span className="font-medium text-foreground">{distinct}</span> solved</span>
              </span>
              {distinct > 0 ? (
                <>
                  <span className="mt-1.5 flex h-1 gap-px overflow-hidden rounded-full">
                    {bands.map(([level, count], index) => (
                      <span key={level} style={{ flexGrow: count, background: `color-mix(in oklab, ${source.color} ${100 - (bands.length - 1 - index) * (60 / Math.max(1, bands.length))}%, var(--activity-empty))` }} title={`${count} ${level}`} />
                    ))}
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2 text-ui-sm text-muted-foreground">
                    <span className="truncate">{bands.map(([level, count]) => `${count} ${level}`).join(" · ")}</span>
                    <Spark color={source.color} max={most} values={spark} />
                  </span>
                </>
              ) : (
                <span className="mt-0.5 block truncate text-ui-sm text-muted-foreground">{last ? "" : "Nothing solved here yet"}</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Spark({ color, max, values }: { color: string; max: number; values: number[] }) {
  return (
    <span aria-hidden className="flex h-3 shrink-0 items-end gap-[2px]" title="Solves per week, last 12 weeks">
      {values.map((value, index) => (
        <span className="activity-bar w-[3px] rounded-[1px]" key={index} style={{ height: value ? `${Math.max(18, (value / max) * 100)}%` : "2px", background: value ? color : "var(--activity-empty)", ["--wave" as string]: `${index * 25}ms` }} />
      ))}
    </span>
  );
}

/* ---- Rhythm -------------------------------------------------------------- */

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** When the work happens: by weekday, by hour, and a few plain facts about pace.
 *  Follows the lens, so "when do I do Codeforces" is one hover away. */
function Rhythm({ days, lens, report }: { days: Map<string, Day>; lens: string | null; report: ActivityReport }) {
  const rhythm = useMemo(() => {
    const solves = lens ? report.solves.filter((solve) => solve.source === lens) : report.solves;
    const weekday = Array.from({ length: 7 }, () => 0);
    const hours = Array.from({ length: 24 }, () => 0);
    for (const solve of solves) {
      weekday[parseDay(solve.day).getDay()]! += 1;
      hours[new Date(solve.at).getHours()]! += 1;
    }
    let active = 0;
    for (const day of days.values()) if (lens ? day.by[lens] : day.solved || day.worked) active += 1;
    return { weekday, hours, count: solves.length, active, first: solves[0]?.day ?? null };
  }, [days, lens, report]);
  const stats = { weekday: rhythm.weekday, hours: rhythm.hours };
  const total = rhythm.count;
  const busiest = total ? stats.weekday.indexOf(Math.max(...stats.weekday)) : -1;
  const peakHour = total ? stats.hours.indexOf(Math.max(...stats.hours)) : -1;
  const perDay = rhythm.active ? total / rhythm.active : 0;
  const weekMax = Math.max(1, ...stats.weekday);
  const hourMax = Math.max(1, ...stats.hours);
  const hourLabel = (hour: number) => new Intl.DateTimeFormat(undefined, { hour: "numeric", hour12: true }).format(new Date(2000, 0, 1, hour));

  const facts: Array<[string, string]> = [
    ["Busiest day", busiest >= 0 ? `${new Date(2000, 0, 2 + busiest).toLocaleDateString(undefined, { weekday: "long" })} · ${Math.round((stats.weekday[busiest]! / total) * 100)}%` : "—"],
    ["Peak hour", peakHour >= 0 ? hourLabel(peakHour) : "—"],
    ["Solves per active day", perDay ? perDay.toFixed(1) : "—"],
    ["First solve", rhythm.first ? shortDate(rhythm.first, true) : "—"],
  ];

  return (
    <div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-4 px-0.5">
        <div className="flex h-10 items-end gap-1" title="Solves by weekday">
          {stats.weekday.map((value, index) => (
            <span className="flex h-full w-3 flex-col items-center justify-end gap-1" key={index}>
              <span
                className="activity-bar w-full rounded-[2px]"
                style={{ height: `${Math.max(6, (value / weekMax) * 70)}%`, background: index === busiest ? "color-mix(in oklab, var(--foreground) 72%, transparent)" : "color-mix(in oklab, var(--foreground) 16%, transparent)", ["--wave" as string]: `${index * 30}ms` }}
              />
              <span className="text-[10px] leading-none text-muted-foreground">{WEEKDAYS[index]}</span>
            </span>
          ))}
        </div>
        <div className="min-w-0" title="Solves by hour of day">
          <div className="flex h-7 items-end gap-px">
            {stats.hours.map((value, hour) => (
              <span
                className="activity-bar min-w-0 flex-1 rounded-[1px]"
                key={hour}
                style={{ height: value ? `${Math.max(10, (value / hourMax) * 100)}%` : "2px", background: hour === peakHour ? "color-mix(in oklab, var(--foreground) 72%, transparent)" : value ? "color-mix(in oklab, var(--foreground) 16%, transparent)" : "var(--activity-empty)", ["--wave" as string]: `${hour * 12}ms` }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] leading-none text-muted-foreground">
            <span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span>
          </div>
        </div>
      </div>
      <dl className="mt-3">
        {facts.map(([label, value]) => (
          <div className="flex items-baseline justify-between gap-3 py-1.5" key={label}>
            <dt className="truncate text-ui text-muted-foreground">{label}</dt>
            <dd className="shrink-0 text-ui font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function shortDate(day: string, year = false) {
  const date = parseDay(day);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(year || date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}
