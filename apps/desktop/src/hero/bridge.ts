import type { SessionDetail } from "@spar/domain";
import type { AgentStreamEvent, BootstrapData, ProviderInventory, SparApi, SubmissionResult } from "../shared/api";
import type { Clock } from "./clock";

type State = { bootstrap: BootstrapData; detail: SessionDetail };
type Chunk = { at: number; stream: "stdout" | "stderr" | "exit"; data: string; exitCode?: number };

export type Recording = {
  source: { session: string; turn: string; recordedAt: string };
  clock: { open: number; beats: Record<string, number>; agent: { start: number; end: number } };
  learner: { path: string; code: string; message: string };
  files: { before: Record<string, string>; after: Record<string, string> };
  run: { chunks: Chunk[]; exitCode: number };
  submission: SubmissionResult;
  states: Record<"opening" | "afterRun" | "afterSubmit" | "afterSend" | "final", State>;
  stream: Array<{ at: number; event: AgentStreamEvent }>;
};

/** The recording stores each state after the first as what changed since the
 *  one before it (see `deltas` in record.ts). */
export function expandStates(recording: Recording): Recording {
  let previous: State | null = null;
  const states = {} as Recording["states"];
  for (const [name, stored] of Object.entries(recording.states) as Array<[keyof Recording["states"], State]>) {
    const state: State = previous ? { bootstrap: { ...previous.bootstrap, ...stored.bootstrap }, detail: { ...previous.detail, ...stored.detail } } : stored;
    states[name] = state;
    previous = state;
  }
  return { ...recording, states };
}

/** What the composer's model pill reads. The film's turn ran on this model. */
const PROVIDERS: ProviderInventory = {
  providers: [{
    id: "openai-codex",
    name: "ChatGPT",
    description: "",
    kind: "subscription",
    state: "connected",
    selectedModel: "gpt-6-luna",
    baseUrl: "",
    models: [{ id: "gpt-6-luna", name: "GPT-6 Luna", reasoning: true }],
  }],
  ready: true,
  defaultModel: { provider: "openai-codex", model: "gpt-6-luna", reasoningEffort: "medium", fastMode: false },
};

/**
 * `window.spar`, answered from the recording.
 *
 * The renderer is not told it is in a film. It calls the bridge exactly as it
 * does in the app, and each call is answered with what the main process said at
 * that point in the session: `openSession` returns whichever snapshot the story
 * has reached, `run` streams the runner's recorded chunks, `sendAgentMessage`
 * starts the recorded turn. Anything the film never exercises resolves to
 * nothing, so a component that asks for its own data draws its empty state
 * rather than throwing.
 */
export function createBridge(recording: Recording, clock: Clock) {
  let state: State = recording.states.opening;
  let files = { ...recording.files.before };
  const agentListeners = new Set<(event: AgentStreamEvent) => void>();
  const runnerListeners = new Set<(event: { id: string; stream: string; data: string; exitCode?: number }) => void>();
  let cancelled = false;
  /** How far behind its recorded beat the turn started. */
  let shift = 0;

  /* Recorded moments are virtual epochs; waiting on the clock rather than on a
     timer is what keeps the stream in step when the film speeds up. */
  const at = async (epoch: number) => {
    await clock.until(epoch);
    if (cancelled) throw new Error("cancelled");
  };

  const known: Partial<SparApi> = {
    bootstrap: async () => state.bootstrap,
    openSession: async () => state.detail,
    readWorkspaceFile: async ({ path }) => files[path] ?? "",
    writeWorkspaceFile: async ({ path, content }) => { files[path] = content; },
    saveWorkspaceState: async () => undefined,
    appendAttemptEvent: async () => undefined as never,
    attemptComplexityStatus: async () => null,
    listChallengePreviews: async () => [],
    listProviders: async () => PROVIDERS,
    providerUsage: async () => ({ windows: [{ kind: "five-hour", usedPercent: 12, resetsAt: null }, { kind: "weekly", usedPercent: 31, resetsAt: null }], capturedAt: clock.now() }),
    onAgentEvent: (listener) => { agentListeners.add(listener); return () => agentListeners.delete(listener); },
    onRunnerEvent: (listener) => { runnerListeners.add(listener as never); return () => runnerListeners.delete(listener as never); },

    run: async () => {
      const id = "hero-visible-run";
      const started = clock.now();
      const settles = Math.max(recording.clock.beats.runSettles!, started + 900);
      void (async () => {
        /* The workspace learns the run's id from this call's return; a chunk
           sent before then is not heard as its own. */
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (const chunk of recording.run.chunks) {
          /* The real run took a few dozen milliseconds. It is drawn over the
             recorded beat instead, so the panel is seen to be running — and never
             less than a beat, when the learner typed slower than they did. */
          await at(chunk.stream === "exit" ? settles : started + chunk.at);
          if (chunk.stream === "exit") state = recording.states.afterRun;
          for (const listener of runnerListeners) listener({ id, stream: chunk.stream, data: chunk.data, ...(chunk.exitCode !== undefined ? { exitCode: chunk.exitCode } : {}) });
        }
      })().catch(() => undefined);
      return { id };
    },

    submitAttempt: async () => {
      await at(Math.max(recording.clock.beats.submitSettles!, clock.now() + 1_600));
      state = recording.states.afterSubmit;
      return recording.submission;
    },

    sendAgentMessage: async () => {
      state = recording.states.afterSend;
      /* The turn starts when the message goes, however long the typing took. */
      shift = Math.max(0, clock.now() - recording.clock.beats.send!);
      void (async () => {
        for (const { at: epoch, event } of recording.stream) {
          await at(epoch + shift);
          /* The turn's end is when the main process has written the reply and
             the new challenge, so the snapshot moves before `done` is heard. */
          if (event.type === "done") {
            state = recording.states.final;
            files = { ...recording.files.after };
          }
          for (const listener of agentListeners) listener(event);
        }
      })().catch(() => undefined);
      return { runId: "hero-run" } as never;
    },
  };

  const api = new Proxy(known as SparApi, {
    get(target, property: string) {
      if (property in target) return target[property as keyof SparApi];
      if (property === "then") return undefined;
      /* Subscriptions return their unsubscribe; everything else is a call that
         the film has no answer for. */
      if (/^on[A-Z]/.test(property)) return () => () => undefined;
      return async () => null;
    },
  });

  return {
    api,
    /** Where the recorded turn landed on the film's clock, relative to its beat. */
    shift: () => shift,
    reset() {
      shift = 0;
      cancelled = true;
      state = recording.states.opening;
      files = { ...recording.files.before };
      agentListeners.clear();
      runnerListeners.clear();
      cancelled = false;
    },
  };
}
