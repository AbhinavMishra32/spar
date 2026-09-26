import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ArrowRight, Check, ChevronDown, Keyboard, Layers, Lightbulb, Loader2, Repeat2, X } from "lucide-react";
import { REVIEW_TARGETS, REVIEW_TARGET_LABEL, type FsrsRating, type ReviewCard, type ReviewGradeResult, type ReviewIntervalPreview, type ReviewOverview, type ReviewPending, type ReviewTarget } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { message } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Markdown } from "../agent/Markdown";
import { SparDots } from "../common/SparDots";
import { TARGET_HINT } from "./InsightCard";
import { RATING_LABEL, dueLabel, intervalLabel } from "./schedule";

/*
 * A review, the way Anki runs one: a card at a time in a sheet over the page.
 *
 * A card that is due is first a problem to practise: the default is solving it
 * again from a blank file, graded from how that goes. Only when the learner
 * chooses not to — no time, not at the keyboard, the problem is gone — do they
 * answer the card instead.
 *
 * The front is a short question. The learner recalls the answer in their head,
 * flips the card (Space) and grades themselves 1–4, seeing what each grade would
 * schedule. Typing an answer is there for when they want it checked, not the
 * default — most recall is faster, and more honest, unwritten. Closing the sheet
 * files nothing: the card in hand stays due, and the question is kept for next
 * time unless its back was already seen.
 */

type Step =
  | { kind: "choose" }
  | { kind: "writing" }
  | { kind: "front"; pending: ReviewPending }
  | { kind: "checking"; pending: ReviewPending }
  | { kind: "back"; pending: ReviewPending; answer: string; intervals: ReviewIntervalPreview; checked: ReviewGradeResult | null; filing: FsrsRating | null };

/** Asked from elsewhere to start reviewing: the queue, one card, or a given
 *  list — and whether the first card goes straight to its flashcard, as it does
 *  when the learner backs out of re-solving it. */
export type ReviewStart = { cardId: string | null; cardIds?: string[] | undefined; flashcardFirst?: boolean | undefined };

const RATINGS: FsrsRating[] = [1, 2, 3, 4];
const RATING_TONE: Record<FsrsRating, string> = {
  1: "text-destructive",
  2: "text-[var(--warning)]",
  3: "text-[var(--success)]",
  4: "text-[var(--info,var(--success))]",
};

