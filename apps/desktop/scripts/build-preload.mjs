import { build } from "esbuild";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { preloadOptions, preloadOutput } from "./preload-build.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

await build(preloadOptions(projectRoot));

/* Assert the artifact rather than trusting the build. A missing or wrong-format
   preload does not fail packaging — it produces an app that opens and then says
   it cannot start, which is what 0.1.0 shipped. This check is the reason that
   cannot happen quietly again. */
const output = preloadOutput(projectRoot);
const info = await stat(output).catch(() => null);
if (!info?.isFile() || info.size === 0) {
  throw new Error(`Preload bundle missing or empty at ${output}`);
}
const source = await readFile(output, "utf8");
if (!source.includes("contextBridge")) {
  throw new Error(`Preload bundle at ${output} does not expose a context bridge`);
}
console.log(`preload → ${output} (${Math.round(info.size / 1024)} KB)`);
