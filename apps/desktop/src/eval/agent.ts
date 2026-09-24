import { digest, type TraceWriter } from "@spar/eval";
import type { LocalStore } from "../main/store.js";
import { executeTrainingTool } from "../main/trainingTools.js";
import { agentToolSchemas } from "../workers/agentTools.js";
import type { Scenario, ScriptedAttempt } from "./types.js";

/**
 * A competent agent, written down.
 *
 * The point of a scripted agent is to hold the pedagogy fixed so that a
 * difference between two runs is a difference in the host. That only works if
 * the script is honest about what an agent can *see*, which is the one rule
 * everything here is built around:
 *
 * **It may only act on what a tool handed back.** It never reads the store.
 * Every decision below is a function of tool results and of the scenario's own
 * script, and nothing else. An agent that peeked would find its earlier
 * hypothesis in both arms of a comparison and the run would show no difference —
 * where the actual difference is that one arm could not see it. The instrument
 * would read zero because the instrument was broken, which is the worst possible
 * failure for an eval and the easiest one to write by accident.
 *
 * It is also deliberately *good*. It reads before it writes, it interprets
 * rather than grades, it links every event it is shown, and it proposes the same
 * pattern title again rather than a fresh one. That is what makes the result
 * legible: when this agent still fails to accumulate a finding, the agent is not
 * what went wrong.
 *
 * Every call is validated against the real tool contract before it is made. A
 * call this agent could not legally make is a call the model could not make
 * either, and it fails here loudly rather than silently taking a path the
 * product does not have.
 */

export type AgentDeps = { store: LocalStore; sessionId: string; scenario: Scenario; writer: TraceWriter };

export function scriptedAgent(deps: AgentDeps) {
  const { store, sessionId, scenario, writer } = deps;
  const schemas = agentToolSchemas();
  let step = 0;
  let abilityId = "";
  /* Whether anything has gone wrong yet. A standing finding is a claim that the
     learner keeps making a mistake, so an agent that files one after a run of
     clean solves has invented it — and a suite that only ever rewards *finding*
     something would teach exactly that. Tracked from the attempts themselves
     rather than from the store, like everything else here. */
  let sawTrouble = false;

  /** One tool call, traced on both sides, with the host's own `checks` carried
   *  through — they are the richest label in the system and the eval scores them
   *  rather than second-guessing them. */
  async function call(name: string, input: Record<string, unknown>, actionTitle: string): Promise<Record<string, unknown>> {
    step += 1;
    const schema = schemas[name];
    if (!schema) throw new Error(`The scripted agent tried to call ${name}, which is not a tool this build offers`);
    /* Validated against the contract the model is shown. A required field the
       agent forgot is a turn the provider would have rejected, and an eval that
       let it through would be measuring a product that does not exist. */
    const payload = schema.parse({ ...input, actionTitle }) as Record<string, unknown>;
    writer.emit({ kind: "stage", step, activeTools: [name], toolChoice: "required" });
    writer.emit({ kind: "tool_call", step, name, inputHash: digest(payload), input: redact(payload) });
    try {
      const result = (await executeTrainingTool(name, payload, sessionId, store, undefined as never, undefined as never)) as Record<string, unknown>;
      const report = (result?.report ?? {}) as { checks?: Array<{ name: string; passed: boolean; detail?: string }> };
      writer.emit({
        kind: "tool_result", step, name, ok: result?.status !== "invalid",
        status: String(result?.status ?? "ok"), outputHash: digest(result),
        checks: (report.checks ?? []).map((check) => ({ name: check.name, passed: check.passed, detail: check.detail ?? "" })),
      });
      return result ?? {};
    } catch (error) {
      writer.emit({ kind: "tool_result", step, name, ok: false, status: "threw", outputHash: "", checks: [] });
      writer.emit({ kind: "error", message: `${name}: ${error instanceof Error ? error.message : String(error)}`, fatal: false });
      return {};
    }
  }

  return {
    /** The target, before any attempt exists. Named from the scenario because a
     *  scripted agent is not being tested on its ability to name things. */
    async openTarget() {
      const target = await call("set_training_target", {
        ability: scenario.ability.title,
        specificGap: scenario.misconception.statement,
        desiredEvidence: `Restores the invariant repeatedly rather than once, on a problem where one shrink is not enough.`,
        avoidTesting: ["unrelated data structures"],
      }, "Aiming at the invariant");
      abilityId = String(target.abilityId ?? "");
    },

    /**
     * The turn after a finished attempt: read, then write.
     *
     * The order is the whole thing. Reading first is what gives the agent the
     * chance to recognise its own earlier hypothesis, and the difference between
     * the two arms of a comparison is entirely in what those reads return.
     */
    async afterAttempt(input: { attemptNumber: number; attemptId: string; attempt: ScriptedAttempt; eventIds: string[] }) {
      const { attempt, eventIds, attemptNumber } = input;
      if (attempt.outcome !== "passed" || attempt.hints > 0) sawTrouble = true;

      await call("read_attempt", { attemptId: input.attemptId }, "Reading how it went");
      const ability = await call("read_ability", { abilityId }, "Reading what Spar already believes");
      const search = await call("search_learner_model", { query: `${scenario.misconception.slug} invariant shrink`, limit: 4 }, "Looking for the same mistake before");

      /* Every durable event this attempt offers, plus every event an earlier
         interpretation was already attached to — recovered only from what the
         two reads above actually returned. In a build that hands patterns and
         evidence back this reaches across attempts; in one that does not it is
         this attempt alone, and the host will decline to promote anything on
         one attempt's evidence. That decline is the finding. */
      const priorEvents = [...visibleEventIds(ability), ...visibleEventIds(search)];
      const patternTitle = titleFor(scenario);
      const seenBefore = [...visiblePatterns(ability), ...visiblePatterns(search)].some((pattern) => pattern.toLowerCase() === patternTitle.toLowerCase());

      await call("propose_ability_update", {
        abilityId,
        markdown: markdown(scenario, attemptNumber, attempt),
        evidenceEventIds: eventIds.slice(-2),
        summary: scenario.misconception.statement,
        /* One entry per durable event, saying what the learner did rather than
           how it came out. This is the interpretation the contract now insists
           on, and the wording is the scenario's own reading of the attempt. */
        evidence: eventIds.slice(-2).map((eventId) => ({
          eventId,
          statement: attempt.reading,
          polarity: attempt.outcome === "passed" ? "supporting" : "contradictory",
          independence: attempt.hints > 0 ? "assisted" : "independent",
          strength: attempt.regressed ? 0.9 : 0.6,
        })),
        /* Proposed as a pattern once there is reason to think it recurs, and as
           an observation the first time. The host decides which it actually
           becomes — it refuses to promote anything whose evidence does not span
           two attempts — so this is a request and never a claim. */
        ...(sawTrouble ? { pattern: {
          title: patternTitle,
          description: scenario.misconception.statement,
          status: seenBefore ? "pattern" : "observation",
          evidenceEventIds: [...new Set([...priorEvents, ...eventIds.slice(-2)])].slice(0, 8),
        } } : {}),
      }, "Writing down what that showed");

      await call("commit_session_decision", {
        action: attempt.outcome === "passed" && attempt.hints === 0 ? "transfer" : "diagnose",
        reason: `${attempt.reading} The next challenge has to need more than one shrink.`,
      }, "Choosing what to do next");
    },
  };
}

