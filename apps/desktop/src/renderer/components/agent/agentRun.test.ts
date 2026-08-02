import { describe, expect, it } from "vitest";
import { activityGroupLabel, safeToolLabel, type RunPart } from "./agentRun";

const tool = (name: string): Extract<RunPart, { kind: "tool" }> => ({
  kind: "tool", id: name, tool: name, label: "90403a67-bb35-41c4-a01c-8b10b9a55d67", detail: "raw query", phase: "done", files: [], startedAt: 0,
});

describe("Codex-style agent activity", () => {
  it("uses semantic labels without raw arguments", () => {
    expect(safeToolLabel("inspect_current_attempt", false)).toBe("Inspected current attempt");
    expect(safeToolLabel("search_learner_model", false)).toBe("Searched learning history");
  });

  it("summarizes a tool phase into one compact activity heading", () => {
    const label = activityGroupLabel([tool("inspect_current_attempt"), tool("read_ability"), tool("search_learner_model")]);
    expect(label).toBe("Inspected current attempt, read ability context, and searched learning history");
    expect(label).not.toMatch(/90403a67|raw query/);
  });

  it("deduplicates retries and leads with the currently active operation", () => {
    const failed = { ...tool("replace_current_question"), id: "failed", phase: "error" as const };
    const reading = tool("read_challenge");
    const running = { ...tool("replace_current_question"), id: "running", phase: "running" as const };
    expect(activityGroupLabel([failed, failed, reading, running])).toBe("Build replacement challenge after reading challenge context");
    expect(safeToolLabel("replace_current_question", false, true)).toBe("Replacement candidate failed validation");
  });
});
