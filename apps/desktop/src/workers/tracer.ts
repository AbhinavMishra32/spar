import { spawn } from "node:child_process";
import type { TracerCommand } from "@spar/visualizer";

/**
 * The visualiser's execution process.
 *
 * Its own utility process rather than a job on the code runner's, because the
 * two have opposite risk profiles and opposite lifetimes. A run of the learner's
 * test suite is something they asked for once and waited for; a trace is issued
 * on every edit-and-run cycle, against code that by definition does not work
 * yet, and the single most likely outcome of any given trace is an infinite
 * loop. Isolating that means an unkillable trace takes down a process nobody
 * else was using.
 *
 * The tracer program itself is named by the language adapter — this file knows
 * nothing about Python. What it owns is the part that must not be delegated to
 * an adapter: the wall clock, the output ceiling, the kill, and the refusal to
 * put the learner's source anywhere but stdin.
 */

type Request = {
  kind: "request";
  id: string;
  method: "run";
  payload: { command: TracerCommand; timeoutMs: number };
};

const parentPort = process.parentPort;
if (!parentPort) throw new Error("The tracer must run inside an Electron utility process");

parentPort.on("message", (event) => {
  const request = event.data as Request;
  void run(request).catch((error) => reject(request.id, error instanceof Error ? error.message : String(error)));
});

function reject(id: string, error: string) {
  parentPort.postMessage({ kind: "result", id, ok: false, error });
}

/** A trace is JSON and JSON is small next to what a runaway program can print.
 *  Twelve megabytes is far past any legitimate trace and far short of a size
 *  that would trouble the main process to parse. */
const MAX_OUTPUT = 12_000_000;

async function run(request: Request) {
  const { command, timeoutMs } = request.payload;
  await new Promise<void>((resolve) => {
    /* Detached so the kill reaches the whole process group. A tracer that
       spawned anything of its own — it should not, but a learner's code runs
       inside it — would otherwise survive its parent and keep the CPU. */
    const child = spawn(command.bin, command.args, {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      env: safeEnvironment(),
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let overflowed = false;

    const finish = (outcome: { ok: true; value: unknown } | { ok: false; error: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentPort.postMessage({ kind: "result", id: request.id, ...outcome });
      resolve();
    };

    const stop = () => {
      if (!child.pid) return;
      try {
        // Negative pid addresses the group, which is the point of detaching.
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };

    const timer = setTimeout(() => {
      stop();
      finish({ ok: false, error: `The trace did not finish within ${Math.round(timeoutMs / 1000)} seconds and was stopped. Reduce the input, or check that the code terminates.` });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length + chunk.length > MAX_OUTPUT) {
        overflowed = true;
        stop();
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(0, 4_000);
    });

    child.once("error", (error) => {
      // The one failure worth translating: no interpreter. Everything else is
      // reported as itself, because a guess about an unfamiliar spawn error is
      // worse than the error.
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      finish({
        ok: false,
        error: missing
          ? `Spar could not find \`${command.bin}\` on this machine. Install it and reopen the visualiser.`
          : error.message,
      });
    });

    child.once("close", (code) => {
      if (overflowed) return finish({ ok: false, error: "The trace produced more output than Spar can hold. Reduce the input size." });
      if (!stdout.trim()) {
        return finish({ ok: false, error: stderr.trim() || `The tracer exited with code ${code ?? "unknown"} without producing a trace.` });
      }
      try {
        finish({ ok: true, value: JSON.parse(stdout) });
      } catch {
        // Stdout that is not JSON means the tracer itself broke, and its stderr
        // is the only thing that can say why.
        finish({ ok: false, error: stderr.trim() || "The tracer returned something Spar could not read." });
      }
    });

    /* The learner's source goes here and nowhere else. An argv is readable by
       every process on the machine on every platform Spar ships to, and a
       half-written solution turning up in a process list is a surprising thing
       for a practice app to leak. An EPIPE here means the child died before it
       read its input, which `close` is already about to report properly. */
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(command.input));
  });
}

/**
 * The environment a tracer gets.
 *
 * An allowlist rather than a filter: a trace should behave the same on a
 * learner's machine as on a fresh one, and the way that stops being true is a
 * language's own environment variables — a `PYTHONPATH` pointing at a shadowed
 * `typing`, a `PYTHONSTARTUP` that prints a banner into what we are about to
 * parse as JSON. `PATH` is kept because the binary has to be found, and `HOME`
 * and `TMPDIR` because a runtime that cannot write a temp file fails in ways
 * that look nothing like their cause.
 */
function safeEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot", "COMSPEC", "LANG", "LC_ALL"];
  const environment: NodeJS.ProcessEnv = { PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" };
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}
