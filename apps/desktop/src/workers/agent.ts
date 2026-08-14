import { randomUUID } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { askUserQuestionInputSchema, languageSchema, type Language } from "@spar/domain";
import { PRACTICE_READ_TOOLS } from "@spar/practice/mcp";
import { createPiMastraModel, type PiProviderInput } from "./piMastraModel.js";
import { captureCodexRateLimits } from "./codexRateLimits.js";
import { allowedTools, completionInstruction, nextToolStage, phaseExecutionKey, type AgentTurnKind } from "./agentPolicy.js";
import { normalizeAgentStreamPart } from "./agentStream.js";
import { syntheticChallengeAuthoringDoctrine } from "./challengeAuthoring.js";
import { ACTION_TITLE_KEY, splitActionTitle, toolPayload } from "./toolPayload.js";

const AGENT_MAX_STEPS = 96;
const IDENTICAL_TOOL_CALL_LIMIT = 15;
const AGENT_PHASE_TIMEOUT_MS = 180_000;
const CHALLENGE_COMPILATION_LIMIT = 15;
const PROTOCOL_RETRY_LIMIT = 15;
type Request = { kind: "request"; id: string; payload: { sessionId: string; message: string; context: string; turnKind: AgentTurnKind; activeQuestion?: { id: string; attemptId: string } | null; resumeState?: { objective?: unknown; target?: unknown }; webSearch?: boolean; practiceSource?: boolean; provider: PiProviderInput } };
const parentPort = process.parentPort;
if (!parentPort) throw new Error("Spar must run inside an Electron utility process");
const pendingTools = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
/* Not tied to a run: the headers belong to the subscription, not to the turn
   that happened to reveal them, and the main process files them that way. */
captureCodexRateLimits((headers) => parentPort.postMessage({ kind: "event", event: { type: "provider-usage", provider: "openai-codex", headers } }));
type SuggestRequest = { kind: "request"; id: string; payload: { profile: Record<string, unknown>; count: number; provider: PiProviderInput } };
parentPort.on("message", (event) => {
  const message = event.data as Record<string, unknown>;
  if (message.kind === "request" && message.method === "suggest") { void suggest(message as unknown as SuggestRequest); return; }
  if (message.kind === "request") void run(message as unknown as Request);
  if (message.kind === "tool-result") settle(message);
});

const SUGGEST_TIMEOUT_MS = 45_000;

/**
 * One tool-free completion that turns the intake into openable sparring sessions.
 * Deliberately not a turn of the training agent: nothing is persisted, no target
 * is set, and no challenge is compiled — the learner has not chosen a direction
 * yet, and a suggestion they never open must leave no trace in their evidence.
 */
