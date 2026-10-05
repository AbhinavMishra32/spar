import { useEffect, useMemo, useState } from "react";
import { IconArrowsRepeat, IconCheckmark1, IconChevronRight, IconCircleDashed, IconCircleX, IconExclamationTriangle, IconEyeOpen, IconFileBend, IconLightBulb, IconLoader, IconPencilWave, IconSparklesTwo, IconTarget1 } from "central-icons";
import type { ReviewCardDetail, ReviewLog } from "@spar/domain";
import type { SparApi, ReviewSessionCard, ReviewSessionState } from "../../../shared/api";
import type { SubmissionRecord, SubmissionRow } from "../../../shared/submissions";
import { cn } from "@/lib/utils";
import { languageFor, relativeTime } from "@/lib/format";
import { FileCodeBlock } from "../agent/Markdown";
import { InsightCardBody } from "./InsightCard";
import { dueLabel, dueTone, percent, shortDate, TONE_CLASS } from "./schedule";

/*
 * Everything Spar knows about one review card, laid out for the person about
 * to be reviewed on it.
 *
 * The order is the order a learner needs it in: what this review is watching
 * for, where they slipped before, what already holds, the code they actually
 * wrote, and every review so far. The idea itself is last and folded, because
 * reading the answer before a review turns it into a reading test.
 */

export const RATING_WORD: Record<1 | 2 | 3 | 4, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
export const RATING_VAR: Record<1 | 2 | 3 | 4, string> = { 1: "var(--rate-again)", 2: "var(--rate-hard)", 3: "var(--rate-good)", 4: "var(--rate-easy)" };

const SOURCE_WORD: Record<ReviewLog["source"], string> = {
  solve: "First solve",
  recall: "Recall card",
  resolve: "Solved again",
  implicit: "Shared credit",
  coach: "Coach review",
};

export function Rating({ rating, className }: { rating: number; className?: string }) {
  const value = Math.min(4, Math.max(1, rating)) as 1 | 2 | 3 | 4;
  return (
    <span
      className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-ui-sm font-medium", className)}
      style={{ color: RATING_VAR[value], background: `color-mix(in oklch, ${RATING_VAR[value]} 14%, transparent)` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: RATING_VAR[value] }} />
      {RATING_WORD[value]}
    </span>
  );
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--recall)]", className)}>{children}</p>;
}

function SectionTitle({ icon: Icon, children, count }: { icon: typeof IconCheckmark1; children: React.ReactNode; count?: number }) {
  return (
    <h3 className="mb-2 flex items-center gap-1.5 text-ui-sm font-medium tracking-[0.02em] text-muted-foreground">
      <Icon className="size-3.5 text-muted-foreground/70" />
      {children}
      {count !== undefined && <span className="tabular-nums text-muted-foreground/50">{count}</span>}
    </h3>
  );
}

/** What held and what slipped, across the solve and every review, newest first,
 *  each said once. The same mistake found twice is the most important line here. */
function ledger(detail: ReviewCardDetail) {
  const missed = new Map<string, { text: string; at: string; source: ReviewLog["source"]; times: number; fix?: string }>();
  const held = new Map<string, { text: string; at: string }>();
  const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const pitfall of detail.card.pitfalls) missed.set(key(pitfall.mistake), { text: pitfall.mistake, fix: pitfall.fix, at: detail.card.createdAt, source: "solve", times: 1 });
  for (const log of detail.logs) {
    if (log.source === "implicit") continue;
    for (const text of log.missed ?? []) {
      const found = missed.get(key(text));
      if (found) { found.times += log.source === "solve" ? 0 : 1; found.at = log.reviewedAt; found.source = log.source; }
      else missed.set(key(text), { text, at: log.reviewedAt, source: log.source, times: 1 });
    }
    for (const text of log.held ?? []) held.set(key(text), { text, at: log.reviewedAt });
  }
  const byNewest = <T extends { at: string }>(items: T[]) => items.sort((left, right) => right.at.localeCompare(left.at));
  return { missed: byNewest([...missed.values()]), held: byNewest([...held.values()]) };
}

