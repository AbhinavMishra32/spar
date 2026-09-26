import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Clock, Check, CheckCircle2, ChevronRight, CornerDownRight, Flag, History, Pause, Play, Search, XCircle } from "lucide-react";
import type { ChallengeCodePreview, ChallengeHistorySummary, ConceptSummary, ReviewCard, ReviewOverview, ReviewScheduleEntry, ReviewTarget } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { ConceptChips } from "../concepts/ConceptChip";
import { SourceBadge } from "../common/SourceBadge";
import { EmptyState } from "../common/EmptyState";
import { CodePlate } from "../common/CodePeek";
import { LanguageGlyph, LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { ChallengeEmblem } from "../workspace/ChallengeEmblem";
import { DifficultyPill } from "../workspace/Difficulty";
import { dueLabel, dueTone, isDue, percent, shortDate, TONE_CLASS } from "../review/schedule";
import { Button } from "@/components/ui/button";
import { message } from "@/lib/format";
import { CardNotes } from "../review/InsightCard";
import { ReviewSession, type ReviewStart } from "../review/ReviewSession";

type Filter = "all" | "due" | "passed" | "open" | "replaced";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "due", label: "Review due" },
  { id: "open", label: "Open" },
  { id: "passed", label: "Passed" },
  { id: "replaced", label: "Replaced" },
];

function matches(item: ChallengeHistorySummary, filter: Filter, reviews: ReviewOverview["byQuestion"]) {
  if (filter === "due") return isDue(reviews[item.id]);
  if (filter === "open") return item.status === "active";
  if (filter === "passed") return item.lastOutcome === "passed";
  if (filter === "replaced") return Boolean(item.replacedByQuestionId);
  return true;
}

/** How a finished challenge ended, in one chip. An open one gets nothing: the
 *  absence of a verdict is itself the state, and a grey "in progress" pill would
 *  give every row a badge and stop any of them meaning anything. */
function OutcomeChip({ outcome }: { outcome: ChallengeHistorySummary["lastOutcome"] }) {
  if (outcome === "passed") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--success)]/12 px-1.5 py-0.5 text-ui-sm font-medium text-[var(--success)]">
        <CheckCircle2 className="size-3" />
        Passed
      </span>
    );
  }
  if (outcome === "failed") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-destructive/12 px-1.5 py-0.5 text-ui-sm font-medium text-destructive">
        <XCircle className="size-3" />
        Failed
      </span>
    );
  }
  if (outcome === "abandoned") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-ui-sm font-medium text-muted-foreground">
        <Flag className="size-3" />
        Gave up
      </span>
    );
  }
  return null;
}

/**
 * Where a solved challenge stands in spaced review — when it comes back and how
 * likely it is to be remembered today — with the two things to do about it:
 * review it now, or read what it taught.
 */
function ReviewLine({ entry, notesOpen, onReview, onNotes }: { entry: ReviewScheduleEntry; notesOpen: boolean; onReview(): void; onNotes(): void }) {
  const due = isDue(entry);
  const tone = entry.suspended ? "later" : dueTone(entry.dueAt);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-ui-sm text-muted-foreground">
      <Clock className="size-3 shrink-0 text-muted-foreground/60" />
      <span className={cn("rounded px-1.5 py-px font-medium", TONE_CLASS[tone])}>
        {entry.suspended ? "Review paused" : due ? dueLabel(entry.dueAt) : `Review ${dueLabel(entry.dueAt).toLowerCase()}`}
      </span>
      {entry.lastReviewAt && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span title={`Last reviewed ${shortDate(entry.lastReviewAt)}`}>Recall {percent(entry.retrievability)}</span>
        </>
      )}
      {entry.reps > 1 && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span>{entry.reps - 1} review{entry.reps === 2 ? "" : "s"}{entry.lapses ? `, ${entry.lapses} forgotten` : ""}</span>
        </>
      )}
      <span className="pointer-events-auto ml-1 inline-flex items-center gap-0.5">
        <button
          aria-expanded={notesOpen}
          className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-px font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          onClick={onNotes}
          type="button"
        >
          <ChevronRight className={cn("size-3 transition-transform duration-200", notesOpen && "rotate-90")} />
          What you learned
        </button>
        {!entry.suspended && (
          <button
            className={cn("rounded-md px-1.5 py-px font-medium transition-colors hover:bg-accent", due ? "text-foreground" : "text-foreground/70 hover:text-foreground")}
            onClick={onReview}
            type="button"
          >
            {due ? "Review now →" : "Review"}
          </button>
        )}
      </span>
    </div>
  );
}