async function suggest(request: SuggestRequest) {
  const model = createPiMastraModel(request.payload.provider);
  const agent = new Agent({ id: "spar-suggest", name: "Spar", model, instructions: suggestionInstructions(request.payload.count), maxRetries: 1 });
  new Mastra({ agents: { suggest: agent }, logger: false });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error("Spar's provider took too long to draft sessions.")), SUGGEST_TIMEOUT_MS);
  try {
    const output = await agent.stream([{ role: "user", content: stableJson(request.payload.profile) }], { maxSteps: 1, abortSignal: abort.signal });
    for await (const _part of output.fullStream) { /* drained; the caller renders its own progress */ }
    parentPort.postMessage({ kind: "result", id: request.id, ok: true, value: { text: await output.text } });
  } catch (error) {
    parentPort.postMessage({ kind: "result", id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    clearTimeout(timer);
  }
}

function suggestionInstructions(count: number) {
  return `You are Spar, a personalized coding gym. The learner has just finished their intake and has no recorded attempts yet. From their intake alone, draft exactly ${count} sparring sessions they could start right now.

Return only a JSON array, no prose and no code fence. Each element must be an object with exactly these keys:
"title": under 60 characters, the ability being trained, not a task description.
"goal": one or two sentences in the learner's own first-person voice, as if they typed it into Spar themselves. This is what starts the session.
"why": under 140 characters, naming the intake answer this came from.

Each session must train a distinct kind of reasoning, and at least one must be reachable for someone who has overstated their confidence. Use the learner's stated weakness verbatim where it fits. Write the goals for their stated language. Never promise an outcome, never mention a difficulty level, and never number the titles.`;
}

/**
 * How a challenge is filed. The slug is the identity, so a concept already in the
 * vocabulary needs nothing else; `title`, `kind` and `parentSlug` are only read
 * when the slug is new, which is what lets the agent extend the taxonomy for a
 * learner working on something it never anticipated instead of forcing the
 * nearest wrong tag.
 *
 * Deliberately fine-grained: "arrays" is a shelf, and a shelf is not a finding.
 * The first tag is the aim; the rest are what the challenge also touches.
 */
const conceptTagInputSchema=z.object({
  slug:z.string().min(2).max(60).describe("kebab-case, as specific as the challenge really is: prefer window-invariant-restoration over sliding-window, or aliasing over references-and-mutation"),
  title:z.string().min(2).max(80).optional().describe("only needed for a concept Spar has not seen before"),
  kind:z.enum(["dsa","engineering","craft"]).optional(),
  parentSlug:z.string().min(2).max(60).optional().describe("the area a new sub-concept belongs under, e.g. sliding-window"),
  role:z.enum(["primary","supporting"]).default("supporting"),
});
const questionInputSchema=z.object({ concepts:z.array(conceptTagInputSchema).min(1).max(5).describe("What this challenge is about, most specific first. Exactly one entry has role primary: the concept the challenge is aimed at."),title:z.string().min(3).describe("A concise, professional problem title naming the operation or result; never an agent action, lesson, file, or bug category."),language:languageSchema,kind:z.enum(["function","module","repair","extension","repository"]),difficulty:z.enum(["foundation","developing","proficient","advanced"]),statement:z.string().min(30).describe("The complete learner-facing problem page in professional Markdown: description, numbered examples with Input and Output, then constraints. No agent commentary, selection rationale, validation notes, or hidden-test details."),starterFiles:z.record(z.string()),referenceFiles:z.record(z.string()),visibleTests:z.record(z.string()),hiddenTests:z.record(z.string()),knownIncorrectFiles:z.array(z.record(z.string())).min(1),runCommand:z.string().min(1),accidentalDifficulty:z.array(z.string()).max(3),expectedFailureSignatures:z.array(z.string()).min(1) });
/**
 * What turns an ability document into an Ability the learner has. The markdown is
 * the agent's working notes; these three are the claim it supports — one sentence
 * they can read, the concepts it reaches history through, and the drills for going
 * deeper. Shared by both ability tools so the two cannot support different halves
 * of the same object.
 */
const abilityClaimShape = {
  summary: z.string().min(10).max(220).optional().describe("One sentence in plain words: what the learner can now do. Written to them, not about them."),
  concepts: z.array(conceptTagInputSchema).max(6).optional().describe("The concepts this ability covers, which is how the learner reaches the challenges behind it."),
  practice: z.array(z.string().min(10).max(180)).max(4).optional().describe("Drills for going further on this exact ability, each phrased as the learner's own goal because each one starts a session. Vary the transfer context, not just the difficulty."),
  status: z.enum(["uncertain","developing","independent","stale"]).optional().describe("Omit to let the evidence count decide. Set it only to say something the count cannot, such as marking a long-untouched ability stale."),
  evidence: z.array(z.object({ eventId:z.string().uuid(),statement:z.string().min(8).max(300),polarity:z.enum(["supporting","contradictory","neutral"]),independence:z.enum(["independent","assisted","unknown"]),strength:z.number().min(0).max(1) })).max(8).optional().describe("Nuanced interpretations of exact durable events. Describe the behavior observed, not a score."),
  pattern: z.object({title:z.string().min(3).max(100),description:z.string().min(10).max(400),status:z.enum(["observation","hypothesis","pattern","monitoring","resolved"]),evidenceEventIds:z.array(z.string().uuid()).max(12)}).optional().describe("A mistake lifecycle update. The host will refuse to promote a pattern unless evidence links span at least two attempts."),
} as const;

const toolDefinitions = {
  search_learner_model: ["Search focused learner-model passages relevant to a query.", z.object({ query: z.string(), limit: z.number().int().min(1).max(8).default(4) })],
  read_ability: ["Read one versioned ability document.", z.object({ abilityId: z.string().uuid() })],
  search_attempt_history: ["Search attempts by ability or failure signature.", z.object({ query: z.string(), limit: z.number().int().min(1).max(10).default(5) })],
  search_challenge_history: ["Search the learner's durable challenge library, including outcomes and replacement lineage.", z.object({ query:z.string(),limit:z.number().int().min(1).max(12).default(6) })],
  read_challenge: ["Read one stored challenge design, validation report, attempts, and test history.", z.object({ questionId:z.string().uuid() })],
  /* The one pair of tools that reads anything outside the learner's own record.
     Named for what they are for: grounding a goal in what the world actually
     asks — a company's real interview surface, a language's current idiom — not
     for looking up answers, which the host compiler decides anyway. */
  web_search: ["Search the web for current, external information: what a company's interviews actually cover, what a library's current API is, what a topic's standard formulation is. Returns titles, URLs, and short extracts. Use it to ground a goal in reality when the learner's own record cannot answer the question, and prefer one focused query over several vague ones.", z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(10).default(5) })],
  web_fetch: ["Read one or more web pages in full, by URL. Use it after web_search has told you which page is worth reading. http and https only.", z.object({ urls: z.array(z.string().url()).min(1).max(5) })],
  read_attempt: ["Read a focused attempt trace.", z.object({ attemptId: z.string().uuid() })],
  read_session: ["Read the current session summary and decisions.", z.object({ sessionId: z.string().uuid() })],
  read_concept_graph: ["Read the concept vocabulary near a topic, with this learner's evidence against each one. Use it to choose what to tag and what to test next.", z.object({ query: z.string().optional(), limit: z.number().int().min(1).max(24).default(14) })],
  search_concept_evidence: ["Read how this learner behaves under one concept, broken down by sub-concept, with the recent challenges and outcomes behind it. This is the tool for finding which specific sub-concept is failing inside an area that looks fine on average.", z.object({ concept: z.string().min(2).describe("a concept slug or a topic in words"), limit: z.number().int().min(1).max(6).default(3) })],
  ask_user_question: ["Suspend the session for one focused learner answer. Offer 2-3 mutually exclusive choices. Each option is one self-contained line the learner can scan — no subtitle, no second sentence — so write the whole choice into the label. Always allow a custom answer.", askUserQuestionInputSchema],
  set_session_objective: ["Persist a lightweight session objective.", z.object({ objective: z.string() })],
  set_training_target: ["Persist one primary evidence target.", z.object({ ability: z.string(), specificGap: z.string(), desiredEvidence: z.string(), avoidTesting: z.array(z.string()) })],
  create_question: ["Compile and validate a complete question from the active target. All paths are relative and the reference implementation must replace starter implementation files.", questionInputSchema],
  replace_current_question: ["Compile a validated replacement for the active challenge while preserving its attempt, tests, and replacement lineage in history.", questionInputSchema.extend({reason:z.string().min(3).max(500)})],
  inspect_current_attempt: ["Inspect current immutable events, diffs, test runs, and submission evidence.", z.object({ attemptId: z.string().uuid() })],
  replay_attempt: [
    "Read the attempt's own log: every recorded event in order — edits, runs, submissions, verdicts — with its offset from when the attempt opened, plus one line per test case inside every run with its expected/actual values. Nothing in it is summarised or interpreted; it is what was recorded. Two derived sections come with it because a log in order cannot show them: each case's verdict across every run (a transpose) and each run's newly-passing and newly-failing cases (a diff). Take the whole log when the attempt is small — that is the default — and use the parameters to narrow it when it is long or when you only need one metric. This is the sharpest instrument you have for aiming the next question: a 6/7 reached by fixing one case in ninety seconds and a 6/7 reached by breaking two others are different learners.",
    z.object({
      attemptId: z.string().uuid(),
      sections: z.array(z.enum(["log", "cases", "runs", "timings"])).min(1).max(4).optional()
        .describe("log: every event, in order, with its payload and per-case lines. cases: each case's verdict in every run, with pass and failure counts. runs: each run's score and which cases newly passed or newly failed against the last run that saw them. timings: totals, the gap before the first run, the longest gap between events, and each edit stretch. Defaults to log, cases and runs."),
      eventTypes: z.array(z.string().min(3).max(40)).max(12).optional()
        .describe("Keep only these event types in the log, e.g. [\"test_run\"] for nothing but the runs, or [\"file_changed\",\"test_run\"] for the edit-and-run rhythm. Omit for every type. Recorded types: attempt_started, file_changed, command_executed, test_run, submission_created, submission_evaluated, attempt_completed, hint_requested, learner_remark, agent_message."),
      cases: z.enum(["all", "failed-ever", "still-failing", "fixed"]).optional()
        .describe("Narrow the case history. `still-failing` is what is wrong now; `fixed` is what they repaired themselves, which is evidence of learning inside one attempt."),
      scope: z.enum(["all", "since-last-submission"]).optional()
        .describe("`since-last-submission` keeps only what happened after the last graded run, which is often the whole question on a follow-up turn."),
      caseDetail: z.enum(["brief", "full"]).optional().describe("`brief` drops the expected/actual pair from each failing case line in the log. Default full."),
      maxLines: z.number().int().min(20).max(2_000).optional().describe("Cap on log lines, newest kept, and it says how many it dropped. Default 400. Raise it rather than guessing at what a truncated log left out."),
    }),
  ],
  evaluate_attempt: ["Read the already-recorded deterministic runner outcome and evidence. Never judge correctness with the model.", z.object({ attemptId: z.string().uuid() })],
  propose_ability_update: ["Propose a versioned markdown ability change backed by evidence. Include summary, concepts and practice whenever the evidence now supports naming this as something the learner can do.", z.object({ abilityId: z.string().uuid(), markdown: z.string(), evidenceEventIds: z.array(z.string().uuid()), ...abilityClaimShape })],
  upsert_ability: ["Introduce an uncertain ability, or grant one: append an evidence-backed version and give it the summary, concepts and practice drills that make it something the learner can see and train.", z.object({title:z.string().min(2).max(120),markdown:z.string().min(20),evidenceEventIds:z.array(z.string().uuid()).default([]), ...abilityClaimShape})],
  commit_session_decision: ["Commit exactly one next pedagogical action.", z.object({ action: z.enum(["diagnose", "teach", "practise", "transfer", "advance", "retain"]), reason: z.string() })],
  /**
   * Setting a real problem instead of writing one.
   *
   * The counterpart to `create_question`, and the reason the source exists. What
   * it takes is deliberately not the problem — the host reads that from the
   * source itself — but the *aim*: which concept this is being set for and what
   * the agent expects it to show. A slug alone would mount a problem with no
   * statement about why, and the ledger would gain a challenge nobody can explain.
   */
  assign_practice_problem: [
    "Set a real problem from any available provider as this session's challenge. Use the exact `source` and `slug` returned by search. Prefer this over create_question whenever a real problem genuinely lands on the target you chose: it carries the provider's judge, calibrated difficulty, and the learner's history when that provider is connected. Read it first. The host mounts it, tags it with the concepts you name, and returns the challenge; do not describe its contents in your reply because the learner is about to read it.",
    z.object({
      source: z.enum(["leetcode", "codeforces"]).describe("The provider identity returned by search. A slug is only unique inside its provider."),
      slug: z.string().min(1).max(120).describe("The problem's URL slug, exactly as the source gave it."),
      concepts: z.array(conceptTagInputSchema).min(1).max(5).describe("What this challenge is about, in Spar's vocabulary, most specific first. Exactly one entry has role primary and it must name the gap the target describes — not merely the topic the source files the problem under."),
      why: z.string().min(20).max(400).describe("One or two sentences: why this specific problem discriminates what is still uncertain about this learner. This is stored with the challenge and is what a later turn reads to know what you were testing."),
      language: languageSchema.optional().describe("Omit to use the learner's preferred language. Only name one when the problem demands it."),
      replaceReason: z.string().min(3).max(500).optional().describe("Required only when a challenge is already open and this problem is to take its place — say what the learner asked for. Their attempt is closed as replaced and this problem records it as its predecessor. Never set it to move someone off a challenge they did not ask to leave."),
    }),
  ],
} as const;