export function MemoryStats({ detail }: { detail: ReviewCardDetail }) {
  const { card } = detail;
  const tone = card.suspended ? "later" : dueTone(card.dueAt);
  const reviews = detail.logs.filter((log) => log.source !== "implicit" && log.source !== "solve").length;
  const stats = [
    { label: "Recall now", value: card.lastReviewAt ? percent(card.retrievability) : "—" },
    { label: "Holds for", value: `~${card.stability < 1 ? "<1" : Math.round(card.stability)}d` },
    { label: "Reviews", value: String(reviews) },
    { label: "Forgotten", value: String(card.lapses) },
  ];
  return (
    <div className="flex flex-wrap items-stretch gap-1.5">
      <span className={cn("inline-flex items-center rounded-lg px-2 text-ui-sm font-medium", TONE_CLASS[tone])}>{card.suspended ? "Paused" : dueLabel(card.dueAt)}</span>
      {stats.map((stat) => (
        <span key={stat.label} className="inline-flex items-baseline gap-1.5 rounded-lg bg-[var(--color-background-elevated-secondary)] px-2 py-1 text-ui-sm">
          <span className="text-muted-foreground">{stat.label}</span>
          <span className="font-medium tabular-nums text-foreground">{stat.value}</span>
        </span>
      ))}
    </div>
  );
}

/** One submission, folded to its verdict until opened, then its code. */
function SubmissionRowView({ api, row, label }: { api: SparApi | undefined; row: SubmissionRow; label?: string }) {
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<SubmissionRecord | null | undefined>(undefined);
  useEffect(() => {
    if (!open || record !== undefined || !api) return;
    void api.readSubmission(row.id).then(setRecord).catch(() => setRecord(null));
  }, [api, open, record, row.id]);
  const passed = row.outcome === "passed";
  return (
    <li className="rounded-lg border border-border/70 bg-card/60">
      <button className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-ui" onClick={() => setOpen((value) => !value)} type="button">
        <IconChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        {passed ? <IconCheckmark1 className="size-3.5 shrink-0 text-[var(--success)]" /> : <IconCircleX className="size-3.5 shrink-0 text-destructive" />}
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{label ?? row.challengeTitle}</span>
          <span className="text-muted-foreground"> · submission {row.ordinal}</span>
        </span>
        <span className="shrink-0 tabular-nums text-ui-sm text-muted-foreground">{row.totalCases ? `${row.passedCases}/${row.totalCases}` : row.status}</span>
        <span className="shrink-0 text-ui-sm text-muted-foreground/60">{relativeTime(row.submittedAt)}</span>
      </button>
      {open && (
        <div className="border-t border-border/60 px-2.5 pb-2.5 pt-2">
          {record === undefined ? (
            <p className="flex items-center gap-1.5 text-ui-sm text-muted-foreground"><IconLoader className="size-3 animate-spin" /> Reading the code…</p>
          ) : record?.code ? (
            <>
              <FileCodeBlock body={record.code.text} className="max-h-72 overflow-auto" language={languageFor(record.code.path)} path={record.code.path} />
              {record.cases.filter((entry) => entry.status === "failed").slice(0, 3).map((entry, index) => (
                <p key={index} className="mt-1.5 truncate font-mono text-[11px] text-destructive/90" title={entry.name}>✕ {entry.name}</p>
              ))}
            </>
          ) : (
            <p className="text-ui-sm text-muted-foreground">No snapshot of the code was kept for this one.</p>
          )}
        </div>
      )}
    </li>
  );
}

/** The learner's own code at this card's challenges: the solve, and every
 *  challenge set to review it. The work is the evidence the reviews were judged on. */
