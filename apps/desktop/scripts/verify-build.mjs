import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Checks the built output for the two faults that have actually shipped.
 *
 * Both were invisible to typecheck, tests, and packaging itself, and both
 * produced an app that installs, opens a window, and then cannot work:
 *
 *   the preload was never built for release, so the renderer had no bridge and
 *   the app reported that it could not start;
 *
 *   assets were referenced from the filesystem root, so nothing loaded over
 *   file:// and the window came up blank.
 *
 * Checked here rather than inside the packaged asar because `files` copies
 * `dist/**` verbatim — what is wrong here is what ships — and reading an asar
 * would mean depending on a package electron-builder only happens to pull in.
 */

const projectRoot = resolve(import.meta.dirname, "..");
const dist = resolve(projectRoot, "dist");
const problems = [];

function sized(path) {
  const full = resolve(dist, path);
  if (!existsSync(full)) return null;
  const info = statSync(full);
  return info.isFile() && info.size > 0 ? readFileSync(full, "utf8") : null;
}

// main/window.ts loads this exact path, and a sandboxed renderer will only accept
// the CommonJS bundle — not the ESM `tsc` emits alongside it.
const preload = sized("preload/index.cjs");
if (!preload) problems.push("dist/preload/index.cjs is missing or empty");
else if (!preload.includes("contextBridge")) problems.push("dist/preload/index.cjs exposes no context bridge");

const html = sized("renderer/index.html");
if (!html) {
  problems.push("dist/renderer/index.html is missing or empty");
} else if (/(?:src|href)="\/(?!\/)/.test(html)) {
  // Absolute paths resolve against the root of the disk under file://.
  problems.push("dist/renderer/index.html references assets from the filesystem root");
}

if (!sized("main/main.js")) problems.push("dist/main/main.js is missing or empty");

if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  console.error(`\n${problems.length} problem(s) that would ship a build that cannot start.`);
  process.exit(1);
}
console.log("Built output looks launchable: preload bridge, relative assets, main entry.");
