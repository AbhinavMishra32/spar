import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Checks the built output for the faults that have actually shipped.
 *
 * Each was invisible to typecheck, tests, and packaging itself, and both
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
if (!sized("workers/tracer.js")) problems.push("dist/workers/tracer.js is missing or empty");

/* The third fault of the same shape, found the same way: the visualiser spawns
   `python3` on a `tracer.py` that is *copied* into the visualiser package's
   `dist` by a build step, not compiled there. Nothing typechecks a copied file,
   so a dist left behind by an earlier build keeps working — it is a valid,
   older tracer — and the app fails at the first feature the newer one added.
   Comparing against the source is the whole check: they are meant to be the
   same bytes, and any difference means the copy did not run. */
const tracer = resolve(projectRoot, "../../packages/visualizer");
const shipped = resolve(tracer, "dist/languages/python/tracer.py");
const authored = resolve(tracer, "src/languages/python/tracer.py");
if (!existsSync(shipped)) {
  problems.push("packages/visualizer/dist/languages/python/tracer.py is missing — run the visualiser's build");
} else if (existsSync(authored) && readFileSync(shipped, "utf8") !== readFileSync(authored, "utf8")) {
  problems.push("packages/visualizer/dist/languages/python/tracer.py is stale — it does not match its source");
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  console.error(`\n${problems.length} problem(s) that would ship a build that cannot start.`);
  process.exit(1);
}
console.log("Built output looks launchable: preload bridge, relative assets, main entry, current tracer.");
