import { randomUUID } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { askUserQuestionInputSchema } from "@spar/domain";
import { createPiMastraModel, type PiProviderInput } from "./piMastraModel.js";
import { nextToolStage, phaseExecutionKey, type AgentTurnKind } from "./agentPolicy.js";
import { normalizeAgentStreamPart } from "./agentStream.js";

const AGENT_MAX_STEPS = 96;
const IDENTICAL_TOOL_CALL_LIMIT = 15;
const AGENT_PHASE_TIMEOUT_MS = 180_000;
const CHALLENGE_COMPILATION_LIMIT = 15;
const PROTOCOL_RETRY_LIMIT = 15;
type Request = { kind: "request"; id: string; payload: { sessionId: string; message: string; context: string; turnKind: AgentTurnKind; resumeState?: { objective?: unknown; target?: unknown }; provider: PiProviderInput } };
const parentPort = process.parentPort;
if (!parentPort) throw new Error("Training Agent must run inside an Electron utility process");
const pendingTools = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
parentPort.on("message", (event) => { const message = event.data as Record<string, unknown>; if (message.kind === "request") void run(message as unknown as Request); if (message.kind === "tool-result") settle(message); });

const toolDefinitions = {
  search_learner_model: ["Search focused learner-model passages relevant to a query.", z.object({ query: z.string(), limit: z.number().int().min(1).max(8).default(4) })],
  read_ability: ["Read one versioned ability document.", z.object({ abilityId: z.string().uuid() })],
  search_attempt_history: ["Search attempts by ability or failure signature.", z.object({ query: z.string(), limit: z.number().int().min(1).max(10).default(5) })],
  read_attempt: ["Read a focused attempt trace.", z.object({ attemptId: z.string().uuid() })],
  read_session: ["Read the current session summary and decisions.", z.object({ sessionId: z.string().uuid() })],
  read_concept_graph: ["Read a bounded concept neighborhood.", z.object({ conceptId: z.string().uuid().optional(), query: z.string().optional(), depth: z.number().int().min(0).max(2).default(1) })],
  ask_user_question: ["Suspend the session for one focused learner answer. Offer 2-3 mutually exclusive choices with concise descriptions when useful, and always allow a custom answer.", askUserQuestionInputSchema],
  set_session_objective: ["Persist a lightweight session objective.", z.object({ objective: z.string() })],
  set_training_target: ["Persist one primary evidence target.", z.object({ ability: z.string(), specificGap: z.string(), desiredEvidence: z.string(), avoidTesting: z.array(z.string()) })],
  create_question: ["Compile and validate a complete question from the active target. All paths are relative and the reference implementation must replace starter implementation files.", z.object({ title:z.string().min(3),language:z.enum(["javascript","typescript","cpp"]),kind:z.enum(["function","module","repair","extension","repository"]),difficulty:z.enum(["foundation","developing","proficient","advanced"]),statement:z.string().min(30),starterFiles:z.record(z.string()),referenceFiles:z.record(z.string()),visibleTests:z.record(z.string()),hiddenTests:z.record(z.string()),knownIncorrectFiles:z.array(z.record(z.string())).min(1),runCommand:z.string().min(1),accidentalDifficulty:z.array(z.string()).max(3),expectedFailureSignatures:z.array(z.string()).min(1) })],
  inspect_current_attempt: ["Inspect current events, diffs, tests, remarks, and terminal output.", z.object({ attemptId: z.string().uuid() })],
  evaluate_attempt: ["Read the already-recorded deterministic runner outcome and evidence. Never judge correctness with the model.", z.object({ attemptId: z.string().uuid() })],
  propose_ability_update: ["Propose a versioned markdown ability change backed by evidence.", z.object({ abilityId: z.string().uuid(), markdown: z.string(), evidenceEventIds: z.array(z.string().uuid()) })],
  commit_session_decision: ["Commit exactly one next pedagogical action.", z.object({ action: z.enum(["diagnose", "teach", "practise", "transfer", "advance", "retain"]), reason: z.string() })]
} as const;