function PastWork({ api, detail }: { api: SparApi | undefined; detail: ReviewCardDetail }) {
  const [rows, setRows] = useState<Array<{ row: SubmissionRow; label: string }> | null>(null);
  const challengeIds = useMemo(() => [
    { id: detail.card.questionId, label: detail.card.questionTitle },
    ...(detail.challenges ?? []).map((link) => ({ id: link.challengeId, label: link.challengeTitle })),
  ], [detail]);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void Promise.all(challengeIds.map((entry) => api.listChallengeSubmissions(entry.id).then((list) => list.map((row) => ({ row, label: entry.label }))).catch(() => [])))
      .then((lists) => { if (!cancelled) setRows(lists.flat().sort((left, right) => right.row.submittedAt.localeCompare(left.row.submittedAt))); });
    return () => { cancelled = true; };
  }, [api, challengeIds]);
  if (rows === null) return <p className="flex items-center gap-1.5 text-ui-sm text-muted-foreground"><IconLoader className="size-3 animate-spin" /> Gathering your submissions…</p>;
  if (!rows.length) return <p className="text-ui-sm text-muted-foreground">No submissions recorded for this card's challenges.</p>;
  /* The ones reviews were judged on come first — that is the code the coach read. */
  const judged = new Set(detail.logs.map((log) => log.submissionId).filter(Boolean));
  const ordered = [...rows.filter((entry) => judged.has(entry.row.id)), ...rows.filter((entry) => !judged.has(entry.row.id))].slice(0, 12);
  return (
    <ul className="flex flex-col gap-1.5">
      {ordered.map((entry) => <SubmissionRowView api={api} key={entry.row.id} label={entry.label} row={entry.row} />)}
    </ul>
  );
}

