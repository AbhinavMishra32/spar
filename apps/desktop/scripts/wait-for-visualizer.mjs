import { spawnSync } from "node:child_process";

// wait-on only establishes that a file exists. On a clean checkout, the
// visualizer copies tracer.py before TypeScript finishes emitting its modules.
// Import in a new process each time so a failed ESM import is not cached.
const deadline = Date.now() + 60_000;
let lastError = "";
while (Date.now() < deadline) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", 'import("@spar/visualizer/host")'], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  if (result.status === 0) process.exit(0);
  lastError = result.stderr.trim();
  await new Promise((resolve) => setTimeout(resolve, 250));
}

console.error(`Visualizer did not become importable within 60 seconds.\n${lastError}`);
process.exit(1);
