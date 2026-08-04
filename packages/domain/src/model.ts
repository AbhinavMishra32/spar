import { z } from "zod";
import { conceptTagSchema } from "./concepts.js";

export const id = z.string().uuid();
export const isoDate = z.string().datetime();
export const languageSchema = z.enum(["javascript", "typescript", "cpp"]);
export type Language = z.infer<typeof languageSchema>;

/** What the learner told Spar about themselves at onboarding.
 *  `language` is the default every new session starts in — a default, not a
 *  constraint: naming another language in a goal still wins. */
export const learnerProfileSchema = z.object({
  name: z.string().min(1).max(60),
  experience: z.enum(["new", "working", "senior"]),
  focus: z.array(z.string().min(1)).max(12).default([]),
  weakness: z.string().max(600).default(""),
  language: languageSchema,
  completedAt: isoDate,
});
export type LearnerProfile = z.infer<typeof learnerProfileSchema>;

/** A sparring session Spar offers before the learner has written a goal of their
 *  own. `goal` is what actually starts the session, so it has to read like
 *  something the learner said; `why` names the intake answer it came from. */
export const sessionSuggestionSchema = z.object({
  title: z.string().min(3).max(70),
  goal: z.string().min(10).max(400),
  why: z.string().min(3).max(160),
});
export type SessionSuggestion = z.infer<typeof sessionSuggestionSchema>;

export const sessionStatusSchema = z.enum(["planning", "active", "paused", "completed"]);
// "abandoned" is a learner decision, kept distinct from "invalid" (failed
// validation) and "completed" (evaluated) so evidence stays honest about why a
// challenge ended.
export const questionStatusSchema = z.enum(["generating", "validating", "playable", "active", "completed", "invalid", "abandoned"]);
export const pedagogicalActionSchema = z.enum(["diagnose", "teach", "practise", "transfer", "advance", "retain"]);

export const trainingTargetSchema = z.object({
  id,
  sessionId: id,
  abilityId: id,
  abilityTitle: z.string().min(1),
  specificGap: z.string().min(1),
  desiredEvidence: z.string().min(1),
  avoidTesting: z.array(z.string()).default([]),
  action: pedagogicalActionSchema,
  createdAt: isoDate
});
export type TrainingTarget = z.infer<typeof trainingTargetSchema>;

export const questionSchema = z.object({
  id,
  sessionId: id,
  trainingTargetId: id,
  ordinal: z.number().int().positive(),
  title: z.string().min(1),
  statement: z.string().min(1),
  language: languageSchema,
  kind: z.enum(["function", "module", "repair", "extension", "repository"]),
  status: questionStatusSchema,
  difficulty: z.enum(["foundation", "developing", "proficient", "advanced"]),
  visibleTests: z.array(z.string()),
  artifactId: id,
  createdAt: isoDate
});
export type Question = z.infer<typeof questionSchema>;

