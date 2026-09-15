import { describe, expect, it } from "vitest";
import { groupParts, reasoningAtLiveEdge, reduceRun, runActivity, safeToolLabel, toolRowTitle, type AgentRun, type RunPart } from "./agentRun";

const tool = (name: string): Extract<RunPart, { kind: "tool" }> => ({
  kind: "tool", id: name, tool: name, label: "", actionTitle: "", detail: "raw query", phase: "done", files: [], input: "", output: "", startedAt: 0,
});

const run = (parts: RunPart[], status: AgentRun["status"] = "streaming"): AgentRun => ({ runId: "run", parts, status, startedAt: 0, steersConsumed: 0 });

describe("what a tool row is called", () => {
  it("prefers the title the agent wrote for this particular call", () => {
    const part = { ...tool("search_attempt_history"), actionTitle: "Checking whether arrays have ever been tested" };
    expect(toolRowTitle(part)).toBe("Checking whether arrays have ever been tested");
  });

  it("falls back to the fixed label when the agent gave no title", () => {
    expect(toolRowTitle(tool("search_learner_model"))).toBe("Searched learning history");
    expect(safeToolLabel("inspect_current_attempt", false)).toBe("Inspected current attempt");
  });

  /* `label` is the host's own summary — a challenge's title, a replay's sections —
     and is what the challenge row shows. It is never the caption for a step, so a
     row whose agent title is missing must not fall through to it. */
  it("never mistakes the host's summary for the agent's caption", () => {
    const part = { ...tool("create_question"), label: "Fix the window that stops shrinking too early" };
    expect(toolRowTitle(part)).toBe("Built challenge");
  });
});

