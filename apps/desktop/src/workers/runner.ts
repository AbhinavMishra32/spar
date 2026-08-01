import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, globSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Request = {
  kind: "request";
  id: string;
  payload: {
    root: string;
    language: "javascript" | "typescript" | "cpp";
    command: "test" | "run";
    timeoutMs: number;
  };
};
type Stage = { bin: string; args: string[] };

const parentPort = process.parentPort;
if (!parentPort) throw new Error("Code runner must run inside an Electron utility process");
parentPort.on("message", (event) => {
  const request = event.data as Request;
  void execute(request).catch((error) => parentPort.postMessage({ kind: "result", id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }));
});

async function execute(request: Request) {
  const stages = resolveStages(request.payload.root, request.payload.language, request.payload.command);
  const started = Date.now();
  const maxOutput = 1_000_000;
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  let active: ChildProcess | null = null;
  let stopped = false;

  const emit = (stream: "stdout" | "stderr", chunk: Buffer) => {
    const text = chunk.toString("utf8");
    if (stream === "stdout") stdout += text;
    else stderr += text;
    outputBytes += chunk.byteLength;
    parentPort.postMessage({ kind: "event", requestId: request.id, stream, data: text });
    if (outputBytes > maxOutput && active?.pid) {
      stopped = true;
      emitLimitMessage();
      terminate(active.pid);
    }
  };
  const emitLimitMessage = () => {
    const text = `\nProcess stopped after producing more than ${maxOutput} bytes.\n`;
    stderr += text;
    parentPort.postMessage({ kind: "event", requestId: request.id, stream: "stderr", data: text });
  };
  const finish = (exitCode: number, signal: NodeJS.Signals | null = null) => {
    clearTimeout(timer);
    parentPort.postMessage({ kind: "event", requestId: request.id, stream: "exit", data: signal ? `signal:${signal}` : `code:${exitCode}`, exitCode });
    parentPort.postMessage({ kind: "result", id: request.id, ok: true, value: { exitCode, stdout: stdout.slice(0, maxOutput), stderr: stderr.slice(0, maxOutput), durationMs: Date.now() - started } });
  };
  const runStage = (index: number) => {
    const stage = stages[index];
    if (!stage) return finish(1);
    active = spawn(stage.bin, stage.args, { cwd: request.payload.root, env: safeEnvironment(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    active.stdout?.on("data", (chunk: Buffer) => emit("stdout", chunk));
    active.stderr?.on("data", (chunk: Buffer) => emit("stderr", chunk));
    active.once("error", (error) => {
      const text = `${error.message}\n`;
      stderr += text;
      parentPort.postMessage({ kind: "event", requestId: request.id, stream: "stderr", data: text });
    });
    active.once("close", (code, signal) => {
      const exitCode = code ?? 1;
      if (!stopped && exitCode === 0 && index + 1 < stages.length) runStage(index + 1);
      else finish(exitCode, signal);
    });
  };
  const timer = setTimeout(() => {
    stopped = true;
    const text = `\nProcess stopped after ${request.payload.timeoutMs}ms.\n`;
    stderr += text;
    parentPort.postMessage({ kind: "event", requestId: request.id, stream: "stderr", data: text });
    if (active?.pid) terminate(active.pid);
  }, request.payload.timeoutMs);
  runStage(0);
}

function resolveStages(root: string, language: Request["payload"]["language"], command: Request["payload"]["command"]): Stage[] {
  const tests = (pattern: string) => globSync(pattern, { cwd: root }).sort();
  if (language === "javascript") {
    return [{ bin: process.execPath, args: command === "test" ? ["--test", ...tests("**/*.test.js")] : [existsSync(path.join(root, "index.js")) ? "index.js" : "src/index.js"] }];
  }
  if (language === "typescript") {
    const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
    return [{ bin: process.execPath, args: [tsxCli, ...(command === "test" ? ["--test", ...tests("**/*.test.ts")] : [existsSync(path.join(root, "index.ts")) ? "index.ts" : "src/index.ts"])] }];
  }

  const executable = path.join(root, ".spar", "solution");
  mkdirSync(path.dirname(executable), { recursive: true });
  rmSync(executable, { force: true });
  const sources = command === "test"
    ? [...tests("src/**/*.cpp"), ...tests("tests/test.cpp")]
    : [...tests("src/**/*.cpp"), ...(existsSync(path.join(root, "main.cpp")) ? ["main.cpp"] : [])];
  if (!sources.length) throw new Error(`No C++ ${command === "test" ? "test" : "entrypoint"} sources found`);
  return [
    { bin: "clang++", args: ["-std=c++20", "-O2", "-Wall", "-Wextra", "-pedantic", "-o", executable, ...sources] },
    { bin: executable, args: [] },
  ];
}

function safeEnvironment() {
  return {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
    LANG: "en_US.UTF-8",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    ELECTRON_RUN_AS_NODE: "1",
  };
}
function terminate(pid: number) {
  try {
    process.kill(-pid, "SIGTERM");
    setTimeout(() => {
      try { process.kill(-pid, "SIGKILL"); } catch {}
    }, 500);
  } catch {}
}
