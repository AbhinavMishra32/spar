import { randomUUID } from "node:crypto";
import { parentPort } from "node:worker_threads";
import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

type Request = { kind: "request"; id: string; payload: { message: string; context: string; provider: { model: string; baseUrl: string; apiKey: string } } };
const pendingTools = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
parentPort?.on("message", (event) => { const message = (event as MessageEvent<Record<string, unknown>>).data; if (message.kind === "request") void run(message as unknown as Request); if (message.kind === "tool-result") settle(message); });

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
  create_question: ["Compile and validate a question from the active target.", z.object({ language: z.enum(["javascript", "typescript", "cpp"]), context: z.string(), constraints: z.array(z.string()) })],
  inspect_current_attempt: ["Inspect current events, diffs, tests, remarks, and terminal output.", z.object({ attemptId: z.string().uuid() })],
  evaluate_attempt: ["Run deterministic evaluation and return evidence.", z.object({ attemptId: z.string().uuid() })],
  propose_ability_update: ["Propose a versioned markdown ability change backed by evidence.", z.object({ abilityId: z.string().uuid(), markdown: z.string(), evidenceEventIds: z.array(z.string().uuid()) })],
  commit_session_decision: ["Commit exactly one next pedagogical action.", z.object({ action: z.enum(["diagnose", "teach", "practise", "transfer", "advance", "retain"]), reason: z.string() })]
} as const;

function hostTool(name: string, description: string, schema: z.ZodTypeAny) { return createTool({ id: name, description, inputSchema: schema, execute: async (input) => { const id = randomUUID(); const result = new Promise((resolve, reject) => pendingTools.set(id, { resolve, reject })); parentPort?.postMessage({ kind: "tool-call", id, name, input }); return result; } }); }

async function run(request: Request) {
  const tools = Object.fromEntries(Object.entries(toolDefinitions).map(([name, [description, schema]]) => [name, hostTool(name, description, schema)]));
  const provider = createOpenAI({ apiKey: request.payload.provider.apiKey, baseURL: request.payload.provider.baseUrl });
  const agent = new Agent({ id: "practice-training-agent", name: "Practice Training Agent", model: provider(request.payload.provider.model), instructions: instructions(), tools, maxRetries: 1 });
  new Mastra({ agents: { training: agent }, logger: false });
  try {
    const output = await agent.stream([{ role: "user", content: `${request.payload.context}\n\nLatest learner action:\n${request.payload.message}` }], { maxSteps: 16 });
    for await (const part of output.fullStream) parentPort?.postMessage({ kind: "event", requestId: request.id, event: normalize(part as Record<string, unknown>) });
    parentPort?.postMessage({ kind: "result", id: request.id, ok: true, value: { text: await output.text, usage: await output.totalUsage, finishReason: await output.finishReason } });
  } catch (error) { parentPort?.postMessage({ kind: "result", id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
}
function settle(message: Record<string, unknown>) { const pending = pendingTools.get(String(message.id)); if (!pending) return; pendingTools.delete(String(message.id)); if (message.ok) pending.resolve(message.value); else pending.reject(new Error(String(message.error))); }
function normalize(part: Record<string, unknown>) { const type = String(part.type); if (type === "text-delta") return { type: "text", text: String(part.textDelta ?? part.payload ?? "") }; if (type.includes("tool")) return { type: "tool", tool: String(part.toolName ?? "tool"), detail: type }; return { type: "status", detail: type }; }
function instructions() { return `You are the single Training Agent for a personalized coding gym. Own pedagogical decisions, not persistence or execution. Start broad goals by searching learner history. Every question needs one explicit Training Target. Use tools as reality and never claim a write, test, evaluation, or update without its tool result. Ask the learner only when history cannot answer something materially important. After an attempt choose exactly one action: diagnose, teach, practise, transfer, advance, or retain. Prefer evidence over scores. Never overreact to one attempt. Keep the coding task primary and chat concise.`; }
