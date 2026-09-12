import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Language } from "@spar/domain";
import {
  coerceValue,
  dialect,
  draftFromExample,
  emptyDraft,
  findEntryPoint,
  EMPTY_SPEC,
  type EntryPoint,
  type InputDraft,
  type InputSpec,
  type InputValue,
  type Trace,
} from "@spar/visualizer";
import type { SparApi, VisualizerProblem } from "../../shared/api";

/**
 * The visualiser's state, in one place.
 *
 * Four things move and they move in a fixed order: the code changes, which
 * invalidates the input form; the form is regenerated and the draft refitted
 * onto it; the draft composes a setup; the setup and the code produce a trace.
 * Spreading that across components is what makes a debugger UI rot — a stale
 * form outliving the code it describes, a trace outliving both — so the whole
 * chain lives here and the components render what it says.
 *
 * The rule the rest of it hangs off: **a trace is never silently stale**. Edit
 * the code and the existing trace stays on screen, because throwing away the
 * picture someone is looking at is hostile, but `stale` goes true and every
 * control that would imply the picture is current says otherwise. The one thing
 * this must never do is let a learner read a canvas that does not match the
 * file next to it.
 */

/** How long to wait after a keystroke before re-deriving the form. Long enough
 *  not to spawn an interpreter mid-word, short enough that the form is ready by
 *  the time someone's hand reaches the mouse. */
const ANALYZE_DEBOUNCE_MS = 500;

export type VisualizerStatus = "idle" | "analyzing" | "tracing";

export type VisualizerState = {
  language: Language;
  code: string;
  setCode(code: string): void;

  /** What the code offers as an entry point, and how sure we are. */
  spec: InputSpec;
  entry: EntryPoint | null;
  selectEntry(id: string): void;

  draft: InputDraft;
  setValue(name: string, value: InputValue): void;
  setMode(mode: "form" | "raw"): void;
  setRawSource(source: string): void;
  /** Replace a parameter's control when the guess was wrong. */
  retypeParam(name: string, field: EntryPoint["params"][number]): void;
  /** The Python the form composes, shown above the run button. */
  composed: string;

  /** The problem the inputs were inherited from, when there is one. */
  problem: VisualizerProblem | null;
  loadProblem(source: "leetcode" | "codeforces", slug: string): Promise<void>;
  clearProblem(): void;
  /** Fill the form from one of the problem's worked examples. */
  useExample(index: number): void;

  trace: Trace | null;
  /** True when the code or the inputs have changed since the trace was taken. */
  stale: boolean;
  status: VisualizerStatus;
  error: string | null;
  dismissError(): void;
  run(): Promise<void>;

  index: number;
  setIndex(index: number): void;
  step(delta: number): void;
  playing: boolean;
  setPlaying(playing: boolean): void;
  speed: number;
  setSpeed(speed: number): void;
};

