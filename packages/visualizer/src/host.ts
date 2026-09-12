/**
 * The main-process entry point: language adapters that name executables.
 *
 * Kept out of `index.ts` so the renderer's bundle never reaches a `node:`
 * import. Anything the sandboxed side needs is in the root export.
 */
import { registerLanguage } from "./language.js";
import { python } from "./languages/python/host.js";

registerLanguage(python);

export { python, pythonTracerPath } from "./languages/python/host.js";
export { pythonSpecFromAnalysis } from "./languages/python/analysis.js";
export { mergeSpecs, specFromSignature, specFromAnalysis } from "./languages/python/shapes.js";
export type { PythonAnalysis } from "./languages/python/shapes.js";
export * from "./index.js";
