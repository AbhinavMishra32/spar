import { app, net } from "electron";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, chmod, constants, mkdtemp, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { UpdateInfo } from "electron-updater";

const run = promisify(execFile);

/** Where release assets live. The same feed electron-updater reads
 *  `latest-mac.yml` from, so the archive and its checksum come from one release. */
export const RELEASE_DOWNLOADS = "https://github.com/AbhinavMishra32/spar/releases/download";

/** How long the swap waits for Spar to finish quitting before giving up rather
 *  than replacing a bundle that is still running. */
const QUIT_WAIT_TENTHS = 600;

export type UpdateProgress = { percent: number; transferred: number; total: number | null; bytesPerSecond: number };

/** The result the install script leaves for the next launch to read. */
export type InstallResult = { ok: boolean; version: string; reason?: string };

/**
 * What the update service needs from a platform that installs its own updates.
 * Only macOS has one today; Windows and Linux stay on electron-updater.
 */
export interface SelfInstaller {
  download(info: UpdateInfo, onProgress: (progress: UpdateProgress) => void): Promise<void>;
  /** Hands the swap to a detached script and quits. Resolves once the quit has
   *  been requested; the script does the rest after Spar has exited. */
  install(): Promise<void>;
  /** What the last install left behind, read once at startup and then cleared. */
  takeResult(): Promise<InstallResult | null>;
}

/* ---- Pure parts, tested on their own ------------------------------------- */

type Archive = { url: string; sha512: string; size?: number | undefined };

/**
 * The zip built for this Mac. electron-builder names the Apple-silicon one
 * `…-arm64-mac.zip` and the Intel one `…-mac.zip`; an Intel build running under
 * Rosetta reports x64 and keeps getting the Intel build, which is what it is.
 */
export function pickMacArchive(info: Pick<UpdateInfo, "files">, arch: string): Archive | null {
  const zips = (info.files ?? []).filter((file) => file.url.endsWith(".zip") && file.sha512);
  const found = arch === "arm64"
    ? zips.find((file) => /-arm64-mac\.zip$/.test(file.url))
    : zips.find((file) => /-mac\.zip$/.test(file.url) && !/-arm64-/.test(file.url));
  return found ? { url: found.url, sha512: found.sha512, size: found.size } : null;
}

