import { useEffect, useId, useMemo, useState } from "react";
import type { ProviderId, ProviderInventory, SparApi, SubscriptionUsage, UsageReport, UsageTotals, UsageWindow } from "../../../shared/api";
import { Meter as Bands, type MeterBand } from "@/components/ui/meter";
import { Segmented } from "@/components/ui/segmented";
import { SparDots } from "@/components/common/SparDots";
import { relativeTime, shortTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Meter, Panel } from "../common/Page";
import { ProviderGlyph } from "../common/ProviderGlyph";
import { SettingsSection } from "./layout";

type Provider = ProviderInventory["providers"][number];
type Range = "7" | "30" | "all";

const RANGES: Array<{ value: Range; label: string }> = [
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "all", label: "All" },
];

const RANGE_LABEL: Record<Range, string> = { "7": "Last 7 days", "30": "Last 30 days", all: "Since the first run" };

/* Providers billed by plan rather than by token. Their dollar figure is what the
   same tokens would have cost on the API, and the page says so. */
const SUBSCRIPTIONS = new Set(["openai-codex", "claude-code", "github-copilot"]);

const SESSIONS_SHOWN = 8;

/**
 * Where the agent's tokens went: a summary panel with a curve you can read a
 * shape off, then what each plan has left, then the same spend split by model
 * and by session.
 *
 * Everything comes from this device's own record of finished runs, so it reads
 * offline and needs no account. Monochrome throughout: the only colour is a
 * quota running low, which is the one reading here that asks for action.
 */