function Timeline({ logs }: { logs: ReviewLog[] }) {
  const shown = [...logs].filter((log) => log.source !== "implicit").reverse();
  if (!shown.length) return null;
  return (
    <ol className="relative ml-1.5 flex flex-col gap-3 border-l border-border/80 pl-4">
      {shown.map((log) => (
        <li key={log.id} className="relative">
          <span className="absolute -left-[21px] top-1 size-2.5 rounded-full ring-4 ring-[var(--color-background-surface)]" style={{ background: RATING_VAR[Math.min(4, Math.max(1, log.rating)) as 1 | 2 | 3 | 4] }} />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm">
            <span className="inline-flex items-center gap-1 font-medium text-foreground/85">
              {log.source === "coach" ? <IconSparklesTwo className="size-3 text-[var(--recall)]" /> : log.source === "resolve" ? <IconArrowsRepeat className="size-3" /> : log.source === "recall" ? <IconLightBulb className="size-3" /> : <IconCircleDashed className="size-3" />}
              {SOURCE_WORD[log.source]}
            </span>
            <Rating rating={log.rating} />
            <span className="text-muted-foreground/70" title={new Date(log.reviewedAt).toLocaleString()}>{shortDate(log.reviewedAt)} · {relativeTime(log.reviewedAt)}</span>
          </div>
          {log.prompt && log.source !== "solve" && <p className="mt-1 line-clamp-2 text-ui-sm text-muted-foreground">{log.prompt.replace(/[#*`>]/g, "").trim()}</p>}
          {log.feedback && <p className="mt-1 text-ui leading-[1.55] text-foreground/85">{log.feedback}</p>}
          {log.answer && <p className="mt-1 rounded-md bg-[var(--color-background-elevated-secondary)] px-2 py-1 text-ui-sm italic text-muted-foreground">“{log.answer.slice(0, 280)}”</p>}
          {(log.held?.length || log.missed?.length) ? (
            <ul className="mt-1.5 flex flex-col gap-0.5 text-ui-sm">
              {log.held?.map((text, index) => <li key={`h${index}`} className="flex gap-1.5 text-foreground/80"><IconCheckmark1 className="mt-[3px] size-3 shrink-0 text-[var(--success)]" />{text}</li>)}
              {log.missed?.map((text, index) => <li key={`m${index}`} className="flex gap-1.5 text-foreground/80"><IconExclamationTriangle className="mt-[3px] size-3 shrink-0 text-[var(--warning)]" />{text}</li>)}
            </ul>
          ) : null}
          {log.misconception && <p className="mt-1 text-ui-sm text-destructive/90">Believed: {log.misconception}</p>}
        </li>
      ))}
    </ol>
  );
}

/**
 * The dossier. `focus` is what the open review challenge was set to watch, when
 * there is one; `spoilerGuard` folds the idea away while a review is running.
 */
export function ReviewDossier({ api, detail, focus = null, deeper = false, spoilerGuard = false }: { api: SparApi | undefined; detail: ReviewCardDetail; focus?: string | null; deeper?: boolean; spoilerGuard?: boolean }) {
  const { card } = detail;
  const { missed, held } = useMemo(() => ledger(detail), [detail]);
  const [ideaOpen, setIdeaOpen] = useState(!spoilerGuard);
  useEffect(() => setIdeaOpen(!spoilerGuard), [card.id, spoilerGuard]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <div>
          <h2 className="text-[1.05rem] font-semibold leading-snug tracking-[-0.015em]">{card.title}</h2>
          <p className="mt-0.5 text-ui text-muted-foreground">
            From <span className="text-foreground/85">{card.questionTitle}</span>
            {card.concepts.length > 0 && <> · {card.concepts.map((tag) => tag.title).join(", ")}</>}
            {card.independence !== "unknown" && <> · first solved {card.independence === "assisted" ? "with help" : "on your own"}</>}
          </p>
        </div>
        <MemoryStats detail={detail} />
      </div>

      {(focus || card.coachNote || card.remember) && (
        <div className="relative overflow-hidden rounded-xl border border-[var(--recall)]/25 bg-[var(--recall)]/[0.06] p-3.5">
          <div className="pointer-events-none absolute -right-8 -top-10 size-28 rounded-full bg-[var(--recall)]/10 blur-2xl" />
          {focus && (
            <div className="relative">
              <p className="flex items-center gap-1.5 text-ui-sm font-medium text-[var(--recall)]"><IconTarget1 className="size-3.5" /> {deeper ? "Going deeper on" : "This review is watching for"}</p>
              <p className="mt-1 text-content leading-[1.55] text-foreground">{focus}</p>
            </div>
          )}
          {card.coachNote && (
            <div className={cn("relative", focus && "mt-3 border-t border-[var(--recall)]/15 pt-3")}>
              <p className="flex items-center gap-1.5 text-ui-sm font-medium text-[var(--recall)]"><IconPencilWave className="size-3.5" /> Coach's note</p>
              <p className="mt-1 text-ui leading-[1.6] text-foreground/90">{card.coachNote}</p>
            </div>
          )}
          {card.remember && (
            <div className={cn("relative", (focus || card.coachNote) && "mt-3 border-t border-[var(--recall)]/15 pt-3")}>
              <p className="text-ui-sm font-medium text-[var(--recall)]">You wanted to remember</p>
              <p className="mt-1 text-ui italic leading-[1.6] text-foreground/85">“{card.remember}”</p>
            </div>
          )}
        </div>
      )}

      {missed.length > 0 && (
        <section>
          <SectionTitle count={missed.length} icon={IconExclamationTriangle}>Where you slipped</SectionTitle>
          <ul className="flex flex-col gap-1.5">
            {missed.map((item) => (
              <li key={item.text} className="flex items-start gap-2.5 rounded-lg bg-[var(--warning)]/[0.07] px-2.5 py-2 text-ui leading-[1.5]">
                <IconExclamationTriangle className="mt-[3px] size-3.5 shrink-0 text-[var(--warning)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground/90">{item.text}</p>
                  {item.fix && <p className="mt-0.5 text-ui-sm text-muted-foreground">Fix: {item.fix}</p>}
                  <p className="mt-0.5 text-ui-sm text-muted-foreground/70">
                    {SOURCE_WORD[item.source]} · {relativeTime(item.at)}
                    {item.times > 1 && <span className="ml-1.5 rounded bg-[var(--warning)]/15 px-1 font-medium text-[var(--warning)]">came back ×{item.times}</span>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {held.length > 0 && (
        <section>
          <SectionTitle count={held.length} icon={IconCheckmark1}>What now holds</SectionTitle>
          <ul className="flex flex-col gap-1">
            {held.map((item) => (
              <li key={item.text} className="flex items-start gap-2 text-ui leading-[1.5] text-foreground/85">
                <IconCheckmark1 className="mt-[3px] size-3.5 shrink-0 text-[var(--success)]" />
                {item.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionTitle icon={IconFileBend}>Your code</SectionTitle>
        <PastWork api={api} detail={detail} />
      </section>

      <section>
        <SectionTitle count={detail.logs.filter((log) => log.source !== "implicit").length} icon={IconArrowsRepeat}>Review history</SectionTitle>
        <Timeline logs={detail.logs} />
      </section>

      <section>
        <button
          className="flex w-full items-center gap-1.5 text-left text-ui-sm font-medium tracking-[0.02em] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setIdeaOpen((value) => !value)}
          type="button"
        >
          <IconChevronRight className={cn("size-3.5 transition-transform", ideaOpen && "rotate-90")} />
          <IconEyeOpen className="size-3.5" />
          The idea itself
          {spoilerGuard && !ideaOpen && <span className="ml-1 font-normal text-muted-foreground/70">— try the review first; reading it now turns it into a reading test</span>}
        </button>
        {ideaOpen && (
          <div className="mt-3 rounded-xl border border-border bg-card p-3.5">
            <InsightCardBody card={card} />
          </div>
        )}
      </section>
    </div>
  );
}

/* ---- The review session's own panel ------------------------------------- */

export function useReviewSession(api: SparApi | undefined, sessionId: string, refreshKey: unknown): ReviewSessionState | null {
  const [state, setState] = useState<ReviewSessionState | null>(null);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api.reviewSessionState(sessionId).then((value) => { if (!cancelled) setState(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [api, sessionId, refreshKey]);
  return state;
}

/** Where the session is: one stop per card, reviewed ones in their grade's colour. */
export function ReviewQueue({ state, selected, onSelect }: { state: ReviewSessionState; selected: string | null; onSelect(cardId: string): void }) {
  const done = state.queue.filter((entry) => entry.status === "reviewed").length;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <Eyebrow>Review session</Eyebrow>
        <span className="text-ui-sm tabular-nums text-muted-foreground">{done} of {state.queue.length} reviewed</span>
      </div>
      <div className="mb-2.5 flex h-1 gap-0.5 overflow-hidden rounded-full">
        {state.queue.map((entry) => (
          <span
            key={entry.detail.card.id}
            className={cn("flex-1", entry.status === "current" && "animate-pulse")}
            style={{ background: entry.reviewedHere ? RATING_VAR[Math.min(4, Math.max(1, entry.reviewedHere.rating)) as 1 | 2 | 3 | 4] : entry.status === "current" ? "var(--recall)" : "color-mix(in oklch, var(--foreground) 12%, transparent)" }}
          />
        ))}
      </div>
      <ul className="flex flex-col gap-0.5">
        {state.queue.map((entry, index) => (
          <QueueItem deeper={state.current?.purpose === "deeper"} entry={entry} index={index} key={entry.detail.card.id} onSelect={onSelect} selected={selected === entry.detail.card.id} />
        ))}
      </ul>
    </div>
  );
}

function QueueItem({ entry, index, selected, deeper, onSelect }: { entry: ReviewSessionCard; deeper: boolean; index: number; selected: boolean; onSelect(cardId: string): void }) {
  const { card } = entry.detail;
  return (
    <li>
      <button
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui transition-colors",
          selected ? "bg-[var(--recall)]/10 text-foreground" : "text-foreground/80 hover:bg-accent",
        )}
        onClick={() => onSelect(card.id)}
        type="button"
      >
        <span
          className={cn("grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold tabular-nums", entry.status === "current" ? "bg-[var(--recall)] text-white" : "bg-[var(--color-background-elevated-secondary)] text-muted-foreground")}
        >
          {entry.reviewedHere ? <IconCheckmark1 className="size-3" style={{ color: RATING_VAR[Math.min(4, Math.max(1, entry.reviewedHere.rating)) as 1 | 2 | 3 | 4] }} /> : index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate">{card.title}</span>
        {entry.reviewedHere ? <Rating rating={entry.reviewedHere.rating} /> : entry.status === "current" ? <span className="text-ui-sm font-medium text-[var(--recall)]">{deeper ? "Deeper" : "Now"}</span> : null}
      </button>
    </li>
  );
}

/**
 * What sits above the problem in a review session: which card this is for and
 * the coach's word to the learner about it — what went wrong last time and what
 * to get right now. Everything else waits in the Review tab.
 */
export function ReviewBanner({ api, sessionId, refreshKey }: { api: SparApi | undefined; sessionId: string; refreshKey: unknown }) {
  const state = useReviewSession(api, sessionId, refreshKey);
  const current = state?.current;
  if (!current) return null;
  const card = state.queue.find((entry) => entry.detail.card.id === current.cardId)?.detail.card;
  if (!card) return null;
  const deeper = current.purpose === "deeper";
  return (
    <div className="mx-4 mt-3 rounded-xl border border-[var(--recall)]/25 bg-[var(--recall)]/[0.07] px-3.5 py-2.5">
      <p className="flex items-center gap-1.5 text-ui-sm font-medium text-[var(--recall)]">
        <IconArrowsRepeat className="size-3.5" />
        {deeper ? "Going deeper on" : "Review"} · <span className="truncate">{card.title}</span>
      </p>
      {current.learnerNote && <p className="mt-1 text-content leading-[1.5] text-foreground">{current.learnerNote}</p>}
    </div>
  );
}

/**
 * The review session's panel: where the session is, and for each card either
 * how its review went or — before it has been judged — nothing that would give
 * the answer away. The full dossier is one click further, for when they want it.
 */
export function ReviewBrief({ api, sessionId, refreshKey, className }: { api: SparApi | undefined; sessionId: string; refreshKey: unknown; className?: string }) {
  const state = useReviewSession(api, sessionId, refreshKey);
  const [picked, setPicked] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const current = state?.current?.cardId ?? null;
  useEffect(() => setPicked(null), [current]);
  if (!state) {
    return <div className={cn("grid h-full place-items-center text-ui text-muted-foreground", className)}><IconLoader className="size-4 animate-spin" /></div>;
  }
  const selectedId = picked ?? current ?? state.queue.find((entry) => entry.status === "queued")?.detail.card.id ?? state.queue[0]?.detail.card.id ?? null;
  const selected = state.queue.find((entry) => entry.detail.card.id === selectedId) ?? null;
  const underReview = selected?.status === "current";
  const open = selected ? revealed.has(selected.detail.card.id) : false;
  const reveal = (cardId: string) => setRevealed((prior) => new Set(prior).add(cardId));
  return (
    <div className={cn("app-scroll h-full overflow-y-auto", className)}>
      <div className="mx-auto flex w-full max-w-[40rem] flex-col gap-5 px-5 pb-10 pt-4">
        <ReviewQueue onSelect={setPicked} selected={selectedId} state={state} />
        {selected ? (
          <div className="border-t border-border/70 pt-4">
            <h3 className="text-content font-semibold text-foreground">{selected.detail.card.title}</h3>
            <p className="mt-0.5 text-ui-sm text-muted-foreground">From {selected.detail.card.questionTitle}</p>
            {selected.reviewedHere ? (
              <Verdict log={selected.reviewedHere} />
            ) : (
              <p className="mt-3 text-ui leading-[1.55] text-muted-foreground">
                {underReview
                  ? "Work the problem first. Your notes, old code and past reviews for this card open here once the coach has looked at your attempt — reading them now would give it away."
                  : "Coming up in this session."}
              </p>
            )}
            {open ? (
              <div className="mt-5">
                <ReviewDossier api={api} detail={selected.detail} spoilerGuard={!selected.reviewedHere} />
              </div>
            ) : (
              <button className="mt-3 inline-flex items-center gap-1 text-ui-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => reveal(selected.detail.card.id)} type="button">
                <IconChevronRight className="size-3.5" /> {selected.reviewedHere ? "Everything about this card" : "Show it anyway"}
              </button>
            )}
          </div>
        ) : (
          <p className="text-ui text-muted-foreground">No cards in this session yet — ask the coach what to review.</p>
        )}
      </div>
    </div>
  );
}

/** How a card's review in this session went, in the coach's words. */
function Verdict({ log }: { log: ReviewLog }) {
  return (
    <div className="mt-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-2"><Rating rating={log.rating} /><span className="text-ui-sm text-muted-foreground">{relativeTime(log.reviewedAt)}</span></div>
      {log.feedback && <p className="text-content leading-[1.55] text-foreground">{log.feedback}</p>}
      {!!log.held?.length && (
        <ul className="flex flex-col gap-1">{log.held.map((item) => <li className="flex gap-1.5 text-ui text-foreground/85" key={item}><IconCheckmark1 className="mt-0.5 size-3.5 shrink-0 text-[var(--rate-good)]" />{item}</li>)}</ul>
      )}
      {!!log.missed?.length && (
        <ul className="flex flex-col gap-1">{log.missed.map((item) => <li className="flex gap-1.5 text-ui text-foreground/85" key={item}><IconExclamationTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--rate-hard)]" />{item}</li>)}</ul>
      )}
    </div>
  );
}