export function archiveUrl(version: string, file: string): string {
  if (/^https:\/\//.test(file)) return file;
  return `${RELEASE_DOWNLOADS}/v${version}/${encodeURIComponent(file)}`;
}

/**
 * The bundle Spar is running from, or why it cannot be replaced. An app opened
 * straight from the disk image, or run from the read-only copy macOS makes of
 * a quarantined app ("App Translocation"), has no home to install into.
 */
export function installedBundle(exe: string): { bundle: string } | { problem: string } {
  const bundle = path.resolve(exe, "..", "..", "..");
  if (!bundle.endsWith(".app")) return { problem: "Spar could not find its own app bundle to update." };
  if (bundle.includes("/AppTranslocation/") || bundle.startsWith("/Volumes/")) {
    return { problem: "Move Spar to your Applications folder and open it from there, then update again." };
  }
  return { bundle };
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

/**
 * The two scripts that do the swap once Spar has quit.
 *
 * `swap` moves the running bundle aside, moves the new one into its place, and
 * puts the old one back if that second move fails — so at every point there is
 * a working Spar at the original path. `launcher` waits for Spar to exit, runs
 * the swap (through the system's administrator prompt when the folder is not
 * writable by this user), records how it went, and opens Spar again: the new
 * version, or the old one if anything failed.
 */
export function installScripts(input: {
  pid: number;
  next: string;
  target: string;
  staging: string;
  resultFile: string;
  version: string;
  admin: boolean;
  swapFile: string;
  /** Overridden in tests, where there is no app to open. */
  open?: string;
}): { swap: string; launcher: string } {
  const backup = `${input.target}.spar-previous`;
  const swap = [
    "#!/bin/bash",
    `rm -rf ${shellQuote(backup)}`,
    `mv ${shellQuote(input.target)} ${shellQuote(backup)} || exit 1`,
    `if ! mv ${shellQuote(input.next)} ${shellQuote(input.target)}; then mv ${shellQuote(backup)} ${shellQuote(input.target)}; exit 1; fi`,
    `rm -rf ${shellQuote(backup)}`,
    `xattr -dr com.apple.quarantine ${shellQuote(input.target)} 2>/dev/null || true`,
    "exit 0",
    "",
  ].join("\n");
  const ok = JSON.stringify({ ok: true, version: input.version } satisfies InstallResult);
  const quitFailed = JSON.stringify({ ok: false, version: input.version, reason: "Spar did not finish quitting." } satisfies InstallResult);
  const swapFailed = JSON.stringify({ ok: false, version: input.version, reason: "The new version could not be moved into place." } satisfies InstallResult);
  const doSwap = input.admin
    ? `/usr/bin/osascript -e ${shellQuote(`do shell script "/bin/bash " & quoted form of ${appleScriptString(input.swapFile)} with administrator privileges`)}`
    : `/bin/bash ${shellQuote(input.swapFile)}`;
  const launcher = [
    "#!/bin/bash",
    `for _ in $(seq 1 ${QUIT_WAIT_TENTHS}); do kill -0 ${input.pid} 2>/dev/null || break; sleep 0.1; done`,
    `if kill -0 ${input.pid} 2>/dev/null; then printf '%s' ${shellQuote(quitFailed)} > ${shellQuote(input.resultFile)}; exit 1; fi`,
    `if ${doSwap}; then`,
    `  printf '%s' ${shellQuote(ok)} > ${shellQuote(input.resultFile)}`,
    "else",
    `  printf '%s' ${shellQuote(swapFailed)} > ${shellQuote(input.resultFile)}`,
    "fi",
    `${input.open ?? "/usr/bin/open"} ${shellQuote(input.target)}`,
    `rm -rf ${shellQuote(input.staging)}`,
    "",
  ].join("\n");
  return { swap, launcher };
}

/* ---- The installer ------------------------------------------------------- */

/**
 * Updates an unsigned Spar on macOS without Squirrel.Mac.
 *
 * Squirrel only accepts an update whose code signature satisfies the running
 * app's, which an app without a Developer ID certificate can never offer, so
 * every update of the open distribution failed with "could not be verified".
 * This does the job itself, with the check that matters for a build that is not
 * signed: the archive's SHA-512 has to match the one published beside it in the
 * release's `latest-mac.yml` — the same integrity check electron-updater uses
 * on Windows and Linux — and the bundle inside has to be Spar, at the version
 * that was offered.
 *
 * Downloading with Node rather than a browser is also what lets the new copy
 * open without Gatekeeper asking again: nothing marks it as quarantined.
 */
export class MacSelfUpdater implements SelfInstaller {
  private ready: { app: string; staging: string; version: string } | null = null;

  constructor(
    private readonly exe = app.getPath("exe"),
    private readonly temp = app.getPath("temp"),
    private readonly resultFile = path.join(app.getPath("userData"), "update-result.json"),
  ) {}

  async download(info: UpdateInfo, onProgress: (progress: UpdateProgress) => void): Promise<void> {
    const home = installedBundle(this.exe);
    if ("problem" in home) throw new Error(home.problem);
    const archive = pickMacArchive(info, process.arch);
    if (!archive) throw new Error(`This release has no download for ${process.arch === "arm64" ? "Apple silicon" : "Intel"} Macs.`);

    await this.discard();
    const staging = await mkdtemp(path.join(this.temp, "spar-update-"));
    try {
      const zip = path.join(staging, "Spar.zip");
      const digest = await this.fetchTo(archiveUrl(info.version, archive.url), zip, archive.size ?? null, onProgress);
      if (digest !== archive.sha512) throw new Error("The downloaded update did not match its published checksum, so it was not installed.");

      /* ditto rather than a JavaScript unzip: the frameworks inside an app are
         full of symlinks, and an extractor that flattens them produces a bundle
         that will not launch. */
      const unpacked = path.join(staging, "unpacked");
      await run("/usr/bin/ditto", ["-x", "-k", zip, unpacked]);
      await rm(zip, { force: true });
      const bundle = (await readdir(unpacked)).find((name) => name.endsWith(".app"));
      if (!bundle) throw new Error("The update archive did not contain Spar.");
      const next = path.join(unpacked, bundle);

      const [expectedId, nextId, nextVersion] = await Promise.all([
        plist(path.join(home.bundle, "Contents", "Info.plist"), "CFBundleIdentifier"),
        plist(path.join(next, "Contents", "Info.plist"), "CFBundleIdentifier"),
        plist(path.join(next, "Contents", "Info.plist"), "CFBundleShortVersionString"),
      ]);
      if (!nextId || nextId !== expectedId) throw new Error("The update archive contained a different app, so it was not installed.");
      if (nextVersion !== info.version) throw new Error(`The update archive held version ${nextVersion || "unknown"} instead of ${info.version}.`);
      await run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", next]).catch(() => undefined);

      this.ready = { app: next, staging, version: info.version };
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async install(): Promise<void> {
    if (!this.ready) throw new Error("No downloaded update is ready to install.");
    const home = installedBundle(this.exe);
    if ("problem" in home) throw new Error(home.problem);
    const writable = await Promise.all([
      access(path.dirname(home.bundle), constants.W_OK),
      access(home.bundle, constants.W_OK),
    ]).then(() => true, () => false);

    const swapFile = path.join(this.ready.staging, "swap.sh");
    const launcherFile = path.join(this.ready.staging, "install.sh");
    const scripts = installScripts({
      pid: process.pid,
      next: this.ready.app,
      target: home.bundle,
      staging: this.ready.staging,
      resultFile: this.resultFile,
      version: this.ready.version,
      admin: !writable,
      swapFile,
    });
    await writeFile(swapFile, scripts.swap, { mode: 0o700 });
    await writeFile(launcherFile, scripts.launcher, { mode: 0o700 });
    await chmod(launcherFile, 0o700);
    await rm(this.resultFile, { force: true });

    const child = spawn("/bin/bash", [launcherFile], { detached: true, stdio: "ignore" });
    child.unref();
    this.ready = null;
    app.quit();
    /* A window that refuses to close would leave the script waiting on a Spar
       that never exits. Saving already happened before this point. */
    setTimeout(() => app.exit(0), 8_000).unref();
  }

  async takeResult(): Promise<InstallResult | null> {
    try {
      const parsed = JSON.parse(await readFile(this.resultFile, "utf8")) as InstallResult;
      await unlink(this.resultFile).catch(() => undefined);
      return typeof parsed?.ok === "boolean" && typeof parsed.version === "string" ? parsed : null;
    } catch {
      return null;
    }
  }

  private async discard() {
    if (!this.ready) return;
    await rm(this.ready.staging, { recursive: true, force: true }).catch(() => undefined);
    this.ready = null;
  }

  /** Streams the archive to disk, hashing as it goes, and returns the base64
   *  SHA-512 — the form `latest-mac.yml` publishes. */
  private async fetchTo(url: string, file: string, size: number | null, onProgress: (progress: UpdateProgress) => void): Promise<string> {
    const response = await net.fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`The update download failed (HTTP ${response.status}).`);
    const total = Number(response.headers.get("content-length")) || size;
    const hash = createHash("sha512");
    const out = createWriteStream(file);
    const started = Date.now();
    let transferred = 0;
    let reported = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        transferred += value.byteLength;
        if (!out.write(value)) await new Promise<void>((resolve) => out.once("drain", resolve));
        const now = Date.now();
        if (now - reported > 120) {
          reported = now;
          onProgress({
            percent: total ? (transferred / total) * 100 : 0,
            transferred,
            total,
            bytesPerSecond: transferred / Math.max(0.001, (now - started) / 1_000),
          });
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
    }
    onProgress({ percent: 100, transferred, total: total ?? transferred, bytesPerSecond: transferred / Math.max(0.001, (Date.now() - started) / 1_000) });
    return hash.digest("base64");
  }
}

async function plist(file: string, key: string): Promise<string> {
  const { stdout } = await run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", file]).catch(() => ({ stdout: "" }));
  return String(stdout).trim();
}
