import { describe, expect, it } from "vitest";
import type { Trace } from "@spar/visualizer";
import { VisualizerToolbox } from "./visualizerTools.js";
import type { LocalStore } from "./store.js";
import type { VisualizerService } from "./visualizer.js";
import type { WorkspaceService } from "./workspaces.js";

const SESSION = "11111111-1111-4111-8111-111111111111";

const trace: Trace = {
  frames: [
    { line: 1, event: "call", function: "f", locals: { n: 3 }, heap: {}, stack: [], output: "" },
    { line: 2, event: "step", function: "f", locals: { n: 3, total: 0 }, heap: {}, stack: [], output: "" },
    { line: 3, event: "return", function: "f", locals: { n: 3, total: 6 }, heap: {}, stack: [], output: "", result: 6 },
  ],
  output: "",
  error: null,
  truncated: false,
  notes: { "2": { kind: "Assign", text: "total = 0", targets: ["total"] } },
  durationMs: 2,
};

function toolbox(overrides: { trace?: () => Promise<Trace>; saved?: unknown[] } = {}) {
  const saved = overrides.saved ?? [];
  const service = { trace: overrides.trace ?? (async () => trace) } as unknown as VisualizerService;
  const store = {
    readSession: () => ({ question: { language: "python" } }),
    trackIdForSession: () => null,
    listTracks: () => [],
    saveVisualization: (input: unknown) => { saved.push(input); },
  } as unknown as LocalStore;
  const workspaces = { list: async () => [], read: async () => "" } as unknown as WorkspaceService;
  return { box: new VisualizerToolbox(service, store, workspaces), saved };
}

describe("loading the toolkit", () => {
  it("answers with the briefing rather than with data", async () => {
    const { box } = toolbox();
    const result = await box.execute("open_visualizer", {}, SESSION) as { loaded: boolean; instructions: string; tools: string[] };
    expect(result.loaded).toBe(true);
    expect(result.tools).toContain("visualize_explain");
    expect(result.instructions).toContain("visualize_find");
  });

  /* The one rule that cannot be left to the model's judgement, so it is in the
     briefing verbatim and this asserts it stays there. */
  it("states the rule against drawing a working solution", async () => {
    const { box } = toolbox();
    const result = await box.execute("open_visualizer", {}, SESSION) as { instructions: string };
    expect(result.instructions).toContain("never show, a working implementation of the challenge");
  });

  it("says plainly when the session's language cannot be traced", async () => {
    const service = {} as VisualizerService;
    const store = { readSession: () => ({ question: { language: "rust" } }), trackIdForSession: () => null, listTracks: () => [] } as unknown as LocalStore;
    const box = new VisualizerToolbox(service, store, {} as WorkspaceService);
    const result = await box.execute("open_visualizer", {}, SESSION) as { supported: boolean; instructions: string };
    expect(result.supported).toBe(false);
    expect(result.instructions).toContain("do not tell the learner a diagram is coming");
  });
});

describe("tracing", () => {
  it("refuses a run with no call to trace, and says what setup is", async () => {
    const { box } = toolbox();
    const result = await box.execute("visualize_run", { code: "def f(): pass" }, SESSION) as { error: string; note: string };
    expect(result.error).toBe("no-setup");
    expect(result.note).toContain("one line");
  });

  it("returns a digest and a handle, not the trace", async () => {
    const { box } = toolbox();
    const result = await box.execute("visualize_run", { code: "def f(n): return n", setup: "f(3)" }, SESSION) as Record<string, unknown>;
    expect(typeof result.runId).toBe("string");
    expect(result).not.toHaveProperty("frames");
    expect((result.digest as { steps: number }).steps).toBe(3);
  });

  /* Nothing traced almost always means the setup called a name the code does not
     define. An empty digest would be explained anyway; this is explained right. */
  it("explains an empty trace instead of returning one", async () => {
    const { box } = toolbox({ trace: async () => ({ ...trace, frames: [] }) });
    const result = await box.execute("visualize_run", { code: "x = 1", setup: "g()" }, SESSION) as { error: string };
    expect(result.error).toBe("no-frames");
  });

  it("turns a tracer failure into a result the turn can carry on from", async () => {
    const { box } = toolbox({ trace: async () => { throw new Error("the tracer timed out"); } });
    const result = await box.execute("visualize_run", { code: "x = 1", setup: "f()" }, SESSION) as { error: string; note: string };
    expect(result).toMatchObject({ error: "trace-failed", note: "the tracer timed out" });
  });
});

