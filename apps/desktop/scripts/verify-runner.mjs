import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { app, utilityProcess } from "electron";

console.log("VERIFY_RUNNER_BOOT");

if (app.isReady()) void verify();
else app.once("ready", () => void verify());

async function verify() {
const worker = utilityProcess.fork(path.resolve(import.meta.dirname, "../dist/workers/runner.js"), [], { serviceName: "Spar runner verification", stdio: "pipe" });
console.log(`VERIFY_RUNNER_FORK pid=${worker.pid ?? "pending"}`);
worker.stdout?.on("data", (chunk) => process.stdout.write(`[runner stdout] ${chunk}`));
worker.stderr?.on("data", (chunk) => process.stderr.write(`[runner stderr] ${chunk}`));
const pending = new Map();
worker.on("message", (message) => {
  if (message.kind !== "result") return;
  const item = pending.get(message.id);
  if (!item) return;
  pending.delete(message.id);
  item.resolve(message.value);
});
worker.on("spawn", () => console.log(`VERIFY_RUNNER_SPAWN pid=${worker.pid}`));
worker.on("exit", (code) => {
  console.log(`VERIFY_RUNNER_EXIT code=${code}`);
  for (const item of pending.values()) item.reject(new Error(`Runner exited (${code})`));
  pending.clear();
});
await new Promise((resolve) => setTimeout(resolve, 250));

const root = await mkdtemp(path.join(tmpdir(), "spar-runner-e2e-"));
try {
  const javascript = path.join(root, "javascript");
  await files(javascript, {
    "src/value.js": "export const double = value => value * 2;",
    "tests/value.test.js": "import test from 'node:test';import assert from 'node:assert/strict';import {double} from '../src/value.js';test('double',()=>assert.equal(double(4),8));",
  });
  assertPassed("javascript", await run(javascript, "javascript"));

  const typescript = path.join(root, "typescript");
  await files(typescript, {
    "src/value.ts": "export const double = (value: number): number => value * 2;",
    "tests/value.test.ts": "import test from 'node:test';import assert from 'node:assert/strict';import {double} from '../src/value.ts';test('double',()=>assert.equal(double(4),8));",
  });
  assertPassed("typescript", await run(typescript, "typescript"));

  const cpp = path.join(root, "cpp");
  await files(cpp, {
    "src/value.cpp": "int double_value(int value) { return value * 2; }",
    "tests/test.cpp": "#include <cassert>\nint double_value(int);\nint main(){assert(double_value(4)==8);}",
  });
  assertPassed("cpp", await run(cpp, "cpp"));
  await writeFile(path.join(cpp, "src/value.cpp"), "int double_value(int value) { return value; }");
  const changed = await run(cpp, "cpp");
  if (changed.exitCode === 0) throw new Error("C++ runner reused a stale executable after source changed");

  console.log(JSON.stringify({ javascript: "passed", typescript: "passed", cpp: "passed", cppRecompile: "proved" }));
} finally {
  worker.kill();
  await rm(root, { recursive: true, force: true });
  app.quit();
}

function run(root, language) {
  const id = randomUUID();
  const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  worker.postMessage({ kind: "request", id, payload: { root, language, command: "test", timeoutMs: 8_000 } });
  return result;
}
async function files(root, entries) {
  for (const [relative, content] of Object.entries(entries)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}
function assertPassed(language, result) {
  if (result.exitCode !== 0) throw new Error(`${language} runner failed:\n${result.stdout}\n${result.stderr}`);
}
}