/**
 * Tools that reach the practice source, declared from the MCP server's own
 * schemas rather than restated here.
 *
 * Restating them is how a tool the agent can call with arguments the server
 * rejects comes about — a turn that fails for a reason no log explains. The
 * descriptions come from the same place, so what the agent is told a tool does is
 * what the server documents it doing.
 */
const sourceToolDefinitions = Object.fromEntries(
  PRACTICE_READ_TOOLS.map((tool) => [tool.name, [tool.description, z.object(tool.name === "search_practice_problems"
    ? tool.shape
    : { ...tool.shape, source: z.enum(["leetcode", "codeforces"]).describe("The provider identity returned by search. Keep it paired with the slug.") })] as const]),
) as Record<string, readonly [string, z.ZodTypeAny]>;

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
    /* Keyed on the arguments alone. The title is prose the model rewrites freely,
       and letting it into the signature would make two identical calls that were
       merely described differently look like two different pieces of work — which
       is exactly what the per-phase cache exists to collapse. */
    const signature = phaseExecutionKey(name, stableJson(splitActionTitle(input).arguments));
    const cached = phaseExecutions.get(signature);
    if (cached?.phase === currentPhase()) return cached.promise;

    const promise = callHostTool(runId, sessionId, name, input, record);
    phaseExecutions.set(signature, { phase: currentPhase(), promise });
    return promise;
  } });
}

/**
 * One host round-trip, reported to the renderer as it happens. Shared so the
 * controller's own fallback call is the same unit of work as a model-issued
 * one, rather than a second path with its own reporting.
 */
