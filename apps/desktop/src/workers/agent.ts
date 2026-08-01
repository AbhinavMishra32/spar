import { randomUUID } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { toMastraProviderModel } from "@pracai/provider";
import { z } from "zod";

type TurnKind = "cold-start" | "session-start" | "attempt-complete" | "learner-message";
const AGENT_MAX_STEPS = 96;
const IDENTICAL_TOOL_CALL_LIMIT = 2;
const AGENT_PHASE_TIMEOUT_MS = 180_000;
const CHALLENGE_COMPILATION_LIMIT = 2;
const PROTOCOL_RETRY_LIMIT = 1;
type Request = { kind: "request"; id: string; payload: { sessionId: string; message: string; context: string; turnKind: TurnKind; resumeState?: { objective?: unknown; target?: unknown }; provider: { provider: string; model: string; baseUrl: string; apiKey: string } } };
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
  ask_learner: ["Ask only a materially important question not answered by history.", z.object({ question: z.string(), reason: z.string() })],
  set_session_objective: ["Persist a lightweight session objective.", z.object({ objective: z.string() })],
  set_training_target: ["Persist one primary evidence target.", z.object({ ability: z.string(), specificGap: z.string(), desiredEvidence: z.string(), avoidTesting: z.array(z.string()) })],
  create_question: ["Compile and validate a complete question from the active target. All paths are relative and the reference implementation must replace starter implementation files.", z.object({ title:z.string().min(3),language:z.enum(["javascript","typescript","cpp"]),kind:z.enum(["function","module","repair","extension","repository"]),difficulty:z.enum(["foundation","developing","proficient","advanced"]),statement:z.string().min(30),starterFiles:z.record(z.string()),referenceFiles:z.record(z.string()),visibleTests:z.record(z.string()),hiddenTests:z.record(z.string()),knownIncorrectFiles:z.array(z.record(z.string())).min(1),runCommand:z.string().min(1),accidentalDifficulty:z.array(z.string()).max(3),expectedFailureSignatures:z.array(z.string()).min(1) })],
  inspect_current_attempt: ["Inspect current events, diffs, tests, remarks, and terminal output.", z.object({ attemptId: z.string().uuid() })],
  evaluate_attempt: ["Run deterministic evaluation and return evidence.", z.object({ attemptId: z.string().uuid() })],
  propose_ability_update: ["Propose a versioned markdown ability change backed by evidence.", z.object({ abilityId: z.string().uuid(), markdown: z.string(), evidenceEventIds: z.array(z.string().uuid()) })],
  commit_session_decision: ["Commit exactly one next pedagogical action.", z.object({ action: z.enum(["diagnose", "teach", "practise", "transfer", "advance", "retain"]), reason: z.string() })]
} as const;

function hostTool(runId:string,sessionId:string,name: string, description: string, schema: z.ZodTypeAny, record: (name: string, input: unknown, value: unknown) => void) { return createTool({ id: name, description, inputSchema: schema, execute: async (input) => { const id = randomUUID(); const result = new Promise((resolve, reject) => pendingTools.set(id, { resolve, reject })); parentPort.postMessage({ kind: "tool-call", id, requestId:runId, sessionId, name, input }); const value = await result; record(name, input, value); return value; } }); }

