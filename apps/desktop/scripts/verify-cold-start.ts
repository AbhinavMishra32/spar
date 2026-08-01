import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { app } from "electron";
import keytar from "keytar";
import { LocalStore } from "../src/main/store.js";
import { executeTrainingTool } from "../src/main/trainingTools.js";
import { UtilityClient } from "../src/main/utilityClient.js";
import { WorkspaceService } from "../src/main/workspaces.js";

const launch = () => void verify().catch((error) => { console.error(`COLD_START_E2E_ERROR ${error instanceof Error ? error.stack ?? error.message : String(error)}`); app.exit(1); });
if (app.isReady()) launch(); else app.once("ready", launch);

async function verify() {
  const root = await mkdtemp(path.join(tmpdir(), "spar-cold-start-e2e-"));
  const store = new LocalStore(path.join(root, "state.sqlite3"));
  const workspaces = new WorkspaceService(path.join(root, "workspaces"));
  const runner = new UtilityClient("runner", () => {});
  let phase: "placement" | "first-question" = "placement";
  const calls: Array<{ phase: string; name: string }> = [];
  const agent = new UtilityClient("agent", (event) => {
    const value = event.event as { type?: unknown; tool?: unknown; detail?: unknown } | undefined;
    if (value?.type === "tool") console.log(`AGENT_EVENT phase=${phase} tool=${String(value.tool ?? "unknown")} detail=${String(value.detail ?? "")}`);
  }, async (name, input, context) => {
    calls.push({ phase, name });
    return executeTrainingTool(name, input, context.sessionId, store, workspaces, runner);
  });
  try {
    const apiKey = await keytar.getPassword("ai.spar.desktop", "provider:openrouter");
    if (!apiKey) throw new Error("OpenRouter credential is missing from Spar Keychain");
    const provider = { provider: "openrouter", model: process.env.SPAR_VERIFY_MODEL?.trim() || "openrouter/free", baseUrl: "https://openrouter.ai/api/v1", apiKey };
    const goal = "Understand event loop scheduling in JavaScript";
    const { sessionId } = store.createSession(goal);
    if (store.hasLearnerEvidence()) throw new Error("Fresh account unexpectedly contains learner evidence");

    await withTimeout(agent.request("turn", {
      sessionId,
      message: `This account has no Ability Ledger entries or completed attempts. Ask exactly one plain-language prerequisite placement question for: ${goal}. Do not create a challenge.`,
      context: JSON.stringify({ session: store.readSession(sessionId)?.summary, relevantAbilitySummary: [] }),
      turnKind: "cold-start",
      provider,
    }).promise, 600_000, "cold-start placement turn");

    const pending = store.pendingIntake(sessionId);
    if (!pending?.question) throw new Error("Cold-start turn did not persist a learner question");
    const placementNames = calls.filter((call) => call.phase === "placement").map((call) => call.name);
    for (const required of ["search_learner_model", "search_attempt_history", "ask_learner"]) if (!placementNames.includes(required)) throw new Error(`Cold-start turn skipped ${required}`);
    for (const forbidden of ["set_session_objective", "set_training_target", "create_question"]) if (placementNames.includes(forbidden)) throw new Error(`Cold-start turn incorrectly called ${forbidden}`);
    if (store.readSession(sessionId)?.question) throw new Error("Cold-start turn created a challenge before placement was answered");

    const answer = "I know variables and functions, but I have never used callbacks, Promises, async/await, microtasks, or timers.";
    store.answerIntake(sessionId, answer);
    phase = "first-question";
    await withTimeout(agent.request("turn", {
      sessionId,
      message: `The learner answered the placement question: ${answer}\nCreate a foundation-level first challenge that introduces ordinary function-call and callback sequencing. Avoid Promises, microtasks, timers, and async syntax because those prerequisites are absent.`,
      context: JSON.stringify({ session: store.readSession(sessionId)?.summary, relevantAbilitySummary: [], placementAnswer: answer }),
      turnKind: "session-start",
      provider,
    }).promise, 1_200_000, "post-placement first question turn");

    const detail = store.readSession(sessionId);
    const question = detail?.question;
    if (!question) throw new Error("Post-placement turn did not create a question");
    if (question.difficulty !== "foundation") throw new Error(`Expected foundation difficulty after novice placement, received ${question.difficulty}`);
    if (/microtask|Promise\.resolve|setTimeout|timer callback|event-loop phase/i.test(question.statement)) throw new Error("Foundation question still assumed event-loop primitives the learner said they do not know");
    console.log(JSON.stringify({
      model: provider.model,
      learnerEvidenceBeforePlacement: 0,
      pendingQuestion: pending.question,
      challengeBeforeAnswer: false,
      firstQuestion: { title: question.title, difficulty: question.difficulty, statement: question.statement },
      placementTools: placementNames,
    }, null, 2));
  } finally {
    runner.stop(); agent.stop(); store.close(); await rm(root, { recursive: true, force: true }); app.quit();
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise, new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}
