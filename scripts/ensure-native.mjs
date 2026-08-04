import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { root } from "./lib.mjs";

const nativePackages = ["electron", "better-sqlite3", "keytar"];
const nativeVersions = nativePackages.map((packageName) => {
  const manifest = JSON.parse(readFileSync(resolve(root, `apps/desktop/node_modules/${packageName}/package.json`), "utf8"));
  return `${packageName}@${manifest.version}`;
});
const fingerprint = createHash("sha256")
  .update(nativeVersions.join("\n"))
  .update(process.platform)
  .update(process.arch)
  .digest("hex")
  .slice(0, 16);
const markerDirectory = resolve(root, "node_modules/.cache/spar");
const marker = resolve(markerDirectory, `electron-native-${fingerprint}`);

if (existsSync(marker)) {
  console.log("Electron native dependencies already match this lockfile; skipping rebuild.");
  process.exit(0);
}

/* On Windows the shim in .bin is `electron-builder.cmd`; the extensionless name
   is a shell script that only Unix can run, and spawning it there fails with
   ENOENT. Resolve the real file rather than trusting one name on both. */
const binaries = process.platform === "win32"
  ? ["electron-builder.cmd", "electron-builder.exe", "electron-builder"]
  : ["electron-builder"];
const builder = binaries
  .map((name) => resolve(root, "apps/desktop/node_modules/.bin", name))
  .find((candidate) => existsSync(candidate));
if (!builder) {
  console.error("electron-builder is unavailable; dependency installation is incomplete.");
  process.exit(1);
}

const result = spawnSync(builder, ["install-app-deps"], {
  cwd: resolve(root, "apps/desktop"),
  env: process.env,
  stdio: "inherit",
  // A .cmd is only executable through the command interpreter.
  shell: process.platform === "win32"
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
mkdirSync(markerDirectory, { recursive: true });
writeFileSync(marker, `${new Date().toISOString()}\n`);