async function run(request: Request) {
  const allowed = allowedTools(request.payload.turnKind);
  const outcomes = new Map<string, unknown[]>();
  if (request.payload.resumeState?.objective) outcomes.set("set_session_objective", [request.payload.resumeState.objective]);
  if (request.payload.resumeState?.target) outcomes.set("set_training_target", [request.payload.resumeState.target]);
  const callSignatures: string[] = [];
  const protocolFailures = new Map<string, { count: number; detail: string }>();
  const record = (name: string, input: unknown, value: unknown) => {
    outcomes.set(name, [...(outcomes.get(name) ?? []), { input, result: value }]);
    callSignatures.push(`${name}:${stableJson(input)}`);
    assertNoExtremeToolLoop(callSignatures);
  };
  const tools = Object.fromEntries(Object.entries(toolDefinitions).filter(([name]) => allowed.has(name)).map(([name, [description, schema]]) => [name, hostTool(request.id,request.payload.sessionId,name, description, schema, record)]));
  const model = toMastraProviderModel(request.payload.provider);
  const agent = new Agent({ id: "practice-training-agent", name: "Practice Training Agent", model, instructions: instructions(), tools, maxRetries: 1 });
  new Mastra({ agents: { training: agent }, logger: false });
  try {
    const usage: unknown[] = [];
    let finalText = "";
    let finishReason = "stop";
    for (let step = 0; step < AGENT_MAX_STEPS; step += 1) {
      const stage = nextToolStage(request.payload.turnKind, outcomes);
      if (request.payload.turnKind === "cold-start" && stage.activeTools.length === 0) {
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
          const normalized = normalize(part as Record<string, unknown>);
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
        const previous = protocolFailures.get(stageKey);
        const count = (previous?.count ?? 0) + 1;
        const detail = streamError || `The provider ended without a valid call to one of: ${stage.activeTools.join(", ")}.`;
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
  const repairingQuestion=activeTools.length===1&&activeTools[0]==="create_question"&&(outcomes.get("create_question")?.length??0)>0;
  const phaseInstruction=protocolFailure
    ? `Your previous response did not produce a schema-valid host tool call: ${protocolFailure}. Call exactly one tool from ${activeTools.join(", ")} now. Correct only the tool-call JSON shape; do not answer in prose.`
    : repairingQuestion
    ? "Repair the exact previous create_question input using its deterministic report. Preserve the problem context, title, function contract, filenames, module format, and targeted misconception. Make the smallest source or assertion changes that correct the reported expected/actual values, imports, exports, timeout, or visible/hidden discrimination. Do not invent a new problem. Only change the title or representation when the report explicitly says adaptive progression failed. Call create_question with the complete repaired design and do not answer in prose."
    : activeTools.length?`Call the single best required next tool from this allowlist: ${activeTools.join(", ")}. Do not answer in prose.`:"All required durable operations succeeded. Give the learner a concise explanation of the current training target and why this question follows from their evidence.";
  return `${request.payload.context}\n\nLatest learner action:\n${request.payload.message}\n\nDurable results from earlier phases of this same Training Agent turn:\n${stableJson(evidence)}\n\nPhase ${step + 1}. ${phaseInstruction}`;
}
function sumUsage(values: unknown[]) {
  const totals: Record<string, number> = {};
  for (const value of values) for (const [key, amount] of Object.entries((value && typeof value === "object" ? value : {}) as Record<string, unknown>)) if (typeof amount === "number") totals[key] = (totals[key] ?? 0) + amount;
  return totals;
}
function nextToolStage(turnKind: TurnKind, outcomes: Map<string, unknown[]>) {
  const completed = (name: string) => (outcomes.get(name)?.length ?? 0) > 0;
  const playableQuestion = (outcomes.get("create_question") ?? []).some((value) => value && typeof value === "object" && (value as { result?: { status?: unknown } }).result?.status === "playable");
  if ((outcomes.get("create_question")?.length ?? 0) >= CHALLENGE_COMPILATION_LIMIT && !playableQuestion) throw new Error(`Training Agent stopped after ${CHALLENGE_COMPILATION_LIMIT} rejected challenge compilations; automatic regeneration is intentionally disabled.`);
  if (turnKind === "learner-message") return { activeTools: [...allowedTools(turnKind)], toolChoice: "auto" as const };
  if (turnKind === "cold-start") {
    const retrieval = ["search_learner_model", "search_attempt_history"].filter((name) => !completed(name));
    if (retrieval.length) return { activeTools: retrieval, toolChoice: "required" as const };
    if (!completed("ask_learner")) return { activeTools: ["ask_learner"], toolChoice: "required" as const };
    return { activeTools: [] as string[], toolChoice: "none" as const };
  }
  if (playableQuestion) return { activeTools: [] as string[], toolChoice: "none" as const };
  if (turnKind === "session-start") {
    const retrieval = ["search_learner_model", "search_attempt_history"].filter((name) => !completed(name));
    if (retrieval.length) return { activeTools: retrieval, toolChoice: "required" as const };
    if (!completed("set_session_objective")) return { activeTools: completed("read_ability") ? ["set_session_objective"] : ["read_ability", "set_session_objective"], toolChoice: "required" as const };
    if (!completed("set_training_target")) return { activeTools: ["set_training_target"], toolChoice: "required" as const };
    return { activeTools: ["create_question"], toolChoice: "required" as const };
  }
  for (const stage of [["inspect_current_attempt", "evaluate_attempt"], ["read_ability"], ["propose_ability_update"], ["commit_session_decision"], ["search_learner_model"], ["set_training_target"]]) {
    const remaining = stage.filter((name) => !completed(name));
    if (remaining.length) return { activeTools: remaining, toolChoice: "required" as const };
  }
  return { activeTools: ["create_question"], toolChoice: "required" as const };
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
function allowedTools(turnKind: TurnKind) {
  if (turnKind === "cold-start") return new Set(["search_learner_model", "search_attempt_history", "ask_learner"]);
  if (turnKind === "session-start") return new Set(["search_learner_model", "search_attempt_history", "read_ability", "read_concept_graph", "ask_learner", "set_session_objective", "set_training_target", "create_question"]);
  if (turnKind === "attempt-complete") return new Set(["inspect_current_attempt", "evaluate_attempt", "read_ability", "propose_ability_update", "commit_session_decision", "search_learner_model", "search_attempt_history", "read_concept_graph", "set_training_target", "create_question"]);
  return new Set(["read_session", "inspect_current_attempt", "read_attempt", "read_ability", "search_learner_model", "search_attempt_history", "read_concept_graph", "ask_learner"]);
}
function settle(message: Record<string, unknown>) { const pending = pendingTools.get(String(message.id)); if (!pending) return; pendingTools.delete(String(message.id)); if (message.ok) pending.resolve(message.value); else pending.reject(new Error(String(message.error))); }
function normalize(part: Record<string, unknown>): {type:"text"|"tool"|"status"|"error";text:string;tool?:string;detail?:string} { const type = String(part.type); if (type === "text-delta") return { type: "text", text: String(part.textDelta ?? part.payload ?? "") }; if (type === "error") return {type:"error",text:errorText(part.error ?? part)};if (type.includes("tool")) return { type: "tool", text:"",tool: String(part.toolName ?? "tool"), detail: type }; return { type: "status", text:"",detail: type }; }
function errorText(value: unknown): string {
  const find = (candidate: unknown, depth = 0): string | null => {
    if (depth > 8 || candidate == null) return null;
    if (candidate instanceof Error) return candidate.message.slice(0, 1_000);
    if (typeof candidate === "string") {
      if (candidate.length < 1_200 && !candidate.trimStart().startsWith("{")) return candidate;
      try { return find(JSON.parse(candidate), depth + 1); } catch { const match=candidate.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/);return match?.[1]?JSON.parse(`"${match[1]}"`):null; }
    }
    if (typeof candidate !== "object") return null;
    const record = candidate as Record<string, unknown>;
    for (const key of ["message", "payload", "error", "data", "cause"]) { const found=find(record[key],depth+1);if(found)return found; }
    return null;
  };
  return (find(value) ?? "The model provider returned an unknown error.").replace(/sk-[A-Za-z0-9_-]{8,}/g,"[redacted]").slice(0,1_000);
}
function instructions() { return `You are the single Training Agent for a personalized coding gym. Own pedagogical decisions, not persistence or execution. On a cold-start turn, retrieve learner and attempt evidence once, then ask exactly one short, plain-language question establishing prerequisite experience and confidence for the stated goal; do not set a target or create a challenge. For a new broad goal with existing evidence or a completed cold-start answer: call search_learner_model once and search_attempt_history once using focused queries, then stop retrieving, set a concise session objective, set exactly one Training Target, and create one complete validated question. Treat a cold-start answer as evidence about accessibility and never infer advanced readiness merely because the learner named an advanced topic. When retrieved evidence contains an existing ability relevant to the target, reuse its exact title so evidence updates the same durable Ability Ledger identity. Prefer JavaScript unless the learner explicitly asks for TypeScript or C++. A JavaScript question must use Node's built-in test runner, .js files, no dependencies, and runCommand "node --test". Starter and reference maps must use the same implementation path. Visible and hidden tests must be separate .test.js files and import the implementation relatively. Every reference solution must pass all tests. Every known incorrect implementation must represent the targeted misconception, pass all visible tests, and fail when hidden tests are included. The question's observable return contract must expose the targeted misconception: for repeated invariant restoration, do not rely only on a monotone maximum if a one-step shrink can return the same maximum; prefer counting valid windows, returning restored state, or another output where incomplete restoration is behaviorally distinguishable. Before calling create_question, ensure its title, statement, function contract, examples, reference code, visible tests, hidden tests, and expected failure signatures all describe the same exact operation and constraints. If validation rejects a design, inspect the deterministic checks and repair the files before returning; there is no reviewer agent. Use tools as reality and never claim a write, test, evaluation, or update without its tool result. Ask the learner only when history cannot answer something materially important. After a completed attempt: inspect the attempt once, evaluate it once, read the active ability once, propose one evidence-backed markdown update, commit exactly one action (diagnose, teach, practise, transfer, advance, or retain), call search_learner_model once for wider context, then create the next target and validated question. The next question must discriminate what remains uncertain from the attempt in a meaningfully different representation while avoiding unrelated difficulty. Its persisted Training Target and generated task must name the same transfer context and constraint. Prefer evidence over scores and never overreact to one attempt. Keep chat concise.`; }
