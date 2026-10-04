import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { UpdateService, updateInternals, type Updater } from "./updates.js";

class MemorySettings {
  private values = new Map<string, string>();
  getSetting(key: string, fallback: string) { return this.values.get(key) ?? fallback; }
  setSetting(key: string, value: string) { this.values.set(key, value); }
}

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  autoRunAppAfterInstall = false;
  allowPrerelease = true;
  fullChangelog = true;
  disableWebInstaller = false;
  isUpdaterActive = () => true;
  checkForUpdates = vi.fn(async () => null);
  downloadUpdate = vi.fn(async () => ["/tmp/Spar.zip"]);
  quitAndInstall = vi.fn();
}

const window = () => null;

describe("UpdateService", () => {
  it("normalizes one release note and a full changelog", () => {
    expect(updateInternals.notesFrom({ releaseNotes: "  Faster starts.  " })).toBe("Faster starts.");
    expect(updateInternals.notesFrom({ releaseNotes: [{ version: "0.5.0", note: "New shell" }, { version: "0.4.0", note: "Fixes" }] })).toBe("## 0.5.0\n\nNew shell\n\n## 0.4.0\n\nFixes");
  });

  it("checks automatically but waits for consent before downloading", async () => {
    const engine = new FakeUpdater();
    const service = new UpdateService(new MemorySettings() as never, window, async () => undefined, engine as unknown as Updater, "0.3.0", true, null);
    service.start();
    await vi.waitFor(() => expect(engine.checkForUpdates).toHaveBeenCalledOnce());
    engine.emit("update-available", { version: "0.4.0", releaseNotes: "A sharper Spar.", files: [] });
    expect(service.snapshot()).toMatchObject({ status: "available", version: "0.4.0", notes: "A sharper Spar." });
    expect(engine.downloadUpdate).not.toHaveBeenCalled();
    await service.download();
    expect(engine.downloadUpdate).toHaveBeenCalledOnce();
    service.stop();
  });

  it("persists release notes, saves work, then installs and relaunches", async () => {
    const engine = new FakeUpdater();
    const settings = new MemorySettings();
    const prepare = vi.fn(async () => undefined);
    const service = new UpdateService(settings as never, window, prepare, engine as unknown as Updater, "0.3.0", true, null);
    service.start();
    engine.emit("update-available", { version: "0.4.0", releaseNotes: "A sharper Spar.", files: [] });
    engine.emit("update-downloaded", { version: "0.4.0", releaseNotes: "A sharper Spar.", files: [], downloadedFile: "/tmp/Spar.zip" });
    await vi.waitFor(() => expect(engine.quitAndInstall).toHaveBeenCalledWith(false, true));
    expect(prepare).toHaveBeenCalledOnce();
    expect(settings.getSetting("update.pending-changelog", "")).toContain("A sharper Spar.");
    service.stop();
  });

  it("shows a changelog only when the installed version actually launches", () => {
    const settings = new MemorySettings();
    settings.setSetting("update.pending-changelog", JSON.stringify({ version: "0.4.0", notes: "A sharper Spar." }));
    const oldVersion = new UpdateService(settings as never, window, async () => undefined, new FakeUpdater() as unknown as Updater, "0.3.0", false, null);
    const installedVersion = new UpdateService(settings as never, window, async () => undefined, new FakeUpdater() as unknown as Updater, "0.4.0", false, null);
    expect(oldVersion.snapshot().changelog).toBeNull();
    expect(installedVersion.snapshot().changelog).toEqual({ version: "0.4.0", notes: "A sharper Spar." });
  });

  it("installs through the platform's own installer instead of electron-updater when it has one", async () => {
    const engine = new FakeUpdater();
    const settings = new MemorySettings();
    const self = {
      download: vi.fn(async (_info: unknown, progress: (value: { percent: number; transferred: number; total: number | null; bytesPerSecond: number }) => void) => { progress({ percent: 50, transferred: 5, total: 10, bytesPerSecond: 1 }); }),
      install: vi.fn(async () => undefined),
      takeResult: vi.fn(async () => null),
    };
    const service = new UpdateService(settings as never, window, async () => undefined, engine as unknown as Updater, "0.3.0", true, self);
    service.start();
    engine.emit("update-available", { version: "0.4.0", releaseNotes: "A sharper Spar.", files: [] });
    await service.download();
    expect(engine.downloadUpdate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(self.install).toHaveBeenCalledOnce());
    expect(engine.quitAndInstall).not.toHaveBeenCalled();
    expect(settings.getSetting("update.pending-changelog", "")).toContain("A sharper Spar.");
    service.stop();
  });

  it("says so when the last self-install put the old version back", async () => {
    const self = { download: vi.fn(), install: vi.fn(), takeResult: vi.fn(async () => ({ ok: false, version: "0.4.0", reason: "The new version could not be moved into place." })) };
    const service = new UpdateService(new MemorySettings() as never, window, async () => undefined, new FakeUpdater() as unknown as Updater, "0.3.0", true, self as never);
    service.start();
    await vi.waitFor(() => expect(service.snapshot().message).toContain("couldn’t install 0.4.0"));
    service.stop();
  });

  it("keeps a failed self-download retryable", async () => {
    const engine = new FakeUpdater();
    const self = { download: vi.fn(async () => { throw new Error("The downloaded update did not match its published checksum, so it was not installed."); }), install: vi.fn(), takeResult: vi.fn(async () => null) };
    const service = new UpdateService(new MemorySettings() as never, window, async () => undefined, engine as unknown as Updater, "0.3.0", true, self as never);
    service.start();
    engine.emit("update-available", { version: "0.4.0", releaseNotes: "", files: [] });
    await expect(service.download()).rejects.toThrow(/checksum/);
    expect(service.snapshot()).toMatchObject({ status: "error", message: expect.stringContaining("checksum") });
    expect(self.install).not.toHaveBeenCalled();
    service.stop();
  });
});