describe("reading a run", () => {
  const run = async () => {
    const made = toolbox();
    const { runId } = await made.box.execute("visualize_run", { code: "def f(n): return n", setup: "f(3)" }, SESSION) as { runId: string };
    return { ...made, runId };
  };

  it("reads one step exactly, with what the step before it was not", async () => {
    const { box, runId } = await run();
    const report = await box.execute("visualize_read_step", { runId, step: 1 }, SESSION) as { line: number; changed: string[]; source: string };
    expect(report.line).toBe(2);
    expect(report.source).toBe("total = 0");
    expect(report.changed).toEqual(["total = 0 (new)"]);
  });

  it("finds where a variable moved", async () => {
    const { box, runId } = await run();
    const found = await box.execute("visualize_find", { runId, variable: "total" }, SESSION) as { total: number };
    expect(found.total).toBe(2);
  });

  /* A stale handle is a normal thing for a long turn to hold, so it comes back
     as an instruction rather than as a thrown tool call that ends the turn. */
  it("tells the agent to trace first rather than throwing on an unknown run", async () => {
    const { box } = toolbox();
    const result = await box.execute("visualize_find", { runId: "gone", variable: "x" }, SESSION) as { error: string };
    expect(result.error).toBe("no-run");
  });
});

describe("showing the picture", () => {
  it("stores the chosen steps and returns only their id", async () => {
    const { box, saved } = toolbox();
    const { runId } = await box.execute("visualize_run", { code: "def f(n): return n", setup: "f(3)" }, SESSION) as { runId: string };
    const shown = await box.execute("visualize_explain", {
      runId, title: "Why it comes back as 6", takeaway: "The total is built before the return.",
      steps: [{ step: 2, caption: "Here it returns." }, { step: 1, caption: "total starts at zero." }],
    }, SESSION) as Record<string, unknown>;

    expect(shown.shown).toBe(true);
    expect(typeof shown.visualizationId).toBe("string");
    expect(shown).not.toHaveProperty("steps.0.frame");

    const record = saved[0] as { title: string; payload: { steps: Array<{ step: number; caption: string }>; takeaway: string } };
    expect(record.title).toBe("Why it comes back as 6");
    // Named out of order, played in run order.
    expect(record.payload.steps.map((step) => step.step)).toEqual([1, 2]);
    expect(record.payload.takeaway).toBe("The total is built before the return.");
  });


  /* The direction is the feature. A picture of every object in scope makes the
     learner find the one the sentence meant, which is the work the agent was
     supposed to do — and one fixed speed cannot say which moment mattered. */
  it("carries the agent's framing and pacing through to the stored view", async () => {
    const { box, saved } = toolbox();
    const { runId } = await box.execute("visualize_run", { code: "def f(n): return n", setup: "f(3)" }, SESSION) as { runId: string };
    await box.execute("visualize_explain", {
      runId, title: "t",
      steps: [
        { step: 1, caption: "total starts at zero.", focus: ["total", " "], hold: 3.5 },
        { step: 2, caption: "and comes back as six." },
      ],
    }, SESSION);
    const steps = (saved[0] as { payload: { steps: Array<{ focus: string[]; hold: number }> } }).payload.steps;
    expect(steps[0]).toMatchObject({ focus: ["total"], hold: 3.5 });
    // Unpaced steps fall back to their caption's reading time rather than to a
    // constant, so a long sentence is never cut off by the next step arriving.
    expect(steps[1]?.hold).toBeGreaterThan(1);
  });

  it("does not play a single still at the learner", async () => {
    const { box, saved } = toolbox();
    const { runId } = await box.execute("visualize_run", { code: "def f(n): return n", setup: "f(3)" }, SESSION) as { runId: string };
    await box.execute("visualize_explain", { runId, title: "t", steps: [{ step: 1, caption: "just this one." }] }, SESSION);
    expect((saved[0] as { payload: { autoplay: boolean } }).payload.autoplay).toBe(false);
  });

  /* A diagram with no words attached is the failure this feature exists to
     avoid: the learner is shown a step and left to work out why. */
  it("refuses to show steps with no captions", async () => {
    const { box } = toolbox();
    const { runId } = await box.execute("visualize_run", { code: "def f(n): return n", setup: "f(3)" }, SESSION) as { runId: string };
    const result = await box.execute("visualize_explain", { runId, title: "t", steps: [{ step: 1, caption: "  " }] }, SESSION) as { error: string };
    expect(result.error).toBe("no-steps");
  });
});
