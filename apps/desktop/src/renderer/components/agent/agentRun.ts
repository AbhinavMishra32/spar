import type { AgentActivityFile, AgentStreamEvent } from "../../../shared/api";

export type ToolPhase = "running" | "done" | "error";

export type RunPart =
  | { kind: "text"; id: string; body: string }
  /** The model's own reasoning, streamed in as it arrives. `open` while more is
   *  still coming, which is what makes it read as thinking rather than as a
   *  block that appears finished. */
  | { kind: "reasoning"; id: string; body: string; open: boolean; startedAt: number; endedAt?: number }
  | {
      kind: "tool";
      id: string;
      tool: string;
      label: string;
      /** The agent's own name for this step. Empty when it gave none. */
      actionTitle: string;
      detail: string;
      phase: ToolPhase;
      files: AgentActivityFile[];
      /** The call's arguments, and its result once it settles, as formatted JSON.
       *  Redacted in the worker, so what is here is what may be shown. */
      input: string;
      output: string;
      startedAt: number;
      endedAt?: number;
    }
  | { kind: "status"; id: string; body: string }
  | { kind: "error"; id: string; body: string };

export type AgentRun = {
  runId: string;
  parts: RunPart[];
  status: "streaming" | "done" | "error";
  startedAt: number;
  /* When the agent stopped working and started answering. The worker names each
     phase as it opens it, and the phase that offers no tools is the one that
     replies — so this is the turn's own account of where the work ended, not a
     guess made from watching text arrive. It is what folds the work away. */
  finalStartedAt?: number;
  /** How many parts had arrived by then: everything before is the work, and
   *  everything from here is the reply. */
  finalFrom?: number;
  /* How many of the learner's mid-turn messages this turn has actually picked
     up. They are queued when sent and drained at the next phase boundary, so
     until this counts one, what they said is in the transcript but not yet in
     front of the agent — and the thread says so rather than letting them assume
     it was read. */
  steersConsumed: number;
};

/** Provider reasoning is visible only as a transient loader at the live edge. */
export function reasoningAtLiveEdge(parts: readonly RunPart[], streaming: boolean, finalStartedAt?: number): boolean {
  return streaming && finalStartedAt === undefined && parts.at(-1)?.kind === "reasoning";
}

/**
 * Folds the raw utility-process stream into the shape the transcript renders.
 * Consecutive text deltas append to the trailing text part so streaming reads as
 * one growing message rather than a wall of fragments, and a tool's start/end
 * pair updates one row in place via its callId.
 */
/**
 * How much of one block of thinking, or one answer, is kept in memory.
 *
 * A turn arrives one token at a time and each token used to rewrite the block it
 * belongs to: `body + text`, a new parts array, a new run object, a React
 * update. For a turn that thinks for ninety seconds that is hundreds of
 * thousands of intermediate strings, each one a copy of everything said so far,
 * and the heap it churns through is quadratic in the length of the thought. That
 * is where the gigabytes came from — the app was not holding them so much as
 * generating them faster than they could be collected, and V8 does not hand that
 * back to the operating system once it has grown for it.
 *
 * Two things fix it and both are here: the flush in `App` applies a frame's
 * worth of deltas in one pass, and this caps what any single part can grow to.
 * The cap keeps the head — the beginning of a thought is the part worth reading,
 * and nobody is scrolling a hundred thousand characters of it.
 */
const MAX_BODY = 20_000;

/** Appends, and stops growing at the cap rather than copying forever. */
function extend(body: string, text: string): string {
  if (body.length >= MAX_BODY) return body;
  const next = body + text;
  return next.length <= MAX_BODY ? next : `${next.slice(0, MAX_BODY)}…`;
}

/**
 * A whole frame's events, applied in one pass.
 *
 * The reducer below copies the parts array per event, which is right for one
 * event and ruinous for a thousand. Folding the buffered batch through it and
 * setting state once is what turns a per-token rewrite into a per-frame one.
 */
export function reduceRunBatch(current: AgentRun | null, events: readonly AgentStreamEvent[]): AgentRun | null {
  return events.reduce<AgentRun | null>((run, event) => reduceRun(run, event) ?? run, current);
}

