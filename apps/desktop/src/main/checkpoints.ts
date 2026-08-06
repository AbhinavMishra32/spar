import { createHash, randomUUID } from "node:crypto";
import { CHECKPOINT_FILE_LIMIT, CHECKPOINT_TOTAL_LIMIT, trainingTargetSchema, type SessionCheckpoint } from "@spar/domain";
import { normalizeTarget, type LocalStore } from "./store.js";
import type { WorkspaceService } from "./workspaces.js";

/** What only the window knows about a session. Everything else in a checkpoint
 *  is read from the store or from disk, so this is the whole of what the renderer
 *  has to send — and it is sent on change rather than on save, because the
 *  window is not the thing that decides when a checkpoint is worth writing. */
export type WorkspaceUiState = {
  openFiles: string[];
  activeFile: string | null;
  layout: SessionCheckpoint["layout"];
  visibleTestRunIds: string[];
  terminalRecipe: string[];
};

const DEFAULT_UI: WorkspaceUiState = {
  openFiles: [],
  activeFile: null,
  layout: { sidebarWidth: 240, editorRatio: 0.6, bottomPanelHeight: 220, agentPanelOpen: true },
  visibleTestRunIds: [],
  terminalRecipe: [],
};

/** How long after the last change a checkpoint is written. Long enough that a
 *  burst of keystrokes and a test run collapse into one row; short enough that
 *  killing the app loses seconds of work rather than a session's worth. */
const DEBOUNCE_MS = 3_000;

/** Writes the checkpoints that make a session resumable somewhere else.
 *
 *  This is new behaviour, not a refactor: `checkpoint:save` was wired through to
 *  the store from the beginning and nothing ever called it, so `checkpoints` was
 *  empty on every install and the cloud's copy was empty with it. A session could
 *  be pushed and pulled and still reopen as a blank editor.
 *
 *  Composition lives in the main process because that is the side that can read
 *  the workspace off disk and the store in the same breath. The window
 *  contributes what only it knows — which files are open, how the panes are
 *  sized — and does not decide when to persist.
 */
export class CheckpointService {
  private readonly ui = new Map<string, WorkspaceUiState>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Sessions whose write is mid-flight, so a change arriving during one
   *  schedules the next rather than interleaving with it. */
  private readonly writing = new Set<string>();

  constructor(private readonly store: LocalStore, private readonly workspaces: WorkspaceService) {}

  /** The window's own state for a session, held until the next write folds it in. */
  remember(sessionId: string, state: WorkspaceUiState) {
    this.ui.set(sessionId, state);
    this.schedule(sessionId);
  }

  /** Something changed that a checkpoint should capture — a file written, a run
   *  finished, an agent turn settled. */
  note(sessionId: string) {
    this.schedule(sessionId);
  }

  /** Write every session with work pending, now. Called on quit, where there is
   *  no next tick to wait for. */
  async flushAll() {
    const pending = [...this.timers.keys()];
    for (const sessionId of pending) await this.writeNow(sessionId).catch(() => undefined);
  }

  /** Checkpoint one session immediately, cancelling any pending debounce for it.
   *  The debounce is a batching convenience, not a rule, so quitting and anything
   *  else that cannot wait three seconds goes through here. */
  async writeNow(sessionId: string) {
    const timer = this.timers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.timers.delete(sessionId);
    await this.write(sessionId);
  }

  /** Stop watching a session that has gone. */
  forget(sessionId: string) {
    const timer = this.timers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.timers.delete(sessionId);
    this.ui.delete(sessionId);
  }

  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private schedule(sessionId: string) {
    const existing = this.timers.get(sessionId);
    if (existing) clearTimeout(existing);
    this.timers.set(sessionId, setTimeout(() => {
      this.timers.delete(sessionId);
      void this.write(sessionId).catch(() => undefined);
    }, DEBOUNCE_MS));
  }

  /** One checkpoint for one session. Failures are swallowed by the callers above:
   *  a checkpoint is a convenience for later, and refusing to run tests because
   *  the last snapshot could not be taken would be the wrong trade. */
  private async write(sessionId: string) {
    if (this.writing.has(sessionId)) {
      /* Re-armed rather than dropped: whatever prompted this has not been
         captured by the write already in flight. */
      this.schedule(sessionId);
      return;
    }
    this.writing.add(sessionId);
    try {
      const detail = this.store.readSession(sessionId);
      if (!detail) return void this.forget(sessionId);
      const ui = this.ui.get(sessionId) ?? DEFAULT_UI;
      const { files, omitted } = await this.readWorkspace(sessionId);
      const previous = this.store.latestCheckpoint(sessionId);
      /* Parsed rather than cast: the row is assembled from a database that has
         outlived several shapes of this app, and a target that no longer fits is
         better recorded as absent than as a checkpoint that will not validate on
         the way to the server. */
      const target = trainingTargetSchema.safeParse(((row) => (row ? normalizeTarget(row) : null))(this.store.latestTarget(sessionId)));
      const checkpoint: SessionCheckpoint = {
        id: randomUUID(),
        sessionId,
        attemptId: detail.question?.attemptId ?? null,
        version: (previous?.version ?? 0) + 1,
        savedAt: new Date().toISOString(),
        eventSequence: detail.question?.latestEventSequence ?? 0,
        /* Always null: the files are in this payload. The column stays for the
           day a workspace outgrows a jsonb row and goes to object storage. */
        workspaceSnapshotId: null,
        workspaceFiles: files,
        omittedFiles: omitted,
        openFiles: ui.openFiles,
        activeFile: ui.activeFile,
        layout: ui.layout,
        terminalRecipe: ui.terminalRecipe,
        visibleTestRunIds: ui.visibleTestRunIds,
        objective: detail.summary.objective,
        trainingTarget: target.success ? target.data : null,
        agent: {
          lastDecision: previous?.agent.lastDecision ?? null,
          pendingLearnerQuestion: detail.pendingLearnerQuestion,
          relevantAbilityIds: previous?.agent.relevantAbilityIds ?? [],
          /* How much of the thread the agent has already been shown. The
             transcript is the cursor's units, so its length is the cursor. */
          messageCursor: detail.messages.length,
          traceId: previous?.agent.traceId ?? null,
          nextAllowedActions: previous?.agent.nextAllowedActions ?? [],
        },
      };
      this.store.saveCheckpoint(checkpoint);
    } finally {
      this.writing.delete(sessionId);
    }
  }

  /** The session's live files, with their contents, under the size the schema
   *  documents. A file over the per-file limit is named in `omittedFiles` rather
   *  than truncated — half a source file restored silently is worse than a gap
   *  the app can report. */
  private async readWorkspace(sessionId: string) {
    const files: SessionCheckpoint["workspaceFiles"] = [];
    const omitted: string[] = [];
    let total = 0;
    for (const path of (await this.workspaces.list(sessionId).catch(() => [])).sort()) {
      const content = await this.workspaces.read(sessionId, path).catch(() => null);
      if (content === null) continue;
      const bytes = Buffer.byteLength(content, "utf8");
      const contentHash = createHash("sha256").update(content).digest("hex");
      if (bytes > CHECKPOINT_FILE_LIMIT || total + bytes > CHECKPOINT_TOTAL_LIMIT) {
        /* Still named, and still hashed. A restore that knows the path and the
           hash can say what is missing and could one day fetch it. */
        files.push({ path, contentHash });
        omitted.push(path);
        continue;
      }
      total += bytes;
      files.push({ path, contentHash, content });
    }
    return { files, omitted };
  }
}