function hostTool(
  runId: string,
  sessionId: string,
  name: string,
  description: string,
  schema: z.ZodTypeAny,
  record: (name: string, input: unknown, value: unknown) => void,
  currentPhase: () => number,
  phaseExecutions: Map<string, { phase: number; promise: Promise<unknown> }>,
) {
  return createTool({ id: name, description, inputSchema: schema, execute: (input) => {
    const signature = phaseExecutionKey(name, stableJson(input));
    const cached = phaseExecutions.get(signature);
    if (cached?.phase === currentPhase()) return cached.promise;

    const promise = (async () => {
      const id = randomUUID();
      const result = new Promise((resolve, reject) => pendingTools.set(id, { resolve, reject }));
      // The host tool call is the real unit of agent work, so the renderer is told
      // about it directly rather than inferring rows from provider stream parts.
      const summary = summarizeToolInput(name, input);
      parentPort.postMessage({ kind: "event", requestId: runId, event: { type: "tool", tool: name, phase: "start", callId: id, ...summary } });
      parentPort.postMessage({ kind: "tool-call", id, requestId:runId, sessionId, name, input });
      try {
        const value = await result;
        record(name, input, value);
        // Compilation rejection is an expected tool result rather than an IPC
        // error, but it must never be rendered as a successfully created
        // challenge. Only a playable result reaches durable question storage.
        const published = name !== "create_question" || isPlayableQuestion(value);
        parentPort.postMessage({ kind: "event", requestId: runId, event: { type: "tool", tool: name, phase: "end", callId: id, ok: published, detail: describeToolResult(name, value), ...summary } });
        return value;
      } catch (error) {
        parentPort.postMessage({ kind: "event", requestId: runId, event: { type: "tool", tool: name, phase: "end", callId: id, ok: false, detail: error instanceof Error ? error.message : String(error), ...summary } });
        throw error;
      }
    })();
    phaseExecutions.set(signature, { phase: currentPhase(), promise });
    return promise;
  } });
}

/** Files a tool writes, counted so the renderer can show real `+N -N` stats. */
function summarizeToolInput(name: string, input: unknown): { label?: string; files?: Array<{ path: string; added: number; removed: number }> } {
  const record = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : undefined);

  if (name === "create_question") {
    const files: Array<{ path: string; added: number; removed: number }> = [];
    for (const group of ["starterFiles", "referenceFiles", "visibleTests", "hiddenTests"]) {
      const entries = record[group];
      if (!entries || typeof entries !== "object") continue;
      for (const [path, content] of Object.entries(entries as Record<string, unknown>)) {
        if (typeof content !== "string") continue;
        files.push({ path, added: countLines(content), removed: 0 });
      }
    }
    const label = text("title");
    return { ...(label ? { label } : {}), ...(files.length ? { files } : {}) };
  }

  if (name === "ask_user_question") {
    const questions=record.questions;
    const first=Array.isArray(questions)&&questions[0]&&typeof questions[0]==="object"?questions[0] as Record<string,unknown>:undefined;
    const label=first&&typeof first.question==="string"?first.question:undefined;
    return label?{label}:{};
  }

  const label =
    text("query") ??
    text("ability") ??
    text("objective") ??
    text("action") ??
    text("question") ??
    text("abilityId") ??
    text("attemptId");
  return label ? { label } : {};
}

function describeToolResult(name: string, value: unknown): string {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  if (name === "create_question" && typeof record.status === "string") {
    const report = record.report && typeof record.report === "object" ? record.report as Record<string, unknown> : {};
    const checks = Array.isArray(report.checks) ? report.checks : [];
    const failures = checks.flatMap((check) => {
      if (!check || typeof check !== "object") return [];
      const item = check as Record<string, unknown>;
      return item.passed === false ? [`${String(item.name ?? "validation")}: ${String(item.detail ?? "failed")}`] : [];
    });
    return [`status ${record.status}`, ...failures].join(" · ").slice(0, 320);
  }
  if (Array.isArray(value)) return `${value.length} result${value.length === 1 ? "" : "s"}`;
  if (typeof record.outcome === "string") return `outcome ${record.outcome}`;
  return "";
}

