import { app, ipcMain, type BrowserWindow } from "electron";
import updater from "electron-updater";
import type { AppUpdater, UpdateInfo } from "electron-updater";
import type { LocalStore } from "./store.js";
import { ipc, type UpdateState } from "../shared/api.js";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const PENDING_CHANGELOG = "update.pending-changelog";
const DISMISSED_CHANGELOG = "update.dismissed-changelog";
const MAX_NOTES_LENGTH = 100_000;

export type Updater = Pick<AppUpdater,
  | "autoDownload"
  | "autoInstallOnAppQuit"
  | "autoRunAppAfterInstall"
  | "allowPrerelease"
  | "fullChangelog"
  | "disableWebInstaller"
  | "isUpdaterActive"
  | "checkForUpdates"
  | "downloadUpdate"
  | "quitAndInstall"
  | "on"
>;

type PendingChangelog = { version: string; notes: string };

function notesFrom(info: Pick<UpdateInfo, "releaseNotes">): string | null {
  const notes = Array.isArray(info.releaseNotes)
    ? info.releaseNotes.map((item) => `## ${item.version}\n\n${item.note ?? ""}`.trim()).join("\n\n")
    : info.releaseNotes?.trim();
  return notes ? notes.slice(0, MAX_NOTES_LENGTH) : null;
}

function readPending(store: LocalStore, currentVersion: string): PendingChangelog | null {
  try {
    const pending = JSON.parse(store.getSetting(PENDING_CHANGELOG, "null")) as PendingChangelog | null;
    if (!pending || pending.version !== currentVersion || !pending.notes) return null;
    return store.getSetting(DISMISSED_CHANGELOG, "") === currentVersion ? null : pending;
  } catch {
    return null;
  }
}

/**
 * Owns the complete updater state machine. Electron's main process is the trust
 * boundary: it reads signed release metadata, verifies the downloaded artifact,
 * persists the changelog, flushes learner work, and starts the native installer.
 * The window only requests transitions and renders the resulting state.
 */
export class UpdateService {
  private state: UpdateState;
  private timer: NodeJS.Timeout | null = null;
  private checking: Promise<UpdateState> | null = null;
  private downloading: Promise<void> | null = null;
  private installing = false;
  private latestInfo: UpdateInfo | null = null;
  private supported = false;

  constructor(
    private readonly store: LocalStore,
    private readonly window: () => BrowserWindow | null,
    private readonly prepareToInstall: () => Promise<void>,
    private readonly engine: Updater = updater.autoUpdater,
    currentVersion = app.getVersion(),
    private readonly packaged = app.isPackaged,
  ) {
    this.state = {
      status: "idle",
      currentVersion,
      version: null,
      notes: null,
      percent: null,
      transferred: null,
      total: null,
      bytesPerSecond: null,
      message: null,
      checkedAt: null,
      changelog: readPending(store, currentVersion),
    };
  }

  installIpc() {
    ipcMain.handle(ipc.updateState, () => this.snapshot());
    ipcMain.handle(ipc.updateCheck, () => this.check(true));
    ipcMain.handle(ipc.updateDownload, () => this.download());
    ipcMain.handle(ipc.updateDismissChangelog, (_event, version: unknown) => this.dismissChangelog(version));
  }