export function UsageSettings({ api, providers }: { api: SparApi | undefined; providers: Provider[] }) {
  const [range, setRange] = useState<Range>("30");
  const [report, setReport] = useState<UsageReport | null>(null);
  const [allSessions, setAllSessions] = useState(false);

  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.usageReport(range === "all" ? null : Number(range)).then((value) => { if (live) setReport(value); }).catch(() => undefined);
    return () => { live = false; };
  }, [api, range]);

  const subscriptions = providers.filter((provider) => provider.kind === "subscription" && provider.state !== "disconnected");
  const sessions = report ? (allSessions ? report.sessions : report.sessions.slice(0, SESSIONS_SHOWN)) : [];
  const priciestSession = Math.max(0, ...(report?.sessions.map((session) => session.costUsd) ?? []));

  return (
    <>
      <SettingsSection title="Overview">
        {report ? (
          <Masthead onRange={setRange} range={range} report={report} />
        ) : (
          <Panel className="-mx-3.5 flex items-center gap-2.5 px-3.5 py-6">
            <SparDots className="text-muted-foreground" pattern="pulse" size={16} />
            <span className="text-ui text-muted-foreground">{api ? "Adding up runs…" : "Usage is recorded in the desktop app."}</span>
          </Panel>
        )}
      </SettingsSection>

      {subscriptions.length > 0 && (
        <SettingsSection title="Plan limits">
          <Panel className="-mx-3.5 divide-y-[length:var(--hairline)] divide-[var(--border-surface-strong)]">
            {subscriptions.map((provider) => <LimitRow api={api} key={provider.id} provider={provider} />)}
          </Panel>
        </SettingsSection>
      )}

      {report && report.models.length > 0 && (
        <SettingsSection title="Models">
          <ul className="-mx-2">
            {report.models.map((model) => (
              <li className="flex items-center gap-3 rounded-[var(--radius-lg)] px-2 py-2" key={`${model.provider}:${model.model}`}>
                <ProviderGlyph className="size-4 shrink-0 opacity-80" provider={model.provider as ProviderId} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-content font-medium leading-5 tracking-[-0.01em]">{model.model}</span>
                  <span className="mt-0.5 block truncate text-ui leading-[1.35] text-muted-foreground tabular-nums">
                    {plural(model.runs, "turn")} · {tokens(sumTokens(model))} tokens · {cacheRate(model)}% from cache
                  </span>
                </span>
                <span className="hidden w-20 shrink-0 @md:block">
                  <Meter title={`${share(model.costUsd, report.totals.costUsd)}% of spend`} value={report.totals.costUsd > 0 ? model.costUsd / report.totals.costUsd : 0} />
                </span>
                <span className="w-14 shrink-0 text-right text-ui font-medium tabular-nums">{money(model.costUsd)}</span>
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}

      {report && report.sessions.length > 0 && (
        <SettingsSection title="Sessions">
          <ul className="-mx-2">
            {sessions.map((session) => (
              <li
                className="flex items-center gap-3 rounded-[var(--radius-lg)] px-2 py-2"
                key={session.sessionId}
                title={session.models.length ? `Ran on ${session.models.join(", ")}` : undefined}
              >
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-content font-medium leading-5 tracking-[-0.01em]", !session.title && "text-muted-foreground")}>
                    {session.title ?? "Deleted session"}
                  </span>
                  <span className="mt-0.5 block truncate text-ui leading-[1.35] text-muted-foreground tabular-nums">
                    {plural(session.runs, "turn")} · {tokens(inputOf(session))} in · {tokens(session.outputTokens)} out
                  </span>
                </span>
                {/* The session's slice of the range, on the same hairline the
                    models use, so the two lists can be read against each other. */}
                <span className="hidden w-20 shrink-0 @md:block">
                  <Meter value={priciestSession > 0 ? session.costUsd / priciestSession : 0} />
                </span>
                <span className="w-14 shrink-0 text-right text-ui font-medium tabular-nums">{money(session.costUsd)}</span>
                <span className="w-10 shrink-0 text-right text-ui tabular-nums text-muted-foreground/70" title={relativeTime(session.lastRunAt)}>
                  {shortTime(session.lastRunAt)}
                </span>
              </li>
            ))}
          </ul>
          {report.sessions.length > SESSIONS_SHOWN && (
            <button
              className="mt-1 inline-flex items-center gap-1 rounded-[var(--radius-md)] px-1.5 py-0.5 text-ui-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setAllSessions((value) => !value)}
              type="button"
            >
              {allSessions ? "Show fewer" : `Show all ${report.sessions.length}`}
            </button>
          )}
        </SettingsSection>
      )}
    </>
  );
}

/**
 * The range at a glance: a handful of figures, the curve of how the spend
 * built up, and what the tokens were made of. Cumulative rather than daily bars, because the
 * question is "how much so far", and a rising line answers it at a glance where
 * thirty bars have to be added up.
 */
function Masthead({ onRange, range, report }: { onRange(range: Range): void; range: Range; report: UsageReport }) {
  const { totals } = report;
  const series = useMemo(() => fillDays(report.daily, range), [report.daily, range]);
  const subscriptionOnly = report.models.length > 0 && report.models.every((model) => SUBSCRIPTIONS.has(model.provider));
  const busiest = series.reduce<(typeof series)[number] | null>((top, day) => (day.costUsd > (top?.costUsd ?? 0) ? day : top), null);
  const bands: MeterBand[] = [
    /* Darkest where the money is: output and fresh input are what a turn pays
       full price for, and the cache is the part that came cheap. */
    { key: "output", value: totals.outputTokens, className: "bg-foreground/75", label: "output" },
    { key: "fresh", value: totals.inputTokens, className: "bg-foreground/50", label: "fresh input" },
    { key: "written", value: totals.cacheWriteTokens, className: "bg-foreground/35", label: "cache writes" },
    { key: "cached", value: totals.cachedInputTokens, className: "bg-foreground/22", label: "from cache" },
  ];

  return (
    <Panel className="-mx-3.5 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3.5 pt-3">
        <p className="min-w-0 truncate text-ui text-muted-foreground">
          {RANGE_LABEL[range]}
          {subscriptionOnly && (
            <span className="text-muted-foreground/70" title="What these tokens would have cost on the API at list price. Your plan is not billed per token."> · API-equivalent cost</span>
          )}
        </p>
        <Segmented<Range> ariaLabel="Usage range" className="-mr-2" onChange={onRange} options={RANGES} value={range} />
      </div>

      {/* Four figures at reading size, not one at display size: spend is one fact
          about a range of work among several, not the thing this page is for. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-3.5 pt-2.5 pb-3 @md:grid-cols-4">
        <Stat label="Spend" value={money(totals.costUsd)} />
        <Stat label="Tokens" value={tokens(sumTokens(totals))} />
        <Stat label="From cache" value={`${cacheRate(totals)}%`} />
        <Stat label="Turns" value={totals.runs.toLocaleString()} />
      </dl>

      <div className="px-3.5 pb-3.5">
        <SpendCurve className="h-12" series={series} />
        <span className="mt-1 flex items-baseline justify-between gap-3 text-ui-sm text-muted-foreground">
          <span className="truncate">{busiest ? `Most on ${dayLabel(busiest.day)} · ${money(busiest.costUsd)}` : "Nothing spent yet"}</span>
          <span className="shrink-0">{series.length > 1 ? `${dayLabel(series[0]!.day)} – today` : "today"}</span>
        </span>
      </div>

      {/* What the tokens were, as one measured bar: the share the cache saved is
          the part of this worth seeing, and it is only visible against the rest. */}
      <div className="border-t-[length:var(--hairline)] border-[var(--border-surface-strong)] px-3.5 pt-3 pb-3.5">
        <Bands bands={bands} height="0.375rem" />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {bands.filter((band) => band.value > 0).map((band) => (
            <span className="inline-flex items-center gap-1.5 text-ui text-muted-foreground" key={band.key}>
              <span className={cn("size-1.5 shrink-0 rounded-full", band.className)} />
              <span className="text-foreground/80 tabular-nums">{tokens(band.value)}</span>
              {band.label}
            </span>
          ))}
          {!totals.runs && <span className="text-ui text-muted-foreground">No agent runs in this range yet.</span>}
        </div>
      </div>

    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ui-sm text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-content font-medium tracking-[-0.01em] tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Running spend over the range, in the rating curve's hand: a line with a fading
 * area under it, swept in left to right, and the last point marked because
 * "where am I now" is the reading. A range with no spend still draws its
 * baseline rather than an empty box.
 */
function SpendCurve({ className, series }: { className?: string; series: UsageReport["daily"] }) {
  const id = useId();
  const shape = useMemo(() => {
    let running = 0;
    const cumulative = series.map((day) => (running += day.costUsd));
    const values = cumulative.length > 1 ? cumulative : [cumulative[0] ?? 0, cumulative[0] ?? 0];
    const max = Math.max(values.at(-1) ?? 0, Number.EPSILON);
    const points = values.map((value, index) => ({ x: (index / (values.length - 1)) * 100, y: 38 - (value / max) * 34 }));
    return {
      line: points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" "),
      area: `M0 40 ${points.map((point) => `L${point.x} ${point.y}`).join(" ")} L100 40 Z`,
      last: points.at(-1)!,
    };
  }, [series]);

  return (
    <div className={cn("relative", className)} style={{ ["--rating-draw" as string]: "820ms" }}>
      <svg aria-label="Spend over time" className="size-full overflow-visible" preserveAspectRatio="none" role="img" viewBox="0 0 100 40">
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`${id}-sweep`}>
            <rect className="rating-curve-sweep" height="60" width="100" x="0" y="-10" />
          </clipPath>
        </defs>
        <path className="text-border" d="M0 39.5H100" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <g clipPath={`url(#${id}-sweep)`}>
          <path d={shape.area} fill={`url(#${id}-fill)`} />
          <path d={shape.line} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      {/* HTML over the stretched SVG, so the dot stays round at any width. */}
      <span
        className="rating-mark absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${shape.last.x}%`, top: `${(shape.last.y / 40) * 100}%`, ["--mark-delay" as string]: "910ms" }}
      >
        <span aria-hidden className="block size-[6px] rounded-full bg-foreground shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-foreground)_20%,transparent)]" />
      </span>
    </div>
  );
}

/** One plan's two quota windows as hairlines, read fresh on mount. ChatGPT only
 *  reports its quota on a turn's response, so it can be empty until then. */
function LimitRow({ api, provider }: { api: SparApi | undefined; provider: Provider }) {
  const [usage, setUsage] = useState<SubscriptionUsage | null | undefined>(undefined);
  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.providerUsage(provider.id).then((value) => { if (live) setUsage(value); }).catch(() => { if (live) setUsage(null); });
    return () => { live = false; };
  }, [api, provider.id]);

  const fiveHour = usage?.windows.find((entry) => entry.kind === "five-hour") ?? null;
  const weekly = usage?.windows.find((entry) => entry.kind === "weekly") ?? null;
  return (
    <div className="flex items-center gap-4 px-3.5 py-3">
      <span className="flex w-32 shrink-0 items-center gap-2">
        <ProviderGlyph className="size-4 shrink-0" provider={provider.id} />
        <span className="truncate text-content font-medium tracking-[-0.01em]">{provider.name}</span>
      </span>
      {usage === undefined ? (
        <SparDots className="text-muted-foreground" pattern="pulse" size={14} />
      ) : !fiveHour && !weekly ? (
        <p className="flex-1 text-ui text-muted-foreground">Reported after your next turn.</p>
      ) : (
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-6">
          <Window entry={fiveHour} label="5 hours" />
          <Window entry={weekly} label="Weekly" />
        </div>
      )}
    </div>
  );
}

/* What is left, not what is used: the question a quota is read to answer is
   "can I keep going". Tinted only once it is nearly gone. */
function Window({ entry, label }: { entry: UsageWindow | null; label: string }) {
  const left = entry ? Math.min(100, Math.max(0, Math.round(100 - entry.usedPercent))) : 0;
  const tone = entry && left <= 10 ? "var(--destructive)" : entry && left <= 25 ? "var(--warning)" : undefined;
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-ui-sm tabular-nums text-muted-foreground">
        <span>{label}</span>
        <span className={cn(entry && "font-medium text-foreground")} style={tone ? { color: tone } : undefined}>{entry ? `${left}% left` : "—"}</span>
      </div>
      <Meter tone={tone} value={left / 100} />
      <p className="mt-1.5 truncate text-ui-sm text-muted-foreground/70">{entry?.resetsAt ? `Resets ${resetLabel(entry.resetsAt)}` : " "}</p>
    </div>
  );
}

