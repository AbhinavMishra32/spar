import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import os from "node:os";
import type { Language } from "@spar/domain";
import { resolveLanguageStages } from "./languageStages.js";

type Request = {
  kind: "request";
  id: string;
  payload: {
    root: string;
    language: Language;
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
  const resolved = resolveLanguageStages(request.payload.root, request.payload.language, request.payload.command);
  const started = Date.now();
  // A layout the toolchain cannot build is a fact about the candidate, not a
  // crash. Reporting it as a failed run keeps the diagnostic inside the
  // validation report the agent reads, instead of aborting the tool call with
  // an opaque IPC error the agent cannot act on.
  if ("error" in resolved) {
    parentPort.postMessage({ kind: "event", requestId: request.id, stream: "stderr", data: resolved.error });
    parentPort.postMessage({ kind: "event", requestId: request.id, stream: "exit", data: "code:1", exitCode: 1 });
    parentPort.postMessage({ kind: "result", id: request.id, ok: true, value: { exitCode: 1, stdout: "", stderr: resolved.error, durationMs: Date.now() - started } });
    return;
  }
  const stages = resolved.stages;
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

function safeEnvironment() {
  return {
    PATH: `/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${path.join(os.homedir(), ".cargo", "bin")}`,
    GO111MODULE: "off",
    PYTHONPATH: ".",
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
