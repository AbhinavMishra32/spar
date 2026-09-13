import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import os from "node:os";
import type { Language } from "@spar/domain";
import { resolveLanguageStages } from "./languageStages.js";
import { createFailFast, truncateAtFailure } from "./failFast.js";
/* The panel reads this note back to know the cases after the failure were not
   run rather than silently missing — a grid of grey dots means "not reached",
   and it is only allowed to say that if it is true. */
import { STOPPED_AT_FAILURE } from "../shared/testReport.js";

type Request = {
  kind: "request";
  id: string;
  payload: {
    root: string;
    language: Language;
    command: "test" | "run";
    timeoutMs: number;
    /** Stop the suite at its first failing case.
     *
     *  Set on submissions and on nothing else. The visible cases are the
     *  contract the learner reads, so all of them run and all of them report —
     *  that list is the thing they are working against. The hidden suite is a
     *  grader, and a grader that keeps going after the first failure is
     *  answering a question nobody asked: the submission is already rejected,
     *  and two hundred more verdicts on the same broken function are noise the
     *  learner has to read past to find the one case that matters. */
    failFast?: boolean;
  };
};
type Stage = { bin: string; args: string[] };

const DIAGNOSTIC_MS = 400;


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
      return;
    }
    if (stream === "stdout") watchForFailure(text);
  };

  /* Fail-fast, watched off the stream rather than asked of the harness — see
     `failFast.ts` for why it is read rather than requested, and why the kill
     waits for the failing case's diagnostic before it lands. */
  const watch = createFailFast();
  let diagnostic: NodeJS.Timeout | null = null;
  const watchForFailure = (text: string) => {
    if (!request.payload.failFast || stopped) return;
    const enough = watch.feed(text);
    /* The diagnostic is worth waiting for, but not forever: a harness that
       prints a bare `not ok` and then goes quiet must not hold the process. */
    if (watch.failing() && !diagnostic) diagnostic = setTimeout(stopAtFailure, DIAGNOSTIC_MS);
    if (enough) stopAtFailure();
  };
  const noteStopped = () => {
    if (stderr.includes(STOPPED_AT_FAILURE)) return;
    const text = `\n${STOPPED_AT_FAILURE}\n`;
    stderr += text;
    parentPort.postMessage({ kind: "event", requestId: request.id, stream: "stderr", data: text });
  };
  const stopAtFailure = () => {
    if (stopped || !active?.pid) return;
    stopped = true;
    if (diagnostic) clearTimeout(diagnostic);
    noteStopped();
    terminate(active.pid);
  };
  const emitLimitMessage = () => {
    const text = `\nProcess stopped after producing more than ${maxOutput} bytes.\n`;
    stderr += text;
    parentPort.postMessage({ kind: "event", requestId: request.id, stream: "stderr", data: text });
  };
  const finish = (exitCode: number, signal: NodeJS.Signals | null = null) => {
    clearTimeout(timer);
    if (diagnostic) clearTimeout(diagnostic);
    /* The cut, applied to the output whether or not the kill landed.
       
       A suite that buffers — most of them, the moment stdout is a pipe — hands
       over every verdict at once on the way out, so there was never a stream to
       stop. The watcher above saves the work where the work can be saved; this
       is what makes the answer the same either way, which matters more: "the
       grader stops at your first failing case" has to be true of every challenge
       in every language, or a grid of grey dots means one thing on a Go suite
       and another on a Python one. */
    const cut = request.payload.failFast ? truncateAtFailure(stdout) : null;
    if (cut !== null) {
      stdout = cut;
      noteStopped();
    }
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
    /* Line-buffered rather than block-buffered, so a Python suite's verdicts
       reach the runner as they happen and its failure can actually cut the run
       short instead of being noticed after the process has already finished. */
    PYTHONUNBUFFERED: "1",
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