export function reduceRun(current: AgentRun | null, event: AgentStreamEvent): AgentRun | null {
  const run: AgentRun = current && current.runId === event.runId
    ? current
    : { runId: event.runId, parts: [], status: "streaming", startedAt: Date.now(), steersConsumed: 0 };

  const parts = [...run.parts];
  const last = parts[parts.length - 1];

  switch (event.type) {
    case "text": {
      const text = event.text ?? "";
      if (!text) return run;
      // A word of the answer closes the thinking that produced it.
      const settled = closeReasoning(parts);
      const tail = settled[settled.length - 1];
      if (tail?.kind === "text") settled[settled.length - 1] = { ...tail, body: extend(tail.body, text) };
      else settled.push({ kind: "text", id: `${event.runId}-t${settled.length}`, body: text });
      return { ...run, parts: settled, status: "streaming" };
    }

    /* Reasoning accumulates into the open block, and a new block starts whenever
       the last thing in the transcript is not one — so thinking that resumes
       after a tool call reads as a second thought rather than as more of the
       first. */
    case "reasoning": {
      if (event.phase === "end") return { ...run, parts: closeReasoning(parts), status: "streaming" };
      const text = event.text ?? "";
      if (event.phase === "start") {
        const settled = closeReasoning(parts);
        settled.push({ kind: "reasoning", id: `${event.runId}-r${settled.length}`, body: "", open: true, startedAt: Date.now() });
        return { ...run, parts: settled, status: "streaming" };
      }
      if (!text) return run;
      /* Continues the trailing block even when it was closed, as long as nothing
         happened in between. A turn runs as several provider calls, each opening
         its own reasoning; without this the transcript grew one "Thought for Ns"
         row per call and read as a stack of stubs rather than as one thought. */
      if (last?.kind === "reasoning") {
        const { endedAt: _reopened, ...held } = last;
        parts[parts.length - 1] = { ...held, body: extend(last.body, text), open: true };
      } else {
        parts.push({ kind: "reasoning", id: `${event.runId}-r${parts.length}`, body: text, open: true, startedAt: Date.now() });
      }
      return { ...run, parts, status: "streaming" };
    }

    case "tool": {
      const tool = event.tool ?? "tool";
      const id = event.callId ?? `${event.runId}-x${parts.length}`;
      const index = parts.findIndex((part) => part.kind === "tool" && part.id === id);
      // A call starting closes the thinking that decided on it.
      if (event.phase !== "end" && index < 0) closeReasoning(parts, true);

      if (event.phase === "end") {
        if (index < 0) return run;
        const existing = parts[index] as Extract<RunPart, { kind: "tool" }>;
        parts[index] = {
          ...existing,
          phase: event.ok === false ? "error" : "done",
          detail: event.detail ?? existing.detail,
          ...(event.files ? { files: event.files } : {}),
          /* The start event already carried the arguments, so an end event that
             omits them must not blank the panel the learner may have open. */
          ...(event.actionTitle ? { actionTitle: event.actionTitle } : {}),
          ...(event.input ? { input: event.input } : {}),
          output: event.output ?? existing.output,
          endedAt: Date.now(),
        };
        return { ...run, parts };
      }

      if (index >= 0) return run;
      parts.push({
        kind: "tool",
        id,
        tool,
        label: event.label ?? "",
        actionTitle: event.actionTitle ?? "",
        detail: event.detail ?? "",
        phase: "running",
        files: event.files ?? [],
        input: event.input ?? "",
        output: event.output ?? "",
        startedAt: Date.now(),
      });
      return { ...run, parts, status: "streaming" };
    }

    case "status": {
      const body = event.detail ?? event.text ?? "";
      /* Read before the noise filter drops it. `active:none` is the phase that
         has no tools to call, which is the phase that answers. */
      const steered = /^steered:(\d+)$/.exec(body);
      if (steered) return { ...run, steersConsumed: run.steersConsumed + Number(steered[1]) };
      if (/^phase-step:\d+;active:none$/.test(body) && run.finalStartedAt === undefined) {
        return { ...run, finalStartedAt: Date.now(), finalFrom: parts.length };
      }
      // Provider protocol chatter belongs in the raw trace, not the transcript.
      if (!body || isProtocolNoise(body)) return run;
      if (last?.kind === "status") parts[parts.length - 1] = { ...last, body };
      else parts.push({ kind: "status", id: `${event.runId}-s${parts.length}`, body });
      return { ...run, parts, status: "streaming" };
    }

    case "error":
      parts.push({ kind: "error", id: `${event.runId}-e${parts.length}`, body: event.text ?? "Spar could not finish that turn." });
      return { ...run, parts, status: "error" };

    case "done":
      return { ...run, parts: closeReasoning(parts), status: "done" };

    default:
      return run;
  }
}

