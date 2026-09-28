import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Flame, Layers, Loader2, Pause, Play, Repeat2, Sparkles, TriangleAlert, Zap } from "lucide-react";
import type { ReviewActivityEntry, ReviewCard, ReviewCardDetail, ReviewOverview } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { message, relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Eyebrow, Rating, RATING_VAR, ReviewDossier } from "./ReviewDossier";
import { dueLabel, dueTone, percent, TONE_CLASS } from "./schedule";

/*
 * Spaced review, as a place of its own.
 *
 * The calendar is the spine: behind today, every review filed, in the colour
 * of how it went; ahead, what comes due. The day picked on it opens underneath,
 * and every card opens its whole dossier. Reviewing itself happens in a review
 * session — a coach session made only of review challenges — or, short on time,
 * as quick recall cards.
 */

const DAY_MS = 86_400_000;

function dayKey(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function lastRating(card: ReviewCard, activity: ReviewActivityEntry[]): ReviewActivityEntry | undefined {
  return activity.find((entry) => entry.cardId === card.id && entry.source !== "solve");
}

export function ReviewHub({
  api,
  cards,
  due,
  overview,
  onStartSession,
  onQuickRecall,
  onChanged,
  onError,
}: {
  api: SparApi | undefined;
  cards: ReviewCard[];
  due: ReviewCard[];
  overview: ReviewOverview;
  /** Open a review session: these cards, or what is due. */
  onStartSession(cardIds?: string[]): Promise<void>;
  /** Flashcards instead of challenges: the named cards, or the due queue. */
  onQuickRecall(cardIds?: string[]): void;
  onChanged(): void;
  onError(value: string): void;
}) {
  const [activity, setActivity] = useState<ReviewActivityEntry[]>([]);
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const [day, setDay] = useState(() => dayKey(new Date()));
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api.reviewActivity(365).then((value) => { if (!cancelled) setActivity(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [api, overview.reviewedToday, overview.totalCards, overview.dueCount]);

  const start = async (cardIds?: string[]) => {
    setStarting(true);
    try {
      await onStartSession(cardIds);
    } catch (error) {
      onError(message(error));
    } finally {
      setStarting(false);
    }
  };

  const active = useMemo(() => cards.filter((card) => !card.suspended), [cards]);
  const today = dayKey(new Date());
  const dueByDay = useMemo(() => {
    const map = new Map<string, ReviewCard[]>();
    const now = Date.now();
    for (const card of active) {
      const key = Date.parse(card.dueAt) <= now ? today : dayKey(card.dueAt);
      map.set(key, [...(map.get(key) ?? []), card]);
    }
    return map;
  }, [active, today]);
  const doneByDay = useMemo(() => {
    const map = new Map<string, ReviewActivityEntry[]>();
    for (const entry of activity) {
      if (entry.source === "solve") continue;
      const key = dayKey(entry.reviewedAt);
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    return map;
  }, [activity]);
  const filedByDay = useMemo(() => {
    const map = new Map<string, ReviewActivityEntry[]>();
    for (const entry of activity) {
      if (entry.source !== "solve") continue;
      const key = dayKey(entry.reviewedAt);
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    return map;
  }, [activity]);

  const weekAhead = useMemo(() => {
    const end = startOfDay(new Date()).getTime() + 7 * DAY_MS;
    return active.filter((card) => Date.parse(card.dueAt) < end).length;
  }, [active]);
  const reviewed30 = useMemo(() => activity.filter((entry) => entry.source !== "solve" && Date.parse(entry.reviewedAt) > Date.now() - 30 * DAY_MS).length, [activity]);

  /* The cards the record says are slipping: forgotten before, or last graded
     Again or Hard. The line under each is the newest thing it missed. */
  const attention = useMemo(() => active
    .map((card) => ({ card, last: lastRating(card, activity) }))
    .filter(({ card, last }) => card.lapses > 0 || (last && last.rating <= 2) || (card.lastReviewAt && card.retrievability < 0.7))
    .sort((left, right) => (left.card.retrievability - right.card.retrievability) || (right.card.lapses - left.card.lapses))
    .slice(0, 6), [active, activity]);

  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const dueCount = due.length;

  return (
    <div className="flex flex-col gap-5">
      {/* The call to action and the numbers behind it. */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--recall)]/20 bg-card p-5 shadow-[var(--app-shadow-card)]">
        <div className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full bg-[var(--recall)]/12 blur-3xl" />
        <div className="pointer-events-none absolute -left-24 bottom-[-7rem] size-56 rounded-full bg-[var(--recall)]/6 blur-3xl" />
        <div className="relative flex items-start gap-5 max-md:flex-col">
          <div className="min-w-0 flex-1">
            <Eyebrow>Spaced review</Eyebrow>
            <p className="mt-1.5 text-[1.6rem] font-semibold leading-tight tracking-[-0.03em]">
              {dueCount ? <>{dueCount} {dueCount === 1 ? "card" : "cards"} to review</> : "All caught up"}
            </p>
            <p className="mt-1 max-w-[32rem] text-content leading-[1.55] text-muted-foreground">
              {dueCount
                ? "A review session hands each one back as a fresh problem, aimed at exactly where you slipped last time, and the coach judges how it held."
                : overview.nextDueAt ? `The next card comes back ${dueLabel(overview.nextDueAt).toLowerCase()}. Reviewing early is fine; the schedule credits it for how early it was.` : "Solve a challenge and what cracked it is filed here for review."}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                className="bg-[var(--recall)] text-white hover:bg-[color-mix(in_oklch,var(--recall)_88%,black)]"
                disabled={starting || !active.length}
                onClick={() => void start()}
              >
                {starting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
                {dueCount ? "Start review session" : "Review the weakest"}
                <ArrowRight className="size-3.5" />
              </Button>
              <Button disabled={!active.length} onClick={() => onQuickRecall()} title="One recall question per card, no code" variant="ghost">
                <Zap data-icon="inline-start" /> Quick recall
              </Button>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 max-md:w-full">
            <Stat icon={CalendarDays} label="Due this week" value={String(weekAhead)} />
            <Stat icon={Repeat2} label="Recall today" value={percent(overview.retention)} />
            <Stat icon={Flame} label="Day streak" value={String(overview.streakDays)} />
            <Stat icon={Layers} label="Reviews, 30 days" value={String(reviewed30)} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <MonthCalendar
          doneByDay={doneByDay}
          dueByDay={dueByDay}
          filedByDay={filedByDay}
          month={month}
          onDay={setDay}
          onMonth={setMonth}
          selected={day}
          today={today}
        />
        <DayAgenda
          day={day}
          done={doneByDay.get(day) ?? []}
          due={dueByDay.get(day) ?? []}
          filed={filedByDay.get(day) ?? []}
          onOpen={setOpenCard}
          onStart={(ids) => void start(ids)}
          starting={starting}
          today={today}
        />
      </div>

      {attention.length > 0 && (
        <section>
          <SectionHeading hint="Forgotten before, graded Again or Hard last time, or slipping below 70%">Needs attention</SectionHeading>
          <div className="grid gap-2 md:grid-cols-2">
            {attention.map(({ card, last }) => (
              <button
                className="group flex flex-col gap-1.5 rounded-xl border border-border bg-card p-3 text-left shadow-[var(--app-shadow-card)] transition-[border-color,transform] hover:-translate-y-px hover:border-[var(--recall)]/35"
                key={card.id}
                onClick={() => setOpenCard(card.id)}
                type="button"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-content font-medium">{card.title}</span>
                  {last && <Rating rating={last.rating} />}
                </div>
                <p className="truncate text-ui-sm text-muted-foreground">{card.questionTitle} · recall {percent(card.retrievability)}{card.lapses ? ` · forgotten ${card.lapses}×` : ""}</p>
                {(last?.missed?.[0] ?? card.pitfalls[0]?.mistake) && (
                  <p className="flex items-start gap-1.5 text-ui leading-[1.45] text-foreground/80">
                    <TriangleAlert className="mt-[3px] size-3 shrink-0 text-[var(--warning)]" />
                    <span className="line-clamp-2">{last?.missed?.[0] ?? card.pitfalls[0]?.mistake}</span>
                  </p>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHeading hint="Pick any to review them together">All cards</SectionHeading>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--app-shadow-card)]">
          {cards.length ? cards.map((card) => (
            <CardRow
              card={card}
              checked={selected.has(card.id)}
              key={card.id}
              last={lastRating(card, activity)}
              onOpen={() => setOpenCard(card.id)}
              onToggle={() => toggle(card.id)}
            />
          )) : <p className="px-4 py-6 text-center text-ui text-muted-foreground">No cards yet. Each solve files what cracked it here.</p>}
        </div>
      </section>

      {selected.size > 0 && (
        <div className="sticky bottom-4 z-20 mx-auto flex items-center gap-2 rounded-xl border border-[var(--recall)]/30 bg-popover/95 px-3 py-2 shadow-[var(--app-shadow-overlay)] backdrop-blur-xl">
          <span className="text-ui tabular-nums">{selected.size} selected</span>
          <Button onClick={() => setSelected(new Set())} variant="ghost">Clear</Button>
          <Button onClick={() => onQuickRecall([...selected])} variant="outline"><Zap data-icon="inline-start" /> Quick recall</Button>
          <Button className="bg-[var(--recall)] text-white hover:bg-[color-mix(in_oklch,var(--recall)_88%,black)]" disabled={starting} onClick={() => void start([...selected]).then(() => setSelected(new Set()))}>
            {starting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />} Review session
          </Button>
        </div>
      )}

      <CardSheet
        api={api}
        cardId={openCard}
        onChanged={onChanged}
        onClose={() => setOpenCard(null)}
        onError={onError}
        onQuickRecall={(id) => { setOpenCard(null); onQuickRecall([id]); }}
        onStart={(id) => { setOpenCard(null); void start([id]); }}
      />
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Check; label: string; value: string }) {
  return (
    <div className="min-w-[8.5rem] rounded-xl border border-border/70 bg-[var(--color-background-elevated-secondary)]/60 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-ui-sm text-muted-foreground"><Icon className="size-3.5" />{label}</p>
      <p className="mt-0.5 text-[1.25rem] font-semibold tabular-nums tracking-[-0.02em]">{value}</p>
    </div>
  );
}

function SectionHeading({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <h2 className="text-content font-semibold tracking-[-0.01em]">{children}</h2>
      {hint && <span className="text-ui-sm text-muted-foreground/70">{hint}</span>}
    </div>
  );
}

/* ---- The calendar ------------------------------------------------------- */

function MonthCalendar({ month, onMonth, selected, onDay, today, dueByDay, doneByDay, filedByDay }: {
  month: Date;
  onMonth(next: Date): void;
  selected: string;
  onDay(key: string): void;
  today: string;
  dueByDay: Map<string, ReviewCard[]>;
  doneByDay: Map<string, ReviewActivityEntry[]>;
  filedByDay: Map<string, ReviewActivityEntry[]>;
}) {
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // weeks start on Monday
    const start = new Date(first);
    start.setDate(first.getDate() - offset);
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const count = Math.ceil((offset + days) / 7) * 7;
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [month]);
  const peak = Math.max(1, ...[...dueByDay.values()].map((list) => list.length));
  const label = month.toLocaleDateString([], { month: "long", year: "numeric" });
  const shift = (by: number) => onMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--app-shadow-card)]">
      <div className="mb-3 flex items-center gap-1">
        <h3 className="flex-1 text-content font-semibold tracking-[-0.01em]">{label}</h3>
        <button className="rounded-md px-2 py-1 text-ui-sm text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => { const now = new Date(); onMonth(new Date(now.getFullYear(), now.getMonth(), 1)); onDay(today); }} type="button">Today</button>
        <button aria-label="Previous month" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => shift(-1)} type="button"><ChevronLeft className="size-4" /></button>
        <button aria-label="Next month" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => shift(1)} type="button"><ChevronRight className="size-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => <span key={name} className="pb-1">{name}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date) => {
          const key = dayKey(date);
          const inMonth = date.getMonth() === month.getMonth();
          const due = dueByDay.get(key) ?? [];
          const done = doneByDay.get(key) ?? [];
          const filed = filedByDay.get(key) ?? [];
          const future = key >= today;
          const isToday = key === today;
          const isSelected = key === selected;
          const heat = future && due.length ? 0.1 + 0.3 * (due.length / peak) : 0;
          return (
            <button
              className={cn(
                "relative flex aspect-square min-h-11 flex-col items-center justify-start rounded-lg pt-1.5 text-ui transition-[background-color,box-shadow]",
                inMonth ? "text-foreground/85" : "text-muted-foreground/35",
                "hover:bg-accent",
                isSelected && "ring-1 ring-[var(--recall)] ring-offset-0",
              )}
              key={key}
              onClick={() => onDay(key)}
              style={heat ? { background: `color-mix(in oklch, var(--recall) ${Math.round(heat * 100)}%, transparent)` } : undefined}
              title={[
                date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }),
                due.length && future ? `${due.length} due` : "",
                done.length ? `${done.length} reviewed` : "",
                filed.length ? `${filed.length} new ${filed.length === 1 ? "card" : "cards"}` : "",
              ].filter(Boolean).join(" · ")}
              type="button"
            >
              <span className={cn("grid size-6 place-items-center rounded-full tabular-nums", isToday && "bg-[var(--recall)] font-semibold text-white")}>{date.getDate()}</span>
              {future && due.length > 0 && (
                <span className="mt-0.5 text-[10px] font-semibold tabular-nums text-[var(--recall)]">{due.length}</span>
              )}
              {done.length > 0 && (
                <span className="absolute inset-x-0 bottom-1.5 flex justify-center gap-[3px]">
                  {done.slice(0, 4).map((entry) => (
                    <span className="size-[5px] rounded-full" key={entry.id} style={{ background: RATING_VAR[Math.min(4, Math.max(1, entry.rating)) as 1 | 2 | 3 | 4] }} />
                  ))}
                  {done.length > 4 && <span className="text-[8px] leading-[5px] text-muted-foreground">+</span>}
                </span>
              )}
              {filed.length > 0 && !done.length && !future && <span className="absolute bottom-1.5 size-[5px] rounded-full border border-muted-foreground/50" />}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-sm text-muted-foreground">
        <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-[var(--recall)]/35" /> Due</span>
        {([1, 2, 3, 4] as const).map((rating) => (
          <span className="flex items-center gap-1" key={rating}><span className="size-[6px] rounded-full" style={{ background: RATING_VAR[rating] }} />{["Again", "Hard", "Good", "Easy"][rating - 1]}</span>
        ))}
        <span className="flex items-center gap-1"><span className="size-[6px] rounded-full border border-muted-foreground/50" /> New card</span>
      </div>
    </div>
  );
}

function DayAgenda({ day, today, due, done, filed, onOpen, onStart, starting }: {
  day: string;
  today: string;
  due: ReviewCard[];
  done: ReviewActivityEntry[];
  filed: ReviewActivityEntry[];
  onOpen(cardId: string): void;
  onStart(cardIds: string[]): void;
  starting: boolean;
}) {
  const date = new Date(`${day}T12:00:00`);
  const future = day >= today;
  const title = day === today ? "Today" : date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  return (
    <div className="flex min-h-[20rem] flex-col rounded-2xl border border-border bg-card p-4 shadow-[var(--app-shadow-card)]">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="flex-1 text-content font-semibold tracking-[-0.01em]">{title}</h3>
        {future && due.length > 0 && (
          <Button disabled={starting} onClick={() => onStart(due.map((card) => card.id))} size="sm" variant="outline">
            Review {due.length === 1 ? "it" : `these ${due.length}`} <ArrowRight className="size-3" />
          </Button>
        )}
      </div>
      <div className="app-scroll -mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
        {future && due.length > 0 && (
          <div>
            <p className="mb-1.5 text-ui-sm font-medium text-muted-foreground">{day === today ? "Due now" : "Comes due"}</p>
            <ul className="flex flex-col gap-1">
              {due.map((card) => (
                <li key={card.id}>
                  <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent" onClick={() => onOpen(card.id)} type="button">
                    <span className="size-1.5 shrink-0 rounded-full bg-[var(--recall)]" />
                    <span className="min-w-0 flex-1 truncate text-ui">{card.title}</span>
                    <span className={cn("shrink-0 rounded px-1.5 py-px text-ui-sm", TONE_CLASS[dueTone(card.dueAt)])}>{dueLabel(card.dueAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {done.length > 0 && (
          <div>
            <p className="mb-1.5 text-ui-sm font-medium text-muted-foreground">Reviewed</p>
            <ul className="flex flex-col gap-1.5">
              {done.map((entry) => (
                <li key={entry.id}>
                  <button className="flex w-full flex-col gap-1 rounded-lg border border-border/60 px-2.5 py-2 text-left hover:border-[var(--recall)]/35" onClick={() => onOpen(entry.cardId)} type="button">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-ui font-medium">{entry.cardTitle}</span>
                      <Rating rating={entry.rating} />
                    </span>
                    <span className="text-ui-sm text-muted-foreground">
                      {entry.source === "coach" ? "Coach review" : entry.source === "resolve" ? "Solved again" : "Recall card"} · {new Date(entry.reviewedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </span>
                    {entry.feedback && <span className="line-clamp-2 text-ui-sm text-foreground/80">{entry.feedback}</span>}
                    {entry.missed?.[0] && <span className="flex items-start gap-1 text-ui-sm text-foreground/75"><TriangleAlert className="mt-[2px] size-3 shrink-0 text-[var(--warning)]" /><span className="line-clamp-1">{entry.missed[0]}</span></span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {filed.length > 0 && (
          <div>
            <p className="mb-1.5 text-ui-sm font-medium text-muted-foreground">Filed from a solve</p>
            <ul className="flex flex-col gap-1">
              {filed.map((entry) => (
                <li key={entry.id}>
                  <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent" onClick={() => onOpen(entry.cardId)} type="button">
                    <Sparkles className="size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-ui">{entry.cardTitle}</span>
                    <span className="shrink-0 truncate text-ui-sm text-muted-foreground">{entry.questionTitle}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!due.length && !done.length && !filed.length && (
          <div className="grid flex-1 place-items-center text-center">
            <p className="max-w-[16rem] text-ui text-muted-foreground">{future ? "Nothing comes due this day." : "No reviews this day."}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CardRow({ card, last, checked, onToggle, onOpen }: { card: ReviewCard; last: ReviewActivityEntry | undefined; checked: boolean; onToggle(): void; onOpen(): void }) {
  const recall = card.lastReviewAt ? card.retrievability : null;
  return (
    <div className={cn("group flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0", card.suspended && "opacity-60")}>
      <input
        aria-label={`Select ${card.title}`}
        checked={checked}
        className="size-3.5 shrink-0 accent-[var(--recall)]"
        onChange={onToggle}
        type="checkbox"
      />
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onOpen} type="button">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-medium">{card.title}</span>
          <span className="block truncate text-ui-sm text-muted-foreground">{card.questionTitle}{card.concepts[0] ? ` · ${card.concepts[0].title}` : ""}</span>
        </span>
        <span className="hidden w-24 shrink-0 sm:block" title={recall === null ? "Not reviewed yet" : `Recall ${percent(recall)}`}>
          <span className="block h-1 overflow-hidden rounded-full bg-foreground/8">
            <span className="block h-full rounded-full" style={{ width: `${Math.round((recall ?? 0) * 100)}%`, background: recall === null ? "transparent" : recall < 0.7 ? "var(--rate-again)" : recall < 0.85 ? "var(--rate-hard)" : "var(--rate-good)" }} />
          </span>
          <span className="mt-0.5 block text-[10.5px] tabular-nums text-muted-foreground">{recall === null ? "new" : `recall ${percent(recall)}`}</span>
        </span>
        <span className="w-14 shrink-0">{last ? <Rating rating={last.rating} /> : null}</span>
        <span className={cn("w-[5.5rem] shrink-0 rounded px-1.5 py-px text-center text-ui-sm", card.suspended ? TONE_CLASS.later : TONE_CLASS[dueTone(card.dueAt)])}>
          {card.suspended ? "Paused" : dueLabel(card.dueAt)}
        </span>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
      </button>
    </div>
  );
}

/** One card's whole story, and what can be done with it. */
function CardSheet({ api, cardId, onClose, onStart, onQuickRecall, onChanged, onError }: {
  api: SparApi | undefined;
  cardId: string | null;
  onClose(): void;
  onStart(cardId: string): void;
  onQuickRecall(cardId: string): void;
  onChanged(): void;
  onError(value: string): void;
}) {
  const [detail, setDetail] = useState<ReviewCardDetail | null>(null);
  useEffect(() => {
    setDetail(null);
    if (!api || !cardId) return;
    let cancelled = false;
    void api.readReviewCard(cardId).then((value) => { if (!cancelled) setDetail(value); }).catch((error) => onError(message(error)));
    return () => { cancelled = true; };
  }, [api, cardId, onError]);
  const suspend = async () => {
    if (!api || !detail) return;
    try {
      await api.suspendReview({ cardId: detail.card.id, suspended: !detail.card.suspended });
      setDetail({ ...detail, card: { ...detail.card, suspended: !detail.card.suspended } });
      onChanged();
    } catch (error) {
      onError(message(error));
    }
  };
  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open={Boolean(cardId)}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[46rem]">
        <DialogTitle className="sr-only">{detail?.card.title ?? "Review card"}</DialogTitle>
        <DialogDescription className="sr-only">Everything this review card holds: where you slipped, your code and every review.</DialogDescription>
        <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-5">
          <Eyebrow className="mb-2">Review card{detail ? ` · filed ${relativeTime(detail.card.createdAt)}` : ""}</Eyebrow>
          {detail ? <ReviewDossier api={api} detail={detail} /> : <div className="grid h-40 place-items-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>}
        </div>
        {detail && (
          <div className="flex shrink-0 items-center gap-2 border-t border-border/70 bg-popover px-5 py-3">
            <Button onClick={() => void suspend()} variant="ghost">
              {detail.card.suspended ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}
              {detail.card.suspended ? "Resume" : "Pause"}
            </Button>
            <span className="flex-1" />
            {!detail.card.suspended && <Button onClick={() => onQuickRecall(detail.card.id)} variant="outline"><Zap data-icon="inline-start" /> Quick recall</Button>}
            {!detail.card.suspended && (
              <Button className="bg-[var(--recall)] text-white hover:bg-[color-mix(in_oklch,var(--recall)_88%,black)]" onClick={() => onStart(detail.card.id)}>
                <Sparkles data-icon="inline-start" /> Review in a session
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