function fillDays(days: UsageReport["daily"], range: Range) {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const today = new Date();
  const first = range === "all" ? (days[0] ? parseDay(days[0].day) : today) : new Date(today.getFullYear(), today.getMonth(), today.getDate() - Number(range) + 1);
  const out: UsageReport["daily"] = [];
  for (const cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate()); cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
    const key = localDay(cursor);
    out.push(byDay.get(key) ?? { day: key, runs: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, costUsd: 0 });
  }
  return out;
}

const localDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parseDay = (day: string) => { const [year, month, date] = day.split("-").map(Number); return new Date(year!, month! - 1, date!); };
const dayLabel = (day: string) => parseDay(day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const inputOf = (value: UsageTotals) => value.inputTokens + value.cachedInputTokens + value.cacheWriteTokens;
const sumTokens = (value: UsageTotals) => inputOf(value) + value.outputTokens;
const cacheRate = (value: UsageTotals) => (inputOf(value) > 0 ? Math.round((value.cachedInputTokens / inputOf(value)) * 100) : 0);
const share = (value: number, total: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
const plural = (count: number, noun: string) => `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

function tokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return value.toLocaleString();
}

function money(value: number) {
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", maximumFractionDigits: value < 100 ? 2 : 0 });
}

function resetLabel(epochSeconds: number) {
  const date = new Date(epochSeconds * 1_000);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}
