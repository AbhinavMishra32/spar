import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { Context, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createTrainingAgent, normalizePiAgentEvent, phaseToolChoice, piAgentTools, toolErrorText, type ToolChoiceRef } from "./piAgent.js";
import type { PiProviderInput } from "./piProvider.js";

const provider: PiProviderInput = { provider: "spar-faux", model: "training-faux", api: "spar-faux", baseUrl: "http://localhost:0", apiKey: "test" };

/** One faux provider, plus the requests it was actually sent. What reaches the
 *  wire is the whole point of this migration, so it is recorded rather than
 *  inferred from the reply. */
function harness() {
  const faux = registerFauxProvider({ api: "spar-faux", provider: "spar-faux", models: [{ id: "training-faux" }] });
  const requests: Array<{ context: Context; options: SimpleStreamOptions | undefined }> = [];
  /* The context is snapshotted, not captured: pi mutates the live object as the
     turn proceeds, so holding the reference would assert on the transcript as
     it ended rather than as it was sent. */
  const scripted = (message: ReturnType<typeof fauxAssistantMessage>) =>
    (context: Context, options: SimpleStreamOptions | undefined) => {
      requests.push({ context: { ...context, messages: [...context.messages] }, options });
      return message;
    };
  return { faux, requests, scripted };
}

describe("the training agent, on pi's runtime", () => {
  it("carries the phase's forced tool choice all the way to the provider", async () => {
    const { faux, requests, scripted } = harness();
    try {
      faux.setResponses([scripted(fauxAssistantMessage([fauxToolCall("read_ability", { abilityId: "6f1c9d34-0e1a-4a5b-9c3d-2f8e7a6b5c40", actionTitle: "Reading the ability" }, { id: "call-1" })], { stopReason: "toolUse" }))]);
      const calls: Array<{ name: string; input: unknown }> = [];
      const toolChoice: ToolChoiceRef = { current: phaseToolChoice("spar-faux", "required") };
      const agent = createTrainingAgent(provider, "system", toolChoice);
      agent.state.tools = piAgentTools((name) => name === "read_ability", async (name, input) => { calls.push({ name, input }); return { ok: true }; });
      await agent.prompt("Phase 1.");

      /* The fix this whole migration was for. Mastra asked for "required" and
         the adapter dropped it, so twenty-one phases that are supposed to be
         forced were running on prompt text alone. */
      expect(requests[0]?.options?.toolChoice).toBe("required");
      expect(calls).toEqual([{ name: "read_ability", input: { abilityId: "6f1c9d34-0e1a-4a5b-9c3d-2f8e7a6b5c40", actionTitle: "Reading the ability" } }]);
    } finally { faux.unregister(); }
  });

  it("offers only the tools the phase opened, in the shape the provider reads", async () => {
    const { faux, requests, scripted } = harness();
    try {
      faux.setResponses([scripted(fauxAssistantMessage("nothing to do"))]);
      const toolChoice: ToolChoiceRef = { current: undefined };
      const agent = createTrainingAgent(provider, "system", toolChoice);
      agent.state.tools = piAgentTools((name) => name === "search_learner_model", async () => ({}));
      await agent.prompt("Phase 1.");

      const tools = requests[0]?.context.tools ?? [];
      expect(tools.map((tool) => tool.name)).toEqual(["search_learner_model"]);
      expect(tools[0]?.parameters).toMatchObject({ type: "object", required: ["query", "actionTitle"] });
      expect(requests[0]?.context.systemPrompt).toBe("system");
      expect(requests[0]?.context.messages).toHaveLength(1);
    } finally { faux.unregister(); }
  });

  /* The transcript is rebuilt per phase, which is how the controller has always
     worked. Nothing may leak from one phase into the next — the prompt already
     states the evidence, and a second copy arriving as history would be the
     model reading the same turn twice. */
  it("starts each phase from the prompt alone", async () => {
    const { faux, requests, scripted } = harness();
    try {
      faux.setResponses([
        scripted(fauxAssistantMessage([fauxToolCall("read_ability", { abilityId: "6f1c9d34-0e1a-4a5b-9c3d-2f8e7a6b5c40", actionTitle: "Reading the ability" }, { id: "c1" })], { stopReason: "toolUse" })),
        scripted(fauxAssistantMessage("done")),
      ]);
      const agent = createTrainingAgent(provider, "system", { current: undefined });
      agent.state.tools = piAgentTools((name) => name === "read_ability", async () => ({ ok: true }));
      await agent.prompt("Phase 1.");
      agent.state.messages = [];
      await agent.prompt("Phase 2.");

      expect(requests).toHaveLength(2);
      expect(requests[1]?.context.messages).toHaveLength(1);
      expect(requests[1]?.context.messages[0]).toMatchObject({ role: "user" });
    } finally { faux.unregister(); }
  });

  /* A call the host never sees. pi rejects it against the same JSON Schema the
     model was shown, and the complaint is the only account of why the phase did
     not advance — the retry quotes it back verbatim. */
  it("reports a rejected call with the fault the retry needs", async () => {
    const { faux, scripted } = harness();
    try {
      faux.setResponses([scripted(fauxAssistantMessage([fauxToolCall("read_ability", { abilityId: "not-a-uuid", actionTitle: "Reading the ability" }, { id: "c1" })], { stopReason: "toolUse" }))]);
      const agent = createTrainingAgent(provider, "system", { current: undefined });
      let reached = false;
      agent.state.tools = piAgentTools((name) => name === "read_ability", async () => { reached = true; return {}; });
      let fault = "";
      agent.subscribe((event) => { if (event.type === "tool_execution_end" && event.isError) fault = toolErrorText(event.result); });
      await agent.prompt("Phase 1.");

      expect(reached).toBe(false);
      expect(fault).toContain("abilityId");
    } finally { faux.unregister(); }
  });

  /* zod applied `.default()` when it parsed arguments, and a JSON Schema
     validator does not. A `limit` the model omits has to still arrive as 4. */
  it("hands the host the defaults the model left out", async () => {
    const { faux, scripted } = harness();
    try {
      faux.setResponses([scripted(fauxAssistantMessage([fauxToolCall("search_learner_model", { query: "arrays", actionTitle: "Checking arrays" }, { id: "c1" })], { stopReason: "toolUse" }))]);
      const agent = createTrainingAgent(provider, "system", { current: undefined });
      let received: unknown = null;
      agent.state.tools = piAgentTools((name) => name === "search_learner_model", async (_name, input) => { received = input; return {}; });
      await agent.prompt("Phase 1.");

      expect(received).toEqual({ query: "arrays", limit: 4, actionTitle: "Checking arrays" });
    } finally { faux.unregister(); }
  });

  it("stops a phase when the turn is abandoned", async () => {
    const { faux } = harness();
    try {
      faux.setResponses([fauxAssistantMessage("a long answer")]);
      const agent = createTrainingAgent(provider, "system", { current: undefined });
      const run = agent.prompt("Phase 1.");
      agent.abort();
      await run;
      expect(agent.state.messages.at(-1)).toMatchObject({ role: "assistant" });
    } finally { faux.unregister(); }
  });
});