export function ReviewSession({
  api,
  cards,
  open,
  onClose,
  onFiled,
  onOpenChallenge,
  canPractice,
  flashcardFirst = false,
}: {
  api: SparApi | undefined;
  /** The cards to go through, in order. */
  cards: ReviewCard[];
  open: boolean;
  onClose(): void;
  onFiled(overview: ReviewOverview): void;
  /** A re-solve review: open the challenge from a blank file. `rest` is the
   *  queue after this card, to pick up again once it is filed. */
  onOpenChallenge(questionId: string, review: { cardId: string; promptId?: string | undefined }, rest: string[]): void;
  /** Whether this card's challenge is still there to solve again. */
  canPractice(card: ReviewCard): boolean;
  /** The first card skips the choice and goes to its flashcard. */
  flashcardFirst?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<Step>({ kind: "writing" });
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [cue, setCue] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const card = cards[index];
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const ask = useCallback(async (next: ReviewCard, target?: ReviewTarget, fresh = false) => {
    if (!api) return;
    setStep({ kind: "writing" });
    setTyping(false);
    setTyped("");
    setCue(null);
    setFailure(null);
    try {
      const pending = await api.startReview({ cardId: next.id, fresh, ...(target ? { target } : {}) });
      setStep({ kind: "front", pending });
    } catch (error) {
      setFailure(message(error));
    }
  }, [api]);

  /* Practice first: a card whose problem is still there opens on the choice. */
  const canPracticeRef = useRef(canPractice);
  canPracticeRef.current = canPractice;
  const begin = useCallback((next: ReviewCard, skipChoice = false) => {
    if (!skipChoice && canPracticeRef.current(next)) {
      setFailure(null);
      setCue(null);
      setTyping(false);
      setTyped("");
      setStep({ kind: "choose" });
    } else {
      void ask(next);
    }
  }, [ask]);

  /* A fresh run each time the sheet opens, on the queue it was opened with. */
  const flashcardFirstRef = useRef(flashcardFirst);
  flashcardFirstRef.current = flashcardFirst;
  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setDone(0);
    const first = cardsRef.current[0];
    if (first) begin(first, flashcardFirstRef.current);
  }, [begin, open]);

  const practice = useCallback(() => {
    if (!card) return;
    onOpenChallenge(card.questionId, { cardId: card.id }, cardsRef.current.slice(index + 1).map((next) => next.id));
  }, [card, index, onOpenChallenge]);

  const close = useCallback(() => {
    if (api && "pending" in step && !(step.kind === "back" && step.filing)) void api.abandonReview(step.pending.id).catch(() => undefined);
    onClose();
  }, [api, onClose, step]);

  const flip = useCallback(async () => {
    if (!api || step.kind !== "front") return;
    try {
      const reveal = await api.revealReviewAnswer(step.pending.id);
      setStep({ kind: "back", pending: step.pending, answer: reveal.answer, intervals: reveal.intervals, checked: null, filing: null });
    } catch (error) {
      setFailure(message(error));
    }
  }, [api, step]);

  const check = useCallback(async () => {
    if (!api || step.kind !== "front" || !typed.trim()) return;
    const pending = step.pending;
    setStep({ kind: "checking", pending });
    try {
      const checked = await api.answerReview({ promptId: pending.id, answer: typed });
      const reveal = await api.revealReviewAnswer(pending.id);
      setStep({ kind: "back", pending, answer: reveal.answer, intervals: reveal.intervals, checked, filing: null });
    } catch (error) {
      setFailure(message(error));
      setStep({ kind: "front", pending });
    }
  }, [api, step, typed]);

  const grade = useCallback(async (rating: FsrsRating) => {
    if (!api || step.kind !== "back" || step.filing) return;
    setStep({ ...step, filing: rating });
    try {
      const filed = await api.commitReview({ promptId: step.pending.id, rating });
      onFiled(filed.overview);
      setDone((count) => count + 1);
      const next = cardsRef.current[index + 1];
      if (next) {
        setIndex(index + 1);
        begin(next);
      } else {
        setIndex(cardsRef.current.length);
      }
    } catch (error) {
      setFailure(message(error));
      setStep({ ...step, filing: null });
    }
  }, [api, begin, index, onFiled, step]);

  /* Space flips, then Space takes Good (or the checked grade); 1–4 grade. */
  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (step.kind === "choose" && card) {
        if (event.key === "Enter") {
          event.preventDefault();
          practice();
        } else if (event.key === " ") {
          event.preventDefault();
          void ask(card);
        }
      } else if (step.kind === "front" && step.pending.format !== "resolve" && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        void flip();
      } else if (step.kind === "back") {
        if (["1", "2", "3", "4"].includes(event.key)) {
          event.preventDefault();
          void grade(Number(event.key) as FsrsRating);
        } else if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          void grade(step.checked?.suggestedRating ?? 3);
        }
      }
    };
    /* Capture, because the sheet's own layers swallow some keys on the way up. */
    addEventListener("keydown", listener, true);
    return () => removeEventListener("keydown", listener, true);
  }, [ask, card, flip, grade, open, practice, step]);

  const pending = "pending" in step ? step.pending : null;
  const finished = index >= cards.length;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[min(44rem,calc(100vh-4rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[38rem]"
        onOpenAutoFocus={(event) => {
          /* Focus the sheet, not its first button: Space is the flip key, and
             a focused close button would take it. */
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        showCloseButton={false}
      >
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 px-4">
          <DialogPrimitive.Title className="min-w-0 truncate text-ui font-medium">
            {finished ? "Review" : card?.questionTitle || card?.title || "Review"}
          </DialogPrimitive.Title>
          {!finished && card && step.kind !== "choose" && (
            <TargetMenu
              current={pending?.target}
              disabled={step.kind === "writing" || step.kind === "checking"}
              marked={card.targets}
              onPick={(target) => void ask(card, target, true)}
            />
          )}
          <span className="ml-auto shrink-0 text-ui-sm tabular-nums text-muted-foreground">
            {finished ? `${done} done` : `${index + 1} of ${cards.length}`}
          </span>
          <DialogPrimitive.Close aria-label="Stop reviewing" className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <X className="size-3.5" />
          </DialogPrimitive.Close>
        </header>

        <div className="h-0.5 shrink-0 bg-border/50">
          <div className="h-full bg-foreground/35 transition-[width] duration-500" style={{ width: `${cards.length ? (Math.min(index, cards.length) / cards.length) * 100 : 0}%` }} />
        </div>

        <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-7 pb-6 pt-7">
          {finished ? (
            <Finished count={done} />
          ) : step.kind === "choose" && card ? (
            <Choose card={card} onCard={() => void ask(card)} onPractice={practice} />
          ) : step.kind === "writing" ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-ui text-muted-foreground">
              {failure ? <span className="text-destructive">{failure}</span> : <><SparDots label="Writing a card" pattern="sweep" size={16} /> Writing a card…</>}
            </div>
          ) : pending && (
            <>
              <Markdown className="text-[1.02rem] leading-[1.6] [&_pre]:text-[0.82rem]" source={pending.prompt} />

              {cue && (
                <p className="mt-4 flex items-start gap-2 text-ui text-muted-foreground">
                  <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-[var(--warning)]" />
                  {cue}
                </p>
              )}

              {step.kind === "back" && <Back answer={step.answer} checked={step.checked} typed={typed} />}

              {typing && (step.kind === "front" || step.kind === "checking") && (
                <textarea
                  autoFocus
                  className="mt-5 min-h-24 w-full resize-y rounded-lg border border-border bg-[var(--color-background-editor)] px-3 py-2 text-ui leading-[1.6] outline-none placeholder:text-muted-foreground/60 focus-visible:border-[var(--border-strong)] disabled:opacity-60"
                  disabled={step.kind === "checking"}
                  onChange={(event) => setTyped(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void check();
                    }
                  }}
                  placeholder="Your answer — a few words or a few lines of code"
                  value={typed}
                />
              )}
              {failure && <p className="mt-3 text-ui-sm text-destructive">{failure}</p>}
            </>
          )}
        </div>

        {!finished && pending && (
          <footer className="shrink-0 border-t border-border/70 px-4 py-3">
            {step.kind === "back" ? (
              <Grades checked={step.checked} filing={step.filing} intervals={step.intervals} onGrade={(rating) => void grade(rating)} />
            ) : pending.format === "resolve" ? (
              <div className="flex items-center gap-2">
                <Button onClick={() => card && onOpenChallenge(card.questionId, { cardId: card.id, promptId: pending.id }, cardsRef.current.slice(index + 1).map((next) => next.id))}>
                  <Repeat2 className="size-3.5" /> Open a blank copy
                </Button>
                <Button onClick={() => card && void ask(card, pending.target, true)} variant="ghost">Ask something shorter</Button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                {!cue && pending.cue && (
                  <Button onClick={() => void api?.revealReviewCue(pending.id).then((value) => setCue(value ?? null))} size="sm" variant="ghost">
                    <Lightbulb className="size-3.5" /> Hint
                  </Button>
                )}
                {typing ? (
                  <Button disabled={step.kind === "checking"} onClick={() => setTyping(false)} size="sm" variant="ghost">Don't type</Button>
                ) : (
                  <Button onClick={() => setTyping(true)} size="sm" title="Type an answer and have it checked" variant="ghost">
                    <Keyboard className="size-3.5" /> Type it
                  </Button>
                )}
                {typing ? (
                  <Button className="ml-auto" disabled={step.kind === "checking" || !typed.trim()} onClick={() => void check()}>
                    {step.kind === "checking" ? <><Loader2 className="size-3.5 animate-spin" /> Checking…</> : <>Check <kbd className="font-sans text-[10px] opacity-60">⌘↵</kbd></>}
                  </Button>
                ) : (
                  <Button className="ml-auto min-w-40" onClick={() => void flip()}>
                    Show answer <kbd className="font-sans text-[10px] opacity-60">Space</kbd>
                  </Button>
                )}
              </div>
            )}
          </footer>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The first thing a due card asks: solve it again, or answer the card. Solving
 * is the review proper — recall under the conditions that count — so it leads
 * and takes Enter; the card is the lighter way through.
 */
function Choose({ card, onPractice, onCard }: { card: ReviewCard; onPractice(): void; onCard(): void }) {
  const due = Date.parse(card.dueAt) <= Date.now();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-ui-sm text-muted-foreground">
          {due ? "Due" : `Not due until ${dueLabel(card.dueAt).toLowerCase()}`} · {Math.round(card.retrievability * 100)}% likely you remember it
        </p>
        <h2 className="mt-1 text-[1.15rem] font-medium leading-snug">Practise it again</h2>
        <p className="mt-1 text-ui text-muted-foreground">
          The best review is doing it: the problem from a blank file, no notes. Short on time? Answer one question about it instead.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <button
          className="group flex items-center gap-3 rounded-xl border border-foreground/20 bg-accent px-4 py-3 text-left transition-colors hover:border-foreground/35"
          onClick={onPractice}
          type="button"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-foreground"><Repeat2 className="size-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-ui font-medium">Solve it again</span>
            <span className="block text-ui-sm text-muted-foreground">Graded by how it goes: first check inside 15 minutes is Easy, three or more is Hard.</span>
          </span>
          <kbd className="shrink-0 font-sans text-[10px] text-muted-foreground">↵</kbd>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </button>
        <button
          className="group flex items-center gap-3 rounded-xl border border-border px-4 py-3 text-left transition-colors hover:bg-accent/60"
          onClick={onCard}
          type="button"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--color-background-elevated-secondary)] text-muted-foreground"><Layers className="size-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-ui font-medium">Answer the card instead</span>
            <span className="block text-ui-sm text-muted-foreground">One short question about the problem, the pattern or what made it click.</span>
          </span>
          <kbd className="shrink-0 font-sans text-[10px] text-muted-foreground">Space</kbd>
        </button>
      </div>
    </div>
  );
}

/** What this card is asking about, and the way to ask about something else. */
function TargetMenu({ current, marked, disabled, onPick }: { current: ReviewTarget | undefined; marked: ReviewTarget[]; disabled: boolean; onPick(target: ReviewTarget): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-[var(--color-background-elevated-secondary)] px-2 text-ui-sm text-foreground/80 transition-colors hover:text-foreground disabled:opacity-50" type="button">
          {current ? REVIEW_TARGET_LABEL[current] : "Choosing…"}
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {REVIEW_TARGETS.map((target) => (
          <DropdownMenuItem className="flex items-start gap-2 py-1.5" key={target} onSelect={() => target !== current && onPick(target)}>
            <Check className={cn("mt-0.5 size-3.5 shrink-0", target === current ? "opacity-100" : "opacity-0")} />
            <span className="min-w-0">
              <span className="block text-ui">{REVIEW_TARGET_LABEL[target]}{marked.includes(target) ? "" : <span className="text-muted-foreground"> · not on this card</span>}</span>
              <span className="block text-ui-sm text-muted-foreground">{TARGET_HINT[target]}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The back of the card, under a rule, the way a flipped card reads. */
function Back({ answer, checked, typed }: { answer: string; checked: ReviewGradeResult | null; typed: string }) {
  const verdict = checked?.grade.verdict;
  return (
    <div className="mt-6 border-t border-dashed border-border pt-5">
      {checked && (
        <div className="mb-4 rounded-lg bg-[var(--color-background-elevated-secondary)] px-3 py-2">
          <p className="whitespace-pre-wrap text-ui-sm text-muted-foreground">{typed}</p>
          <p className="mt-1.5 text-ui">
            <span className={cn("font-medium", verdict === "correct" ? "text-[var(--success)]" : verdict === "partial" ? "text-[var(--warning)]" : "text-destructive")}>
              {verdict === "correct" ? "Right." : verdict === "partial" ? "Partly." : "Not quite."}
            </span>{" "}
            <span className="text-foreground/85">{checked.grade.feedback}</span>
          </p>
          {checked.capReason && <p className="mt-1 text-ui-sm text-[var(--warning)]">{checked.capReason}</p>}
        </div>
      )}
      <Markdown className="text-content leading-[1.65] text-foreground/90 [&_pre]:text-[0.8rem]" source={answer} />
    </div>
  );
}

function Grades({ intervals, checked, filing, onGrade }: { intervals: ReviewIntervalPreview; checked: ReviewGradeResult | null; filing: FsrsRating | null; onGrade(rating: FsrsRating): void }) {
  const suggested = checked?.suggestedRating ?? 3;
  return (
    <div className="grid grid-cols-4 gap-2">
      {RATINGS.map((rating) => {
        const name = RATING_LABEL[rating];
        const days = intervals[name.toLowerCase() as "again" | "hard" | "good" | "easy"].days;
        return (
          <button
            className={cn(
              "group flex h-12 flex-col items-center justify-center rounded-lg border transition-colors disabled:opacity-60",
              rating === suggested ? "border-foreground/25 bg-accent" : "border-border hover:bg-accent/60",
            )}
            disabled={filing !== null}
            key={rating}
            onClick={() => onGrade(rating)}
            type="button"
          >
            <span className={cn("flex items-center gap-1 text-ui font-medium", RATING_TONE[rating])}>
              {filing === rating && <Loader2 className="size-3 animate-spin" />}
              {name}
            </span>
            <span className="text-ui-sm tabular-nums text-muted-foreground">
              {intervalLabel(days)} <kbd className="ml-0.5 font-sans text-[10px] opacity-50">{rating}</kbd>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Finished({ count }: { count: number }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center">
      <span className="grid size-9 place-items-center rounded-full bg-[var(--success)]/12 text-[var(--success)]"><Check className="size-4" /></span>
      <p className="text-content font-medium">{count ? `${count} card${count === 1 ? "" : "s"} reviewed` : "Nothing reviewed"}</p>
      <p className="text-ui text-muted-foreground">Each one comes back just before you'd forget it.</p>
      <DialogPrimitive.Close asChild>
        <Button className="mt-2" variant="outline">Done</Button>
      </DialogPrimitive.Close>
    </div>
  );
}
