import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Language } from "@spar/domain";
import { canVisualize, digestTrace, findMoments, frameReport, sliceView, type Trace } from "@spar/visualizer";
import type { LocalStore } from "./store.js";
import type { VisualizerService } from "./visualizer.js";
import type { WorkspaceService } from "./workspaces.js";
/* The names live with the stage machine that decides when they are offered, so
   the list the host can execute and the list the model can see cannot drift. */
import { VISUALIZER_GATE, VISUALIZER_SKILL_TOOLS, VISUALIZER_TOOLS } from "../workers/agentPolicy.js";

/**
 * The visualiser, as something the agent can use.
 *
 * Spar can already run a learner's code under a tracer and draw every step of
 * it. All of that was reachable only by the learner opening a page and driving
 * it themselves — so the one participant in the conversation who could say
 * *which* step matters had no way to look at any of them.
 *
 * This is the seam that fixes that, and the shape of it is the design decision
 * worth defending. It would have been less code to hand the agent a trace and
 * let it reason over the JSON. That fails in both directions: a real trace is
 * far too large for a context window, and the parts that get dropped to make it
 * fit are exactly the parts an explanation is made of. So the agent never holds
 * a trace. It holds a handle to one, and asks questions — what shape was this
 * run, where does `total` change, what is true at step 41 — each of which comes
 * back small and exact. The trace itself stays here.
 *
 * The last tool is the different one. `visualize_explain` does not answer a
 * question; it puts a picture in the conversation. The agent picks the steps and
 * writes a sentence for each, and the learner gets those steps drawn on the same
 * canvas the visualiser page uses, inline, in the reply. That is the feature:
 * not "the agent can see traces" but "the agent can show you the moment".
 */

/** Runs kept per session. Small because a trace is large and because the agent
 *  is expected to explain the run it just took, not to accumulate a library of
 *  them — but more than one, because comparing what their code does with what a
 *  correct version does is two runs and is the best explanation available. */
const RUNS_PER_SESSION = 4;
/** Steps one picture may be built from. Past this it is a film, and a learner
 *  scrubbing a film is back to doing the work the agent was supposed to do. */
const MAX_PICKS = 8;
/** Longest snippet the agent may author. Enough for an illustration of a single
 *  idea, short enough that it cannot smuggle in a whole solution. */
const MAX_CODE = 4_000;

export type VisualizerToolName =
  | "open_visualizer"
  | "visualize_run"
  | "visualize_read_step"
  | "visualize_find"
  | "visualize_explain";

type Run = { id: string; language: Language; code: string; setup: string; trace: Trace };

export class VisualizerToolbox {
  private readonly runs = new Map<string, Run[]>();

  constructor(
    private readonly service: VisualizerService,
    private readonly store: LocalStore,
    private readonly workspaces: WorkspaceService,
  ) {}

  handles(name: string): name is VisualizerToolName {
    return VISUALIZER_TOOLS.includes(name);
  }

  async execute(name: VisualizerToolName, input: Record<string, unknown>, sessionId: string): Promise<unknown> {
    if (name === VISUALIZER_GATE) return this.open(sessionId);
    if (name === "visualize_run") return this.run(input, sessionId);
    if (name === "visualize_read_step") return this.readStep(input, sessionId);
    if (name === "visualize_find") return this.find(input, sessionId);
    return this.explain(input, sessionId);
  }

  /**
   * Loading the toolkit.
   *
   * The result is instructions, not data, and that is the whole point of the
   * tool existing. Everything the agent needs to know about using the visualiser
   * well — several hundred words of it — would otherwise sit in the system
   * prompt of every turn Spar ever runs, including the ones that only set a
   * challenge. Here it is one line in the tool list until the moment it is
   * relevant, and a full briefing after.
   */
  private open(sessionId: string) {
    const language = this.languageFor(sessionId);
    const supported = canVisualize(language);
    return {
      loaded: true,
      language,
      supported,
      tools: VISUALIZER_SKILL_TOOLS,
      instructions: supported ? VISUALIZER_SKILL : `The execution visualiser cannot run ${language} yet — it traces Python only. Explain in words this turn, and do not tell the learner a diagram is coming.`,
    };
  }

