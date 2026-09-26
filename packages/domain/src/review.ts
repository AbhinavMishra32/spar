import { z } from "zod";
import { conceptTagSchema } from "./concepts.js";
import type { FsrsRating, FsrsRatingName, FsrsState } from "./fsrs.js";

/*
 * Spaced review of what a solve taught, not of the code it produced.
 *
 * When a learner solves a challenge, the agent reads how they got there — the
 * failing runs, the diff that turned them green, whether that change came from
 * them or from something it said — and writes down the idea that did it: the cue
 * in the problem that should have pointed at it, the insight itself, the
 * invariant that keeps it correct, and the mistakes this learner actually made
 * on the way. That record is an insight card.
 *
 * Cards are scheduled with FSRS (see fsrs.ts). A review is never the same
 * question twice: the agent writes a fresh prompt each time, in a format chosen
 * against how well the card is held, and grades the free-text answer against the
 * card's rubric. So what is rehearsed is recognising and applying the pattern,
 * which is the thing that transfers, rather than recalling one answer.
 */

export const reviewFormatSchema = z.enum([
  /** A new problem statement that needs the same idea: which approach, and why. */
  "recognize",
  /** State the invariant, or the condition the loop maintains, from memory. */
  "invariant",
  /** A short version of their own earlier wrong code: find and explain the bug. */
  "spot-the-bug",
  /** A changed constraint: does the idea still hold, and what changes? */
  "what-if",
  /** Why does the naive approach fail, or why is this step needed? */
  "explain-why",
  /** Write the heart of the solution — the loop, the recurrence — from memory. */
  "sketch",
  /** Solve the original challenge again, from a blank file. */
  "resolve",
]);
export type ReviewFormat = z.infer<typeof reviewFormatSchema>;

export const REVIEW_FORMAT_LABEL: Record<ReviewFormat, string> = {
  recognize: "Recognise the pattern",
  invariant: "State the invariant",
  "spot-the-bug": "Spot the bug",
  "what-if": "What if…",
  "explain-why": "Explain why",
  sketch: "Sketch it",
  resolve: "Solve it again",
};

/*
 * What a review is about. A solve teaches more than the moment it turned: there
 * is the problem itself, the pattern it is an instance of, the concept that
 * makes the pattern work, the turn that got this learner unstuck, and the mistake
 * they kept making. A card holds the ones worth keeping — the agent picks them,
 * or asks the learner — and each review rehearses one of them, so "remember this
 * question" and "remember why the window slides" are both things a card can do.
 */
export const reviewTargetSchema = z.enum([
  /** This exact challenge: its statement, its approach, its edge cases. */
  "problem",
  /** The reusable technique, and how to spot a problem that wants it. */
  "pattern",
  /** The underlying idea — the invariant or property — that makes it correct. */
  "concept",
  /** What changed between stuck and solved for this learner. */
  "turning-point",
  /** The mistakes this learner made, and how to not make them again. */
  "pitfall",
]);
export type ReviewTarget = z.infer<typeof reviewTargetSchema>;

export const REVIEW_TARGETS = reviewTargetSchema.options;

export const REVIEW_TARGET_LABEL: Record<ReviewTarget, string> = {
  problem: "The problem",
  pattern: "The pattern",
  concept: "The concept",
  "turning-point": "What made it click",
  pitfall: "The mistake",
};

/** Cards filed before targets existed rehearsed the turn and the pattern. */
export const DEFAULT_REVIEW_TARGETS: ReviewTarget[] = ["turning-point", "pattern"];

/** The formats that exercise each target. A review's format is chosen from this
 *  intersected with the band the card's memory allows. */
export const REVIEW_TARGET_FORMATS: Record<ReviewTarget, ReviewFormat[]> = {
  problem: ["resolve", "sketch", "explain-why", "what-if"],
  pattern: ["recognize", "what-if", "sketch"],
  concept: ["invariant", "explain-why", "what-if"],
  "turning-point": ["explain-why", "spot-the-bug", "invariant", "sketch"],
  pitfall: ["spot-the-bug", "explain-why"],
};

export const insightIndependenceSchema = z.enum(["independent", "assisted", "unknown"]);
export type InsightIndependence = z.infer<typeof insightIndependenceSchema>;

export const insightPitfallSchema = z.object({
  mistake: z.string().min(4).max(240),
  fix: z.string().min(4).max(240),
});

export const insightClickSchema = z.object({
  /** What changed between stuck and solved, in the learner's terms. */
  summary: z.string().min(8).max(500),
  /** The run that turned it, as `read_attempt` numbers runs. */
  runOrdinal: z.number().int().min(1).nullable(),
  /** The lines that did it, when the agent quoted them from the diff. */
  diff: z.string().max(1_600).nullable(),
});

export const reviewSourceSchema = z.enum(["solve", "recall", "resolve", "implicit"]);
export type ReviewSource = z.infer<typeof reviewSourceSchema>;