function isPlayableQuestion(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { status?: unknown }).status === "playable");
}

function countLines(content: string): number {
  if (!content) return 0;
  const lines = content.split("\n");
  // A trailing newline terminates the last line rather than starting a new one.
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

async function run(request: Request) {
  const allowed = allowedTools(request.payload.turnKind);
  const outcomes = new Map<string, unknown[]>();
  if (request.payload.resumeState?.objective) outcomes.set("set_session_objective", [request.payload.resumeState.objective]);
  if (request.payload.resumeState?.target) outcomes.set("set_training_target", [request.payload.resumeState.target]);
  const callSignatures: string[] = [];
  const phaseExecutions = new Map<string, { phase: number; promise: Promise<unknown> }>();
  let currentPhase = -1;
  const protocolFailures = new Map<string, { count: number; detail: string }>();
  const record = (name: string, input: unknown, value: unknown) => {
    outcomes.set(name, [...(outcomes.get(name) ?? []), { input, result: value }]);
    callSignatures.push(`${name}:${stableJson(input)}`);
    assertNoExtremeToolLoop(callSignatures);
  };
  const tools = Object.fromEntries(Object.entries(toolDefinitions).filter(([name]) => allowed.has(name)).map(([name, [description, schema]]) => [name, hostTool(request.id,request.payload.sessionId,name, description, schema, record, () => currentPhase, phaseExecutions)]));
  const model = createPiMastraModel(request.payload.provider);
  const agent = new Agent({ id: "spar-training-agent", name: "Spar Training Agent", model, instructions: instructions(), tools, maxRetries: 1 });
  new Mastra({ agents: { training: agent }, logger: false });
  try {
    const usage: unknown[] = [];
    let finalText = "";
    let finishReason = "stop";
    for (let step = 0; step < AGENT_MAX_STEPS; step += 1) {
      currentPhase = step;
      const stage = nextToolStage(request.payload.turnKind, outcomes, CHALLENGE_COMPILATION_LIMIT);
      if (request.payload.turnKind === "cold-start" && stage.activeTools.length === 0) {
        parentPort.postMessage({ kind: "result", id: request.id, ok: true, value: { text: "", usage: sumUsage(usage), finishReason: "tool-calls-complete", phaseSteps: step } });
        return;
      }
      if (request.payload.turnKind !== "learner-message" && stage.activeTools.length === 0) {
        parentPort.postMessage({ kind: "result", id: request.id, ok: true, value: { text: "", usage: sumUsage(usage), finishReason: "tool-calls-complete", phaseSteps: step } });
        return;
      }
      const callsBefore = callSignatures.length;
      let streamError = "";
      parentPort.postMessage({ kind: "event", requestId: request.id, event: { type: "status", detail: `phase-step:${step};active:${stage.activeTools.join(",") || "none"}` } });
      const stageKey = stage.activeTools.join(",");
      const prompt = orchestrationPrompt(request, outcomes, stage.activeTools, step, protocolFailures.get(stageKey)?.detail);
      const phaseAbort = new AbortController();
      const phaseTimer = setTimeout(() => phaseAbort.abort(new Error(`Training Agent provider phase exceeded ${AGENT_PHASE_TIMEOUT_MS / 1_000} seconds.`)), AGENT_PHASE_TIMEOUT_MS);
      let text = "";
      try {
        const output = await agent.stream([{ role: "user", content: prompt }], { maxSteps: 1, activeTools: stage.activeTools, toolChoice: stage.toolChoice, abortSignal: phaseAbort.signal });
        for await (const part of output.fullStream) {
          const normalized = normalizeAgentStreamPart(part as Record<string, unknown>);
          if (normalized.type === "error") streamError = normalized.text;
          parentPort.postMessage({ kind: "event", requestId: request.id, event: normalized });
        }
        text = await output.text;
        const turnUsage = await output.totalUsage;
        finishReason = await output.finishReason ?? "unknown";
        usage.push(turnUsage);
      } finally {
        clearTimeout(phaseTimer);
      }
      if (stage.activeTools.length > 0 && callSignatures.length === callsBefore) {
        if (streamError) throw new Error(`Provider ${request.payload.provider.provider} failed during ${stageKey}: ${streamError}`);
        const previous = protocolFailures.get(stageKey);
        const count = (previous?.count ?? 0) + 1;
        const detail = `The provider ended without a valid call to one of: ${stage.activeTools.join(", ")}.`;
        if (count > PROTOCOL_RETRY_LIMIT) throw new Error(`Training Agent could not produce a valid ${stageKey} tool call after ${count} attempts: ${detail}`);
        protocolFailures.set(stageKey, { count, detail });
        parentPort.postMessage({ kind: "event", requestId: request.id, event: { type: "status", detail: `protocol-retry:${stageKey}:${count}` } });
        continue;
      }
      protocolFailures.delete(stageKey);
      if (stage.activeTools.length === 0) {
        finalText = text;
        parentPort.postMessage({ kind: "result", id: request.id, ok: true, value: { text: finalText, usage: sumUsage(usage), finishReason, phaseSteps: step + 1 } });
        return;
      }
    }
    throw new Error(`Training Agent exceeded ${AGENT_MAX_STEPS} phase steps.`);
  } catch (error) { parentPort.postMessage({ kind: "result", id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
}
function orchestrationPrompt(request: Request, outcomes: Map<string, unknown[]>, activeTools: string[], step: number, protocolFailure?: string) {
  const evidence = Object.fromEntries([...outcomes.entries()].map(([name, values]) => [name, values.at(-1)]));
  const compilationFeedback = activeTools.includes("create_question") ? latestRejectedCompilationFeedback(outcomes) : "";
  const phaseInstruction=protocolFailure
    ? `Your previous response did not produce a schema-valid host tool call: ${protocolFailure}. Call exactly one tool from ${activeTools.join(", ")} now. Correct only the tool-call JSON shape; do not answer in prose.`
    : activeTools.length?`${compilationFeedback ? `The previous challenge candidate was rejected by deterministic compilation: ${compilationFeedback} Revise the candidate to fix that exact failure. A known-incorrect implementation must pass every visible test and fail a hidden test; do not submit a placeholder or deliberately visible-failing implementation. ` : ""}Call the single best required next tool from this allowlist: ${activeTools.join(", ")}. Do not answer in prose.`:"All required durable operations succeeded. Give the learner a concise explanation of the current training target and why this question follows from their evidence.";
  return `${request.payload.context}\n\nLatest learner action:\n${request.payload.message}\n\nDurable results from earlier phases of this same Training Agent turn:\n${stableJson(evidence)}\n\nPhase ${step + 1}. ${phaseInstruction}`;
}

function latestRejectedCompilationFeedback(outcomes: Map<string, unknown[]>): string {
  const latest = outcomes.get("create_question")?.at(-1);
  if (!latest || typeof latest !== "object") return "";
  const result = (latest as { result?: unknown }).result;
  if (!result || typeof result !== "object" || (result as { status?: unknown }).status === "playable") return "";
  return describeToolResult("create_question", result).slice(0, 500);
}
function sumUsage(values: unknown[]) {
  const totals: Record<string, number> = {};
  for (const value of values) for (const [key, amount] of Object.entries((value && typeof value === "object" ? value : {}) as Record<string, unknown>)) if (typeof amount === "number") totals[key] = (totals[key] ?? 0) + amount;
  return totals;
}
function assertNoExtremeToolLoop(signatures: string[]) {
  const latest = signatures.at(-1);
  if (!latest) return;
  let identical = 0;
  for (let index = signatures.length - 1; index >= 0 && signatures[index] === latest; index -= 1) identical += 1;
  if (identical >= IDENTICAL_TOOL_CALL_LIMIT) throw new Error(`Training Agent stopped after ${identical} identical tool calls; probable provider loop.`);
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function allowedTools(turnKind: AgentTurnKind) {
  if (turnKind === "cold-start") return new Set(["search_learner_model", "search_attempt_history", "ask_user_question"]);
  if (turnKind === "session-start") return new Set(["search_learner_model", "search_attempt_history", "read_ability", "read_concept_graph", "ask_user_question", "set_session_objective", "set_training_target", "create_question"]);
  if (turnKind === "attempt-complete") return new Set(["inspect_current_attempt", "evaluate_attempt", "read_ability", "propose_ability_update", "commit_session_decision", "search_learner_model", "search_attempt_history", "read_concept_graph", "set_training_target", "create_question"]);
  return new Set(["read_session", "inspect_current_attempt", "read_attempt", "read_ability", "search_learner_model", "search_attempt_history", "read_concept_graph", "ask_user_question"]);
}
function settle(message: Record<string, unknown>) { const pending = pendingTools.get(String(message.id)); if (!pending) return; pendingTools.delete(String(message.id)); if (message.ok) pending.resolve(message.value); else pending.reject(new Error(String(message.error))); }
function instructions() { return `You are the single Training Agent for a personalized coding gym. Own pedagogical decisions, not persistence, execution, or correctness verification. On a cold-start turn, retrieve learner and attempt evidence once, then ask exactly one short, plain-language question establishing prerequisite experience and confidence for the stated goal; do not set a target or create a challenge. For a new broad goal with existing evidence or a completed cold-start answer: call search_learner_model once and search_attempt_history once using focused queries, then stop retrieving, set a concise session objective, set exactly one Training Target, and create one complete validated question. Retrieved history calibrates difficulty but must never replace the learner's current goal: use prior evidence only when it is materially relevant, and otherwise choose an accessible foundation diagnostic from the goal and placement answer. Treat a cold-start answer as evidence about accessibility and never infer advanced readiness merely because the learner named an advanced topic. When retrieved evidence contains an existing ability relevant to the target, reuse its exact title so evidence updates the same durable Ability Ledger identity. Prefer JavaScript unless the learner explicitly asks for TypeScript or C++. A JavaScript question must use Node's built-in test runner, .js files, no dependencies, and runCommand "node --test". Starter and reference maps must use the same implementation path. Visible and hidden tests must be separate .test.js files and import the implementation relatively. Every reference solution must pass all tests. Every known incorrect implementation must represent the targeted misconception, pass all visible tests, and fail when hidden tests are included. The question's observable return contract must expose the targeted misconception: for repeated invariant restoration, do not rely only on a monotone maximum if a one-step shrink can return the same maximum; prefer counting valid windows, returning restored state, or another output where incomplete restoration is behaviorally distinguishable. Before calling create_question, ensure its title, statement, function contract, examples, reference code, visible tests, hidden tests, and expected failure signatures all describe the same exact operation and constraints. The model only proposes candidate designs; it must never declare a candidate or learner submission correct. The deterministic host compiler and runner are the sole verification authority. When create_question returns status invalid, read its failed checks, revise the candidate to address those exact failures, and call create_question again; continue until the host publishes a playable candidate or stops the bounded run. There is no reviewer or judge model. Use tools as reality and never claim a write, test, evaluation, or update without its tool result. Ask the learner only when history cannot answer something materially important. After a completed attempt: inspect the attempt once, read its already-recorded deterministic evaluation once, read the active ability once, propose one evidence-backed markdown update, commit exactly one action (diagnose, teach, practise, transfer, advance, or retain), call search_learner_model once for wider context, then create the next target and validated question. The next question must discriminate what remains uncertain from the attempt in a meaningfully different representation while avoiding unrelated difficulty. Its persisted Training Target and generated task must name the same transfer context and constraint. Prefer evidence over scores and never overreact to one attempt. Keep chat concise.`; }