  /**
   * Take a trace.
   *
   * Two sources, and they are for different jobs. `attempt` traces what the
   * learner actually wrote, which is how you explain why *their* code does what
   * it does. `code` traces a snippet the agent wrote, which is how you explain an
   * idea that is not in their file at all — what a slice really copies, why a
   * dict lookup does not scan, where an off-by-one lands. The second is the one
   * that turns this from a debugger into a teaching instrument, so it is not an
   * afterthought: a four-line illustration is a legitimate and often better use
   * of this tool than a trace of a hundred-line solution.
   */
  private async run(input: Record<string, unknown>, sessionId: string) {
    const language = this.languageFor(sessionId);
    if (!canVisualize(language)) return { error: "unsupported-language", language, note: `Spar can only trace Python right now, and this session is ${language}. Explain in words instead.` };

    const from = input.from === "attempt" ? "attempt" : "code";
    const code = from === "attempt" ? await this.attemptCode(sessionId) : String(input.code ?? "");
    if (!code.trim()) {
      return from === "attempt"
        ? { error: "no-attempt", note: "The learner has no traceable file in this session yet. Pass your own snippet as `code` instead." }
        : { error: "no-code", note: "Pass either `code` (a snippet to trace) or from: \"attempt\" (the learner's own file)." };
    }
    if (code.length > MAX_CODE) return { error: "too-long", note: `That is ${code.length} characters; ${MAX_CODE} is the limit. Trace the part that matters, not the whole file.` };

    const setup = String(input.setup ?? "").trim();
    if (!setup) return { error: "no-setup", note: "`setup` is the call to trace — one line, e.g. `search([1,3,9], 9)`. Without it nothing runs." };

    let trace: Trace;
    try {
      trace = await this.service.trace({ language, code, setup, ...(typeof input.maxSteps === "number" ? { maxSteps: input.maxSteps } : {}) });
    } catch (cause) {
      return { error: "trace-failed", note: cause instanceof Error ? cause.message : String(cause) };
    }
    if (!trace.frames.length) {
      /* Nothing ran. Almost always the setup calling something that is not
         there, and saying so is more useful than an empty digest the agent will
         try to explain anyway. */
      return { error: "no-frames", traceError: trace.error, note: "Nothing was traced. Usually the setup line calls a name the code does not define — check it against the code you passed." };
    }

    const run: Run = { id: randomUUID(), language, code, setup, trace };
    const held = [...(this.runs.get(sessionId) ?? []), run].slice(-RUNS_PER_SESSION);
    this.runs.set(sessionId, held);

    return {
      runId: run.id,
      from,
      setup,
      digest: digestTrace(trace, language),
      note: "This is the shape of the run, not the run. Use visualize_find to locate the step that matters and visualize_read_step to read it exactly — then visualize_explain to show it.",
    };
  }

  private readStep(input: Record<string, unknown>, sessionId: string) {
    const run = this.run_(sessionId, input.runId);
    if ("error" in run) return run;
    return frameReport(run.trace, Number(input.step ?? 0), run.language);
  }

  private find(input: Record<string, unknown>, sessionId: string) {
    const run = this.run_(sessionId, input.runId);
    if ("error" in run) return run;
    return findMoments(run.trace, {
      variable: typeof input.variable === "string" ? input.variable : undefined,
      line: typeof input.line === "number" ? input.line : undefined,
      branch: typeof input.branch === "boolean" ? input.branch : undefined,
      event: typeof input.event === "string" ? (input.event as "call" | "step" | "return" | "exception" | "condition") : undefined,
      value: typeof input.value === "string" ? input.value : undefined,
      limit: typeof input.limit === "number" ? input.limit : undefined,
    }, run.language);
  }

