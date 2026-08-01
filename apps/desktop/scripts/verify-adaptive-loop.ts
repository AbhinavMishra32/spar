import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { app } from "electron";
import keytar from "keytar";
import type { AttemptEvent, QuestionDesign } from "@spar/domain";
import { LocalStore } from "../src/main/store.js";
import { executeTrainingTool } from "../src/main/trainingTools.js";
import { UtilityClient } from "../src/main/utilityClient.js";
import { WorkspaceService } from "../src/main/workspaces.js";

console.log("ADAPTIVE_E2E_BOOT");
const launch = () => void verify().catch((error) => { console.error(`ADAPTIVE_E2E_ERROR ${error instanceof Error ? error.stack ?? error.message : String(error)}`); app.exit(1); });
if (app.isReady()) launch();
else app.once("ready", launch);

async function verify() {
  const root = await mkdtemp(path.join(tmpdir(), "spar-adaptive-e2e-"));
  const store = new LocalStore(path.join(root, "state.sqlite3"));
  const workspaces = new WorkspaceService(path.join(root, "workspaces"));
  const runnerEvents: Array<Record<string, unknown>> = [];
  const runner = new UtilityClient("runner", (event) => runnerEvents.push(event));
  let phase: "first" | "second" = "first";
  const toolCalls: Array<{ phase: string; name: string; input: unknown }> = [];
  const agent = new UtilityClient("agent", (event) => {
    const value = event.event as { type?: unknown; tool?: unknown; detail?: unknown } | undefined;
    if (value?.type === "tool" && (value.detail === "tool-call" || value.detail === "tool-result")) console.log(`AGENT_EVENT phase=${phase} detail=${String(value.detail)}`);
  }, async (name, input, context) => {
    toolCalls.push({ phase, name, input });
    console.log(`TOOL_START phase=${phase} name=${name}`);
    const result = await executeTrainingTool(name, input, context.sessionId, store, workspaces, runner);
    const status = result && typeof result === "object" && "status" in result ? String((result as { status?: unknown }).status) : "ok";
    console.log(`TOOL_DONE phase=${phase} name=${name} status=${status}`);
    if (status === "invalid" && result && typeof result === "object" && "report" in result) {
      const report = (result as { report?: { checks?: Array<{ name?: string; passed?: boolean; detail?: string }> } }).report;
      console.log(`VALIDATION_FAILURES ${JSON.stringify(report?.checks?.filter((check) => !check.passed).map((check) => ({ name: check.name, detail: check.detail })) ?? [])}`);
    }
    return result;
  });

  try {
    const apiKey = await keytar.getPassword("ai.spar.desktop", "provider:openrouter");
    if (!apiKey) throw new Error("OpenRouter credential is missing from Spar Keychain");
    const provider = { provider: "openrouter", model: process.env.SPAR_VERIFY_MODEL?.trim() || "openrouter/free", baseUrl: "https://openrouter.ai/api/v1", apiKey };

    const historical = store.createSession("Earlier variable-size sliding-window practice");
    const historicalTarget = store.setTrainingTarget(historical.sessionId, {
      ability: "Variable-Size Sliding Window",
      specificGap: "Restoring validity repeatedly after one update changes several tracked conditions",
      desiredEvidence: "Uses a loop until every invariant is valid",
      avoidTesting: ["complex parsing", "advanced syntax"],
    });
    store.updateAbility({
      abilityId: historicalTarget.abilityId,
      markdown: "# Variable-Size Sliding Window\n\n## Current Understanding\n\nThe learner recognizes changing-window problems and can state the invariant. Repeated shrinking when several conditions change remains uncertain.\n\n## Evidence\n\n- Prior direct-array practice required an invariant hint.\n\n## Best Next Evidence\n\nTest repeated restoration with straightforward syntax and a context that is not another direct numeric array.",
      evidenceEventIds: [],
    });

    const created = store.createSession("Master variable-size sliding window invariant restoration deeply");
    const firstResult = await agentTurn(created.sessionId, "Start this adaptive session. Retrieve prior learner and attempt evidence before choosing one target. Reuse the exact existing ability title when relevant, then create the first validated JavaScript question.", "session-start", provider);
    if (!firstResult) throw new Error("First Training Agent turn produced no result");
    const firstDetail = store.readSession(created.sessionId);
    const firstQuestion = firstDetail?.question;
    if (!firstQuestion) throw new Error("Training Agent did not create question one");
    if (firstQuestion.abilityId !== historicalTarget.abilityId) throw new Error("Question one fragmented the existing Ability Ledger identity");
    const firstBundle = store.submissionBundle(firstQuestion.attemptId);
    if (!firstBundle) throw new Error("Question one has no active attempt bundle");
    const misconception = firstBundle.design.knownIncorrectFiles[0];
    if (!misconception) throw new Error("Question one has no validated misconception implementation");
    await workspaces.writeAll(created.sessionId, misconception);

    let sequence = firstQuestion.latestEventSequence;
    const append = (type: AttemptEvent["type"], payload: Record<string, unknown>, source: AttemptEvent["source"] = "learner") => {
      const event = { id: randomUUID(), attemptId: firstQuestion.attemptId, sequence: ++sequence, type, occurredAt: new Date().toISOString(), payload, source, schemaVersion: 1 } satisfies AttemptEvent;
      store.appendEvent(event);
      return event;
    };
    const implementationPath = Object.keys(misconception)[0] ?? "unknown";
    append("file_opened", { path: implementationPath });
    append("file_changed", { path: implementationPath, reason: "learner implementation checkpoint" });
    append("command_executed", { command: "test", scope: "visible" });
    const remark = append("learner_remark", { body: "I know the invariant should be restored, but I am stopping after one repair because I cannot tell when repeated shrinking should stop." });
    const visible = await runWorkspace(created.sessionId, firstBundle.design.language);
    if (visible.exitCode !== 0) throw new Error(`Generated misconception did not pass visible tests:\n${visible.stdout}\n${visible.stderr}`);
    append("test_run", { scope: "visible", exitCode: visible.exitCode, durationMs: visible.durationMs }, "runner");

    const hidden = await runWithHidden(created.sessionId, firstBundle.design);
    if (hidden.exitCode === 0) throw new Error("Generated hidden tests did not detect the validated misconception");
    append("submission_created", { questionId: firstQuestion.id });
    append("test_run", { scope: "visible-and-hidden", exitCode: hidden.exitCode, durationMs: hidden.durationMs }, "runner");
    const evaluated = append("submission_evaluated", { outcome: "failed", failureSignature: firstBundle.design.expectedFailureSignatures[0], remarkEventId: remark.id }, "system");
    append("attempt_completed", { outcome: "failed" }, "system");
    store.completeAttempt(firstQuestion.attemptId, "failed");

    phase = "second";
    const secondResult = await agentTurn(created.sessionId, `Attempt ${firstQuestion.attemptId} is complete. The learner's plausible implementation passed visible tests but failed targeted hidden tests. Inspect and evaluate the immutable attempt, read ability ${firstQuestion.abilityId}, update that same Ability Ledger using evidence event ${evaluated.id}, commit exactly one pedagogical action, retrieve wider learner context, then create question two. Reuse the exact ability title \"${firstQuestion.abilityTitle}\". Question two must build on the observed repeated-restoration uncertainty in a different representation, not merely rename question one.`, "attempt-complete", provider);
    if (!secondResult) throw new Error("Second Training Agent turn produced no result");
    const secondDetail = store.readSession(created.sessionId);
    const secondQuestion = secondDetail?.question;
    if (!secondQuestion || secondQuestion.ordinal !== 2) throw new Error("Training Agent did not create question two");
    if (secondQuestion.abilityId !== firstQuestion.abilityId) throw new Error("Question two did not continue the same Ability Ledger identity");
    if (secondQuestion.specificGap === firstQuestion.specificGap) throw new Error("Question two repeated the first target without adapting");
    if (secondQuestion.title === firstQuestion.title) throw new Error("Question two duplicated question one");
    const ability = store.readAbility(firstQuestion.abilityId) as { version?: number; markdown?: string } | null;
    if (!ability || Number(ability.version) < 2) throw new Error("Attempt evidence did not produce a new Ability Ledger version");
    const secondBundle = store.submissionBundle(secondQuestion.attemptId);
    if (!secondBundle) throw new Error("Question two has no active attempt bundle");
    await assertHiddenDiscrimination(created.sessionId, secondBundle.design);

    const secondNames = new Set(toolCalls.filter((call) => call.phase === "second").map((call) => call.name));
    for (const required of ["inspect_current_attempt", "evaluate_attempt", "read_ability", "propose_ability_update", "commit_session_decision", "search_learner_model", "set_training_target", "create_question"]) {
      if (!secondNames.has(required) && !(required === "inspect_current_attempt" && secondNames.has("read_attempt"))) throw new Error(`Second agent turn skipped required tool ${required}`);
    }

    console.log(JSON.stringify({
      model: provider.model,
      historicalAbilityVersion: 1,
      resultingAbilityVersion: ability.version,
      firstQuestion: { title: firstQuestion.title, target: firstQuestion.specificGap, visibleMisconception: "passed", hiddenMisconception: "failed" },
      learnerRemarkCaptured: true,
      secondQuestion: { title: secondQuestion.title, target: secondQuestion.specificGap, sameAbilityId: true, visibleMisconception: "passed", hiddenMisconception: "failed" },
      secondTurnTools: [...secondNames],
      runnerEventCount: runnerEvents.length,
    }, null, 2));
  } finally {
    runner.stop();
    agent.stop();
    store.close();
    await rm(root, { recursive: true, force: true });
    app.quit();
  }

  async function agentTurn(sessionId: string, message: string, turnKind: "session-start" | "attempt-complete", provider: { provider: string; model: string; baseUrl: string; apiKey: string }) {
    store.addMessage(sessionId, "system", message);
    const session = store.readSession(sessionId);
    if (!session) throw new Error("Session disappeared during agent turn");
    const context = JSON.stringify({
      session: session.summary,
      activeQuestion: session.question,
      checkpoint: session.checkpoint,
      relevantAbilitySummary: store.searchLearner(session.summary.originalGoal, 6),
    });
    return withTimeout(agent.request("turn", { sessionId, message, context, turnKind, provider }).promise, 1_200_000, `Training Agent ${phase} turn`);
  }
  async function runWorkspace(sessionId: string, language: QuestionDesign["language"]) {
    return withTimeout(runner.request("run", { root: workspaces.sessionRoot(sessionId), language, command: "test", timeoutMs: 8_000 }).promise, 15_000, "visible test run") as Promise<RunResult>;
  }
  async function runWithHidden(sessionId: string, design: QuestionDesign) {
    const files: Record<string, string> = {};
    for (const file of await workspaces.list(sessionId)) files[file] = await workspaces.read(sessionId, file);
    const validationId = randomUUID();
    const validationRoot = await workspaces.writeValidation(sessionId, validationId, { ...files, ...design.hiddenTests });
    try {
      return await withTimeout(runner.request("run", { root: validationRoot, language: design.language, command: "test", timeoutMs: 8_000 }).promise, 15_000, "hidden test run") as RunResult;
    } finally {
      await workspaces.removeValidation(sessionId, validationId);
    }
  }
  async function assertHiddenDiscrimination(sessionId: string, design: QuestionDesign) {
    const misconception = design.knownIncorrectFiles[0];
    if (!misconception) throw new Error("Question two has no known misconception implementation");
    const visibleId = randomUUID();
    const visibleRoot = await workspaces.writeValidation(sessionId, visibleId, { ...design.starterFiles, ...misconception, ...design.visibleTests });
    const fullId = randomUUID();
    const fullRoot = await workspaces.writeValidation(sessionId, fullId, { ...design.starterFiles, ...misconception, ...design.visibleTests, ...design.hiddenTests });
    try {
      const visible = await withTimeout(runner.request("run", { root: visibleRoot, language: design.language, command: "test", timeoutMs: 8_000 }).promise, 15_000, "question two visible discrimination") as RunResult;
      const hidden = await withTimeout(runner.request("run", { root: fullRoot, language: design.language, command: "test", timeoutMs: 8_000 }).promise, 15_000, "question two hidden discrimination") as RunResult;
      if (visible.exitCode !== 0 || hidden.exitCode === 0) throw new Error("Question two did not preserve visible-pass/hidden-fail discrimination");
    } finally {
      await workspaces.removeValidation(sessionId, visibleId);
      await workspaces.removeValidation(sessionId, fullId);
    }
  }
}

type RunResult = { exitCode: number; stdout: string; stderr: string; durationMs: number };
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
