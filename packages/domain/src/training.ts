import { z } from "zod";
import { languageSchema, pedagogicalActionSchema } from "./model.js";

export const questionDesignSchema = z.object({
  title: z.string().min(3),
  language: languageSchema,
  kind: z.enum(["function", "module", "repair", "extension", "repository"]),
  difficulty: z.enum(["foundation", "developing", "proficient", "advanced"]).optional(),
  /**
   * Whether explaining asymptotic time and auxiliary space is part of this
   * challenge's learning contract.
   *
   * This is authored explicitly instead of inferred from `kind`: a function can
   * be an algorithm exercise or an API exercise, and a repository task can still
   * be about scaling behaviour. Optional keeps challenges saved before this
   * capability existed readable; only an explicit `true` opens the checkpoint.
   */
  requiresComplexityAnalysis: z.boolean().optional(),
  statement: z.string().min(30),
  /**
   * How the solution has to be written, when the agent has a reason to insist.
   *
   * Passing the tests is evidence that the output is right and nothing more. A
   * learner practising sliding windows who passes with a nested loop, or
   * practising recursion who passes with a stdlib call, has produced a correct
   * answer to a question nobody asked — and the ability document written from
   * that attempt records a skill they did not use. So the agent may state the
   * terms up front: linear time, one pass, no sort, recursive, no library for
   * the part being taught. They are shown to the learner with the problem,
   * because a constraint discovered at review time is a trick, and they are
   * checked after the tests pass rather than by the tests, because "wrote it
   * the intended way" is a judgement about code and not something an assertion
   * can decide.
   */
  solutionRequirements: z.array(z.string().min(4).max(160)).max(4).optional(),
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

/** The checkpoint exists only at the intersection of challenge intent and the
 * learner's global preference. Kept as one policy function so submit, restore,
 * review, and acknowledgement cannot quietly acquire different rules. */
export function challengeRequiresComplexityCheckpoint(
  design: Pick<QuestionDesign, "requiresComplexityAnalysis">,
  settingEnabled: boolean,
): boolean {
  return settingEnabled && design.requiresComplexityAnalysis === true;
}

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
  "read_session", "read_concept_graph", "search_concept_evidence", "ask_user_question", "set_session_objective",
  "set_training_target", "create_question", "inspect_current_attempt", "evaluate_attempt",
  "propose_ability_update", "commit_session_decision"
] as const;
export type TrainingToolName = typeof trainingToolNames[number];