describe("transcript rows", () => {
  it("gives every tool call its own row rather than one synthesized summary", () => {
    const rows = groupParts([tool("search_learner_model"), tool("read_ability"), tool("read_concept_graph")]);
    expect(rows.map((row) => row.kind)).toEqual(["tool-row", "tool-row", "tool-row"]);
  });

  /* A turn that makes six provider calls settles six reasoning blocks with
     nothing between them, and each one drew its own grey heading. */
  it("joins thinking that was interrupted by nothing into one thought", () => {
    const think = (id: string, body: string): RunPart => ({ kind: "reasoning", id, body, open: false, startedAt: 0, endedAt: 1 });
    const rows = groupParts([think("a", "**Planning**"), think("b", "**Refining**"), tool("read_ability"), think("c", "**Deciding**")]);
    /* Both blocks before the call are one thought, and that thought belongs to
       the call it led to rather than to a row of its own. The trailing one led
       nowhere, so it goes back onto the same call as what came of it. */
    expect(rows.map((row) => row.kind)).toEqual(["tool-row"]);
    const row = rows[0] as Extract<ReturnType<typeof groupParts>[number], { kind: "tool-row" }>;
    expect(row.thinking?.body).toBe("**Planning**\n\n**Refining**");
    expect(row.after?.body).toBe("**Deciding**");
  });

  /* Half a turn used to be the agent announcing its own next row: "Planning to
     call open_visualizer", then a row saying it opened it. */
  it("folds the thinking that led to a call into that call's row", () => {
    const think: RunPart = { kind: "reasoning", id: "a", body: "**Planning the read**", open: false, startedAt: 0, endedAt: 1 };
    const rows = groupParts([think, tool("read_ability")]);
    expect(rows.map((row) => row.kind)).toEqual(["tool-row"]);
  });

  /* The turn's last stretch of reasoning has no call ahead of it, so it drew a
     stack of six headings between the work and the reply — the agent describing
     the work, where the work itself was. */
  it("puts the thinking after the last call back onto that call", () => {
    const think: RunPart = { kind: "reasoning", id: "a", body: "**Weighing the fix**", open: false, startedAt: 0, endedAt: 1 };
    const reply: RunPart = { kind: "text", id: "b", body: "Your loop bound is off by one." };
    const rows = groupParts([tool("read_ability"), think, reply]);
    expect(rows.map((row) => row.kind)).toEqual(["tool-row", "text"]);
    const row = rows[0] as Extract<ReturnType<typeof groupParts>[number], { kind: "tool-row" }>;
    expect(row.after?.body).toBe("**Weighing the fix**");
  });

  it("leaves thinking that led to an answer rather than to an action as its own row", () => {
    const think: RunPart = { kind: "reasoning", id: "a", body: "**Deciding what to say**", open: false, startedAt: 0, endedAt: 1 };
    const reply: RunPart = { kind: "text", id: "b", body: "Here is the answer." };
    expect(groupParts([think, reply]).map((row) => row.kind)).toEqual(["reasoning", "text"]);
  });

  it("never folds away the thought still being written — it is the sign a turn is alive", () => {
    const live: RunPart = { kind: "reasoning", id: "a", body: "writing", open: true, startedAt: 0 };
    expect(groupParts([live, tool("read_ability")]).map((row) => row.kind)).toEqual(["reasoning", "tool-row"]);
  });

  it("leaves the thought still being written alone", () => {
    const settled: RunPart = { kind: "reasoning", id: "a", body: "done", open: false, startedAt: 0, endedAt: 1 };
    const live: RunPart = { kind: "reasoning", id: "b", body: "writing", open: true, startedAt: 0 };
    expect(groupParts([settled, live]).map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("still lifts the two outcomes out of the run of steps", () => {
    const published = { ...tool("create_question"), phase: "done" as const };
    const rows = groupParts([tool("search_learner_model"), tool("replay_attempt"), published]);
    expect(rows.map((row) => row.kind)).toEqual(["tool-row", "solve-read", "challenge"]);
  });
});

describe("live thinking placement", () => {
  const thought: RunPart = { kind: "reasoning", id: "thought", body: "working", open: true, startedAt: 0 };
  const reply: RunPart = { kind: "text", id: "reply", body: "Here is what I found." };

  it("shows thinking only when reasoning is the current live edge", () => {
    expect(reasoningAtLiveEdge([tool("read_attempt"), thought], true)).toBe(true);
    expect(reasoningAtLiveEdge([thought, reply], true)).toBe(false);
  });

  it("never keeps the loading state after the reply phase or completion", () => {
    expect(reasoningAtLiveEdge([thought], true, 10)).toBe(false);
    expect(reasoningAtLiveEdge([thought], false)).toBe(false);
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

/**
 * Reasoning used to reach the renderer and be discarded as protocol noise, so the
 * transcript could only show a fixed "Thinking" label with nothing behind it.
 * These lock the shape the thread actually renders: an ordered transcript where
 * thinking, tool calls, and replies sit where they happened.
 */
describe("streaming a turn", () => {
  const stream = (...events: Array<Partial<Parameters<typeof reduceRun>[1]>>) =>
    events.reduce<AgentRun | null>((current, event) => reduceRun(current, { runId: "run", ...event } as Parameters<typeof reduceRun>[1]), null);

  it("streams reasoning into one open block rather than one part per delta", () => {
    const result = stream(
      { type: "reasoning", phase: "start" },
      { type: "reasoning", text: "The shrink case " },
      { type: "reasoning", text: "keeps failing." },
    );

    expect(result?.parts).toHaveLength(1);
    const thinking = result?.parts[0];
    expect(thinking?.kind).toBe("reasoning");
    if (thinking?.kind !== "reasoning") throw new Error("expected reasoning");
    expect(thinking.body).toBe("The shrink case keeps failing.");
    expect(thinking.open).toBe(true);
  });

  it("closes the thinking that produced a reply, and keeps both in order", () => {
    const result = stream(
      { type: "reasoning", text: "Deciding what to read." },
      { type: "text", text: "You fixed the shrink case." },
    );

    expect(result?.parts.map((part) => part.kind)).toEqual(["reasoning", "text"]);
    const thinking = result?.parts[0];
    if (thinking?.kind !== "reasoning") throw new Error("expected reasoning");
    expect(thinking.open).toBe(false);
  });

  it("interleaves thinking, tool calls, and thinking again as separate blocks", () => {
    const result = stream(
      { type: "reasoning", text: "First I need the log." },
      { type: "tool", tool: "replay_attempt", callId: "c1", phase: "start" },
      { type: "tool", tool: "replay_attempt", callId: "c1", phase: "end", ok: true, detail: "5 runs" },
      { type: "reasoning", text: "Now I know what broke." },
      { type: "text", text: "Here is what I found." },
    );

    // Not one thought and a list of calls: the second thought is its own row,
    // after the call it followed.
    expect(result?.parts.map((part) => part.kind)).toEqual(["reasoning", "tool", "reasoning", "text"]);
    const first = result?.parts[0];
    if (first?.kind !== "reasoning") throw new Error("expected reasoning");
    expect(first.open).toBe(false);
    expect(first.body).toBe("First I need the log.");
  });

  it("settles the open thinking when the turn finishes", () => {
    const result = stream({ type: "reasoning", text: "Half a thought" }, { type: "done" });
    const thinking = result?.parts[0];

    expect(result?.status).toBe("done");
    if (thinking?.kind !== "reasoning") throw new Error("expected reasoning");
    expect(thinking.open).toBe(false);
    expect(thinking.endedAt).toBeGreaterThan(0);
  });
});

/* A Spar turn is twenty-one phases and every one of them draws rows. Which of
   them is work and which is the answer is not guessed from watching text
   arrive — the worker names each phase as it opens it, and the phase with no
   tools is the one that replies. */
describe("where the work ends and the answer begins", () => {
  const phase = (current: AgentRun, detail: string): AgentRun => {
    const next = reduceRun(current, { runId: "run", type: "status", detail });
    if (!next) throw new Error("the status event was dropped");
    return next;
  };

  it("marks the reply phase, and the parts that came before it as the work", () => {
    const working = phase(run([tool("read_ability")]), "phase-step:4;active:create_question");
    expect(working.finalStartedAt).toBeUndefined();

    const answering = phase({ ...working, parts: [tool("read_ability"), tool("create_question")] }, "phase-step:9;active:none");
    expect(answering.finalStartedAt).toBeDefined();
    expect(answering.finalFrom).toBe(2);
  });

  it("keeps the first such phase, so a turn cannot end its work twice", () => {
    const first = phase(run([]), "phase-step:9;active:none");
    const again = phase({ ...first, parts: [tool("read_ability")] }, "phase-step:10;active:none");
    expect(again.finalStartedAt).toBe(first.finalStartedAt);
    expect(again.finalFrom).toBe(0);
  });

  it("says nothing about a phase that still has tools to call", () => {
    expect(phase(run([]), "phase-step:2;active:read_ability,search_learner_model").finalStartedAt).toBeUndefined();
  });
});

/* A message typed mid-turn is queued when it is sent and picked up at the next
   phase boundary. Until the turn says it has taken it, the thread shows it as
   waiting — otherwise the learner assumes they were ignored. */
describe("a message the turn has not picked up yet", () => {
  const status = (detail: string): AgentRun => {
    const next = reduceRun(run([]), { runId: "run", type: "status", detail });
    if (!next) throw new Error("the status event was dropped");
    return next;
  };

  it("counts what the turn reports having drained", () => {
    expect(run([]).steersConsumed).toBe(0);
    expect(status("steered:1").steersConsumed).toBe(1);
    expect(status("steered:3").steersConsumed).toBe(3);
  });
});
