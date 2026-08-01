import { z } from "zod";

export const id = z.string().uuid();
export const isoDate = z.string().datetime();
export const languageSchema = z.enum(["javascript", "typescript", "cpp"]);
export type Language = z.infer<typeof languageSchema>;

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
  updatedAt: isoDate
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const workspaceFileEntrySchema = z.object({
  path: z.string().min(1),
  language: z.string().min(1),
  readOnly: z.boolean().default(false)
});

export const activeQuestionSchema = questionSchema.omit({ artifactId: true, visibleTests: true }).extend({
  abilityId: id,
  abilityTitle: z.string().min(1),
  specificGap: z.string().min(1),
  desiredEvidence: z.string().min(1),
  avoidTesting: z.array(z.string()),
  files: z.array(workspaceFileEntrySchema),
  visibleTestFiles: z.array(z.string()),
  attemptId: id,
  latestEventSequence: z.number().int().min(-1)
});
export type ActiveQuestion = z.infer<typeof activeQuestionSchema>;

export const sessionDetailSchema = z.object({
  summary: sessionSummarySchema,
  question: activeQuestionSchema.nullable(),
  checkpoint: z.unknown().nullable(),
  pendingLearnerQuestion: z.string().nullable(),
  messages: z.array(z.object({ id, role: z.enum(["learner", "agent", "system"]), body: z.string(), createdAt: isoDate })),
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
