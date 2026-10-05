import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText, fauxThinking } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { Context, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { advanceTrainingConversation, createTrainingAgent, piAgentTools } from "./piAgent.js";
import { compactConversation, compactionThreshold, conversationTokens, savedConversation } from "./coachConversation.js";
import { DECLARED_TOOLS, coachTools, unavailableTool } from "./agentPolicy.js";
import type { PiProviderInput } from "./piProvider.js";

const provider: PiProviderInput = { provider: "spar-faux", model: "training-faux", api: "spar-faux", baseUrl: "http://localhost:0", apiKey: "test" };

function harness() {
  const faux = registerFauxProvider({ api: "spar-faux", provider: "spar-faux", models: [{ id: "training-faux" }] });
  const requests: Context[] = [];
  const scripted = (message: ReturnType<typeof fauxAssistantMessage>) =>
    (context: Context, _options: SimpleStreamOptions | undefined) => {
      requests.push({ ...context, messages: [...context.messages] });
      return message;
    };
  return { faux, requests, scripted };
}

const tools = () => piAgentTools((name) => DECLARED_TOOLS.has(name), async () => ({}));

/* A session's coach used to be a new conversation every turn: the journey
   rebuilt and everything the coach did last time thrown away. These pin the
   replacement: one conversation, saved and continued. */
describe("the coach's conversation across turns", () => {
  it("continues the saved conversation: the next turn's request carries everything before it, then only the new opening", async () => {
    const { faux, requests, scripted } = harness();
    try {
      faux.setResponses([
        scripted(fauxAssistantMessage([fauxThinking("They want heaps."), fauxText("Let's start with heaps.")])),
        scripted(fauxAssistantMessage("Good, next one.")),
      ]);
      const first = createTrainingAgent(provider, "system", undefined, { messages: [], tools: tools() });
      await advanceTrainingConversation(first, "# Journey\n…\n\n# Now\nTeach me heaps", undefined, false);
      const saved = savedConversation(first.state.messages);
      expect(saved.map((message) => message.role)).toEqual(["user", "assistant"]);

      /* A later turn, in a new process: restored from what was saved. */
      const restored = JSON.parse(JSON.stringify(saved)) as AgentMessage[];
      const second = createTrainingAgent(provider, "system", undefined, { messages: restored, tools: tools() });
      await advanceTrainingConversation(second, "# Update\nNothing in the journey changed since your last turn.\n\n# Now\nI solved it", undefined, false);

      const sent = requests[1]!.messages.filter((message) => message.role !== "system");
      expect(sent.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
      expect(JSON.stringify(sent[0])).toContain("Teach me heaps");
      /* The reasoning the coach did last turn goes back with it. */
      expect(JSON.stringify(sent[1])).toContain("They want heaps.");
      expect(JSON.stringify(sent[2])).toContain("I solved it");
      expect(JSON.stringify(sent[2])).not.toContain("# Journey");
      expect(savedConversation(second.state.messages)).toHaveLength(4);
    } finally { faux.unregister(); }
  });

  it("declares the same tools on every turn, whatever this turn allows, and says why one is not available", () => {
    const narrow = coachTools({ webSearch: false, practiceSource: false, sparAuthoring: false, skills: false });
    expect([...DECLARED_TOOLS]).toEqual(expect.arrayContaining([...narrow, "web_search", "assign_practice_problem", "set_challenge", "load_skill"]));
    expect(tools().map((tool) => tool.name)).toEqual(tools().map((tool) => tool.name));
    expect(unavailableTool("web_search")).toContain("no web search key");
    expect(unavailableTool("assign_practice_problem")).toContain("no practice provider");
    expect(unavailableTool("set_challenge")).toContain("real problems only");
  });

  it("is compacted past a ceiling well inside a large window, and never below twice the kept tail", () => {
    expect(compactionThreshold(1_000_000)).toBe(160_000);
    expect(compactionThreshold(128_000)).toBe(128_000 - 16_384);
    expect(compactionThreshold(32_000)).toBe(40_000);
    expect(conversationTokens([{ role: "user", content: "x".repeat(4_000), timestamp: 1 } as AgentMessage])).toBeGreaterThan(900);
  });

  it("compacts the older part into a summary, keeps the recent part, and never splits a call from its result", async () => {
    const { faux, requests, scripted } = harness();
    try {
      faux.setResponses([scripted(fauxAssistantMessage("## The learner\nWants heaps for interviews."))]);
      const long = "word ".repeat(6_000);
      const messages: AgentMessage[] = [];
      for (let turn = 0; turn < 8; turn += 1) {
        messages.push({ role: "user", content: `turn ${turn}: ${long}`, timestamp: turn * 10 + 1 } as AgentMessage);
        messages.push({ role: "assistant", content: [{ type: "text", text: `reply ${turn}` }], api: "spar-faux", provider: "spar-faux", model: "training-faux", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: turn * 10 + 2 } as AgentMessage);
      }
      const compacted = await compactConversation(messages, provider, new AbortController().signal);
      expect(compacted).not.toBeNull();
      const [head, ...tail] = compacted!.messages;
      expect(JSON.stringify(head)).toContain("<summary>");
      expect(JSON.stringify(head)).toContain("Wants heaps for interviews.");
      expect(tail.length).toBeGreaterThan(0);
      expect(tail.length).toBeLessThan(messages.length);
      expect(tail.at(-1)).toEqual(messages.at(-1));
      expect(compacted!.tokensBefore).toBeGreaterThan(20_000);
      expect(JSON.stringify(requests[0]!.messages)).toContain("turn 0");
    } finally { faux.unregister(); }
  });
});