/**
 * Settles the open reasoning block, if there is one, and stamps when it closed so
 * the collapsed row can say how long it thought. Mutates in place when asked, for
 * the caller that is already building the next part onto the same array.
 */
function closeReasoning(parts: RunPart[], inPlace = false): RunPart[] {
  const target = inPlace ? parts : [...parts];
  const index = target.length - 1;
  const last = target[index];
  if (last?.kind === "reasoning" && last.open) target[index] = { ...last, open: false, endedAt: Date.now() };
  return target;
}

export type ToolPart = Extract<RunPart, { kind: "tool" }>;
export type ReasoningPart = Extract<RunPart, { kind: "reasoning" }>;

/** A transcript row. Every tool call is one, since each carries the agent's own
 *  account of what it was for; the two that are outcomes rather than steps —
 *  a published challenge, a solve being read — get their own shape. */
export type GroupedPart =
  | Exclude<RunPart, { kind: "tool" }>
  /** A tool call, and the thinking that led straight to it — see `bindThinking`. */
  | { kind: "tool-row"; id: string; part: ToolPart; thinking?: ReasoningPart; after?: ReasoningPart }
  | { kind: "challenge"; id: string; part: ToolPart }
  | { kind: "solve-read"; id: string; part: ToolPart }
  /** A diagram the agent built into its reply. Lifted out of the step rows for
   *  the same reason a published challenge is: it is something the learner is
   *  meant to look at, not a record of the agent having looked at something. */
  | { kind: "explained-trace"; id: string; part: ToolPart };

/**
 * Rows, in the order everything happened.
 *
 * Shared between the live stream and a turn read back from storage: a finished
 * turn is supposed to look exactly like it did while it ran, and two functions
 * doing this separately is how that stops being true.
 */
/**
 * Thinking, folded into the step it was thinking about.
 *
 * A turn that works through a problem alternates: a block of reasoning, then the
 * call it decided on, then more reasoning, then the next call. Drawn as written
 * that is two rows per step, and the first of each pair says nothing the second
 * does not — "Planning to call open_visualizer" above `Opening the failing
 * window trace`, "Preparing parallel visualizer reads" above the four reads it
 * prepared. Half the transcript was the agent announcing its next row.
 *
 * So a settled block of thinking that is immediately followed by a call belongs
 * to that call, and rides in the panel the row already opens. The thread becomes
 * what the learner is actually scanning for — the things that happened, in
 * order, each with what it found — and the reasoning behind any one of them is
 * one click away rather than in the way of the next.
 *
 * Two cases keep their own row, because in both the thinking is the content
 * rather than a preamble: a block still streaming (that row *is* the agent
 * thinking, and it is the only sign a long turn is alive), and a block that led
 * to prose instead of an action — there, it is the thinking behind what the
 * agent went on to say.
 */
function bindThinking(rows: GroupedPart[]): GroupedPart[] {
  const bound: GroupedPart[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const next = rows[index + 1];
    if (row.kind === "reasoning" && !row.open && next?.kind === "tool-row" && !next.thinking) {
      bound.push({ ...next, thinking: row });
      index += 1;
      continue;
    }
    /* The thinking a turn does after its last call, before it answers. There is
       no call ahead of it to belong to, so on its own it draws a stack of
       headings with nothing behind them — six lines of the agent talking about
       the work, in place of the work. It goes back onto the call it was
       reasoning from, so that one row opens into the whole of it: why it
       looked, what it sent, what came back, and what it made of it. */
    const held = bound[bound.length - 1];
    if (row.kind === "reasoning" && !row.open && held?.kind === "tool-row" && !held.after && (!next || next.kind === "text")) {
      bound[bound.length - 1] = { ...held, after: row };
      continue;
    }
    bound.push(row);
  }
  return bound;
}