  /**
   * Put the picture in the conversation.
   *
   * The captions are required and are checked for length, because a picture with
   * no words attached is the failure mode this whole feature exists to avoid:
   * the learner gets a diagram of a step and is left to work out for themselves
   * why they were shown it. The agent chose the step; the agent says why.
   */
  private explain(input: Record<string, unknown>, sessionId: string) {
    const run = this.run_(sessionId, input.runId);
    if ("error" in run) return run;

    const picks = Array.isArray(input.steps) ? input.steps : [];
    const cleaned = picks
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        step: Number(entry.step ?? 0),
        caption: String(entry.caption ?? "").trim(),
        focus: Array.isArray(entry.focus) ? entry.focus.map((name) => String(name)) : [],
        ...(typeof entry.hold === "number" ? { hold: entry.hold } : {}),
      }))
      .filter((entry) => Number.isFinite(entry.step) && entry.caption.length > 0)
      .slice(0, MAX_PICKS);
    if (!cleaned.length) return { error: "no-steps", note: "Pick at least one step, each with a caption saying what the learner should notice in it." };

    const title = String(input.title ?? "").trim().slice(0, 90) || "What happens when this runs";
    const view = sliceView(run.trace, run.language, run.code, title, cleaned, input.autoplay !== false);
    const id = randomUUID();
    this.store.saveVisualization({ id, sessionId, title, payload: { ...view, setup: run.setup, takeaway: String(input.takeaway ?? "").trim().slice(0, 400) } });

    /* Deliberately thin. The card the learner sees is drawn from the stored row,
       fetched by id — so this result carries what the agent needs to write its
       next sentence and nothing it would be tempted to transcribe. Returning the
       frames here would put the whole picture in the transcript twice, once as a
       diagram and once as JSON the model reads back to them in prose. */
    return {
      shown: true,
      visualizationId: id,
      title,
      steps: cleaned.length,
      /* Both halves of this are things the first version of the feature got
         wrong in front of a learner: a reply that announced the picture ("the
         visualization is above"), and then described in prose the frames the
         learner was already looking at. */
      note: "It is in the conversation now and plays at the pace you set. The learner can see it, so do not announce it, do not say it is above, and do not describe its frames. Write only the one thing it is evidence for, in a sentence or two.",
    };
  }

  /** The run this call is about. Named with a trailing underscore because `run`
   *  is the tool that makes one. */
  private run_(sessionId: string, id: unknown): Run | { error: string; note: string } {
    const held = this.runs.get(sessionId) ?? [];
    const run = held.find((entry) => entry.id === String(id ?? ""));
    if (run) return run;
    return held.length
      ? { error: "unknown-run", note: `That runId is not one of this session's ${held.length} recent runs. Use the runId visualize_run returned.` }
      : { error: "no-run", note: "Nothing has been traced in this session yet. Call visualize_run first." };
  }

  /**
   * The learner's own file.
   *
   * Their implementation, not their tests and not the harness: tracing a test
   * file traces the assertions, which is a picture of the checking rather than
   * of the algorithm. Files are matched by extension and the test-shaped names
   * are dropped, which is the same rule the runner uses to decide what is a test.
   */
  private async attemptCode(sessionId: string): Promise<string> {
    const language = this.languageFor(sessionId);
    if (language !== "python") return "";
    const paths = await this.workspaces.list(sessionId).catch(() => [] as string[]);
    const candidates = paths.filter((file) => {
      const name = path.basename(file);
      return file.endsWith(".py") && !name.startsWith("test_") && !name.endsWith("_test.py") && !name.includes(".test.");
    });
    const contents = await Promise.all(candidates.map(async (file) => this.workspaces.read(sessionId, file).catch(() => "")));
    /* The largest one. A session's implementation is usually the biggest
       non-test file in it, and guessing by name breaks the moment a challenge
       calls its file something the host did not choose. */
    return contents.sort((a, b) => b.length - a.length)[0] ?? "";
  }

  /**
   * What this session is written in.
   *
   * The open challenge's language first, because that is the file the learner is
   * actually looking at; the Track's otherwise, for a session between challenges.
   * Python is the fallback rather than an error because it is the only language
   * the tracer supports — a wrong guess here produces an honest
   * "cannot trace this yet", which is a better failure than a thrown tool call.
   */
  private languageFor(sessionId: string): Language {
    const question = this.store.readSession(sessionId)?.question?.language;
    if (question) return question;
    const trackId = this.store.trackIdForSession(sessionId);
    const track = trackId ? this.store.listTracks().find((entry) => entry.id === trackId) : undefined;
    return track?.language ?? "python";
  }
}