/** The pattern's name. Stable across attempts on purpose: proposing the same
 *  title again is what promotion is, and a title that drifted would file the
 *  same finding under a second row every time. */
function titleFor(scenario: Scenario): string {
  return `${scenario.ability.title}: ${scenario.misconception.slug}`;
}

function markdown(scenario: Scenario, attemptNumber: number, attempt: ScriptedAttempt): string {
  return [
    `# ${scenario.ability.title}`,
    "",
    scenario.misconception.statement,
    "",
    `Attempt ${attemptNumber}: ${attempt.reading}`,
  ].join("\n");
}

/** Event ids reachable from a tool result, wherever that result chose to put
 *  them. Shape-tolerant because the shape is one of the things that changed, and
 *  a reader that knew only the new shape would report the old build as having
 *  returned nothing when in fact it was never asked properly. */
function visibleEventIds(result: unknown): string[] {
  const rows = [...arrayAt(result, "evidence"), ...arrayAt((result as Record<string, unknown>)?.learnerModel, "evidence")];
  return rows.map((row) => String((row as Record<string, unknown>)?.eventId ?? "")).filter(Boolean);
}

function visiblePatterns(result: unknown): string[] {
  const rows = [...arrayAt(result, "patterns"), ...arrayAt((result as Record<string, unknown>)?.learnerModel, "patterns")];
  return rows.map((row) => String((row as Record<string, unknown>)?.title ?? "")).filter(Boolean);
}

function arrayAt(value: unknown, key: string): unknown[] {
  const candidate = (value as Record<string, unknown> | undefined)?.[key];
  return Array.isArray(candidate) ? candidate : [];
}

/** Long prose out of the trace; its hash is already the identity. Keeps a trace
 *  readable in a terminal and keeps a diff about decisions rather than about
 *  paragraphs. */
function redact(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, typeof value === "string" && value.length > 120 ? `${value.slice(0, 117)}…` : value]));
}