async function callHostTool(
  runId: string,
  sessionId: string,
  name: string,
  input: unknown,
  record?: (name: string, input: unknown, value: unknown) => void,
) {
  const id = randomUUID();
  const result = new Promise((resolve, reject) => pendingTools.set(id, { resolve, reject }));
  /* Split before anything else happens to it. The title is for the transcript and
     the rest is the call: passing the title through to the host would hand a tool
     an argument it never declared, and `create_question` forwards its whole input
     to the compiler. */
  const { actionTitle, arguments: args } = splitActionTitle(input);
  // The host tool call is the real unit of agent work, so the renderer is told
  // about it directly rather than inferring rows from provider stream parts.
  const summary = summarizeToolInput(name, args);
  const payload = { input: toolPayload(name, args) };
  const titled = { ...summary, ...(actionTitle ? { actionTitle } : {}) };
  parentPort.postMessage({ kind: "event", requestId: runId, event: { type: "tool", tool: name, phase: "start", callId: id, ...titled, ...payload } });
  parentPort.postMessage({ kind: "tool-call", id, requestId: runId, sessionId, name, input: args });
  try {
    const value = await result;
    record?.(name, args, value);
    // Compilation rejection is an expected tool result rather than an IPC
    // error, but it must never be rendered as a successfully created
    // challenge. Only a playable result reaches durable question storage.
    const published = !["create_question", "replace_current_question", "create_fallback_question", "assign_practice_problem"].includes(name) || isPlayableQuestion(value);
    parentPort.postMessage({ kind: "event", requestId: runId, event: { type: "tool", tool: name, phase: "end", callId: id, ok: published, detail: describeToolResult(name, value), ...titled, ...payload, output: toolPayload(name, value) } });
    return value;
  } catch (error) {
    parentPort.postMessage({ kind: "event", requestId: runId, event: { type: "tool", tool: name, phase: "end", callId: id, ok: false, detail: error instanceof Error ? error.message : String(error), ...titled, ...payload, output: toolPayload(name, { error: error instanceof Error ? error.message : String(error) }) } });
    throw error;
  }
}


/** Files a tool writes, counted so the renderer can show real `+N -N` stats. */
function summarizeToolInput(name: string, input: unknown): { label?: string; files?: Array<{ path: string; added: number; removed: number }> } {
  const record = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : undefined);

  if (name === "create_question" || name === "replace_current_question") {
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

  /* The learner is shown what the replay looked at, in their own terms. This is
     the one tool whose arguments are worth surfacing: "read the case history
     since your last submission" is a statement about them, not a query string. */
  if (name === "replay_attempt") {
    const sections = Array.isArray(record.sections) ? record.sections.filter((entry): entry is string => typeof entry === "string") : [];
    const named = sections.length ? sections.map((section) => SECTION_WORDS[section] ?? section) : ["full log", "case history", "run deltas"];
    const narrowed = [
      record.cases === "still-failing" ? "still failing" : record.cases === "fixed" ? "what you fixed" : record.cases === "failed-ever" ? "everything that failed" : "",
      record.scope === "since-last-submission" ? "since your last submission" : "",
    ].filter(Boolean);
    return { label: [named.join(" · "), ...narrowed].join(" — ") };
  }

  if (name === "ask_user_question") {
    const questions=record.questions;
    const first=Array.isArray(questions)&&questions[0]&&typeof questions[0]==="object"?questions[0] as Record<string,unknown>:undefined;
    const label=first&&typeof first.question==="string"?first.question:undefined;
    return label?{label}:{};
  }

  const label =
    text("query") ??
    text("concept") ??
    text("ability") ??
    text("objective") ??
    text("action") ??
    text("question") ??
    text("abilityId") ??
    text("attemptId");
  return label ? { label } : {};
}

/** Every failed check of a compilation attempt, newest report, in full. */
function failedChecks(value: unknown): string[] {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const report = record.report && typeof record.report === "object" ? record.report as Record<string, unknown> : {};
  const checks = Array.isArray(report.checks) ? report.checks : [];
  return checks.flatMap((check) => {
    if (!check || typeof check !== "object") return [];
    const item = check as Record<string, unknown>;
    return item.passed === false ? [`${String(item.name ?? "validation")}: ${String(item.detail ?? "failed")}`] : [];
  });
}

const SECTION_WORDS: Record<string, string> = {
  log: "full log",
  cases: "case history",
  runs: "run deltas",
  timings: "timings",
};

/** The replay's own numbers, for the row the learner sees. Deliberately the same
 *  facts the report opens with, so the transcript never claims more than the
 *  agent actually read. */
function describeReplay(value: unknown): string {
  const stats = (value && typeof value === "object" ? (value as { stats?: unknown }).stats : null) as Record<string, unknown> | null;
  if (!stats) return "nothing recorded yet";
  const number = (key: string) => (typeof stats[key] === "number" ? stats[key] as number : 0);
  const minutes = Math.round(number("elapsedMs") / 60_000);
  const parts = [
    minutes >= 1 ? `${minutes}m on it` : "under a minute on it",
    `${number("runs")} run${number("runs") === 1 ? "" : "s"}`,
    `${number("casesTracked")} case${number("casesTracked") === 1 ? "" : "s"} followed`,
  ];
  if (number("regressions")) parts.push(`${number("regressions")} broke after passing`);
  if (number("neverPassed")) parts.push(`${number("neverPassed")} never passed`);
  return parts.join(" · ");
}