export const reviewCardSchema = z.object({
  id: z.string().uuid(),
  questionId: z.string().uuid(),
  questionTitle: z.string(),
  sessionId: z.string().uuid(),
  attemptId: z.string().uuid().nullable(),
  title: z.string(),
  trigger: z.string(),
  insight: z.string(),
  invariant: z.string().nullable(),
  click: insightClickSchema,
  independence: insightIndependenceSchema,
  pitfalls: z.array(insightPitfallSchema),
  rubric: z.array(z.string()),
  transfer: z.array(z.string()),
  concepts: z.array(conceptTagSchema),
  /** What this card rehearses. Never empty. */
  targets: z.array(reviewTargetSchema).min(1),
  /** What the learner said they want to remember from this problem, in their
   *  words, when they were asked. Reviews aim at it. */
  remember: z.string().nullable().optional(),
  state: z.enum(["new", "review", "relearning"]),
  stability: z.number(),
  difficulty: z.number(),
  dueAt: z.string(),
  lastReviewAt: z.string().nullable(),
  reps: z.number().int(),
  lapses: z.number().int(),
  /** Chance of recall now, 0–1, from the forgetting curve. */
  retrievability: z.number(),
  suspended: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReviewCard = z.infer<typeof reviewCardSchema>;

export const reviewLogSchema = z.object({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  reviewedAt: z.string(),
  source: reviewSourceSchema,
  format: reviewFormatSchema.nullable(),
  target: reviewTargetSchema.nullable(),
  /** The grade the schedule used. */
  rating: z.number().int().min(1).max(4),
  /** What the grader proposed, when a learner then chose differently. */
  suggestedRating: z.number().int().min(1).max(4).nullable(),
  prompt: z.string().nullable(),
  answer: z.string().nullable(),
  feedback: z.string().nullable(),
  elapsedDays: z.number(),
  scheduledDays: z.number(),
  retrievability: z.number(),
  stabilityBefore: z.number(),
  stabilityAfter: z.number(),
  difficultyAfter: z.number(),
});
export type ReviewLog = z.infer<typeof reviewLogSchema>;

/** What the agent writes for one review: the front of a card and its back.
 *  Neither `answer` nor `expected` reaches the learner before they flip it;
 *  `expected` is also the grader's reference for a typed answer. */
export const reviewPromptSchema = z.object({
  format: reviewFormatSchema,
  /** Chosen by the host before the question is written; absent on prompts
   *  saved before targets existed. */
  target: reviewTargetSchema.optional(),
  /** The question, as markdown. May carry a fenced code block. */
  prompt: z.string().min(10).max(4_000),
  /** The back of the card: what a good answer says, short enough to take in at
   *  a glance. Absent on prompts written before cards had backs. */
  answer: z.string().min(3).max(1_500).optional(),
  /** One nudge the learner can ask to see. Asking caps the grade at Hard. */
  cue: z.string().min(4).max(400).nullable(),
  /** What a complete answer contains, point by point. */
  expected: z.array(z.string().min(3).max(300)).min(1).max(6),
});
export type ReviewPrompt = z.infer<typeof reviewPromptSchema>;

export const reviewPendingSchema = reviewPromptSchema.omit({ expected: true, answer: true }).extend({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  createdAt: z.string(),
});
export type ReviewPending = z.infer<typeof reviewPendingSchema>;

export const reviewGradeSchema = z.object({
  verdict: z.enum(["correct", "partial", "incorrect"]),
  rating: z.number().int().min(1).max(4),
  hits: z.array(z.string().max(300)).max(6),
  misses: z.array(z.string().max(300)).max(6),
  /** Written to the learner: what held, what did not, one thing to keep. */
  feedback: z.string().min(4).max(1_200),
  /** A wrong belief the answer revealed, if it revealed one. */
  misconception: z.string().max(300).nullable(),
});
export type ReviewGrade = z.infer<typeof reviewGradeSchema>;

export type ReviewIntervalPreview = Record<FsrsRatingName, { days: number; dueAt: string }>;

/** A graded answer, before the learner confirms the grade it will be filed with. */
export type ReviewGradeResult = {
  pendingId: string;
  cardId: string;
  grade: ReviewGrade;
  /** The grader's rating after the host's caps (cue used, "I don't know"). */
  suggestedRating: FsrsRating;
  capReason: string | null;
  intervals: ReviewIntervalPreview;
  card: ReviewCard;
};

/** The back of a card, once flipped, and what each grade would schedule. */
export type ReviewReveal = { answer: string; intervals: ReviewIntervalPreview };

export type ReviewScheduleEntry = {
  cardId: string;
  title: string;
  state: FsrsState;
  dueAt: string;
  lastReviewAt: string | null;
  reps: number;
  lapses: number;
  retrievability: number;
  createdAt: string;
  suspended: boolean;
};

export type ReviewOverview = {
  totalCards: number;
  /** Due now. */
  dueCount: number;
  /** Due before the end of the learner's local day. */
  dueTodayCount: number;
  /** Mean retrievability across active cards, 0–1; null with no cards. */
  retention: number | null;
  nextDueAt: string | null;
  /** How many cards come due on each of the next fourteen days, today first. */
  upcoming: Array<{ date: string; count: number }>;
  /** Reviews done today, by local day. */
  reviewedToday: number;
  streakDays: number;
  byQuestion: Record<string, ReviewScheduleEntry>;
};

export type ReviewCardDetail = { card: ReviewCard; logs: ReviewLog[]; intervals: ReviewIntervalPreview };
