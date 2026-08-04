import { context } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { preloadOptions } from "./preload-build.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(projectRoot, "dist");
const build = await context({
  absWorkingDir: projectRoot,
  entryPoints: {
    "main/main": "src/main/main.ts",
    "workers/agent": "src/workers/agent.ts",
    "workers/runner": "src/workers/runner.ts"
  },
  outdir: outputDirectory,
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: "inline",
  logLevel: "info"
});
const preload = await context(preloadOptions(projectRoot));

await build.rebuild();
await preload.rebuild();
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, ".main-ready"), `${Date.now()}\n`);
console.log("Electron main, preload, and utility processes ready. Watching for changes…");
await build.watch();
await preload.watch();

const stop = async () => {
  await build.dispose();
  await preload.dispose();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
