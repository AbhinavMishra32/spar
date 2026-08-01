import { describe, expect, it } from "vitest";
import { normalizeAgentStreamPart } from "../workers/agentStream.js";

describe("Training Agent stream normalization", () => {
  it("extracts text from the current Mastra payload shape", () => {
    expect(normalizeAgentStreamPart({
      type: "text-delta",
      payload: { id: "text-0", text: "Here is the next question." },
    })).toEqual({ type: "text", text: "Here is the next question." });
  });

  it("supports direct legacy deltas without stringifying structured payloads", () => {
    expect(normalizeAgentStreamPart({ type: "text-delta", textDelta: "Legacy text" }))
      .toEqual({ type: "text", text: "Legacy text" });
    expect(normalizeAgentStreamPart({ type: "text-delta", payload: { id: "text-0" } }))
      .toEqual({ type: "text", text: "" });
  });
});
