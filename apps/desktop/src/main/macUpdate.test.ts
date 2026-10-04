import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetched = vi.hoisted(() => ({ body: Buffer.alloc(0), urls: [] as string[] }));
vi.mock("electron", () => ({
  app: {},
  net: { fetch: async (url: string) => { fetched.urls.push(url); return new Response(fetched.body, { headers: { "content-length": String(fetched.body.length) } }); } },
}));
const { MacSelfUpdater, archiveUrl, installedBundle, installScripts, pickMacArchive, shellQuote } = await import("./macUpdate.js");

const run = promisify(execFile);

const files = [
  { url: "Spar-0.7.3-arm64-mac.zip", sha512: "arm", size: 2 },
  { url: "Spar-0.7.3-mac.zip", sha512: "intel", size: 3 },
  { url: "Spar-0.7.3-arm64.dmg", sha512: "dmg", size: 4 },
];

describe("macOS self-update", () => {
  it("picks the zip built for this Mac's chip", () => {
    expect(pickMacArchive({ files } as never, "arm64")).toMatchObject({ url: "Spar-0.7.3-arm64-mac.zip", sha512: "arm" });
    expect(pickMacArchive({ files } as never, "x64")).toMatchObject({ url: "Spar-0.7.3-mac.zip", sha512: "intel" });
    expect(pickMacArchive({ files: [files[2]!] } as never, "arm64")).toBeNull();
  });

  it("downloads from the release the feed belongs to", () => {
    expect(archiveUrl("0.7.3", "Spar-0.7.3-arm64-mac.zip")).toBe("https://github.com/AbhinavMishra32/spar/releases/download/v0.7.3/Spar-0.7.3-arm64-mac.zip");
    expect(archiveUrl("0.7.3", "https://example.com/a.zip")).toBe("https://example.com/a.zip");
  });

  it("refuses to replace an app run from the disk image or a translocated copy", () => {
    expect(installedBundle("/Applications/Spar.app/Contents/MacOS/Spar")).toEqual({ bundle: "/Applications/Spar.app" });
    expect(installedBundle("/Volumes/Spar 0.7.2/Spar.app/Contents/MacOS/Spar")).toHaveProperty("problem");
    expect(installedBundle("/private/var/folders/x/AppTranslocation/ABC/d/Spar.app/Contents/MacOS/Spar")).toHaveProperty("problem");
  });

  it("quotes paths with spaces and quotes for the shell", () => {
    expect(shellQuote("/Users/a b/it's.app")).toBe(`'/Users/a b/it'\\''s.app'`);
  });
});

/* The swap itself, run for real against stand-in bundles. */
describe.runIf(process.platform === "darwin")("macOS install script", () => {
  let root = "";
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  async function stage(name = "Spar's Apps") {
    root = await mkdtemp(path.join(os.tmpdir(), "spar-swap-"));
    const apps = path.join(root, name);
    const staging = path.join(root, "staging");
    await mkdir(path.join(apps, "Spar.app", "Contents"), { recursive: true });
    await writeFile(path.join(apps, "Spar.app", "Contents", "marker"), "old");
    await mkdir(path.join(staging, "unpacked", "Spar.app", "Contents"), { recursive: true });
    await writeFile(path.join(staging, "unpacked", "Spar.app", "Contents", "marker"), "new");
    return { target: path.join(apps, "Spar.app"), next: path.join(staging, "unpacked", "Spar.app"), staging, resultFile: path.join(root, "result.json") };
  }

  async function install(paths: Awaited<ReturnType<typeof stage>>, pid: number) {
    const swapFile = path.join(paths.staging, "swap.sh");
    const launcher = path.join(paths.staging, "install.sh");
    const scripts = installScripts({ ...paths, pid, version: "0.7.3", admin: false, swapFile, open: "true" });
    await writeFile(swapFile, scripts.swap);
    await writeFile(launcher, scripts.launcher);
    await run("/bin/bash", [launcher]).catch(() => undefined);
  }

  it("replaces the bundle once Spar has exited and records the result", async () => {
    const paths = await stage();
    await install(paths, 999_999);
    expect(await readFile(path.join(paths.target, "Contents", "marker"), "utf8")).toBe("new");
    expect(JSON.parse(await readFile(paths.resultFile, "utf8"))).toEqual({ ok: true, version: "0.7.3" });
  });

  it("puts the old version back when the new one cannot be moved in", async () => {
    const paths = await stage();
    await rm(paths.next, { recursive: true });
    await install(paths, 999_999);
    expect(await readFile(path.join(paths.target, "Contents", "marker"), "utf8")).toBe("old");
    expect(JSON.parse(await readFile(paths.resultFile, "utf8"))).toMatchObject({ ok: false, version: "0.7.3" });
  });

  it("does not touch a bundle that is still running", async () => {
    const paths = await stage();
    const scripts = installScripts({ ...paths, pid: process.pid, version: "0.7.3", admin: false, swapFile: path.join(paths.staging, "swap.sh"), open: "true" });
    /* The real wait is a minute; the shape is what is tested here. */
    expect(scripts.launcher).toMatch(new RegExp(`kill -0 ${process.pid}`));
    expect(scripts.launcher.indexOf("kill -0")).toBeLessThan(scripts.launcher.indexOf("swap.sh"));
  });
});