  start() {
    this.engine.autoDownload = false;
    this.engine.autoInstallOnAppQuit = false;
    this.engine.autoRunAppAfterInstall = true;
    this.engine.allowPrerelease = false;
    this.engine.fullChangelog = false;
    // NSIS web installers cannot be Authenticode-verified by electron-updater.
    this.engine.disableWebInstaller = true;

    this.supported = this.packaged && this.engine.isUpdaterActive();
    if (!this.supported) {
      this.patch({
        status: "unsupported",
        message: this.packaged
          ? "Updates are unavailable for this installation. Download the latest installer from sparai.app."
          : "Update checks run in packaged releases.",
      });
      return;
    }

    this.engine.on("update-available", (info) => {
      this.latestInfo = info;
      this.patch({ status: "available", version: info.version, notes: notesFrom(info), message: null });
    });
    this.engine.on("update-not-available", () => {
      this.latestInfo = null;
      this.patch({ status: "current", version: null, notes: null, message: null, checkedAt: new Date().toISOString() });
    });
    this.engine.on("download-progress", (progress) => {
      this.patch({
        status: "downloading",
        percent: Math.max(0, Math.min(100, progress.percent)),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
        message: null,
      });
    });
    this.engine.on("update-downloaded", (info) => {
      const notes = notesFrom(info) ?? (this.latestInfo ? notesFrom(this.latestInfo) : null) ?? "This release includes improvements and fixes across Spar.";
      this.store.setSetting(PENDING_CHANGELOG, JSON.stringify({ version: info.version, notes } satisfies PendingChangelog));
      this.patch({ status: "installing", version: info.version, notes, percent: 100, message: null });
      void this.install();
    });
    this.engine.on("error", (error) => {
      console.error("Update failed:", error);
      this.patch({ status: "error", message: this.publicError(error), percent: null, transferred: null, total: null, bytesPerSecond: null });
    });

    // The first check waits for the window to finish loading, so no update event
    // can be emitted into a renderer that does not exist yet.
    const target = this.window();
    if (target?.webContents.isLoading()) target.webContents.once("did-finish-load", () => void this.check(false));
    else void this.check(false);
    this.timer = setInterval(() => void this.check(false), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  snapshot(): UpdateState {
    return structuredClone(this.state);
  }

  async check(manual: boolean): Promise<UpdateState> {
    if (!this.supported) return this.snapshot();
    if (this.downloading || this.installing || this.state.status === "available") return this.snapshot();
    if (this.checking) return this.checking;
    this.checking = (async () => {
      this.patch({ status: "checking", message: null });
      try {
        await this.engine.checkForUpdates();
      } catch (error) {
        // The updater also emits `error`; this fallback covers adapters and
        // failures that reject before an event listener is reached.
        this.patch({ status: "error", message: this.publicError(error) });
      } finally {
        this.checking = null;
      }
      return this.snapshot();
    })();
    if (!manual) void this.checking.catch(() => undefined);
    return this.checking;
  }

  async download(): Promise<void> {
    if (!this.supported) throw new Error("This installation cannot update itself.");
    if (this.state.status !== "available" || !this.latestInfo) throw new Error("No update is ready to download.");
    if (this.downloading) return this.downloading;
    this.patch({ status: "downloading", percent: 0, transferred: 0, total: null, bytesPerSecond: null, message: null });
    this.downloading = this.engine.downloadUpdate().then(() => undefined).finally(() => { this.downloading = null; });
    return this.downloading;
  }

  private async install() {
    if (this.installing) return;
    this.installing = true;
    try {
      await this.prepareToInstall();
      // `false` keeps the install UI visible where the platform has one;
      // `true` launches Spar again after the native installer succeeds.
      this.engine.quitAndInstall(false, true);
    } catch (error) {
      this.installing = false;
      this.patch({ status: "error", message: `The update is ready, but Spar could not save your work before restarting. ${this.publicError(error)}` });
    }
  }

  private dismissChangelog(version: unknown) {
    if (typeof version !== "string" || version !== this.state.currentVersion) throw new Error("Invalid changelog version.");
    this.store.setSetting(DISMISSED_CHANGELOG, version);
    this.patch({ changelog: null });
  }

  private publicError(error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/signature|signed/i.test(detail)) return "The update could not be verified as an authentic Spar release.";
    if (/net::|ENOTFOUND|ECONN|network|timed? ?out/i.test(detail)) return "Spar could not reach the update service. Check your connection and try again.";
    return detail || "Spar could not complete the update.";
  }

  private patch(next: Partial<UpdateState>) {
    this.state = { ...this.state, ...next };
    const target = this.window();
    if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) target.webContents.send("update:state", this.snapshot());
  }
}

export const updateInternals = { notesFrom };
