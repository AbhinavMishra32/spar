import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { Context, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { NOOP_TELEMETRY_CONTEXT } from "@earendil-works/pi-telemetry";
import { advanceTrainingConversation, createTrainingAgent, normalizePiAgentEvent, piAgentTools, piCompleteText, toolCallSpill, toolErrorText } from "./piAgent.js";
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
  it("reports usage from a private model completion", async () => {
    const { faux, scripted } = harness();
    try {
      faux.setResponses([scripted(fauxAssistantMessage("accepted"))]);
      const usages: unknown[] = [];
      const answer = await piCompleteText(provider, "Review fit", "Does this fit?", new AbortController().signal, "Timed out", (usage) => usages.push(usage));
      expect(answer).toBe("accepted");
      expect(usages).toHaveLength(1);
      expect(usages[0]).toHaveProperty("totalTokens");
    } finally { faux.unregister(); }
  });

  it("sets the system prompt once and keeps tool history across requests", async () => {
    const { faux, requests, scripted } = harness();
    try {
      faux.setResponses([
        scripted(fauxAssistantMessage([fauxToolCall("search_record", { query: "stacks", actionTitle: "Read evidence" }, { id: "first" })], { stopReason: "toolUse" })),
        scripted(fauxAssistantMessage("Ready.")),
      ]);
      const agent = createTrainingAgent(provider, "standing doctrine");
      agent.state.tools = piAgentTools((name) => name === "search_record", async () => ({ results: [] }));
      await advanceTrainingConversation(agent, "Learner asks for next challenge");
      await advanceTrainingConversation(agent, "Learner asks for next challenge");
      expect(requests).toHaveLength(2);
      const system = requests[1]?.context.messages.filter((message) => message.role === "system").map((message) => String(message.content)).join("\n") ?? "";
      expect(system.match(/standing doctrine/g)).toHaveLength(1);
      expect(requests[1]?.context.messages.filter((message) => message.role === "user")).toHaveLength(1);
      expect(requests[1]?.context.messages.some((message) => message.role === "toolResult")).toBe(true);
    } finally { faux.unregister(); }
  });

  it("recognizes a printed tool invocation without treating ordinary prose as one", () => {
    const tools = ["set_challenge", "read_attempt"];
    expect(toolCallSpill('I changed it. to=functions.set_challenge (json)\n{"mode":"revise"}', tools))
      .toBe("set_challenge");
    expect(toolCallSpill("to=functions.read_record {}", tools)).toBe("unknown");
    expect(toolCallSpill('The code mentions functions and JSON.', tools)).toBeNull();
  });

  it("passes the telemetry context to the provider only when given one", async () => {
    const { faux, requests, scripted } = harness();
    try {
      faux.setResponses([scripted(fauxAssistantMessage("one")), scripted(fauxAssistantMessage("two"))]);
      await createTrainingAgent(provider, "system", NOOP_TELEMETRY_CONTEXT).prompt("Traced.");
      await createTrainingAgent(provider, "system").prompt("Untraced.");
      expect(requests[0]?.options).toHaveProperty("telemetryContext", NOOP_TELEMETRY_CONTEXT);
      expect(requests[1]?.options).not.toHaveProperty("telemetryContext");
    } finally { faux.unregister(); }
  });

  it("offers only the allowed tools, in the shape the provider reads", async () => {
    const { faux, requests, scripted } = harness();
    try {
      faux.setResponses([scripted(fauxAssistantMessage("nothing to do"))]);
      const agent = createTrainingAgent(provider, "system");
      agent.state.tools = piAgentTools((name) => name === "search_record", async () => ({}));
      await agent.prompt("Phase 1.");

      const tools = requests[0]?.context.messages.flatMap((message) => message.role === "system" ? message.toolsAdded ?? [] : []) ?? [];
      expect(tools.map((tool) => tool.name)).toEqual(["search_record"]);
      expect(tools[0]?.parameters).toMatchObject({ type: "object", required: ["query"] });
      expect(requests[0]?.context.messages[0]).toMatchObject({ role: "system", content: "system" });
      expect(requests[0]?.context.messages.filter((message) => message.role === "user")).toHaveLength(1);
    } finally { faux.unregister(); }
  });

  it("sends the journey prompt as the first user message and ignores the message on the first request", async () => {
    const { faux, requests, scripted } = harness();
    try {
      faux.setResponses([scripted(fauxAssistantMessage("They ask for the same result and method."))]);
      const agent = createTrainingAgent(provider, "system");
      const fullPrompt = "Recent challenges: #2 passed next-greater positions; #3 repeats it. Latest learner action: Is this the same question?";
      await advanceTrainingConversation(agent, fullPrompt, "An active challenge exists.");
      const sent = requests[0]?.context.messages.filter((message) => message.role === "user");
      expect(sent).toHaveLength(1);
      expect(sent?.[0]).toMatchObject({ role: "user", content: [{ type: "text", text: fullPrompt }] });
    } finally { faux.unregister(); }
  });

  it("continues a dependent tool conversation without replaying context", async () => {
    const { faux, requests, scripted } = harness();
    try {
      faux.setResponses([
        scripted(fauxAssistantMessage([fauxToolCall("search_record", { query: "trees", actionTitle: "Read evidence" }, { id: "c1" })], { stopReason: "toolUse" })),
        scripted(fauxAssistantMessage([fauxToolCall("read_record", { kind: "ability", id: "6f1c9d34-0e1a-4a5b-9c3d-2f8e7a6b5c40", actionTitle: "Read ability" }, { id: "c2" })], { stopReason: "toolUse" })),
        scripted(fauxAssistantMessage("Ready to practise.")),
      ]);
      const agent = createTrainingAgent(provider, "system");
      const results = { passages: [{ id: "6f1c9d34-0e1a-4a5b-9c3d-2f8e7a6b5c40" }] };
      agent.state.tools = piAgentTools((name) => ["search_record", "read_record"].includes(name), async () => results);
      for (let step = 0; step < 3; step++) await advanceTrainingConversation(agent, "Learn trees");
      expect(requests).toHaveLength(3);
      expect(requests[2]?.context.messages.filter((message) => message.role !== "system").map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "assistant", "toolResult"]);
      expect(requests[2]?.context.messages.filter((message) => message.role === "user")).toHaveLength(1);
      expect(requests[1]?.context.messages.at(-1)).toMatchObject({ role: "toolResult", toolCallId: "c1" });
    } finally { faux.unregister(); }
  });

  it("inserts learner steering without dropping earlier tool results", async () => {
    const { faux, requests, scripted } = harness();
    try {
      faux.setResponses([
        scripted(fauxAssistantMessage([fauxToolCall("search_record", { query: "trees", actionTitle: "Read evidence" }, { id: "c1" })], { stopReason: "toolUse" })),
        scripted(fauxAssistantMessage("In Python.")),
      ]);
      const agent = createTrainingAgent(provider, "system");
      agent.state.tools = piAgentTools((name) => name === "search_record", async () => ({ results: [] }));
      await advanceTrainingConversation(agent, "Learn trees");
      await advanceTrainingConversation(agent, "Learn trees", "Use Python");
      expect(requests[1]?.context.messages.filter((message) => message.role !== "system").map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "user"]);
      expect(requests[1]?.context.messages.at(-1)).toMatchObject({ role: "user", content: [{ type: "text", text: "Use Python" }] });
    } finally { faux.unregister(); }
  });

  /* A call the host never sees. pi rejects it against the same JSON Schema the
     model was shown, and the complaint is the only account of why the call did
     not run — the retry quotes it back verbatim. */
  it("reports a rejected call with the fault the retry needs", async () => {
    const { faux, scripted } = harness();
    try {
      faux.setResponses([scripted(fauxAssistantMessage([fauxToolCall("read_attempt", { attemptId: "not-a-uuid", actionTitle: "Reading the attempt" }, { id: "c1" })], { stopReason: "toolUse" }))]);
      const agent = createTrainingAgent(provider, "system");
      let reached = false;
      agent.state.tools = piAgentTools((name) => name === "read_attempt", async () => { reached = true; return {}; });
      let fault = "";
      agent.subscribe((event) => { if (event.type === "tool_execution_end" && event.isError) fault = toolErrorText(event.result); });
      await agent.prompt("Phase 1.");

      expect(reached).toBe(false);
      expect(fault).toContain("attemptId");
    } finally { faux.unregister(); }
  });

  /* zod applied `.default()` when it parsed arguments, and a JSON Schema
     validator does not. A `limit` the model omits has to still arrive as 6. */
  it("hands the host the defaults the model left out", async () => {
    const { faux, scripted } = harness();
    try {
      faux.setResponses([scripted(fauxAssistantMessage([fauxToolCall("search_record", { query: "arrays", actionTitle: "Checking arrays" }, { id: "c1" })], { stopReason: "toolUse" }))]);
      const agent = createTrainingAgent(provider, "system");
      let received: unknown = null;
      agent.state.tools = piAgentTools((name) => name === "search_record", async (_name, input) => { received = input; return {}; });
      await agent.prompt("Phase 1.");

      expect(received).toEqual({ query: "arrays", limit: 6, actionTitle: "Checking arrays" });
    } finally { faux.unregister(); }
  });

  it("stops when the turn is abandoned", async () => {
    const { faux } = harness();
    try {
      faux.setResponses([fauxAssistantMessage("a long answer")]);
      const agent = createTrainingAgent(provider, "system");
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

  it("names the challenge-writing wait while tool arguments stream", () => {
    const partial = { content: [{ type: "toolCall", id: "call", name: "set_challenge", arguments: {} }] };
    expect(normalizePiAgentEvent({ type: "toolcall_start", contentIndex: 0, partial } as never)).toEqual({
      type: "status",
      text: "",
      detail: "Writing the challenge brief",
    });
  });

  it("gives other streamed tool arguments a readable activity label", () => {
    const partial = { content: [{ type: "toolCall", id: "call", name: "search_record", arguments: {} }] };
    expect(normalizePiAgentEvent({ type: "toolcall_start", contentIndex: 0, partial } as never)).toEqual({
      type: "status",
      text: "",
      detail: "Preparing search record",
    });
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
      const agent = createTrainingAgent(provider, "system");
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
