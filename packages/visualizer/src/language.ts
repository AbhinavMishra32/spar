import type { Language } from "@spar/domain";
import type { EntryPoint, InputDraft, InputSpec } from "./inputs.js";

/**
 * What it takes to add a language to the visualiser.
 *
 * Everything above this line is language-neutral: the trace model the canvas
 * draws, the input model the form renders. Everything a runtime actually
 * decides lives behind this one interface, and it is small on purpose — three
 * jobs, none of which know anything about React or Electron.
 *
 *   1. *Analyse* — read source and say how it can be called. Half of this is
 *      pure text work the adapter does in TypeScript (turning a source
 *      problem's declared signature into a form); the other half needs the
 *      language's own parser, so it is delegated to the tracer program in
 *      `analyze` mode rather than reimplemented here badly.
 *   2. *Compose* — turn a filled-in form back into a call in the language.
 *   3. *Trace* — describe the process that produces a `Trace`. The adapter
 *      names a program and its arguments; the host owns spawning it, the
 *      timeout, and the output caps, because those are process-safety
 *      decisions and the host is the only place that can enforce them.
 *
 * Python is the only adapter today. The seam is drawn where it is so a second
 * one is a new folder under `languages/` and one line in the registry — not a
 * change to any of the drawing code.
 */

/** A signature a source problem declared, in the shape LeetCode states it.
 *  Structural rather than imported so this package does not depend on the
 *  practice-source layer to describe a function. */
export type DeclaredSignature = {
  name: string;
  params: Array<{ name: string; type: string }>;
  returnType: string;
  /** Problems with no single entry point — LeetCode's design questions — cannot
   *  be driven by a generated call at all, and say so rather than being guessed. */
  classBased: boolean;
};

/** How to run one job. The host spawns it; the adapter only says what to spawn.
 *  `input` is written to the program's stdin and its stdout is the answer, which
 *  keeps the learner's source off the command line and out of any process list. */
export type TracerCommand = {
  /** Executable name, resolved on PATH by the host. */
  bin: string;
  args: string[];
  /** JSON written to stdin. */
  input: unknown;
};

/** Where a trace came from, for the "run again" affordance and for telling a
 *  learner why a run they did not start appeared. */
export type TraceRequest = { code: string; setup: string; maxSteps: number };

export type VisualizerLanguage = {
  id: Language;
  label: string;
  /** The tab name for the learner's code, e.g. `algorithm.py`. */
  fileName: string;
  /** Monaco's identifier for the grammar, which is not always Spar's. */
  editorLanguage: string;
  /** Helpers the runtime injects and an exported script has to carry itself. */
  prelude: string;
  /** What an empty visualiser opens on: something that runs and shows a shape. */
  starter: string;
  /** Absolute path to the tracer program, resolved for dev and packaged alike. */
  tracerPath(): string;
  /** Ask the language's own parser what this code offers as an entry point. */
  analyzeCommand(code: string): TracerCommand;
  /** Run one trace. */
  traceCommand(request: TraceRequest): TracerCommand;
  /** Derive a form from a signature the source declared, with no parsing at all.
   *  Preferred over `analyzeCommand` when a problem carries one: the source's
   *  own types are better evidence than the starter code they generated. */
  specFromSignature(signature: DeclaredSignature): InputSpec;
  /** Compose the call. Returns the source that goes in the setup slot. */
  composeSetup(entry: EntryPoint, draft: InputDraft): string;
};

const REGISTRY = new Map<Language, VisualizerLanguage>();

export function registerLanguage(language: VisualizerLanguage): void {
  REGISTRY.set(language.id, language);
}

export function visualizerLanguage(id: Language): VisualizerLanguage | undefined {
  return REGISTRY.get(id);
}

/** Every language the visualiser can actually run, for the picker. One today;
 *  the picker is written against the list rather than against Python so that
 *  stays true without a UI change. */
export function visualizerLanguages(): VisualizerLanguage[] {
  return [...REGISTRY.values()];
}

export function supportsVisualizing(id: Language): boolean {
  return REGISTRY.has(id);
}