export const sessionSummarySchema = z.object({
  id,
  title: z.string().min(1),
  originalGoal: z.string().min(1),
  objective: z.string(),
  status: sessionStatusSchema,
  currentFocus: z.array(z.string()),
  completedQuestions: z.number().int().nonnegative(),
  activeQuestion: z.object({ id, title: z.string(), ordinal: z.number().int() }).nullable(),
  questionTitles: z.array(z.object({ id, title: z.string(), status: questionStatusSchema })),
  totalSeconds: z.number().int().nonnegative(),
  updatedAt: isoDate,
  /** How the learner filed this session. Both are shelf position rather than
   *  learning state, so neither is evidence and neither touches `updatedAt`. */
  pinnedAt: isoDate.nullable(),
  archivedAt: isoDate.nullable()
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const workspaceFileEntrySchema = z.object({
  path: z.string().min(1),
  language: z.string().min(1),
  readOnly: z.boolean().default(false)
});

export const activeQuestionSchema = questionSchema.omit({ artifactId: true, visibleTests: true }).extend({
  replacesQuestionId: id.nullable(),
  abilityId: id,
  abilityTitle: z.string().min(1),
  specificGap: z.string().min(1),
  desiredEvidence: z.string().min(1),
  avoidTesting: z.array(z.string()),
  files: z.array(workspaceFileEntrySchema),
  visibleTestFiles: z.array(z.string()),
  /** What this challenge is training, so the learner can see it while they work
   *  rather than only afterwards in history. */
  concepts: z.array(conceptTagSchema),
  attemptId: id,
  /** When the clock started. The learner sees it running while they work, and it
   *  is the zero every offset in a solve replay is measured from. */
  attemptStartedAt: isoDate,
  /** Set once the attempt is graded or given up on, which is what stops the
   *  timer — work after this point is still recorded, but it is practice. */
  attemptCompletedAt: isoDate.nullable(),
  latestEventSequence: z.number().int().min(-1)
});
export type ActiveQuestion = z.infer<typeof activeQuestionSchema>;

/** The few lines of the challenge's own starter file that a history card shows.
 *  Enough to recognise the shape of the problem without opening it, and the
 *  starter rather than the tests, because the starter is what you would write.
 *
 *  Fetched as its own map keyed by challenge id rather than carried on the
 *  history row: the row is read on every bootstrap and a code excerpt per
 *  challenge is a lot of payload for a list that may never be opened. */
export const challengeCodePreviewSchema = z.object({
  path: z.string().min(1),
  language: z.string().min(1),
  code: z.string(),
  /** Lines the preview left behind, so a card can say the file keeps going. */
  remainingLines: z.number().int().nonnegative(),
});
export type ChallengeCodePreview = z.infer<typeof challengeCodePreviewSchema>;

export const challengeHistorySummarySchema = z.object({
  id,
  sessionId: id,
  sessionTitle: z.string().min(1),
  ordinal: z.number().int().positive(),
  title: z.string().min(1),
  language: languageSchema,
  difficulty: z.enum(["foundation", "developing", "proficient", "advanced"]),
  status: questionStatusSchema,
  replacesQuestionId: id.nullable(),
  replacesQuestionTitle: z.string().nullable(),
  replacedByQuestionId: id.nullable(),
  replacedByQuestionTitle: z.string().nullable(),
  attemptCount: z.number().int().nonnegative(),
  testRunCount: z.number().int().nonnegative(),
  lastOutcome: z.enum(["passed", "failed", "abandoned", "replaced"]).nullable(),
  /** What this challenge was about. Ordered primary first, so a row that only has
   *  room for one chip shows the one the challenge was actually aimed at. */
  concepts: z.array(conceptTagSchema),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type ChallengeHistorySummary = z.infer<typeof challengeHistorySummarySchema>;

/** One file of a challenge as the practice page mounts it. `content` is whatever
 *  is on the practice sandbox's disk: the learner's own edit once they have made
 *  one, and the generated file until then. */
export const challengeFileSchema = z.object({
  path: z.string().min(1),
  language: z.string().min(1),
  role: z.enum(["solution", "test"]),
  readOnly: z.boolean(),
  content: z.string(),
});
export type ChallengeFile = z.infer<typeof challengeFileSchema>;

/** One thing that happened while this challenge was open, flattened across every
 *  attempt at it so the detail page can draw a single timeline. */
export const challengeTimelineEntrySchema = z.object({
  id,
  attemptOrdinal: z.number().int().positive(),
  type: z.string().min(1),
  source: z.string().min(1),
  occurredAt: isoDate,
  /** The one line worth reading out of the payload — an outcome, a path, a reason. */
  detail: z.string(),
});
export type ChallengeTimelineEntry = z.infer<typeof challengeTimelineEntrySchema>;

/** Everything the standalone challenge page needs: what the challenge is, the
 *  session and target it came out of, its files, and what happened to it.
 *
 *  This is deliberately not `ActiveQuestion`. A challenge read from history has
 *  no live attempt behind it — practising one records no evidence — so it must
 *  not carry an `attemptId` that would let a caller write against it. */
export const challengeDetailSchema = z.object({
  summary: challengeHistorySummarySchema,
  statement: z.string(),
  kind: questionSchema.shape.kind,
  sessionGoal: z.string(),
  sessionStatus: sessionStatusSchema,
  abilityTitle: z.string(),
  specificGap: z.string(),
  desiredEvidence: z.string(),
  action: pedagogicalActionSchema.nullable(),
  files: z.array(challengeFileSchema),
  /** Cases the learner cannot read. Checking runs them; practising never does. */
  hiddenTestCount: z.number().int().nonnegative(),
  /** Whether the practice sandbox holds edits, so the page can offer a reset. */
  practiceEdited: z.boolean(),
  timeline: z.array(challengeTimelineEntrySchema),
});
export type ChallengeDetail = z.infer<typeof challengeDetailSchema>;

export const abilityStatusSchema = z.enum(["uncertain", "developing", "independent", "stale"]);
export type AbilityStatus = z.infer<typeof abilityStatusSchema>;

export const abilityHistorySummarySchema = z.object({
  id,
  title: z.string().min(1),
  markdown: z.string(),
  /** One line the learner reads first: what they can now do. The markdown is the
   *  agent's working document; this is the claim it supports. */
  summary: z.string(),
  version: z.number().int().positive(),
  status: abilityStatusSchema,
  evidenceCount: z.number().int().nonnegative(),
  /** The concepts this ability spans, which is how it reaches challenge history. */
  concepts: z.array(conceptTagSchema),
  /** Drills the agent wrote for going deeper on this specific ability. Each one
   *  starts a session, so they are phrased as the learner's own goal. */
  practice: z.array(z.string()),
  /** When evidence first supported this ability, or null while it is still
   *  forming. An ability with no evidence behind it is a hypothesis, and the UI
   *  is required to say so rather than present it as earned. */
  earnedAt: isoDate.nullable(),
  updatedAt: isoDate,
});
export type AbilityHistorySummary = z.infer<typeof abilityHistorySummarySchema>;

/** Everything the ability's own page shows: the document, the concepts it spans,
 *  and the graded challenges that are the reason it exists. */
export const abilityDetailSchema = z.object({
  ability: abilityHistorySummarySchema,
  evidence: z.array(z.object({
    challengeId: id,
    sessionId: id,
    sessionTitle: z.string(),
    title: z.string(),
    language: languageSchema,
    difficulty: z.enum(["foundation", "developing", "proficient", "advanced"]),
    outcome: z.enum(["passed", "failed", "abandoned", "replaced", "open"]),
    occurredAt: isoDate,
  })),
});
export type AbilityDetail = z.infer<typeof abilityDetailSchema>;

export const askUserQuestionInputSchema = z.object({
  questions: z.array(z.object({
    header: z.string().trim().min(1).max(40),
    question: z.string().trim().min(3).max(1000),
    options: z.array(z.object({ label: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(300) })).min(2).max(3),
    multiple: z.boolean().default(false),
    custom: z.boolean().default(true),
  })).min(1).max(3),
});
export const askUserQuestionRequestSchema = askUserQuestionInputSchema.extend({ id });
export type AskUserQuestionInput = z.infer<typeof askUserQuestionInputSchema>;
export type AskUserQuestionRequest = z.infer<typeof askUserQuestionRequestSchema>;

/**
 * One settled step of agent work, kept with the reply it helped produce.
 *
 * The live stream shows these while a turn runs, and a turn that has ended is
 * still the only account of how its answer was reached — so the steps are stored
 * rather than discarded when the stream closes.
 */
export const agentActivityStepSchema = z.object({
  /** Defaulted for rows written before reasoning was kept, which are all tools.
   *  `note` is a sentence the agent said mid-turn, before one of its calls. */
  kind: z.enum(["tool", "reasoning", "note"]).default("tool"),
  tool: z.string().default(""),
  /** What the call was about, in the learner's terms. Never a raw argument. */
  label: z.string().default(""),
  /** The agent's own name for this step. Empty for rows written before it existed,
   *  which fall back to the fixed per-tool label. */
  actionTitle: z.string().default(""),
  /** What it returned, already reduced to one line by the worker. */
  detail: z.string().default(""),
  ok: z.boolean().default(true),
  /** The reasoning itself, for a step that is thinking rather than a call. */
  text: z.string().default(""),
  /** How long that thinking took, so the folded row can say it. */
  seconds: z.number().nonnegative().default(0),
  /** The call's arguments and what it returned, as formatted JSON, so a turn read
   *  back from storage can be opened up to exactly what it did. Redacted at the
   *  worker before they get here: a challenge design's reference solution and
   *  hidden tests would let the learner read the answer out of the transcript of
   *  the turn that wrote the challenge. Empty for rows written before this. */
  input: z.string().default(""),
  output: z.string().default(""),
});
export type AgentActivityStep = z.infer<typeof agentActivityStepSchema>;

export const sessionDetailSchema = z.object({
  summary: sessionSummarySchema,
  question: activeQuestionSchema.nullable(),
  checkpoint: z.unknown().nullable(),
  pendingLearnerQuestion: askUserQuestionRequestSchema.nullable(),
  messages: z.array(z.object({ id, role: z.enum(["learner", "agent", "system"]), body: z.string(), createdAt: isoDate, activity: z.array(agentActivityStepSchema).default([]) })),
  events: z.array(z.object({ id, sequence: z.number().int(), type: z.string(), occurredAt: isoDate, payload: z.record(z.unknown()), source: z.string() }))
});
export type SessionDetail = z.infer<typeof sessionDetailSchema>;

export const abilityDocumentSchema = z.object({
  id,
  conceptId: id,
  title: z.string().min(1),
  markdown: z.string().min(1),
  version: z.number().int().positive(),
  status: z.enum(["uncertain", "developing", "independent", "stale"]),
  evidenceCount: z.number().int().nonnegative(),
  lastObservedAt: isoDate.nullable(),
  updatedAt: isoDate
});
export type AbilityDocument = z.infer<typeof abilityDocumentSchema>;

export const conceptNodeSchema = z.object({
  id,
  title: z.string(),
  description: z.string(),
  prerequisiteIds: z.array(id),
  relatedIds: z.array(id),
  failureSignatures: z.array(z.string())
});
export type ConceptNode = z.infer<typeof conceptNodeSchema>;
