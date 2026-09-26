import type { FsrsRating, ReviewCard, ReviewGrade, ReviewGradeResult, ReviewPending, ReviewPrompt, ReviewReveal, ReviewTarget } from "@spar/domain";
import type { LocalStore } from "./store.js";
import type { ReviewTargetMode } from "../shared/api.js";
import type { UtilityClient } from "./utilityClient.js";
import { isBlankAnswer, pickReviewTarget, reviewFormats, type ReviewGradeRequest, type ReviewPromptRequest } from "../workers/reviewAgent.js";

/*
 * A spaced review, end to end, on the main-process side.
 *
 * The shape is Anki's. A card comes due; the agent writes a fresh front and
 * back for it; the learner recalls the answer, flips the card and grades
 * themselves Again / Hard / Good / Easy, seeing what each would schedule. Typing
 * an answer is optional: when they do, the agent checks it against the card and
 * proposes a grade, and the learner still confirms or overrides it. Only then
 * does the schedule move. Leaving a review part-way files nothing.
 */

type ProviderResolver = () => Promise<unknown[]>;

const DAY_MS = 86_400_000;

export class ReviewService {
  constructor(private readonly deps: { store: LocalStore; agent: UtilityClient; providers: ProviderResolver }) {}

  /**
   * The question waiting on this card, or a fresh one written now.
   *
   * `target` is the learner choosing what to recall this time — any of the five,
   * not only the card's own, since wanting to remember the problem itself is a
   * good enough reason to be asked about it. Left out, the card's target gone
   * longest without a review is used. A waiting question on a different target
   * is replaced rather than handed back.
   */
  async start(cardId: string, fresh = false, target?: ReviewTarget): Promise<ReviewPending> {
    const store = this.deps.store;
    const card = store.reviews.card(cardId);
    if (!card) throw new Error("That review card no longer exists.");
    if (!fresh) {
      const open = store.reviews.openPrompt(cardId);
      if (open && (!target || open.target === target)) return open;
    }
    const request = this.promptRequest(card, target);
    const prompt = await this.firstProvider<{ prompt: ReviewPrompt }>("review-prompt", request);
    return store.reviews.savePrompt(cardId, { ...prompt.prompt, target: request.target });
  }

  cue(promptId: string): string | null {
    return this.deps.store.reviews.revealCue(promptId);
  }

  /** Flip the card: its back, and what each grade would schedule. */
  reveal(promptId: string): ReviewReveal {
    const store = this.deps.store;
    const found = store.reviews.prompt(promptId);
    if (!found || found.row.closed_at) throw new Error("That review question is no longer open.");
    const card = store.reviews.card(found.row.card_id);
    if (!card) throw new Error("That review card no longer exists.");
    return { answer: store.reviews.revealAnswer(promptId) ?? "", intervals: store.reviews.intervals(card) };
  }

  /** Walk away from a review. Nothing is filed and the card stays due. */
  abandon(promptId: string) {
    this.deps.store.reviews.abandonPrompt(promptId);
  }

  /**
   * Grade an answer, without filing it.
   *
   * Two caps are the host's, not the grader's: asking for the cue means the
   * idea did not come unaided, so the grade is at most Hard; and an answer that
   * is a way of saying "I don't remember" is Again without a model call.
   */
  async answer(promptId: string, answer: string): Promise<ReviewGradeResult> {
    const store = this.deps.store;
    const found = store.reviews.prompt(promptId);
    if (!found) throw new Error("That review question is no longer open.");
    if (found.row.closed_at) throw new Error("That review has already been filed.");
    const card = store.reviews.card(found.row.card_id);
    if (!card) throw new Error("That review card no longer exists.");
    const text = answer.trim().slice(0, 8_000);
    const cueShown = found.row.cue_shown === 1;
    let grade: ReviewGrade;
    if (isBlankAnswer(text)) {
      grade = { verdict: "incorrect", rating: 1, hits: [], misses: [], feedback: "That's what the review is for — read the answer and it comes back sooner.", misconception: null };
    } else {
      const request: ReviewGradeRequest = {
        ...(found.prompt.target ? { target: found.prompt.target } : {}),
        card: { title: card.title, trigger: card.trigger, insight: card.insight, invariant: card.invariant, pitfalls: card.pitfalls, rubric: card.rubric },
        prompt: found.prompt,
        answer: text,
        cueShown,
      };
      grade = (await this.firstProvider<{ grade: ReviewGrade }>("review-grade", request)).grade;
    }
    const { rating, capReason } = cappedRating(grade.rating as FsrsRating, cueShown);
    store.reviews.saveGrade(promptId, text, grade, rating);
    return { pendingId: promptId, cardId: card.id, grade, suggestedRating: rating, capReason, intervals: store.reviews.intervals(card), card };
  }

  /** File a review with the rating the learner chose: after a checked answer,
   *  or after flipping the card and grading themselves. */
  commit(promptId: string, rating: FsrsRating) {
    const store = this.deps.store;
    const found = store.reviews.prompt(promptId);
    if (!found) throw new Error("That review question is no longer open.");
    if (found.row.closed_at) throw new Error("That review has already been filed.");
    const graded = store.reviews.gradeFor(promptId);
    if (!graded && !found.row.revealed_at) throw new Error("Flip the card before grading it.");
    const result = store.reviews.review(found.row.card_id, rating, {
      source: "recall", format: found.prompt.format, target: found.prompt.target ?? null, prompt: found.prompt.prompt, answer: graded?.answer ?? null,
      feedback: graded?.grade.feedback ?? null, grade: graded?.grade ?? null, suggestedRating: graded?.suggestedRating ?? null, promptId,
    });
    return { ...result, overview: store.reviews.overview() };
  }

