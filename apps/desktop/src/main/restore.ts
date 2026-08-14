import type { AuthService } from "./auth.js";
import type { LocalStore, RestoredAccount, RestoredSession } from "./store.js";
import type { WorkspaceService } from "./workspaces.js";

/** Where a restore has got to, as the window needs to say it.
 *
 *  `failed` is load-bearing and not merely informational: a device that is signed
 *  in, holds no profile, and could not reach the server does not know whether
 *  this account has been onboarded. Showing intake there would ask an onboarded
 *  learner the same seven questions and then overwrite their real profile on the
 *  next flush, so the window shows a retry instead. */
export type RestoreState = "idle" | "pending" | "done" | "failed";

/** How many sessions are asked for at once. Matches `RESTORE_BATCH` in the API,
 *  which refuses more. */
const BATCH = 10;

/** Pulls the account back down from the cloud.
 *
 *  Sync was push-only before this: the outbox drained upward every five seconds
 *  and nothing ever came back, so signing in on a second machine — or on the same
 *  machine after a sign-out, which wipes the device by design — presented an
 *  account with no history and no profile, and the profile's absence is what sent
 *  an already-onboarded learner back through intake.
 *
 *  Every write it makes is idempotent, so an interrupted restore is resumed by
 *  running it again rather than repaired.
 */
export class RestoreService {
  private state: RestoreState = "idle";
  private inFlight: Promise<RestoreState> | null = null;

  constructor(
    private readonly store: LocalStore,
    private readonly workspaces: WorkspaceService,
    private readonly auth: AuthService,
    private readonly origin: string,
    private readonly onState: (state: RestoreState) => void,
  ) {}

  current() { return this.state; }

  /** Restore, or join the restore already running. Never throws: the outcome is
   *  the returned state, because every caller's next move is to show a screen
   *  rather than to handle an exception. */
  run(): Promise<RestoreState> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.execute().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async execute(): Promise<RestoreState> {
    const token = await this.auth.accessToken();
    if (!token) return this.settle("idle");
    this.settle("pending");
    try {
      const manifest = await this.get<RestoredAccount & { sessions: Array<{ id: string; updatedAt: string }>; learningState?: unknown }>("/v1/restore/manifest", token);
      this.store.restoreAccount({ profile: manifest.profile, concepts: manifest.concepts ?? [], abilities: manifest.abilities ?? [] });
      /* Newest first, and sessions this device already holds at or beyond the
         cloud's version are never fetched. The common case — a reinstall while
         the account has months of history — then costs one manifest and the
         batches that are actually missing. */
      const wanted = (manifest.sessions ?? []).filter((session) => !this.store.sessionIsCurrent(session.id, session.updatedAt)).map((session) => session.id);
      for (let index = 0; index < wanted.length; index += BATCH) {
        const batch = wanted.slice(index, index + BATCH);
        const { sessions } = await this.get<{ sessions: RestoredSession[] }>(`/v1/restore/sessions?ids=${batch.join(",")}`, token);
        this.store.restoreSessions(sessions);
        /* Files after the rows, and per batch rather than at the end: a restore
           interrupted here leaves whole sessions usable instead of a database
           full of sessions whose editors are empty. */
        for (const bundle of sessions) await this.writeWorkspace(bundle);
      }
      /* The learner model points at restored sessions, attempts and events, so
         it is deliberately applied last. The store also refuses this cloud
         snapshot when local adaptive state is waiting to sync. */
      this.store.restoreLearningState(manifest.learningState);
      return this.settle("done");
    } catch {
      return this.settle("failed");
    }
  }

  /** The session's files, from the checkpoint that carried them.
   *
   *  `replaceAll` rather than `writeAll`: the checkpoint is the whole of the live
   *  workspace, so a file the learner deleted before the checkpoint was taken must
   *  not survive here. It preserves the `.spar` sandbox directory, which is this
   *  device's own scratch space and none of the cloud's business. */
  private async writeWorkspace(bundle: RestoredSession) {
    const checkpoint = bundle.checkpoint as { workspaceFiles?: Array<{ path: string; content?: string; dirtyContent?: string }> } | null;
    const files = checkpoint?.workspaceFiles ?? [];
    const restorable = files.flatMap((file) => {
      /* An unsaved buffer is the newer truth about what the learner was looking
         at, so it wins over the saved copy — which is exactly the state they left
         the editor in. A file with neither was omitted for size upstream and is
         skipped rather than written empty. */
      const content = file.dirtyContent ?? file.content;
      return content === undefined ? [] : [[file.path, content] as const];
    });
    if (!restorable.length) return;
    await this.workspaces.replaceAll(bundle.session.id, Object.fromEntries(restorable)).catch(() => undefined);
  }

  private async get<T>(path: string, token: string): Promise<T> {
    const response = await fetch(`${this.origin}${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Restore failed (${response.status})`);
    return await response.json() as T;
  }

  private settle(state: RestoreState) {
    this.state = state;
    this.onState(state);
    return state;
  }
}
