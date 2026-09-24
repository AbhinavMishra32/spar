import type { TraceWriter } from "@spar/eval";
import { agentTurnPayload } from "../main/agentTurnPayload.js";
import type { LocalStore } from "../main/store.js";
import type { PiProviderInput } from "../workers/piProvider.js";
import { openAgentWorker } from "./worker.js";
import type { Scenario, ScenarioAgent, ScriptedAttempt } from "./types.js";

/**
 * The real agent, on the real worker, against a real model.
 *
 * Nothing about the turn is assembled here. The message is the one
 * `startAgentTurn` sends after a finished attempt, and the payload around it
 * comes from `agentTurnPayload` — the same function the main process calls — so
 * a live eval and a live app put the same words in front of the model. The
 * moment those two diverge, a live eval measures something the product does not
 * do, and every number it produces becomes an argument about the harness.
 *
 * What this is *for* is the half a scripted run cannot reach. A scripted run
 * holds the agent still and measures the host; a live run lets the agent move
 * and measures whether a model, shown Spar's context and given Spar's tools,
 * actually arrives at the specific thing this learner gets wrong. The two
 * numbers answer different questions and are never averaged together.
 */

export async function liveAgent(deps: {
  store: LocalStore;
  sessionId: string;
  scenario: Scenario;
  writer: TraceWriter;
  provider: PiProviderInput;
}): Promise<ScenarioAgent> {
  const { store, sessionId, scenario, writer, provider } = deps;
  const worker = await openAgentWorker({ store, writer });

  const turn = async (message: string, turnKind: "session-start" | "attempt-complete") => {
    const payload = agentTurnPayload({
      store, sessionId, message, turnKind,
      /* Off, both of them. A live eval that reached the open web or a practice
         source would be measuring those services' availability on the day, and
         a cassette of it would be unreplayable the moment either changed. */
      webSearch: false, practiceSource: false, practiceSummary: null,
      accountId: "eval",
    });
    await worker.turn({ ...payload, provider });
  };

  return {
    async openTarget() {
      await turn(`I want to work on this: ${scenario.goal}`, "session-start");
    },

    async afterAttempt(input: { attemptNumber: number; attemptId: string; attempt: ScriptedAttempt }) {
      await turn(attemptMessage(input.attemptId, input.attempt), "attempt-complete");
    },

    close() { worker.close(); },
  };
}

/**
 * What the host says to the agent when an attempt ends.
 *
 * Copied in shape from `ipc.ts`, and deliberately *not* carrying the scenario's
 * own reading of the attempt. The scripted agent is handed that reading because
 * the point of a scripted run is to measure what the host does with a good one;
 * a live run is asking whether the model can produce one from the durable events
 * alone, and telling it the answer first would make every live number an
 * agreement with the fixture rather than a finding about the model.
 */
function attemptMessage(attemptId: string, attempt: ScriptedAttempt): string {
  if (attempt.outcome === "passed") {
    return `The learner solved attempt ${attemptId} — every visible and hidden test passed. Replay attempt ${attemptId} first and read how they got here. Update the relevant ability document, commit exactly one next pedagogical action, and either ask about a specific moment the replay could not explain or aim the next target and validated question. The new target and question must explicitly respond to this attempt without overreacting to it.`;
  }
  return `The learner gave up on attempt ${attemptId}. Replay attempt ${attemptId} first and read how far they got and where it went wrong. Update the relevant ability document, commit exactly one next pedagogical action, and aim the next target at what the replay actually showed.`;
}

/**
 * The provider a live run talks to, from the environment.
 *
 * From the environment rather than from the learner's keychain, and rather than
 * from a file: an eval that read the developer's own saved credentials would
 * charge their account for a run they did not know they had started, and one
 * that read a file would put a key one `git add -A` away from being published.
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): PiProviderInput | null {
  const apiKey = env.SPAR_EVAL_API_KEY ?? "";
  const model = env.SPAR_EVAL_MODEL ?? "";
  if (!apiKey || !model) return null;
  return {
    provider: env.SPAR_EVAL_PROVIDER ?? "anthropic",
    model,
    api: env.SPAR_EVAL_API ?? "anthropic-messages",
    baseUrl: env.SPAR_EVAL_BASE_URL ?? "",
    apiKey,
    ...(env.SPAR_EVAL_REASONING ? { reasoningEffort: env.SPAR_EVAL_REASONING as never } : {}),
  };
}

/** What a replay needs, which is everything except the key. A cassette carries
 *  the model id in every recorded request, so a replay pointed at a different
 *  model simply misses on every turn and says so. */
export function replayProvider(env: NodeJS.ProcessEnv = process.env): PiProviderInput {
  return providerFromEnv(env) ?? {
    provider: env.SPAR_EVAL_PROVIDER ?? "anthropic",
    model: env.SPAR_EVAL_MODEL ?? "recorded",
    api: env.SPAR_EVAL_API ?? "anthropic-messages",
    baseUrl: env.SPAR_EVAL_BASE_URL ?? "",
    /* Never sent anywhere: in replay the cassette answers before the request
       leaves, and in every other mode this function is not called. */
    apiKey: "replay",
  };
}
