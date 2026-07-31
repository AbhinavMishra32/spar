import { z } from "zod";
import { languageSchema, pedagogicalActionSchema } from "./model.js";

export const questionDesignSchema = z.object({
  title: z.string().min(3),
  language: languageSchema,
  kind: z.enum(["function", "module", "repair", "extension", "repository"]),
  statement: z.string().min(30),
  starterFiles: z.record(z.string()),
  referenceFiles: z.record(z.string()),
  visibleTests: z.record(z.string()),
  hiddenTests: z.record(z.string()),
  knownIncorrectFiles: z.array(z.record(z.string())).min(1),
  runCommand: z.string().min(1),
  accidentalDifficulty: z.array(z.string()),
  expectedFailureSignatures: z.array(z.string())
});
export type QuestionDesign = z.infer<typeof questionDesignSchema>;

export const attemptEvaluationSchema = z.object({
  outcome: z.enum(["passed", "partial", "failed", "abandoned"]),
  counterexamples: z.array(z.object({ input: z.string(), expected: z.string(), actual: z.string() })),
  explanation: z.string(),
  doneWell: z.array(z.string()),
  evidence: z.array(z.string()),
  proposedAbilityMarkdown: z.string(),
  nextAction: pedagogicalActionSchema,
  nextActionReason: z.string()
});
export type AttemptEvaluation = z.infer<typeof attemptEvaluationSchema>;

export const trainingToolNames = [
  "search_learner_model", "read_ability", "search_attempt_history", "read_attempt",
  "read_session", "read_concept_graph", "ask_learner", "set_session_objective",
  "set_training_target", "create_question", "inspect_current_attempt", "evaluate_attempt",
  "propose_ability_update", "commit_session_decision"
] as const;
export type TrainingToolName = typeof trainingToolNames[number];
