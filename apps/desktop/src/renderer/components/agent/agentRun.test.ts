import { describe, expect, it } from "vitest";
import { activityGroupLabel, reduceRun, runActivity, safeToolLabel, type AgentRun, type RunPart } from "./agentRun";

const tool = (name: string): Extract<RunPart, { kind: "tool" }> => ({
  kind: "tool", id: name, tool: name, label: "90403a67-bb35-41c4-a01c-8b10b9a55d67", detail: "raw query", phase: "done", files: [], startedAt: 0,
});

const run = (parts: RunPart[], status: AgentRun["status"] = "streaming"): AgentRun => ({ runId: "run", parts, status, startedAt: 0 });

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
    expect(safeToolLabel("replace_current_question", false, true)).toBe("Replacement candidate rejected");
  });
});

describe("live session activity", () => {
  it("reports the open tool call, the step behind it, and how many have settled", () => {
    const activity = runActivity(run([
      tool("search_learner_model"),
      tool("read_ability"),
      { ...tool("create_question"), phase: "running" },
    ]));
    expect(activity).toMatchObject({ state: "working", headline: "Build challenge", previous: "Read ability context", steps: 2 });
    expect(activity?.headline).not.toMatch(/90403a67|raw query/);
  });

  it("follows the streaming reply when no tool call is open", () => {
    const activity = runActivity(run([
      tool("read_session"),
      { kind: "text", id: "t", body: "I read your last attempt. Now I am weighing two targets" },
    ]));
    expect(activity?.headline).toBe("Now I am weighing two targets");
  });

  it("flags a compiled challenge the moment it lands, before the turn ends", () => {
    expect(runActivity(run([tool("create_question")]))?.published).toBe(true);
    // Rejected by the compiler is not published: nothing reached the session.
    expect(runActivity(run([{ ...tool("create_question"), phase: "error" }]))?.published).toBe(false);
  });

  it("says a turn failed without spilling the stack behind it", () => {
    const activity = runActivity(run([tool("read_session"), { kind: "error", id: "e", body: "Provider request timed out.\n  at fetch (node:internal)" }], "error"));
    expect(activity).toMatchObject({ state: "failed", headline: "Provider request timed out" });
  });

  it("is nothing at all once the turn is done, so the card falls back to the session", () => {
    expect(runActivity(run([tool("create_question")], "done"))).toBeNull();
    expect(runActivity(null)).toBeNull();
  });

  it("keeps each session's turn separate as their events interleave", () => {
    // What App does per session id: one reducer state each, so a second turn
    // streaming beside the first can never append to the wrong card.
    let planning = reduceRun(null, { runId: "a", type: "tool", tool: "search_learner_model", callId: "a1", phase: "start" });
    let solving = reduceRun(null, { runId: "b", type: "tool", tool: "evaluate_attempt", callId: "b1", phase: "start" });
    planning = reduceRun(planning, { runId: "a", type: "tool", tool: "search_learner_model", callId: "a1", phase: "end", ok: true });
    solving = reduceRun(solving, { runId: "b", type: "tool", tool: "evaluate_attempt", callId: "b1", phase: "end", ok: true });
    solving = reduceRun(solving, { runId: "b", type: "text", text: "Your loop bound is off by one" });
    expect(runActivity(planning)?.headline).toBe("Working through what it found");
    expect(runActivity(solving)?.headline).toBe("Your loop bound is off by one");
  });
});