function ChallengeCard({
  challenges,
  item,
  preview,
  onOpen,
  onOpenConcept,
  onReview,
  onSuspend,
  onTargets,
  card,
  schedule,
  summaries,
}: {
  challenges: ChallengeHistorySummary[];
  item: ChallengeHistorySummary;
  preview: ChallengeCodePreview | undefined;
  onOpen(): void;
  onOpenConcept(slug: string): void;
  onReview(cardId: string): void;
  onSuspend(card: ReviewCard): void;
  onTargets(card: ReviewCard, targets: ReviewTarget[]): void;
  card: ReviewCard | undefined;
  schedule: ReviewScheduleEntry | undefined;
  summaries: Map<string, ConceptSummary>;
}) {
  const [notes, setNotes] = useState(false);
  return (
    /* A div with the card-wide action as an overlay button underneath, rather than
       one big button: the concept chips are controls of their own, and a control
       nested inside a button is neither valid nor reachable by keyboard. The
       content layer passes clicks through to the overlay; only the chips take
       their own. */
    <div
      className={cn(
        "group relative w-full overflow-hidden rounded-xl border border-border bg-card p-3 text-left",
        "shadow-[var(--app-shadow-card)] transition-[border-color,box-shadow,transform] duration-200",
        "hover:-translate-y-px hover:border-[var(--border-strong)] hover:shadow-[var(--app-shadow-sheet)]",
        "focus-within:border-[var(--border-strong)]",
      )}
    >
      <button
        aria-label={`Open ${item.title}`}
        className="absolute inset-0 z-0 rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={onOpen}
        type="button"
      />
      <div className="pointer-events-none relative z-10 flex min-h-[7.5rem] items-stretch gap-3">
        <ChallengeEmblem
          animated={false}
          className="mt-0.5 self-start transition-transform duration-300 group-hover:scale-[1.04]"
          question={item}
          size={40}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-content font-semibold tracking-[-0.01em]">{item.title}</span>
            <DifficultyPill difficulty={item.difficulty} />
            {/* Where it came from, next to what it was worth: a history that mixes
                problems Spar wrote with problems the world asks has to say which
                is which, and who graded each one. */}
            {item.source && <SourceBadge size="compact" source={item.source} />}
            <OutcomeChip outcome={item.lastOutcome} />
            <span
              className="ml-auto shrink-0 text-muted-foreground/60"
              title={LANGUAGE_LABEL[item.language]}
            >
              <LanguageGlyph className="size-3.5" language={item.language} />
            </span>
            <span className="shrink-0 text-ui-sm tabular-nums text-muted-foreground/60">{relativeTime(item.updatedAt)}</span>
          </div>

          <p className="truncate text-ui text-muted-foreground">
            {item.sessionTitle}
            <span className="mx-1.5 text-muted-foreground/40">·</span>
            {item.testRunCount} test run{item.testRunCount === 1 ? "" : "s"}
            <span className="mx-1.5 text-muted-foreground/40">·</span>
            {item.attemptCount} attempt{item.attemptCount === 1 ? "" : "s"}
            {item.assistance && item.assistance !== "unknown" && <><span className="mx-1.5 text-muted-foreground/40">·</span>{item.assistance === "assisted" ? "Assisted" : "Independent"}</>}
          </p>

          {schedule && <ReviewLine entry={schedule} notesOpen={notes} onNotes={() => setNotes((value) => !value)} onReview={() => onReview(schedule.cardId)} />}

          {/* What the challenge was about, and the way into the rest of the
              history under each one: hover for the learner's standing there,
              click to open everything filed under it. */}
          <ConceptChips
            challenges={challenges}
            className="pointer-events-auto"
            concepts={item.concepts}
            onOpen={onOpenConcept}
            summaries={summaries}
          />

          {/* Lineage, when there is any. An adaptive swap is the most interesting
              thing in this list — it is the agent changing its mind — so it gets
              its own line rather than being folded into the metadata run-on. */}
          {item.replacesQuestionTitle && (
            <p className="flex min-w-0 items-center gap-1.5 text-ui-sm text-muted-foreground">
              <CornerDownRight className="size-3 shrink-0 text-muted-foreground/50" />
              Replaced
              <span className="min-w-0 truncate font-medium text-foreground">{item.replacesQuestionTitle}</span>
            </p>
          )}
          {item.replacedByQuestionTitle && (
            <p className="flex min-w-0 items-center gap-1.5 text-ui-sm text-muted-foreground">
              <ArrowRight className="size-3 shrink-0 text-muted-foreground/50" />
              Became
              <span className="min-w-0 truncate font-medium text-foreground">{item.replacedByQuestionTitle}</span>
            </p>
          )}

          <span
            className={cn(
              "mt-auto inline-flex w-fit items-center gap-1 pt-1 text-ui-sm font-medium text-muted-foreground/0",
              "transition-colors duration-200 group-hover:text-foreground/70",
            )}
          >
            <Play className="size-3" />
            Practise this again
          </span>
        </div>

        {preview && !notes && <CodePlate preview={preview} />}
      </div>
      {notes && card && (
        <div className="relative z-10 mt-3 border-t border-border/70 pt-1 sm:ml-[52px]">
          <CardNotes card={card} onTargets={(targets) => onTargets(card, targets)} />
          <div className="mt-3 flex justify-end">
            <button className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ui-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" onClick={() => onSuspend(card)} type="button">
              {card.suspended ? <Play className="size-3" /> : <Pause className="size-3" />}
              {card.suspended ? "Resume reviews" : "Pause reviews"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ChallengesPage({
  api,
  challenges,
  concepts,
  onOpen,
  onOpenConcept,
  reviews,
  onReviewsChanged,
  onError,
  onResolve,
  startReview,
  onStartHandled,
}: {
  api: SparApi | undefined;
  challenges: ChallengeHistorySummary[];
  concepts: ConceptSummary[];
  onOpen(challenge: ChallengeHistorySummary): void;
  onOpenConcept(slug: string): void;
  /** Each solved challenge's place in spaced review, keyed by challenge. */
  reviews: ReviewOverview | undefined;
  /** A review moved the schedule; the shell refreshes its badge. */
  onReviewsChanged(overview: ReviewOverview): void;
  onError(value: string): void;
  /** A re-solve review: open the challenge from a blank file. */
  /** Solve a card's challenge again; `rest` is the queue left after it. */
  onResolve(challengeId: string, review: { cardId: string; promptId?: string | undefined }, rest: string[]): void;
  /** Asked from elsewhere to start reviewing: the due queue, one card, or a list. */
  startReview?: ReviewStart | null | undefined;
  onStartHandled?(): void;
}) {
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [due, setDue] = useState<ReviewCard[]>([]);
  const [session, setSession] = useState<{ cards: ReviewCard[]; flashcardFirst: boolean } | null>(null);

  const loadCards = useCallback(async () => {
    if (!api) return null;
    const queue = await api.reviewQueue();
    setCards(queue.cards);
    setDue(queue.due);
    return queue;
  }, [api]);

  useEffect(() => {
    void loadCards().catch(() => undefined);
  }, [loadCards, reviews?.totalCards]);

  const cardFor = useMemo(() => new Map(cards.map((card) => [card.questionId, card])), [cards]);

  /* One card, the due queue, or everything — reviewing ahead of schedule is
     allowed: FSRS credits an early review for how early it was, so extra
     practice never costs the learner their schedule. "All" goes weakest first. */
  const review = useCallback(async (requested: string | string[] | "due" | "all" | "auto", flashcardFirst = false) => {
    const queue = await loadCards().catch(() => null);
    const pool = queue ?? { cards, due };
    const which = requested === "auto" ? (pool.due.length ? "due" : "all") : requested;
    const picked = Array.isArray(which)
      ? which.flatMap((id) => pool.cards.filter((card) => card.id === id && !card.suspended))
      : which === "due"
      ? pool.due
      : which === "all"
        ? pool.cards.filter((card) => !card.suspended).sort((left, right) => left.retrievability - right.retrievability)
        : pool.cards.filter((card) => card.id === which);
    if (picked.length) setSession({ cards: picked, flashcardFirst });
  }, [cards, due, loadCards]);

  useEffect(() => {
    if (!startReview) return;
    onStartHandled?.();
    void review(startReview.cardIds ?? startReview.cardId ?? "auto", startReview.flashcardFirst);
  }, [onStartHandled, review, startReview]);

  const suspend = async (card: ReviewCard) => {
    if (!api) return;
    try {
      await api.suspendReview({ cardId: card.id, suspended: !card.suspended });
      const queue = await loadCards();
      if (queue) onReviewsChanged(queue.overview);
    } catch (error) {
      onError(message(error));
    }
  };

  const retarget = async (card: ReviewCard, targets: ReviewTarget[]) => {
    if (!api) return;
    setCards((list) => list.map((entry) => (entry.id === card.id ? { ...entry, targets } : entry)));
    try {
      await api.setReviewTargets({ cardId: card.id, targets });
    } catch (error) {
      onError(message(error));
      void loadCards();
    }
  };

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [previews, setPreviews] = useState<Record<string, ChallengeCodePreview>>({});

  /* Excerpts are fetched when the list is opened rather than carried on the
     bootstrap: they are a page's worth of code, and most launches never come
     here. A card without one renders fine, so nothing waits on this. */
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api.listChallengePreviews().then((value) => {
      if (!cancelled) setPreviews(value);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, challenges.length]);

  const schedule = useMemo(() => reviews?.byQuestion ?? {}, [reviews]);
  const summaries = useMemo(() => new Map(concepts.map((concept) => [concept.slug, concept])), [concepts]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((item) => [item.id, challenges.filter((row) => matches(row, item.id, schedule)).length])) as Record<Filter, number>,
    [challenges, schedule],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return challenges.filter((item) => {
      if (!matches(item, filter, schedule)) return false;
      if (!needle) return true;
      const concepts = item.concepts.map((concept) => concept.title).join(" ");
      return `${item.title} ${item.sessionTitle} ${item.language} ${item.difficulty} ${concepts} ${item.source ? `${item.source.source} ${item.source.displayId} ${item.source.difficulty}` : ""}`.toLowerCase().includes(needle);
    });
  }, [challenges, filter, query, schedule]);

  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[62rem] px-18 pb-16 pt-8">
        <h1 className="text-[1.35rem] font-semibold tracking-[-0.03em]">History</h1>
        <p className="mt-1 text-content text-muted-foreground">
          Every challenge you've worked on. Each solved one comes back to practise again just before you'd forget it — or, short on time, one question about it.
        </p>

        {reviews && reviews.totalCards > 0 && <ReviewBand dueCount={due.length} overview={reviews} onStart={(which) => void review(which)} />}

        <div className="mt-5 flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-[var(--color-background-elevated-secondary)] p-0.5">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-md px-2.5 text-ui transition-colors",
                  filter === item.id
                    ? "bg-card text-foreground shadow-[var(--app-shadow-card)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setFilter(item.id)}
                type="button"
              >
                {item.label}
                <span className="tabular-nums text-muted-foreground/60">{counts[item.id]}</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-60">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-7 w-full rounded-lg border border-border bg-card pl-7 pr-2 text-ui outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-[var(--border-strong)]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter challenge history"
              value={query}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2.5">
          {visible.length ? (
            visible.map((item) => (
              <ChallengeCard
                challenges={challenges}
                item={item}
                key={item.id}
                onOpen={() => onOpen(item)}
                onOpenConcept={onOpenConcept}
                card={cardFor.get(item.id)}
                onReview={(cardId) => void review(cardId)}
                onSuspend={(card) => void suspend(card)}
                onTargets={(card, targets) => void retarget(card, targets)}
                preview={previews[item.id]}
                schedule={schedule[item.id]}
                summaries={summaries}
              />
            ))
          ) : (
            <EmptyState
              description={
                filter === "due" && challenges.length
                  ? "No solved challenge is due for review. Its pattern comes back here when it is."
                  : challenges.length
                  ? "Clear the filters to see the rest of your challenge history."
                  : "A challenge appears here as soon as Spar compiles and validates it."
              }
              icon={History}
              title={challenges.length ? "Nothing matches this filter" : "No challenges yet"}
            />
          )}
        </div>
      </div>
      <ReviewSession
        api={api}
        canPractice={(card) => challenges.some((challenge) => challenge.id === card.questionId)}
        cards={session?.cards ?? []}
        flashcardFirst={session?.flashcardFirst ?? false}
        onClose={() => {
          setSession(null);
          void loadCards().then((queue) => queue && onReviewsChanged(queue.overview)).catch(() => undefined);
        }}
        onFiled={onReviewsChanged}
        onOpenChallenge={(questionId, target, rest) => {
          setSession(null);
          onResolve(questionId, target, rest);
        }}
        open={Boolean(session?.cards.length)}
      />
    </div>
  );
}

/**
 * The review queue, as one line at the top of History: how many are due, the
 * next two weeks at a glance, and the button that starts them.
 */
function ReviewBand({ overview, dueCount, onStart }: { overview: ReviewOverview; dueCount: number; onStart(which: "due" | "all"): void }) {
  const peak = Math.max(1, ...overview.upcoming.map((day) => day.count));
  return (
    <div className="mt-5 flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--app-shadow-card)] max-sm:flex-wrap">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", dueCount ? "bg-[var(--warning)]/14 text-[var(--warning)]" : "bg-[var(--success)]/12 text-[var(--success)]")}>
        {dueCount ? <Clock className="size-4.5" /> : <Check className="size-4.5" />}
      </span>
      <div className="min-w-0">
        <p className="text-content font-semibold tracking-[-0.01em]">{dueCount ? `${dueCount} to review` : "All caught up"}</p>
        <p className="text-ui-sm text-muted-foreground">
          {dueCount ? "Solve each again, or answer its card." : overview.nextDueAt ? `Next review ${dueLabel(overview.nextDueAt).toLowerCase()}.` : "Nothing scheduled."}
          {overview.retention !== null && <> · Recall {percent(overview.retention)}</>}
          {overview.streakDays > 1 && <> · {overview.streakDays}-day streak</>}
        </p>
      </div>
      <div className="ml-auto flex h-7 w-36 shrink-0 items-end gap-[3px] max-sm:hidden" title="Reviews due over the next two weeks">
        {overview.upcoming.map((day, index) => (
          <div
            className={cn("flex-1 rounded-[2px]", index === 0 ? "bg-foreground/60" : "bg-foreground/20", day.count === 0 && "bg-foreground/8")}
            key={day.date}
            style={{ height: `${day.count ? Math.max(18, (day.count / peak) * 100) : 8}%` }}
            title={`${new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}: ${day.count}`}
          />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {dueCount > 0 && overview.totalCards > dueCount && (
          <Button onClick={() => onStart("all")} title="Every card, weakest first — reviewing early is fine" variant="ghost">
            Review all
          </Button>
        )}
        <Button onClick={() => onStart(dueCount ? "due" : "all")} title={dueCount ? undefined : "Every card, weakest first — reviewing early is fine"} variant={dueCount ? "default" : "outline"}>
          {dueCount ? "Start review" : "Review anyway"} <ArrowRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