export function useVisualizer(api: SparApi | undefined, language: Language): VisualizerState {
  const spoken = dialect(language);
  const [code, setCodeState] = useState(() => spoken?.starter ?? "");
  const [spec, setSpec] = useState<InputSpec>(EMPTY_SPEC);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [draft, setDraft] = useState<InputDraft>({ entryPointId: "", values: {}, mode: "form", source: "" });
  const [problem, setProblem] = useState<VisualizerProblem | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState<VisualizerStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [index, setIndexState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  /* Analysis is the one thing here that races. Every keystroke can start one and
     they can come back out of order, so each is stamped and a late arrival is
     dropped — the alternative is a form that flickers back to a shape the code
     had two seconds ago. */
  const generation = useRef(0);

  /* A problem opened is a problem someone wants to watch run, and its first
     worked example is the input they would have typed. It cannot be applied at
     the moment the problem loads, because the form it fills does not exist
     until the analysis comes back and names the parameters — so the intent is
     parked here and spent by the effect below on the first entry point that
     can hold it. Parked rather than repeated: reshaping the form later must not
     silently overwrite what the learner has since typed. */
  const pendingExample = useRef<number | null>(null);

  const entry = useMemo(() => findEntryPoint(spec, entryId), [spec, entryId]);

  /**
   * Re-derive the form from whatever the code says now.
   *
   * The draft survives it. Someone who has filled in a 20-element array and then
   * fixed a typo three lines away should not lose the array — so values are
   * refitted onto the new shape by name, and only what genuinely no longer fits
   * is dropped. That refit is `coerceValue`'s whole reason for existing.
   */
  const analyze = useCallback(async (source: string, forProblem: VisualizerProblem | null) => {
    if (!api) return;
    const ticket = (generation.current += 1);
    setStatus((current) => (current === "tracing" ? current : "analyzing"));
    try {
      const next = await api.analyzeForVisualizer({ language, code: source, signature: forProblem?.signature ?? null });
      if (ticket !== generation.current) return;
      setSpec(next);
      setEntryId((current) => (next.entryPoints.some((item) => item.id === current) ? current : next.preferred));
    } catch (cause) {
      if (ticket !== generation.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (ticket === generation.current) setStatus((current) => (current === "analyzing" ? "idle" : current));
    }
  }, [api, language]);

  useEffect(() => {
    const timer = setTimeout(() => void analyze(code, problem), ANALYZE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [analyze, code, problem]);

  /* Keep the draft pointed at the selected entry point and shaped like it.
     Refitting rather than resetting is what lets someone switch to a helper,
     look at it, and switch back without retyping their input. */
  useEffect(() => {
    if (!entry) return;
    setDraft((current) => {
      if (current.entryPointId === entry.id && entry.params.every((param) => param.name in current.values)) {
        return current;
      }
      const fresh = emptyDraft(entry);
      return {
        ...fresh,
        mode: current.mode,
        source: current.source,
        values: Object.fromEntries(entry.params.map((param) => [param.name, coerceValue(param, current.values[param.name])])),
      };
    });
  }, [entry]);

  useEffect(() => {
    const index = pendingExample.current;
    if (index === null || !entry || entry.unsupported) return;
    const example = problem?.examples[index];
    if (!example) return;
    pendingExample.current = null;
    setDraft((current) => ({ ...draftFromExample(entry, example.input), mode: current.mode, source: current.source }));
  }, [entry, problem]);

  const composed = useMemo(() => (entry && spoken ? spoken.composeSetup(entry, draft) : draft.source), [entry, draft, spoken]);

  const setCode = useCallback((next: string) => {
    setCodeState(next);
    setStale(true);
    setPlaying(false);
  }, []);

  const setValue = useCallback((name: string, value: InputValue) => {
    // Typing is the same cancellation as picking an example explicitly.
    pendingExample.current = null;
    setDraft((current) => ({ ...current, values: { ...current.values, [name]: value } }));
    setStale(true);
    setPlaying(false);
  }, []);

  const retypeParam = useCallback((name: string, field: EntryPoint["params"][number]) => {
    // The override lives on the spec rather than on the draft, because it is a
    // statement about the code's shape and it should survive the next analysis
    // of an unchanged signature. The value is refitted onto the new control.
    setSpec((current) => ({
      ...current,
      entryPoints: current.entryPoints.map((item) =>
        item.id !== (entry?.id ?? "") ? item : { ...item, params: item.params.map((param) => (param.name === name ? field : param)) },
      ),
    }));
    setDraft((current) => ({ ...current, values: { ...current.values, [name]: coerceValue(field, current.values[name]) } }));
    setStale(true);
  }, [entry?.id]);

  const useExample = useCallback((exampleIndex: number) => {
    // An explicit choice cancels the one that was going to be made for them.
    pendingExample.current = null;
    const example = problem?.examples[exampleIndex];
    if (!example || !entry) return;
    setDraft((current) => ({ ...draftFromExample(entry, example.input), mode: current.mode, source: current.source }));
    setStale(true);
    setPlaying(false);
  }, [entry, problem]);

  /**
   * Open a source problem in the visualiser.
   *
   * The editor is seeded with the source's own starter code, which is the one
   * moment it is safe to overwrite what is in there: the learner just asked for
   * a different problem. Everything after that is theirs.
   */
  const loadProblem = useCallback(async (source: "leetcode" | "codeforces", slug: string) => {
    if (!api) return;
    setStatus("analyzing");
    setError(null);
    try {
      const next = await api.visualizerProblem({ source, slug });
      if (!next) {
        setError("That problem could not be opened. It may need a connected account.");
        return;
      }
      setProblem(next);
      pendingExample.current = next.examples.length ? 0 : null;
      setTrace(null);
      setIndexState(0);
      setPlaying(false);
      setStale(true);
      if (next.starter.trim()) setCodeState(next.starter);
      await analyze(next.starter.trim() ? next.starter : code, next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStatus((current) => (current === "tracing" ? current : "idle"));
    }
  }, [analyze, api, code]);

  const clearProblem = useCallback(() => {
    setProblem(null);
    void analyze(code, null);
  }, [analyze, code]);

  const run = useCallback(async () => {
    if (!api) return;
    setStatus("tracing");
    setError(null);
    setPlaying(false);
    try {
      const next = await api.visualize({ language, code, setup: composed });
      setTrace(next);
      setIndexState(0);
      setStale(false);
      // A program that threw still produced a trace, and the frames leading up
      // to the throw are the most useful thing on the screen. The exception is
      // reported by the verdict banner beside the canvas, not as a failed run.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStatus("idle");
    }
  }, [api, code, composed, language]);

  const count = trace?.frames.length ?? 0;

  const setIndex = useCallback((next: number) => {
    setIndexState(Math.max(0, Math.min(next, Math.max(0, count - 1))));
  }, [count]);

  const step = useCallback((delta: number) => {
    setPlaying(false);
    setIndexState((current) => Math.max(0, Math.min(current + delta, Math.max(0, count - 1))));
  }, [count]);

  /* Playback stops at the end rather than looping. A loop would be prettier and
     would make it impossible to tell "the algorithm finished" from "the
     animation is going round again", which is the only thing the last frame is
     there to say. */
  useEffect(() => {
    if (!playing || count === 0) return;
    const timer = setInterval(() => {
      setIndexState((current) => {
        if (current >= count - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 900 / speed);
    return () => clearInterval(timer);
  }, [playing, speed, count]);

  return {
    language, code, setCode,
    spec, entry, selectEntry: setEntryId,
    draft,
    setValue,
    setMode: (mode) => { setDraft((current) => ({ ...current, mode })); setStale(true); },
    setRawSource: (source) => { setDraft((current) => ({ ...current, source })); setStale(true); },
    retypeParam,
    composed,
    problem, loadProblem, clearProblem, useExample,
    trace, stale, status, error, dismissError: () => setError(null), run,
    index, setIndex, step, playing, setPlaying, speed, setSpeed,
  };
}