describe("provider events, in the transcript's own vocabulary", () => {
  it("forwards text and reasoning, and closes a reasoning block", () => {
    expect(normalizePiAgentEvent({ type: "text_delta", delta: "hello" } as never)).toEqual({ type: "text", text: "hello" });
    expect(normalizePiAgentEvent({ type: "thinking_start" } as never)).toEqual({ type: "reasoning", text: "", phase: "start" });
    expect(normalizePiAgentEvent({ type: "thinking_delta", delta: "weighing" } as never)).toEqual({ type: "reasoning", text: "weighing" });
    expect(normalizePiAgentEvent({ type: "thinking_end" } as never)).toEqual({ type: "reasoning", text: "", phase: "end" });
  });

  it("keeps a key out of an error the learner will read", () => {
    const part = normalizePiAgentEvent({ type: "error", error: { errorMessage: "bad key sk-abcd1234efgh rejected" } } as never);
    expect(part).toEqual({ type: "error", text: "bad key [redacted] rejected" });
  });

  it("says nothing about events the transcript has no row for", () => {
    expect(normalizePiAgentEvent({ type: "done" } as never)).toBeNull();
    expect(normalizePiAgentEvent({ type: "start" } as never)).toBeNull();
  });

  it("streams a thinking model without losing the thinking", async () => {
    const faux = registerFauxProvider({ api: "spar-faux", provider: "spar-faux", models: [{ id: "training-faux" }] });
    try {
      faux.setResponses([fauxAssistantMessage([fauxThinking("weighing the options"), fauxText("Here is the plan.")])]);
      const agent = createTrainingAgent(provider, "system", { current: undefined });
      const parts: string[] = [];
      agent.subscribe((event) => {
        if (event.type !== "message_update") return;
        const part = normalizePiAgentEvent(event.assistantMessageEvent);
        if (part?.type === "text" || part?.type === "reasoning") parts.push(`${part.type}:${part.text}`);
      });
      await agent.prompt("Phase 1.");
      const joined = (kind: string) => parts.filter((part) => part.startsWith(`${kind}:`)).map((part) => part.slice(kind.length + 1)).join("");
      expect(joined("reasoning")).toBe("weighing the options");
      expect(joined("text")).toBe("Here is the plan.");
    } finally { faux.unregister(); }
  });
});
