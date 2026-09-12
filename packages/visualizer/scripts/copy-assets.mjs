/* The tracer is a Python source file, not something tsc knows how to emit. It is
   copied beside the compiled adapter so `runtimeAssetPath` resolves identically
   whether the caller loaded `src` (dev) or `dist` (packaged). */
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const to = path.join(root, "dist", "languages", "python");
await mkdir(to, { recursive: true });
await cp(path.join(root, "src", "languages", "python", "tracer.py"), path.join(to, "tracer.py"));
