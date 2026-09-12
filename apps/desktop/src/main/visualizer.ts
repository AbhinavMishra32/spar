import type { Language } from "@spar/domain";
import {
  EMPTY_SPEC,
  mergeSpecs,
  pythonSpecFromAnalysis,
  traceSchema,
  visualizerLanguage,
  type DeclaredSignature,
  type InputSpec,
  type PythonAnalysis,
  type Trace,
} from "@spar/visualizer/host";
import { UtilityClient } from "./utilityClient.js";

/**
 * The host side of the visualiser.
 *
 * Everything here is a decision the renderer is not allowed to make. The
 * renderer says "trace this Python"; this file decides what program that means,
 * how long it may run, and how much it may produce — and it validates what comes
 * back before any of it reaches a React component, because a trace is a
 * subprocess's stdout and the renderer treats it as a data model.
 *
 * The one design point worth stating: the *shape* of a run comes from the
 * language adapter, but every *limit* on it comes from here. An adapter that
 * could set its own timeout would be an adapter that could hang the app.
 */

/** How long a trace may take. Generous next to the tracer's own eight-second
 *  budget, because this clock also has to cover interpreter startup on a cold
 *  machine — it is the backstop for a tracer that wedged before its own limits
 *  could fire, not the limit a learner is expected to hit. */
const TRACE_TIMEOUT_MS = 20_000;
/** Analysis parses and returns; a second of it means something is wrong. */
const ANALYZE_TIMEOUT_MS = 8_000;
/** Steps per trace. The tracer's default, restated here because it is a
 *  product decision — how much of a run is worth keeping — rather than an
 *  implementation detail of the tracer. */
const DEFAULT_MAX_STEPS = 1_500;
const MAX_STEPS_CEILING = 6_000;

export type TraceInput = { language: Language; code: string; setup: string; maxSteps?: number | undefined };
export type AnalyzeInput = { language: Language; code: string; signature?: DeclaredSignature | null };

export class VisualizerService {
  /* One process, reused. Starting a utility process costs more than most traces
     do, and the visualiser is used in bursts — run, step, edit, run — so a
     per-request process would spend most of its life starting up. */
  private readonly client = new UtilityClient("tracer", () => {});

  /**
   * Run one trace.
   *
   * Errors inside the traced program are not errors here. A trace that ends in
   * an exception still carries every frame up to the throw, and those frames are
   * the most useful thing the visualiser produces — showing them is the whole
   * point. Only a failure to *obtain* a trace throws.
   */
  async trace(input: TraceInput): Promise<Trace> {
    const language = this.adapter(input.language);
    const command = language.traceCommand({
      code: input.code,
      setup: input.setup,
      maxSteps: Math.min(Math.max(input.maxSteps ?? DEFAULT_MAX_STEPS, 1), MAX_STEPS_CEILING),
    });
    const raw = await this.client.request("run", { command, timeoutMs: TRACE_TIMEOUT_MS }).promise;
    const parsed = traceSchema.safeParse(raw);
    if (!parsed.success) throw new Error("The tracer returned a trace Spar could not read.");
    return parsed.data;
  }

  /**
   * Work out how this code can be called.
   *
   * Two sources, and the merge between them is the interesting part. A source
   * problem's declared signature has the types; the learner's file has what
   * actually exists right now. Preferring one outright breaks a real case each
   * way — a renamed method, or a learner who stripped the annotations — so both
   * are gathered and reconciled.
   *
   * A parse failure is a value, not a throw: code that does not parse is the
   * normal state of code someone is typing, and the form should say "line 12"
   * and wait rather than the page reporting that something went wrong.
   */
  async analyze(input: AnalyzeInput): Promise<InputSpec> {
    const language = this.adapter(input.language);
    const declared = input.signature ? language.specFromSignature(input.signature) : null;
    let parsed: InputSpec = EMPTY_SPEC;
    try {
      const raw = await this.client.request("run", { command: language.analyzeCommand(input.code), timeoutMs: ANALYZE_TIMEOUT_MS }).promise;
      parsed = pythonSpecFromAnalysis(raw as PythonAnalysis);
    } catch (error) {
      // Losing the parse is survivable when a signature was declared: the form
      // is still correct, it just cannot know whether the method is really
      // there. Losing both leaves the learner with the raw-source escape hatch,
      // which is why it exists.
      const detail = error instanceof Error ? error.message : String(error);
      if (!declared) return { ...EMPTY_SPEC, warnings: [detail] };
      return { ...declared, warnings: [...declared.warnings, detail] };
    }
    return mergeSpecs(declared, parsed);
  }

  stop() {
    this.client.stop();
  }

  private adapter(language: Language) {
    const adapter = visualizerLanguage(language);
    // Reachable only if the renderer asks for a language the picker never
    // offered, which is a bug rather than a state — but it is an IPC boundary,
    // so it answers rather than crashing.
    if (!adapter) throw new Error(`Spar cannot visualise ${language} yet.`);
    return adapter;
  }
}