/* Download, checksum, unpack and identity checks against a real zip. */
describe.runIf(process.platform === "darwin")("macOS update download", () => {
  let root = "";
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  async function bundle(at: string, id: string, version: string) {
    await mkdir(path.join(at, "Contents", "MacOS"), { recursive: true });
    await writeFile(path.join(at, "Contents", "MacOS", "Spar"), "#!/bin/sh\n");
    await run("/usr/bin/plutil", ["-create", "xml1", path.join(at, "Contents", "Info.plist")]);
    await run("/usr/bin/plutil", ["-insert", "CFBundleIdentifier", "-string", id, path.join(at, "Contents", "Info.plist")]);
    await run("/usr/bin/plutil", ["-insert", "CFBundleShortVersionString", "-string", version, path.join(at, "Contents", "Info.plist")]);
  }

  async function setup(next: { id: string; version: string }) {
    root = await mkdtemp(path.join(os.tmpdir(), "spar-download-"));
    await bundle(path.join(root, "Applications", "Spar.app"), "ai.spar.desktop", "0.7.2");
    await bundle(path.join(root, "build", "Spar.app"), next.id, next.version);
    const zip = path.join(root, "Spar-0.7.3-arm64-mac.zip");
    await run("/usr/bin/ditto", ["-c", "-k", "--keepParent", path.join(root, "build", "Spar.app"), zip]);
    fetched.body = await readFile(zip);
    fetched.urls = [];
    const sha512 = createHash("sha512").update(fetched.body).digest("base64");
    const temp = path.join(root, "temp");
    await mkdir(temp);
    const updater = new MacSelfUpdater(path.join(root, "Applications", "Spar.app", "Contents", "MacOS", "Spar"), temp, path.join(root, "result.json"));
    const info = { version: "0.7.3", files: [{ url: "Spar-0.7.3-arm64-mac.zip", sha512, size: fetched.body.length }, { url: "Spar-0.7.3-mac.zip", sha512, size: fetched.body.length }] };
    return { updater, info, temp };
  }

  it("verifies and unpacks the release built for this Mac", async () => {
    const { updater, info, temp } = await setup({ id: "ai.spar.desktop", version: "0.7.3" });
    const progress = vi.fn();
    await updater.download(info as never, progress);
    expect(fetched.urls[0]).toMatch(/\/v0\.7\.3\/Spar-0\.7\.3-(arm64-)?mac\.zip$/);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ percent: 100 }));
    const [staging] = await readdir(temp);
    expect(await readdir(path.join(temp, staging!, "unpacked"))).toEqual(["Spar.app"]);
  });

  it("rejects an archive whose checksum does not match the feed", async () => {
    const { updater, info, temp } = await setup({ id: "ai.spar.desktop", version: "0.7.3" });
    info.files = info.files.map((file) => ({ ...file, sha512: "AAAA" }));
    await expect(updater.download(info as never, () => undefined)).rejects.toThrow(/checksum/);
    expect(await readdir(temp)).toEqual([]);
  });

  it("rejects an archive holding a different app", async () => {
    const { updater, info } = await setup({ id: "com.example.other", version: "0.7.3" });
    await expect(updater.download(info as never, () => undefined)).rejects.toThrow(/different app/);
  });

  it("rejects an archive at the wrong version", async () => {
    const { updater, info } = await setup({ id: "ai.spar.desktop", version: "0.7.1" });
    await expect(updater.download(info as never, () => undefined)).rejects.toThrow(/0\.7\.1 instead of 0\.7\.3/);
  });
});
