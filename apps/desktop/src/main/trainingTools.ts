import { randomUUID } from "node:crypto";
import { compileQuestion } from "@spar/training";
import type { AskUserQuestionInput } from "@spar/domain";
import type { LocalStore } from "./store.js";
import type { UtilityClient } from "./utilityClient.js";
import type { WorkspaceService } from "./workspaces.js";

export async function executeTrainingTool(
  name: string,
  input: unknown,
  sessionId: string | undefined,
  local: LocalStore,
  workspaces: WorkspaceService,
  runner: UtilityClient,
) {
  if (!sessionId) throw new Error("Training tool call is missing its session context");
  const value = input as Record<string, unknown>;
  if (name === "read_session") return local.readSession(String(value.sessionId));
  if (name === "search_learner_model") return { passages: local.searchLearner(String(value.query ?? ""), Number(value.limit ?? 4)) };
  if (name === "search_attempt_history") return { attempts: local.searchAttempts(String(value.query ?? ""), Number(value.limit ?? 5)) };
  if (name === "read_concept_graph") return { nodes: [], bounded: true, note: "The reusable concept graph has no matching persisted nodes yet." };
  if (name === "set_session_objective") return { committed: true, ...local.setObjective(sessionId, String(value.objective)) };
  if (name === "set_training_target") return { committed: true, ...local.setTrainingTarget(sessionId, value as { ability: string; specificGap: string; desiredEvidence: string; avoidTesting: string[] }) };
  if (name === "commit_session_decision") return { committed: true, ...local.commitDecision(sessionId, value as { action: string; reason: string }) };
  if (name === "ask_user_question") {
    return { pending: true, ...local.setPendingIntake(sessionId, value as AskUserQuestionInput) };
  }
  if (name === "create_question") {
    const activeQuestion = local.readSession(sessionId)?.question;
    if (activeQuestion) {
      return { status: "invalid", report: { valid: false, checks: [{ name: "session lifecycle", passed: false, detail: `A playable challenge (${activeQuestion.title}) is already active for this session. End this agent turn instead of publishing another challenge.` }] } };
    }
    const proposedTitle = String(value.title ?? "").trim();
    const duplicateTitle = local.readSession(sessionId)?.summary.questionTitles.some((question) => question.title.trim().toLocaleLowerCase() === proposedTitle.toLocaleLowerCase());
    if (duplicateTitle) return { status: "invalid", report: { valid: false, checks: [{ name: "adaptive progression", passed: false, detail: `A prior question in this session is already titled "${proposedTitle}". Use a different representation and a title that names it.` }] } };
    const compiled = await compileQuestion(input, async (files, _command, limits) => {
      const validationId = randomUUID();
      const root = await workspaces.writeValidation(sessionId, validationId, files);
      try {
        return await runner.request("run", { root, language: String(value.language), command: "test", timeoutMs: limits.timeoutMs }).promise as { exitCode: number; stdout: string; stderr: string; durationMs: number };
      } finally {
        await workspaces.removeValidation(sessionId, validationId);
      }
    });
    if (!compiled.report.valid) return { status: "invalid", report: compiled.report };
    const questionCreatedWhileCompiling = local.readSession(sessionId)?.question;
    if (questionCreatedWhileCompiling) {
      return { status: "invalid", report: { valid: false, checks: [{ name: "session lifecycle", passed: false, detail: `A playable challenge (${questionCreatedWhileCompiling.title}) was published while this candidate compiled. This candidate was discarded.` }] } };
    }
    await workspaces.writeAll(sessionId, { ...compiled.design.starterFiles, ...compiled.design.visibleTests });
    const question = local.createQuestion(sessionId, compiled.design, compiled.report);
    return { status: "playable", question, report: compiled.report };
  }
  if (name === "inspect_current_attempt" || name === "read_attempt") return { events: local.readAttempt(String(value.attemptId)) };
  if (name === "evaluate_attempt") return { events: local.readAttempt(String(value.attemptId)) };
  if (name === "read_ability") return { ability: local.readAbility(String(value.abilityId)) };
  if (name === "propose_ability_update") return { committed: true, ...local.updateAbility(value as { abilityId: string; markdown: string; evidenceEventIds: string[] }) };
  throw new Error(`Unsupported Training Agent tool: ${name}`);
}