  /** A challenge solved again from a blank file, graded from how it went. */
  resolve(input: { cardId: string; promptId?: string | undefined; passed: boolean; checks: number; elapsedMs: number }) {
    const store = this.deps.store;
    const card = store.reviews.card(input.cardId);
    if (!card) throw new Error("That review card no longer exists.");
    const rating = resolveRating(input);
    const minutes = Math.max(1, Math.round(input.elapsedMs / 60_000));
    const feedback = input.passed
      ? `Solved again in about ${minutes} minute${minutes === 1 ? "" : "s"}, ${input.checks <= 1 ? "on the first check" : `after ${input.checks} checks`}.`
      : "Did not get it back this time — the card comes round again tomorrow.";
    const result = store.reviews.review(card.id, rating, {
      source: "resolve", format: "resolve", target: "problem", prompt: `Solve "${card.questionTitle}" again from a blank file.`, answer: null,
      feedback, grade: null, suggestedRating: null, ...(input.promptId ? { promptId: input.promptId } : {}),
    });
    return { ...result, overview: store.reviews.overview() };
  }

  private promptRequest(card: ReviewCard, chosen?: ReviewTarget): ReviewPromptRequest {
    const store = this.deps.store;
    const now = Date.now();
    const record = store.challengeRecord(card.questionId);
    const trackId = store.trackIdForSession(card.sessionId);
    const words = new Set(`${card.title} ${card.insight} ${card.concepts.map((tag) => `${tag.slug} ${tag.title}`).join(" ")}`.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));
    const openPatterns = store.listPatterns(trackId).filter((pattern) => pattern.status !== "resolved")
      .map((pattern) => ({ pattern, overlap: `${pattern.title} ${pattern.description}`.toLowerCase().split(/[^a-z0-9]+/).filter((word) => words.has(word)).length }))
      .sort((left, right) => right.overlap - left.overlap)
      .slice(0, 4)
      .map(({ pattern }) => ({ title: pattern.title, description: pattern.description }));
    const history = store.reviews.recentLogs(card.id).map((log) => ({ format: log.format, target: log.target, rating: log.rating, daysAgo: Math.round((now - Date.parse(log.reviewedAt)) / DAY_MS), feedback: log.feedback }));
    const memory = {
      stabilityDays: Math.round(card.stability * 10) / 10,
      recallChance: Math.round(card.retrievability * 100) / 100,
      reps: card.reps,
      lapses: card.lapses,
      daysSinceLastReview: card.lastReviewAt ? Math.round((now - Date.parse(card.lastReviewAt)) / DAY_MS) : null,
    };
    const profile = store.getProfile();
    const target = chosen ?? pickReviewTarget(card.targets, history);
    return {
      card: {
        title: card.title, challenge: card.questionTitle, trigger: card.trigger, insight: card.insight, invariant: card.invariant,
        click: card.click.summary, independence: card.independence,
        ...(card.remember ? { remember: card.remember } : {}), pitfalls: card.pitfalls, rubric: card.rubric, transfer: card.transfer,
        concepts: card.concepts.map((tag) => tag.title),
        ...(target === "problem" && record ? { statement: record.design.statement.slice(0, 4_000) } : {}),
      },
      target,
      memory,
      history,
      learner: { language: record?.design.language ?? profile?.language ?? "python", experience: profile?.experience ?? "working", openPatterns },
      formats: reviewFormats(memory, history, target),
    };
  }

  /** The same failover every other model call in Spar uses: the next provider
   *  gets the request when the first one fails. */
  private async firstProvider<T>(method: "review-prompt" | "review-grade", payload: object): Promise<T> {
    const providers = await this.deps.providers();
    if (!providers.length) throw new Error("Connect a model provider in Settings before starting a review");
    let failure: unknown;
    for (const provider of providers) {
      try {
        return await this.deps.agent.request(method, { ...payload, provider }).promise as T;
      } catch (error) {
        failure = error;
      }
    }
    throw failure instanceof Error ? failure : new Error("Spar could not reach a model for this review.");
  }
}

/** Where the learner's choice lives: whether the agent decides what a new card
 *  rehearses, or asks them what they want to remember from the problem. */
export const REVIEW_TARGET_MODE_KEY = "review-targets-mode";

export function reviewTargetMode(store: Pick<LocalStore, "getSetting">): ReviewTargetMode {
  return store.getSetting<string>(REVIEW_TARGET_MODE_KEY, "auto") === "ask" ? "ask" : "auto";
}

/** Asking for the cue caps the grade at Hard. */
export function cappedRating(rating: FsrsRating, cueShown: boolean): { rating: FsrsRating; capReason: string | null } {
  if (cueShown && rating > 2) return { rating: 2, capReason: "You opened the nudge, so this counts as Hard at best." };
  return { rating, capReason: null };
}

/**
 * A re-solve, graded from its signals.
 *
 * The thresholds are fixed rules rather than a judgement so the same re-solve is
 * always the same grade, which is what FSRS assumes a grade is. Giving up or
 * failing is Again. Passing on the first check inside fifteen minutes is Easy;
 * passing after three or more checks, or after forty minutes, is Hard; anything
 * between is Good.
 */
export function resolveRating(input: { passed: boolean; checks: number; elapsedMs: number }): FsrsRating {
  if (!input.passed) return 1;
  const minutes = input.elapsedMs / 60_000;
  if (input.checks >= 3 || minutes > 40) return 2;
  if (input.checks <= 1 && minutes <= 15) return 4;
  return 3;
}
