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
    const service = new UpdateService(new MemorySettings() as never, window, async () => undefined, engine as unknown as Updater, "0.3.0", true);
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
    const service = new UpdateService(settings as never, window, prepare, engine as unknown as Updater, "0.3.0", true);
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
    const oldVersion = new UpdateService(settings as never, window, async () => undefined, new FakeUpdater() as unknown as Updater, "0.3.0", false);
    const installedVersion = new UpdateService(settings as never, window, async () => undefined, new FakeUpdater() as unknown as Updater, "0.4.0", false);
    expect(oldVersion.snapshot().changelog).toBeNull();
    expect(installedVersion.snapshot().changelog).toEqual({ version: "0.4.0", notes: "A sharper Spar." });
  });
});