/**
 * The briefing, loaded on demand.
 *
 * Written as a method rather than a list of capabilities: a tool list already
 * says what the tools are, and what the agent is actually missing is the
 * judgement about when a picture beats a paragraph and how to build one that
 * teaches instead of impressing.
 */
const VISUALIZER_SKILL = [
  "The execution visualiser is loaded. It runs code under a real tracer and draws every value, structure and pointer at any step, inline in this conversation — the learner can scrub through the steps you pick. Arrays draw as cells with their indices, dictionaries as key/value rows, and anything linked — trees, linked lists, graphs — as a real node-and-edge diagram.",
  "",
  "How to use it well:",
  "1. visualize_run takes the trace. Either from: \"attempt\" for the learner's own file — use this when explaining why THEIR code does what it does — or `code` for a short snippet you write yourself, which is how you show an idea that is not in their file at all. `setup` is the single call to trace.",
  "2. Read the digest it returns. Line visit counts show a loop that ran the wrong number of times; the decisions list shows which way every branch actually went; the variables list shows what moved.",
  "3. visualize_find locates the exact step — where a variable changed, where a test first went false, where the exception landed. Never guess a step index or walk steps from zero.",
  "4. visualize_read_step reads one instant exactly: every local, every heap object, and what the step before it was not.",
  "5. visualize_explain directs the animation. Pick two to five steps; for each give a caption, a `focus` naming what to draw, and a `hold` in seconds. It plays inline in your reply at the pace you set. Then write your reply: the learner can see it, so never announce it or say it is above, never narrate its frames, and just say the one thing it proves.",
  "",
  "Directing it is most of the difference between a diagram that lands and one that does not:",
  "- `focus` names the one or two things your sentence is about — a local like \"counts\", or a heap id like \"@n2\". Only those are drawn. Without it the learner gets every object in scope and has to find the one you meant, which is the work you were supposed to do for them. Omit it only when the whole state genuinely is the point.",
  "- `hold` paces it. Give the step where the thing actually goes wrong three or four seconds and the steps setting it up one; a sequence at one fixed speed cannot tell the learner which moment mattered.",
  "- Order the steps so the change is visible: the state just before, the step that changes it, the consequence. Two steps that differ in one value teach more than five that differ in all of them.",
  "- Structures draw as structures. Anything whose fields point at other objects — a tree, a linked list, a graph, a trie — is laid out as a real diagram with the links as edges, not as a box of key/value rows. So for those, focus the ROOT, not the node you happen to be standing on: focus \"tree\" or \"head\" and the whole shape is drawn with the current node marked on it, which is the picture the learner is asking for. Focusing only the current node draws one node with nothing around it.",
  "- A name in an outer frame works. Deep inside a recursion the root is usually not a local of the current frame; naming it anyway resolves up the call stack, so \"tree\" keeps drawing the whole tree at every depth.",
  "",
  "When to reach for it: whenever the learner is confused about state rather than syntax. A pointer that is not where they think, an off-by-one, a loop that exits early, a mutation they did not expect, a value that is a string when they think it is a number, a slice that copies when they think it aliases. Showing three steps of it is worth more than three paragraphs, so prefer it — including for small ideas. A two-line snippet traced and drawn is a perfectly good answer to \"why does this give 4 and not 5\".",
  "",
  "The hard rule this does not suspend: a trace of a correct solution is a solution. Never trace, and never show, a working implementation of the challenge the learner is currently on. Illustrate the mechanism on different data or a smaller analogous problem, or trace their own code and show them the step where it diverges from what they expected. The visualiser exists to make them see their state, not to hand them the answer in pictures.",
].join("\n");