function describeToolResult(name: string, value: unknown): string {
  if (name === "replay_attempt") return describeReplay(value);
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  if ((name === "create_question" || name === "replace_current_question" || name === "assign_practice_problem") && typeof record.status === "string") {
    // The transcript row only has one line to spare; the agent's own repair
    // feedback is built separately and is not clipped to fit a UI label.
    return [`status ${record.status}`, ...failedChecks(value)].join(" · ").slice(0, 320);
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

/**
 * The name of the row this call will draw in the transcript, written by the agent.
 *
 * Added to every tool uniformly rather than to each schema by hand, so no tool can
 * be added later with no way to say what it is doing. The host used to name these
 * rows from a fixed table — "Searched attempt history" for every search, whatever
 * was searched for — which is accurate and says nothing. The agent knows why it is
 * making the call; this is where it says so.
 *
 * It is a label and never an instruction: shown, stored, and otherwise ignored.
 */
function withActionTitle(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (!(schema instanceof z.ZodObject)) return schema;
  return schema.extend({
    [ACTION_TITLE_KEY]: z.string().min(3).max(70).describe(
      "A short, specific title for this step, in the learner's language, shown as the row for this call in the transcript. Say what this particular call is for — \"Checking whether arrays have been tested\", \"Reading how you solved the window repair\" — not the tool's generic purpose. Sentence case, no trailing period, present participle while it runs.",
    ),
  });
}

async function run(request: Request) {
  const hasActiveQuestion=Boolean(request.payload.activeQuestion);
  const webSearch = request.payload.webSearch === true;
  /* Whether the learner has a practice source connected. Decided in the main
     process — it owns the credential — and passed in, so the worker never has to
     ask and a source that expired mid-session simply stops being offered. */
  const practiceSource = request.payload.practiceSource === true;
  const allowed = allowedTools(request.payload.turnKind,hasActiveQuestion,webSearch,practiceSource);
  const outcomes = new Map<string, unknown[]>();
  if (request.payload.resumeState?.objective) outcomes.set("set_session_objective", [request.payload.resumeState.objective]);
  if (request.payload.resumeState?.target && request.payload.turnKind !== "challenge-revision") outcomes.set("set_training_target", [request.payload.resumeState.target]);
  const callSignatures: string[] = [];
  const phaseExecutions = new Map<string, { phase: number; promise: Promise<unknown> }>();
  let currentPhase = -1;
  const protocolFailures = new Map<string, { count: number; detail: string }>();
  const record = (name: string, input: unknown, value: unknown) => {
    outcomes.set(name, [...(outcomes.get(name) ?? []), { input, result: value }]);
    callSignatures.push(`${name}:${stableJson(input)}`);
    assertNoExtremeToolLoop(callSignatures);
  };
  const tools = Object.fromEntries(Object.entries({ ...toolDefinitions, ...sourceToolDefinitions }).filter(([name]) => allowed.has(name)).map(([name, [description, schema]]) => [name, hostTool(request.id,request.payload.sessionId,name, description, withActionTitle(schema as z.ZodTypeAny), record, () => currentPhase, phaseExecutions)]));
  const model = createPiMastraModel(request.payload.provider);
  const agent = new Agent({ id: "spar-agent", name: "Spar", model, instructions: instructions().replaceAll("Training Agent","Spar"), tools, maxRetries: 1 });
  new Mastra({ agents: { training: agent }, logger: false });
  try {
    const usage: unknown[] = [];
    let finalText = "";
    let finishReason = "stop";
    for (let step = 0; step < AGENT_MAX_STEPS; step += 1) {
      currentPhase = step;
      const stage = nextToolStage(request.payload.turnKind, outcomes, CHALLENGE_COMPILATION_LIMIT,{hasActiveQuestion,webSearch,practiceSource});
      if (stage.exhausted) {
        const value = await publishFallbackChallenge(request, outcomes, stage.exhausted);
        parentPort.postMessage({ kind: "result", id: request.id, ok: value.ok, ...(value.ok ? { value: { text: value.text, usage: sumUsage(usage), finishReason: "fallback-challenge", phaseSteps: step + 1 } } : { error: value.error }) });
        return;
      }
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
      const phaseTimer = setTimeout(() => phaseAbort.abort(new Error(`Spar's provider phase exceeded ${AGENT_PHASE_TIMEOUT_MS / 1_000} seconds.`)), AGENT_PHASE_TIMEOUT_MS);
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
      if (stage.activeTools.length > 0 && callSignatures.length === callsBefore && stage.toolChoice === "required") {
        if (streamError) throw new Error(`Provider ${request.payload.provider.provider} failed during ${stageKey}: ${streamError}`);
        const previous = protocolFailures.get(stageKey);
        const count = (previous?.count ?? 0) + 1;
        const detail = `The provider ended without a valid call to one of: ${stage.activeTools.join(", ")}.`;
        if (count > PROTOCOL_RETRY_LIMIT) throw new Error(`Spar could not produce a valid ${stageKey} tool call after ${count} attempts: ${detail}`);
        protocolFailures.set(stageKey, { count, detail });
        parentPort.postMessage({ kind: "event", requestId: request.id, event: { type: "status", detail: `protocol-retry:${stageKey}:${count}` } });
        continue;
      }
      if (stage.toolChoice === "auto" && callSignatures.length === callsBefore) {
        finalText = text;
        parentPort.postMessage({ kind: "result", id: request.id, ok: true, value: { text: finalText, usage: sumUsage(usage), finishReason, phaseSteps: step + 1 } });
        return;
      }
      protocolFailures.delete(stageKey);
      if (stage.activeTools.length === 0) {
        finalText = text;
        parentPort.postMessage({ kind: "result", id: request.id, ok: true, value: { text: finalText, usage: sumUsage(usage), finishReason, phaseSteps: step + 1 } });
        return;
      }
    }
    throw new Error(`Spar exceeded ${AGENT_MAX_STEPS} phase steps.`);
  } catch (error) { parentPort.postMessage({ kind: "result", id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
}
/**
 * Every model-authored candidate was rejected. Publishing a host-authored
 * challenge is strictly better than ending the turn with a compiler error and
 * nothing to attempt — but the learner is told plainly that this one is a
 * standard exercise rather than one written for their stated gap, because a
 * fallback presented as bespoke would misrepresent the evidence it produces.
 */
async function publishFallbackChallenge(request: Request, outcomes: Map<string, unknown[]>, exhausted: { attempts: number; failure: string }): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const language = requestedLanguage(outcomes);
  try {
    const value = await callHostTool(request.id, request.payload.sessionId, "create_fallback_question", { language });
    if (!isPlayableQuestion(value)) {
      return { ok: false, error: `Challenge generation stopped after ${exhausted.attempts} rejected compilation attempts, and the standard fallback challenge could not be published either.${exhausted.failure ? ` Latest failure: ${exhausted.failure}` : ""}` };
    }
    return { ok: true, text: `I could not get a challenge written for your exact target past validation, so I've set a standard ${language === "cpp" ? "C++" : language} exercise instead — tracing when a running total first crosses a threshold. It still shows me whether you follow state step by step or pattern-match, and I'll use what it shows to aim the next one properly.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The language the agent was actually authoring in, taken from its own attempts. */
function requestedLanguage(outcomes: Map<string, unknown[]>): Language {
  const attempts = [...(outcomes.get("create_question") ?? []), ...(outcomes.get("replace_current_question") ?? [])];
  for (const attempt of attempts.reverse()) {
    const input = (attempt && typeof attempt === "object" ? (attempt as { input?: unknown }).input : undefined) as { language?: unknown } | undefined;
    const parsed=languageSchema.safeParse(input?.language);if(parsed.success)return parsed.data;
  }
  return "javascript";
}

function orchestrationPrompt(request: Request, outcomes: Map<string, unknown[]>, activeTools: string[], step: number, protocolFailure?: string) {
  const evidence = Object.fromEntries([...outcomes.entries()].map(([name, values]) => [name, values.at(-1)]));
  const compilationFeedback = activeTools.some((tool)=>tool==="create_question"||tool==="replace_current_question"||tool==="assign_practice_problem") ? latestRejectedCompilationFeedback(outcomes) : "";
  const phaseInstruction=protocolFailure
    ? `Your previous response did not produce a schema-valid host tool call: ${protocolFailure}. Call exactly one tool from ${activeTools.join(", ")} now. Correct only the tool-call JSON shape; do not answer in prose.`
    : activeTools.length?(request.payload.turnKind==="learner-message"?`${compilationFeedback?`The previous challenge candidate was rejected by deterministic compilation: ${compilationFeedback} Fix that exact failure before trying again. `:""}${request.payload.activeQuestion?`An active challenge exists (question ${request.payload.activeQuestion.id}, attempt ${request.payload.activeQuestion.attemptId}). create_question is intentionally unavailable. If the learner says the challenge is too difficult, asks to change it, or confirms "do it", inspect the current attempt if needed, adjust the target if needed, then call replace_current_question. Never answer that a replacement cannot be launched merely because a challenge is active; replacement is the supported operation. `:"No active challenge exists, so create_question is the supported creation operation. "}Respond to the learner's actual request. Use a tool whenever they ask you to inspect or change real tests, challenges, account history, or abilities. You may call one best tool now, or answer concisely if no tool is needed. Never claim a state change without its successful tool result.`:`${compilationFeedback ? `The previous challenge candidate was rejected by deterministic compilation: ${compilationFeedback} Revise the candidate to fix that exact failure. A known-incorrect implementation must pass every visible test and fail a hidden test; do not submit a placeholder or deliberately visible-failing implementation. ` : ""}Before the call, write one short sentence addressed to the learner saying what you are about to do and why it follows from what you just found — one sentence, present tense, no preamble and no restating this instruction. Then call the single best required next tool from this allowlist: ${activeTools.join(", ")}. Do not write anything else: the sentence and the call, nothing more.`):completionInstruction(request.payload.turnKind,outcomes);
  return `${request.payload.context}\n\nLatest learner action:\n${request.payload.message}\n\nDurable results from earlier phases of this same Spar turn:\n${stableJson(evidence)}\n\nPhase ${step + 1}. ${phaseInstruction}`;
}

/**
 * What the agent gets to repair from. Deliberately generous: this is the only
 * channel carrying the compiler's own words back to the model, and clipping it
 * to a label-sized budget is what made a rejection unactionable.
 */
function latestRejectedCompilationFeedback(outcomes: Map<string, unknown[]>): string {
  const latest = outcomes.get("assign_practice_problem")?.at(-1) ?? outcomes.get("replace_current_question")?.at(-1) ?? outcomes.get("create_question")?.at(-1);
  if (!latest || typeof latest !== "object") return "";
  const result = (latest as { result?: unknown }).result;
  if (!result || typeof result !== "object" || (result as { status?: unknown }).status === "playable") return "";
  const failures = failedChecks(result);
  if (!failures.length) return "";
  return failures.map((failure, index) => `(${index + 1}) ${failure}`).join(" ").slice(0, 2_400);
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
  if (identical >= IDENTICAL_TOOL_CALL_LIMIT) throw new Error(`Spar stopped after ${identical} identical tool calls; probable provider loop.`);
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function settle(message: Record<string, unknown>) { const pending = pendingTools.get(String(message.id)); if (!pending) return; pendingTools.delete(String(message.id)); if (message.ok) pending.resolve(message.value); else pending.reject(new Error(String(message.error))); }
/**
 * The exact build contract per language. C++ had none, so every C++ candidate
 * was authored against a layout the host could not build, and the rejection
 * said only that the command exited non-zero — fifteen times, then a dead
 * session. The host is the authority on these rules; stating them here is what
 * lets the first candidate be the one that compiles.
 */
function languageContracts() {
  return [
    `Every synthetic test harness must report cases, not merely exit correctly. Emit TAP or print exactly one line beginning \"ok - \" or \"not ok - \" for every named case. On failure also print indented \"expected: \" and \"actual: \" lines, continue checking the remaining cases where the language permits it, and exit non-zero after reporting all failures. A bare assert, raise, precondition, t.Fatal, or equivalent is invalid because successful checks are silent and cannot populate the structured Test Result UI. The compiler executes both the reference and a known-incorrect implementation and rejects a candidate unless both passing and failing case verdicts are observed.`,
    `A JavaScript question uses Node's built-in test runner, .js files, no dependencies, and runCommand "node --test". Visible and hidden tests are separate *.test.js files that import the implementation relatively.`,
    `A TypeScript question follows the same contract with .ts files and *.test.ts tests.`,
    `A Python question uses dependency-free .py files and standalone test_*.py or *_test.py scripts with assertions; tests import the implementation from the workspace root.`,
    `A Java question uses dependency-free .java files in the default package. Put implementation classes under src/ and standalone assertion-enabled test classes in files ending Test.java, each with public static void main(String[] args).`,
    `A C question declares functions in a header, defines them in a .c implementation without main, and puts each standalone int main(void) test in its own *.test.c file. Code must build under clang -std=c17 -Wall -Wextra -pedantic.`,
    `A C++ question has no test framework available. The implementation is a library: declare its functions in a header (for example src/window.h) and define them in a matching .cpp (src/window.cpp) that must not define main. Every test is a separate standalone program under tests/ (for example tests/visible.test.cpp and tests/hidden.test.cpp), each with its own int main() that includes the header by its bare name, reports every comparison with the case protocol above, and returns 0 only when they all hold. The host compiles each test file into its own binary against the implementation, so never define main in the implementation and never put two tests in one file. Ship every header you include in both starterFiles and referenceFiles. Code must build under clang++ -std=c++20 -Wall -Wextra -pedantic.`,
    `A Go question uses one dependency-free package under src/: implementation *.go files and visible/hidden *_test.go files using the standard testing package.`,
    `A Rust question uses a dependency-free src/*.rs implementation and standalone *_test.rs or *.test.rs harnesses compiled with rustc --test; each harness imports the implementation with #[path = "../src/file.rs"] mod name.`,
    `A Swift question uses dependency-free src/*.swift implementation files and separate *.test.swift programs, each declaring one @main test type and checking with precondition.`,
    `A Ruby question uses dependency-free .rb implementation files and standalone *_test.rb or *.test.rb scripts that require_relative the implementation and raise on failed expectations.`,
  ].join(" ");
}

function instructions() { return `You are the single Training Agent for a personalized coding gym. Own pedagogical decisions, not persistence, execution, or correctness verification. On a cold-start turn, retrieve learner and attempt evidence once, then ask exactly one short, plain-language question establishing prerequisite experience and confidence for the stated goal; do not set a target or create a challenge. For a new broad goal with existing evidence or a completed cold-start answer: call search_learner_model once and search_attempt_history once using focused queries, then stop retrieving, set a concise session objective, set exactly one Training Target, and create one complete validated question. Retrieved history calibrates difficulty but must never replace the learner's current goal: use prior evidence only when it is materially relevant, and otherwise choose an accessible foundation diagnostic from the goal and placement answer. A goal names a surface, and a broad goal names a wide one — "pass a Google interview" is arrays, hashing, two pointers, recursion, trees, graphs, and complexity, not whichever narrow gap the ledger already happens to hold. Before setting the first target of a session, name the surface this goal describes and choose inside it; a search hit is only relevant if it sits on that surface, and a ledger holding one or two abilities will return them for almost any query, which is a property of the search and not evidence about this goal. The context's recentChallenges is the record of what you have already asked, across every session, most recent first. Read it as a coverage constraint: do not aim a session's first target at a primary concept that already dominates that list unless the goal itself names that concept or the learner's most recent attempt on it failed, and never repeat a challenge's operation under a new title. Foundation difficulty means an accessible first rung on this goal's surface, never a retreat to the same off-by-one loop repair for every goal. When retrieved evidence contains an existing ability that genuinely sits on this goal's surface, reuse its exact title so evidence updates the same durable Ability Ledger identity; when nothing retrieved belongs to this goal, open a new ability for it rather than bending the goal to fit the ledger. Treat a cold-start answer as evidence about accessibility and never infer advanced readiness merely because the learner named an advanced topic. Write every question in the context's preferredLanguage unless the learner explicitly asks for a different one in this session; their request wins over the preference for as long as they hold it. When the context carries a learnerProfile, treat its stated experience and weakness as self-reported evidence that calibrates the first target before any attempt exists — weaker than a recorded attempt, and never a reason to skip retrieval. ${languageContracts()} Starter and reference maps must use the same implementation path, so the reference replaces the exact file the learner edits. A repair challenge ships a starter that already runs and is wrong, so its statement must name the intended contract and the observable failure, then ask the learner to correct the implementation without changing its public API. Only a challenge whose starter is a stub asks the learner to implement the operation from scratch. Every reference solution must pass all tests. Every known incorrect implementation must represent the targeted misconception, pass all visible tests, and fail when hidden tests are included. The question's observable return contract must expose the targeted misconception: for repeated invariant restoration, do not rely only on a monotone maximum if a one-step shrink can return the same maximum; prefer counting valid windows, returning restored state, or another output where incomplete restoration is behaviorally distinguishable. Before calling create_question, ensure its title, statement, function contract, examples, reference code, visible tests, hidden tests, and expected failure signatures all describe the same exact operation and constraints. The model only proposes candidate designs; it must never declare a candidate or learner submission correct. The deterministic host compiler and runner are the sole verification authority. When create_question returns status invalid, read its failed checks, revise the candidate to address those exact failures, and call create_question again; continue until the host publishes a playable candidate or stops the bounded run. There is no reviewer or judge model. Every tool call takes an actionTitle, and it is the row the learner sees for that step in the transcript. Write it about this specific call, in their language: name what you are looking for or deciding, not what the tool is called. "Checking whether arrays have ever been tested" and "Reading how you solved the window repair" are titles; "Searched attempt history" and "read_ability" are not. Keep it under about eight words, sentence case, no trailing period, and phrased as the action in progress. It is a caption and never an instruction to yourself. Use tools as reality and never claim a write, test, evaluation, or update without its tool result. After a completed attempt: replay the attempt once and read how it was solved, read its already-recorded deterministic evaluation once, read the active ability once, propose one evidence-backed markdown update, commit exactly one action (diagnose, teach, practise, transfer, advance, or retain), call search_learner_model once for wider context, then either ask the learner about a specific moment the replay could not explain or create the next target and validated question. The next question must discriminate what remains uncertain from the attempt in a meaningfully different representation while avoiding unrelated difficulty. Its persisted Training Target and generated task must name the same transfer context and constraint. Prefer evidence over scores and never overreact to one attempt. Keep chat concise.

${syntheticChallengeAuthoringDoctrine()}

${replayDoctrine()}

${conceptDoctrine()}

${sourceDoctrine()}`; }

/**
 * Real problems, and when to reach for one.
 *
 * Stated as a preference with reasons rather than as a rule, because the failure
 * modes run in both directions. An agent that never uses the source wastes the
 * strongest thing available to it — a problem with a real judge, a real
 * difficulty and the learner's own history attached. An agent that always uses
 * it stops being a coding gym that watches you and becomes a problem shuffler,
 * and it will hand someone a 200-line contest problem to test an off-by-one.
 *
 * The last paragraph is the one that matters most. Every honest thing Spar says
 * about a verdict depends on the agent knowing which judge answered.
 */
function sourceDoctrine() {
  return `Problem providers form one catalogue, not a platform preference. Search fans out across every available provider and every result carries a source identity; preserve that source with its slug when you read and assign it. Choose the best-fitting problem regardless of provider. A real problem is usually the better instrument: it was written and calibrated by people, its hidden cases are ones you did not write, its verdict comes from its provider, and—when that provider is connected—the learner's own solved, attempted, and abandoned history is evidence you cannot get another way. Search before you set a challenge: you are made to once per turn and it costs almost nothing. Read any candidate with read_practice_problem before assigning it, using the result's exact source and slug, because tags say where a problem is filed and only the statement says what it actually asks.

Assign one when it genuinely lands on your target. That means the problem exercises the specific gap the target names, not merely the same topic: "arrays" is not a target and a problem tagged Array is not evidence about index arithmetic. Set the primary concept to the gap you are testing rather than to the source's own tag, or the challenge will be filed under a shelf and disappear from the evidence for the thing you were actually checking. Prefer a problem they have not solved; assigning one they have solved is defensible only when the point is to compare against how they solved it before, and you must say so. Never assign a problem you have not read, and never describe its contents in your reply — they are about to read it themselves.

Write your own instead whenever the source has nothing that fits. That is not a failure: a target aimed at a specific misconception, a repair challenge, a transfer into an unusual representation, or anything in a language or a shape the source does not carry is exactly what create_question is for. The source is a library, not a syllabus, and a challenge written for one learner's gap will often beat anything in it.

Be exact about who graded what. A challenge from a source with its judge behind it is graded there, against every hidden case that problem has, and a pass means the problem was solved. A challenge graded locally is checked against the examples published with the problem and nothing more, and a pass means only that those examples passed — say that, and never call it accepted. The reply from every source tool tells you which of the two you are looking at; read it rather than assuming, because the learner may have connected the source, disconnected it, or chosen to keep their code on their own machine.`;
}

/**
 * The solve, as evidence.
 *
 * Everything else the agent reads is a summary of an outcome. This is the only
 * instrument that shows the work: which case they could never get, which one
 * they broke while fixing another, how long they sat before running anything.
 * Stated as an obligation because the failure mode is not misusing it — it is
 * skipping it and aiming the next question at a score.
 */
function replayDoctrine() {
  return `A verdict tells you almost nothing about a learner. Two people reach 6/7 by completely different routes, and the one who fixed a case in ninety seconds is not the one who broke two others getting there. replay_attempt gives you the attempt's raw log to see the difference with: every recorded event in order with its offset, every test case's result inside every run with its expected and actual values, plus the per-case history across runs and each run's newly-passing and newly-failing sets. It states no conclusions — reading it is your job. Call it before you judge a completed attempt, and again on any later turn where the learner's own behaviour is what is in question. Default to taking the whole log; narrow with eventTypes, cases, scope or maxLines only when the attempt is long or you genuinely need one metric, and when a log comes back truncated raise maxLines rather than guessing at what was cut.

These are the readings that have carried the most, and you are expected to find others. A case that never passed across several runs is where the misconception lives, and it is worth far more than the total. A case that passed and then failed again is the sharpest thing in the log: their fix for one thing broke another, so the two are not separate in their model of the problem. A hidden case first seen on a submission tells you what they could not have known; a visible case failed repeatedly tells you what they could read and still could not do. Offsets are evidence too — a long stretch before the first run, a run after nearly every save, a long quiet gap before a correct fix — and so is work recorded after the grade, which counts for nothing and still says a lot.

Then aim the next question at what the behaviour exposes rather than at the score, and cite the actual moment when you speak to the learner: "the shrink case was passing at +12:36 and broke when you fixed the total" is worth more to them than any summary, and it is how they learn Spar is really watching. Quote only what the log contains — offsets, case names, values — and never dress an event up as a motive. The log says what happened, never why. When the why matters for aiming the next question, and it usually does, ask them with ask_user_question and name the exact moment you are asking about. Asking is a first-class outcome of reading a log rather than a failure to decide: a question that makes the next challenge land beats a confident guess that misses, so do not hesitate to ask, and ask again whenever a later attempt raises something new.`;
}

/**
 * Concepts and Abilities, stated as obligations rather than as features.
 *
 * The reason this is a whole paragraph: tagging is the only thing that makes a
 * challenge visible to the learner's concept history, and an untagged challenge
 * is evidence that no future turn can find. Granting an Ability is the opposite
 * problem — it is the one place the agent is allowed to tell the learner they can
 * do something, so the bar has to be evidence rather than encouragement.
 */
function conceptDoctrine() {
  return `Concepts are Spar's shared vocabulary for what a challenge is about, and they are how the learner and every later turn find their own history. Every create_question and replace_current_question call must carry concepts. Tag at the resolution a decision could be made from: window-invariant-restoration rather than sliding-window, aliasing rather than references-and-mutation, state-definition rather than dynamic-programming. Exactly one tag has role primary and it must name what the challenge is actually aimed at — the same thing the Training Target's specificGap describes — with the rest supporting. Call read_concept_graph before tagging a topic you have not tagged before, and reuse the slugs it returns rather than inventing a near-duplicate; introduce a new slug only when nothing returned covers what you are really testing, and give it a title, kind and parentSlug when you do. Concept evidence is the sharpest instrument you have for aiming the next question: before choosing a target on a session-start or attempt-complete turn, call search_concept_evidence for the area in question and read its subConcepts before its totals, because an area that averages out fine routinely hides one sub-concept the learner has never once passed. A concept with several failures and no passes is where to teach; one with a single pass is not yet learned; one the learner has never met is not a weakness. Note replacedUnderThisConcept as evidence about your own aim rather than about them.

An Ability is what the learner is told they can now do, so treat it as something granted on evidence rather than as a document you keep. Introduce one with upsert_ability when you set a target — that is the hypothesis, and it is correctly uncertain with no evidence behind it. Then, once deterministic outcomes actually support it, call it again with the evidence event ids and give it the three things that make it an ability rather than notes: a summary of one sentence, addressed to the learner, naming what they can do and under what conditions; the concepts it covers, using slugs you have tagged challenges with, so they can reach the evidence themselves; and up to four practice drills, each phrased as the learner's own first-person goal because each one starts a session. Make the drills genuinely different from each other — a new transfer context, a harsher constraint, a larger scale, a repair instead of a build — and never merely "the same thing but harder". Do not grant an ability from one passing attempt, do not grant one from a challenge the learner walked away from, and never write a summary that claims more than the recorded outcomes support.`;
}
