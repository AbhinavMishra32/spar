import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TraceRequest, TracerCommand, VisualizerLanguage } from "../../language.js";
import { pythonDialect, PYTHON_PRELUDE, PYTHON_STARTER } from "./index.js";

/**
 * The half of the Python adapter that names a program and a path.
 *
 * Main-process only. Importing `node:path` from the renderer bundle is the kind
 * of mistake that works in development and fails in a packaged app, so the seam
 * is a separate module rather than a runtime check.
 */

/**
 * Where `tracer.py` is on disk.
 *
 * The package's build step copies it next to the compiled adapter, so the same
 * relative walk finds it whether this module was loaded from `src` in
 * development or from `dist` in a packaged app — the two layouts are made
 * identical rather than branched on. The `src` fallback covers the one case
 * that breaks that: a consumer that compiled the TypeScript itself and did not
 * run our build.
 *
 * The `app.asar` rewrite is the part that is not obvious and that only fails
 * once the app is packaged, which is the worst time to find out.
 *
 * An asar archive is a virtual filesystem that only Electron's own patched
 * `fs` can see through. Node code inside the app reads a path under
 * `.../app.asar/...` quite happily — but `python3` is a separate process with
 * an unpatched libc, and to it that path is a file that does not exist. So the
 * tracer is listed in electron-builder's `asarUnpack`, which writes a real copy
 * to the sibling `app.asar.unpacked` tree, and this points at that copy.
 * Keep the two in step: dropping the `asarUnpack` entry breaks the visualiser
 * in release builds and nowhere else.
 */
export function pythonTracerPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const beside = unpacked(path.join(here, "tracer.py"));
  if (existsSync(beside)) return beside;
  const fromSource = path.join(here, "..", "..", "..", "src", "languages", "python", "tracer.py");
  return existsSync(fromSource) ? fromSource : beside;
}

/** The real file behind a path inside an asar archive. A no-op everywhere else,
 *  including in development, where there is no archive to be inside of. */
function unpacked(target: string): string {
  return target.includes(`${path.sep}app.asar${path.sep}`)
    ? target.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : target;
}

/* Both modes are the same program with a different `mode`, and both take their
   request on stdin. Nothing about the learner's code goes on the command line:
   argv is world-readable on every platform Spar ships to, and a half-finished
   solution showing up in a process list is a surprising thing for a practice
   app to leak.

   `-I` isolates the interpreter — no user site-packages, no PYTHONPATH, no
   `.pth` files — so a trace cannot be changed by whatever the learner happens
   to have installed globally, and a machine with a broken global environment
   still gets a working visualiser. `-S` skips `site` on top of that, which is
   most of the interpreter's startup cost and buys nothing here. */
function command(input: unknown): TracerCommand {
  return { bin: "python3", args: ["-I", "-S", pythonTracerPath()], input };
}

export const python: VisualizerLanguage = {
  id: "python",
  label: pythonDialect.label,
  fileName: pythonDialect.fileName,
  editorLanguage: pythonDialect.editorLanguage,
  prelude: PYTHON_PRELUDE,
  starter: PYTHON_STARTER,
  tracerPath: pythonTracerPath,
  analyzeCommand: (code: string) => command({ mode: "analyze", code }),
  traceCommand: (request: TraceRequest) => command({ mode: "trace", code: request.code, setup: request.setup, maxSteps: request.maxSteps }),
  specFromSignature: pythonDialect.specFromSignature,
  composeSetup: pythonDialect.composeSetup,
};