export function groupParts(parts: RunPart[]): GroupedPart[] {
  const grouped: GroupedPart[] = [];
  for (const part of parts) {
    // A published challenge is the outcome of the turn rather than another step
    // toward it, and leaving it among the retrieval rows is what made it vanish.
    if (part.kind === "tool" && isChallengePublished(part)) grouped.push({ kind: "challenge", id: `challenge-${part.id}`, part });
    // Reading the solve is set apart for the same reason: it is what the rest of
    // the turn is a response to.
    else if (part.kind === "tool" && part.tool === "replay_attempt" && part.phase !== "error") grouped.push({ kind: "solve-read", id: `solve-${part.id}`, part });
    // A successful visualisation is the picture; a failed one is an ordinary
    // failed step, because there is nothing to draw.
    else if (part.kind === "tool" && part.tool === "visualize_explain" && part.phase === "done") grouped.push({ kind: "explained-trace", id: `trace-${part.id}`, part });
    /* Every other call is its own row.
       Consecutive calls used to be folded into one collapsed group under a
       synthesized summary — "Reviewed past attempts, checked concept evidence, and
       2 more". That was the right shape when the host was naming the rows, because
       a stack of interchangeable table labels is worth hiding. Now each call
       carries the agent's own account of what it was for, and a summary that
       replaces four specific sentences with one generic one is throwing away the
       only part worth reading. */
    else if (part.kind === "tool") grouped.push({ kind: "tool-row", id: `tool-${part.id}`, part });
    /* Thinking that was interrupted only by more thinking is one thought.

       The stream opens a fresh reasoning block per provider call, and a stored
       turn records one step per block, so a turn that made six calls came back as
       six settled blocks in a row — a dozen grey headings stacked down the
       transcript with the actual work pushed off the screen. Nothing happened
       between them: there is no tool call, no reply, nothing to divide them but
       the provider's own accounting. Joined here rather than in the reducer so
       the live transcript and the stored one fold identically, and so the parts
       themselves stay a faithful record of what arrived. */
    else if (part.kind === "reasoning" && !part.open && last(grouped)?.kind === "reasoning") {
      const open = grouped[grouped.length - 1] as Extract<RunPart, { kind: "reasoning" }>;
      if (open.open) grouped.push(part);
      else grouped[grouped.length - 1] = {
        ...open,
        // Blank line between them: a heading is only a heading at the start of a
        // line, so joining two blocks with a space would bury the second's.
        body: `${open.body}\n\n${part.body}`.trim(),
        endedAt: Math.max(open.endedAt ?? 0, part.endedAt ?? 0),
      };
    }
    else grouped.push(part);
  }
  return bindThinking(grouped);
}

function last(grouped: GroupedPart[]): GroupedPart | undefined {
  return grouped[grouped.length - 1];
}

function isProtocolNoise(body: string): boolean {
  return /^(phase-step|protocol-retry|step-|start|finish|tool-|text-|reasoning|response-)/.test(body);
}

const TOOL_VERBS: Record<string, string> = {
  search_learner_model: "Searched the learner model",
  search_attempt_history: "Searched attempt history",
  read_ability: "Read ability document",
  read_attempt: "Read attempt trace",
  read_session: "Read session",
  read_concept_graph: "Read concept graph",
  search_concept_evidence: "Checked your concept evidence",
  ask_user_question: "Asked you a question",
  set_session_objective: "Set the session objective",
  set_training_target: "Set the training target",
  create_question: "Created challenge",
  replace_current_question: "Replaced challenge",
  search_challenge_history: "Searched challenge history",
  read_challenge: "Read challenge history",
  upsert_ability: "Updated ability",
  inspect_current_attempt: "Inspected your attempt",
  replay_attempt: "Read your solve",
  evaluate_attempt: "Evaluated your attempt",
  propose_ability_update: "Updated ability document",
  commit_session_decision: "Committed next action",
  open_visualizer: "Opened the visualiser",
  visualize_run: "Traced the code",
  visualize_find: "Looked for the moment it changed",
  visualize_read_step: "Read the state at that step",
  visualize_explain: "Drew what happens",
  web_search: "Searched the web",
  web_fetch: "Read a web page",
};

