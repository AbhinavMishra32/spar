import { spawn } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { parentPort } from "node:worker_threads";

type Request = { kind: "request"; id: string; payload: { root: string; language: "javascript" | "typescript" | "cpp"; command: "test" | "run"; timeoutMs: number } };
parentPort?.on("message", (event) => void execute((event as MessageEvent<Request>).data));

async function execute(request: Request) {
  const { root, language, command, timeoutMs } = request.payload;
  const recipe = resolveRecipe(root, language, command);
  const child = spawn(recipe.bin, recipe.args, { cwd: root, env: safeEnvironment(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let outputBytes = 0; const maxOutput = 1_000_000;
  const emit = (stream: "stdout" | "stderr", chunk: Buffer) => { outputBytes += chunk.byteLength; parentPort?.postMessage({ kind: "event", requestId: request.id, stream, data: chunk.toString("utf8") }); if (outputBytes > maxOutput) terminate(child.pid); };
  child.stdout.on("data", (chunk: Buffer) => emit("stdout", chunk)); child.stderr.on("data", (chunk: Buffer) => emit("stderr", chunk));
  const timer = setTimeout(() => { emit("stderr", Buffer.from(`\nProcess stopped after ${timeoutMs}ms.\n`)); terminate(child.pid); }, timeoutMs);
  child.on("close", (code, signal) => { clearTimeout(timer); parentPort?.postMessage({ kind: "event", requestId: request.id, stream: "exit", data: signal ? `signal:${signal}` : `code:${code ?? 1}`, exitCode: code ?? 1 }); parentPort?.postMessage({ kind: "result", id: request.id, ok: true, value: { exitCode: code ?? 1 } }); });
}

function resolveRecipe(root: string, language: Request["payload"]["language"], command: Request["payload"]["command"]) {
  if (language === "javascript") return { bin: process.execPath, args: ["--test", command === "test" ? "tests/*.test.js" : "index.js"] };
  if (language === "typescript") return { bin: path.join(root, "node_modules/.bin/tsx"), args: command === "test" ? ["--test", "tests/*.test.ts"] : ["index.ts"] };
  const executable = path.join(root, ".practice-ai", "solution");
  if (!existsSync(executable)) return { bin: "clang++", args: ["-std=c++20", "-O2", "-o", executable, command === "test" ? "tests/test.cpp" : "main.cpp"] };
  return { bin: executable, args: [] };
}
function safeEnvironment() { return { PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin", LANG: "en_US.UTF-8", TMPDIR: process.env.TMPDIR ?? "/tmp" }; }
function terminate(pid: number | undefined) { if (!pid) return; try { process.kill(-pid, "SIGTERM"); setTimeout(() => { try { process.kill(-pid, "SIGKILL"); } catch {} }, 500); } catch {} }

