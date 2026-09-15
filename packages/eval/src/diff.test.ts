import { describe, expect, it } from "vitest";
import { diffTraces, renderTraceDiff } from "./diff.js";
import { TraceWriter, type RunHeader, type Trace } from "./trace.js";

const header = (over: Partial<RunHeader> = {}): RunHeader => ({
  schemaVersion: 1, runId: "r", scenario: "window-invariant", seed: 1, arm: "baseline", mode: "scripted", model: "", startedAt: "2026-09-14T00:00:00.000Z", config: {}, ...over,
});

/** A trace built from a compact script, with a clock that never moves — so two
 *  traces written by two different calls are byte-identical unless the script
 *  differs, which is the property every test here depends on. */
function trace(arm: string, script: Array<[step: number, tool: string, ok?: boolean]>): Trace {
  const writer = new TraceWriter(header({ arm }), () => 0);
  writer.emit({ kind: "turn_started", turnKind: "attempt-complete", session: "s" });
  for (const [step, tool, ok = true] of script) {
    writer.emit({ kind: "stage", step, activeTools: [tool], toolChoice: "required" });
    writer.emit({ kind: "tool_call", step, name: tool, inputHash: "aaa", input: {} });
    writer.emit({ kind: "tool_result", step, name: tool, ok, status: ok ? "ok" : "invalid", outputHash: "bbb", checks: [] });
  }
  return writer.trace();
}

describe("aligning two runs", () => {
  it("reports two runs of the same script as identical", () => {
    const diff = diffTraces(trace("baseline", [[1, "replay_attempt"]]), trace("candidate", [[1, "replay_attempt"]]));
    expect(diff.identical).toBe(true);
    expect(renderTraceDiff(diff)).toMatch(/^identical/);
  });

  /* Timing is a measurement of the machine. If it were part of the alignment,
     every run would differ from every other and nobody would read a second
     diff. */
  it("ignores how long anything took", () => {
    const slow = new TraceWriter(header({ arm: "candidate" }), (() => { let t = 0; return () => (t += 500); })());
    slow.emit({ kind: "turn_started", turnKind: "attempt-complete", session: "s" });
    slow.emit({ kind: "stage", step: 1, activeTools: ["replay_attempt"], toolChoice: "required" });
    slow.emit({ kind: "tool_call", step: 1, name: "replay_attempt", inputHash: "aaa", input: {} });
    slow.emit({ kind: "tool_result", step: 1, name: "replay_attempt", ok: true, status: "ok", outputHash: "bbb", checks: [] });
    expect(diffTraces(trace("baseline", [[1, "replay_attempt"]]), slow.trace()).identical).toBe(true);
  });

  it("says how far the two agreed before they forked", () => {
    const diff = diffTraces(
      trace("baseline", [[1, "replay_attempt"], [2, "read_ability"], [3, "create_question"]]),
      trace("candidate", [[1, "replay_attempt"], [2, "read_ability"], [3, "assign_practice_problem"]]),
    );
    expect(diff.identical).toBe(false);
    expect(diff.agreedFor).toBe(7);
    expect(diff.firstDivergence?.key).toContain("create_question");
  });

  /* The reason this is a subsequence alignment and not a positional walk: one
     extra retry in the middle should read as one insertion, not as "everything
     after here is different". */
  it("reads an extra retry as an insertion rather than a total divergence", () => {
    const diff = diffTraces(
      trace("baseline", [[1, "create_question"]]),
      trace("candidate", [[1, "create_question", false], [1, "create_question"]]),
    );
    const added = diff.steps.filter((step) => step.op === "added");
    expect(added.length).toBe(3);
    expect(diff.steps.filter((step) => step.op === "removed")).toHaveLength(0);
  });

  /* A refusal is a decision, so it belongs in the alignment: the same tool
     called with the same arguments and admitted is not the same event as the
     same tool refused. */
  it("distinguishes a call the host admitted from one it refused", () => {
    expect(diffTraces(trace("a", [[1, "create_question"]]), trace("b", [[1, "create_question", false]])).identical).toBe(false);
  });

  it("shows the fork with a little context and says what it skipped", () => {
    const rendered = renderTraceDiff(diffTraces(
      trace("baseline", [[1, "replay_attempt"], [2, "read_ability"], [3, "create_question"]]),
      trace("candidate", [[1, "replay_attempt"], [2, "read_ability"], [3, "assign_practice_problem"]]),
    ), { context: 2 });
    expect(rendered).toContain("earlier events agreed");
    expect(rendered).toContain("- call:3:create_question");
    expect(rendered).toContain("+ call:3:assign_practice_problem");
  });
});
