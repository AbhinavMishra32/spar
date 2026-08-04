import { resolve } from "node:path";

/**
 * How the preload is built, in one place.
 *
 * It cannot be built the way the rest of the main process is. A sandboxed
 * renderer only accepts a CommonJS preload, and this package is `"type":
 * "module"`, so `tsc` emits ESM — which Electron will not load as a preload at
 * all. It is therefore bundled to `.cjs` by esbuild.
 *
 * Shared by `dev-main.mjs` and `build-preload.mjs` because the two drifting is
 * exactly what shipped 0.1.0 with no bridge: dev built `index.cjs` with esbuild,
 * the production build emitted only `index.js` with tsc, and `window.ts` asks for
 * `index.cjs`. Every developer had a stale `.cjs` from a dev run, so the packaged
 * app worked on every machine except a clean one — meaning every user's.
 */
export function preloadOptions(projectRoot) {
  return {
    absWorkingDir: projectRoot,
    entryPoints: { "preload/index": "src/preload/index.ts" },
    outdir: resolve(projectRoot, "dist"),
    bundle: true,
    external: ["electron"],
    platform: "node",
    format: "cjs",
    outExtension: { ".js": ".cjs" },
    target: "node22",
    sourcemap: "inline",
    logLevel: "info"
  };
}

export const preloadOutput = (projectRoot) => resolve(projectRoot, "dist/preload/index.cjs");