/** Present tense while a call is open, past tense once it settles. */
export function toolVerb(tool: string, running: boolean, rejected = false): string {
  if ((tool === "create_question" || tool === "replace_current_question") && rejected) return "Rejected challenge candidate";
  const settled = TOOL_VERBS[tool];
  if (!settled) {
    const spaced = tool.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
  if (!running) return settled;
  return settled
    .replace(/^Searched/, "Searching")
    .replace(/^Read\b/, "Reading")
    .replace(/^Replayed\b/, "Replaying")
    .replace(/^Asked/, "Asking")
    .replace(/^Set\b/, "Setting")
    .replace(/^Created/, "Creating")
    .replace(/^Inspected/, "Inspecting")
    .replace(/^Evaluated/, "Evaluating")
    .replace(/^Updated/, "Updating")
    .replace(/^Committed/, "Committing");
}

const SAFE_TOOL_LABELS: Record<string, [string, string]> = {
  search_learner_model: ["Search learning history", "Searched learning history"],
  search_attempt_history: ["Review past attempts", "Reviewed past attempts"],
  search_challenge_history: ["Review challenge history", "Reviewed challenge history"],
  read_ability: ["Read ability context", "Read ability context"],
  read_attempt: ["Read attempt evidence", "Read attempt evidence"],
  read_session: ["Read session context", "Read session context"],
  read_challenge: ["Read challenge context", "Read challenge context"],
  read_concept_graph: ["Read concept context", "Read concept context"],
  search_concept_evidence: ["Check concept evidence", "Checked concept evidence"],
  inspect_current_attempt: ["Inspect current attempt", "Inspected current attempt"],
  replay_attempt: ["Read how you solved it", "Read how you solved it"],
  evaluate_attempt: ["Evaluate attempt", "Evaluated attempt"],
  set_session_objective: ["Update session objective", "Updated session objective"],
  set_training_target: ["Update training target", "Updated training target"],
  propose_ability_update: ["Prepare ability update", "Prepared ability update"],
  upsert_ability: ["Update ability", "Updated ability"],
  commit_session_decision: ["Choose next step", "Chose next step"],
  create_question: ["Build challenge", "Built challenge"],
  replace_current_question: ["Build replacement challenge", "Built replacement challenge"],
  create_fallback_question: ["Set a standard challenge", "Set a standard challenge"],
  /* Named for the thing the learner watched happen. "Prepared a question" is
     the tool's own view of itself — the question had already been asked, and
     answered, by the time that row settled. */
  ask_user_question: ["Asking you something", "Asked a question"],
  /* The two that leave the learner's own record. Named for the fact of going out
     to the web, because that is the part worth noticing in a transcript that is
     otherwise entirely about them. */
  web_search: ["Search the web", "Searched the web"],
  web_fetch: ["Read a web page", "Read a web page"],
};

/** Transcript-safe labels never expose tool arguments, database IDs, or queries. */
export function safeToolLabel(tool: string, running: boolean, failed = false): string {
  // A rejected candidate is the compiler doing its job and the agent iterating,
  // so it is named as a rejection rather than as a failure the learner should
  // read as breakage.
  if (failed && tool === "replace_current_question") return "Replacement candidate rejected";
  if (failed && (tool === "create_question" || tool === "create_fallback_question")) return "Challenge candidate rejected";
  if (failed) return "Could not complete tool step";
  const labels = SAFE_TOOL_LABELS[tool];
  if (labels) return labels[running ? 0 : 1];
  return running ? "Use a tool" : "Used a tool";
}

/**
 * What this row says it is.
 *
 * The agent's own title for the step when it gave one, and the fixed table only as
 * a fallback. The table can say "Searched attempt history" and nothing more; the
 * agent can say what it was looking for and why, which is the difference between a
 * transcript you can follow and a list of tool names. A stored row from before
 * titles existed, and any turn where the model omitted one, still reads correctly.
 */
export function toolRowTitle(part: Extract<RunPart, { kind: "tool" }>): string {
  return part.actionTitle.trim() || safeToolLabel(part.tool, part.phase === "running", part.phase === "error");
}

/** Every tool that reaches the connected practice source. The transcript marks
 *  these with the source's own logo, because "searched" and "searched LeetCode" are
 *  different claims and only one of them is what happened. */
export function isSourceTool(tool: string): boolean {
  return tool.endsWith("_practice_problem") || tool.endsWith("_practice_problems") || tool.startsWith("read_practice_") || tool === "assign_practice_problem";
}

const CHALLENGE_TOOLS = ["create_question", "replace_current_question", "create_fallback_question", "assign_practice_problem"];

/**
 * A challenge that actually reached durable storage. `phase === "done"` is the
 * distinction that matters: the same tool rejected by the compiler settles as
 * "error" and stays an ordinary step, because nothing was published.
 */
export function isChallengePublished(part: RunPart): boolean {
  return part.kind === "tool" && part.phase === "done" && CHALLENGE_TOOLS.includes(part.tool);
}

/** What a card away from the transcript says about a turn that is under way. */
export type RunActivity = {
  state: "working" | "failed";
  /** The one line: what the agent is doing at this instant. */
  headline: string;
  /**
   * Identity of that line, which is not the same thing as its text. A step
   * change should be animated; a reply growing by a token should not, and
   * keying an animation on the words themselves would restart it on every
   * delta of a streaming sentence.
   */
  headlineKey: string;
  /** The step it finished immediately before, so the line above reads as motion. */
  previous?: string;
  /** Settled tool calls so far — a count of work done, not of tokens spent. */
  steps: number;
  startedAt: number;
  /** A compiled challenge has landed in this run; the session has something new. */
  published: boolean;
};

/**
 * Reduces a run to the few facts a session card can hold.
 *
 * A finished run is deliberately `null` rather than a "done" activity: the card
 * behind it is drawn from the session summary, which the main process has
 * already refreshed by the time the run settles, and a card that kept reporting
 * the last turn would be showing older news than the row it sits in.
 *
 * The headline prefers the open tool call over the streaming reply. Both are
 * true at once near the end of a turn, and "Building challenge" says more about
 * where the session is than the first clause of a sentence about it does.
 */
export function runActivity(run: AgentRun | null | undefined): RunActivity | null {
  if (!run || run.status === "done") return null;
  const tools = run.parts.filter((part): part is Extract<RunPart, { kind: "tool" }> => part.kind === "tool");
  const settled = tools.filter((part) => part.phase !== "running");
  const base = {
    steps: settled.length,
    startedAt: run.startedAt,
    published: run.parts.some(isChallengePublished),
    ...(settled.at(-1) ? { previous: safeToolLabel(settled.at(-1)!.tool, false, settled.at(-1)!.phase === "error") } : {}),
  };

  if (run.status === "error") {
    const failure = [...run.parts].reverse().find((part) => part.kind === "error");
    return { ...base, state: "failed", headlineKey: "failed", headline: firstSentence(failure?.kind === "error" ? failure.body : "") || "That turn did not finish" };
  }

  const running = tools.find((part) => part.phase === "running");
  if (running) return { ...base, state: "working", headlineKey: `tool:${running.id}`, headline: safeToolLabel(running.tool, true) };

  const last = run.parts.at(-1);
  // Thinking is a real state now, so a card says so rather than reporting the
  // step before it as though the turn had stalled there.
  if (last?.kind === "reasoning" && last.open) {
    return { ...base, state: "working", headlineKey: `reasoning:${last.id}`, headline: "Thinking it through" };
  }
  if (last?.kind === "text") {
    const tail = tailLine(last.body);
    if (tail) return { ...base, state: "working", headlineKey: `text:${last.id}`, headline: tail };
  }
  return { ...base, state: "working", headlineKey: `idle:${base.steps}`, headline: base.steps ? "Working through what it found" : "Reading your evidence" };
}

function firstSentence(body: string): string {
  const [head] = body.split(/(?:\.\s+|\n)/).filter((line) => line.trim());
  return (head ?? "").trim().replace(/\.$/, "");
}

/**
 * The sentence the reply is currently in. A card is one line tall, so it follows
 * the front of the stream rather than the start of the message — and a clause
 * still being typed is left as it is instead of being padded with an ellipsis,
 * which at this size reads as a truncation the learner could open to see.
 */
function tailLine(body: string): string {
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  const last = lines.at(-1);
  if (!last) return "";
  const sentences = last.split(/(?<=[.!?])\s+/);
  const tail = (sentences.at(-1) ?? last).replace(/^[#>*\-\s]+/, "");
  return tail.length > 120 ? `${tail.slice(0, 120)}…` : tail;
}

export function diffTotals(files: AgentActivityFile[]): { added: number; removed: number } {
  return files.reduce(
    (totals, file) => ({ added: totals.added + file.added, removed: totals.removed + file.removed }),
    { added: 0, removed: 0 },
  );
}
