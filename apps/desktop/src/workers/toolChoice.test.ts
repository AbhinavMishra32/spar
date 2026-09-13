import { describe, expect, it } from "vitest";
import { toolChoiceFor } from "./piMastraModel.js";

/* Spar's phase controller is twenty-one forced calls in a row, so what this
   translation produces is the difference between a deterministic sequence and a
   prompt asking politely for one. Each family is pinned by the spelling that
   family's API actually accepts — a wrong spelling is not a type error anywhere,
   it is a 400 at the far end of a turn the learner is waiting on. */
describe("forced tool choice, per API family", () => {
  const required = { type: "required" } as const;
  const named = { type: "tool", toolName: "set_training_target" } as const;

  it("passes through the two choices every API spells the same", () => {
    expect(toolChoiceFor("anthropic-messages", { type: "auto" })).toBe("auto");
    expect(toolChoiceFor("openai-responses", { type: "none" })).toBe("none");
  });

  it("leaves the option unset when Mastra asks for nothing", () => {
    expect(toolChoiceFor("openai-responses", undefined)).toBeUndefined();
  });

  it("says `any` to the Anthropic-shaped APIs, and names a tool as an object", () => {
    expect(toolChoiceFor("anthropic-messages", required)).toBe("any");
    expect(toolChoiceFor("bedrock-converse-stream", required)).toBe("any");
    expect(toolChoiceFor("anthropic-messages", named)).toEqual({ type: "tool", name: "set_training_target" });
  });

  it("says `required` to the OpenAI and Mistral families, naming a tool as a function", () => {
    expect(toolChoiceFor("openai-completions", required)).toBe("required");
    expect(toolChoiceFor("mistral-conversations", required)).toBe("required");
    expect(toolChoiceFor("openai-responses", named)).toEqual({ type: "function", function: { name: "set_training_target" } });
  });

  /* Codex takes the demand but not the name — it is the ChatGPT subscription
     endpoint, not the API — so a named choice degrades to "some tool". That is
     no loss in practice: `activeTools` has already narrowed the list to the one
     tool the phase offers. */
  it("degrades a named choice to `required` on the ChatGPT subscription endpoint", () => {
    expect(toolChoiceFor("openai-codex-responses", named)).toBe("required");
    expect(toolChoiceFor("openai-codex-responses", required)).toBe("required");
  });

  it("says `any` to Google, which has no way to name one", () => {
    expect(toolChoiceFor("google-generative-ai", named)).toBe("any");
    expect(toolChoiceFor("google-vertex", required)).toBe("any");
  });
});
