import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { digest, type TraceWriter } from "@spar/eval";
import type { LocalStore } from "../main/store.js";
import { executeTrainingTool } from "../main/trainingTools.js";
import type { AgentTurnKind } from "../workers/agentPolicy.js";
import type { PiProviderInput } from "../workers/piProvider.js";

/**
 * Spar's real agent worker, hosted by the eval instead of by the app.
 *
 * The worker's entire contact with the outside world is `process.parentPort`:
 * it receives requests on it and posts events, tool calls and results back. So
 * the eval supplies one. Nothing about the worker is stubbed, reimplemented or
 * approximated — the phase controller, the retry ladder, the evidence budget,
 * the tool contract and the prompts are the shipping ones, and this file plays
 * the part the main process plays.
 *
 * Why not spawn it properly? Because `utilityProcess.fork` needs a running
 * Electron app, and an eval that required a window on screen would never run in
 * CI. The trade is worth naming: a hosted worker shares this process's globals,
 * which is the only reason the cassette can swap `fetch` at all — and the
 * alternative, passing a cassette path into the worker through an environment
 * variable, would have meant shipping code that reads one.
 *
 * The one thing this file must never do is answer a question on the worker's
 * behalf. Every tool call goes to `executeTrainingTool` against the eval's real
 * store, exactly as `main.ts` routes it. A shortcut here would be a measurement
 * of the shortcut.
 */

type Pending = { resolve(value: unknown): void; reject(error: Error): void };

export type TurnRequest = {
  sessionId: string;
  message: string;
  context: string;
  turnKind: AgentTurnKind;
  activeQuestion?: { id: string; attemptId: string } | null;
  provider: PiProviderInput;
};

export type TurnResult = { text: string; usage?: unknown; finishReason?: string; phaseSteps?: number };

export type AgentWorker = {
  turn(request: TurnRequest): Promise<TurnResult>;
  close(): void;
};

/**
 * The port, installed once for the life of the process.
 *
 * Once, because the worker reads `process.parentPort` at module scope and keeps
 * it — a second install would leave the loaded worker talking to a port nobody
 * is listening on. Runs are multiplexed over it by request id, which is what the
 * real main process does too.
 */
class ParentPortShim extends EventEmitter {
  readonly outbound = new EventEmitter();
  postMessage(message: unknown): void {
    this.outbound.emit("message", message);
  }
  deliver(message: unknown): void {
    /* The worker reads `event.data`, because that is how Electron's port
       delivers a message. */
    this.emit("message", { data: message });
  }
}

let port: ParentPortShim | null = null;
let loading: Promise<unknown> | null = null;

async function ensureWorker(): Promise<ParentPortShim> {
  if (port) { await loading; return port; }
  port = new ParentPortShim();
  (process as unknown as { parentPort: ParentPortShim }).parentPort = port;
  /* Imported after the port exists, never before: the worker captures it on the
     way in and throws if it is not there. */
  loading = import("../workers/agent.js");
  await loading;
  return port;
}

/**
 * One session's worth of turns, traced.
 *
 * `tool` is not injectable. The point of a live run is to find out what the real
 * host does with what the real model asks for, and a harness that could answer a
 * tool call itself would sooner or later be used to.
 */
export async function openAgentWorker(deps: { store: LocalStore; writer: TraceWriter; onToolResult?: (name: string, input: unknown, value: unknown) => void }): Promise<AgentWorker> {
  const shim = await ensureWorker();
  const pending = new Map<string, Pending>();
  const { writer, store } = deps;
  let step = 0;

  const onMessage = (message: unknown) => {
    const record = message as Record<string, unknown>;
    if (record.kind === "event") { trace(record); return; }
    if (record.kind === "tool-call") { void answerTool(record); return; }
    if (record.kind === "result") {
      const item = pending.get(String(record.id));
      if (!item) return;
      pending.delete(String(record.id));
      if (record.ok) item.resolve(record.value);
      else item.reject(new Error(String(record.error)));
    }
  };
  shim.outbound.on("message", onMessage);

  /** The worker's own event stream, narrowed to the things a verdict depends on.
   *  Prose deltas are dropped: a trace that carried every token would be mostly
   *  tokens, and the text of the reply is recorded once at the end. */
  function trace(record: Record<string, unknown>): void {
    const event = (record.event ?? {}) as Record<string, unknown>;
    if (event.type === "status" && typeof event.detail === "string") {
      const detail = event.detail;
      if (detail.startsWith("phase-step:")) {
        const [, active] = detail.split(";active:");
        step += 1;
        writer.emit({ kind: "stage", step, activeTools: active ? active.split(",").filter((name) => name && name !== "none") : [], toolChoice: "" });
      } else if (detail.startsWith("tool-error:") || detail.startsWith("protocol-retry:") || detail.startsWith("phase-skipped:") || detail.startsWith("context-overflow:")) {
        writer.emit({ kind: "note", text: detail });
      }
      return;
    }
    if (event.type === "tool" && event.phase === "end") {
      writer.emit({
        kind: "tool_result", step, name: String(event.tool ?? ""), ok: event.ok !== false,
        status: event.ok === false ? "refused" : "ok", outputHash: digest(event.output ?? null),
        checks: checksOf(event.output),
      });
      return;
    }
    if (event.type === "tool" && event.phase === "start") {
      writer.emit({ kind: "tool_call", step, name: String(event.tool ?? ""), inputHash: digest(event.input ?? null), input: {} });
      return;
    }
    if (event.type === "error" && typeof event.text === "string") writer.emit({ kind: "error", message: event.text, fatal: false });
  }

  async function answerTool(record: Record<string, unknown>): Promise<void> {
    const name = String(record.name);
    const input = record.input;
    try {
      const value = await executeTrainingTool(name, input as never, record.sessionId as string | undefined, store, undefined as never, undefined as never);
      deps.onToolResult?.(name, input, value);
      shim.deliver({ kind: "tool-result", id: record.id, ok: true, value });
    } catch (error) {
      /* Reported to the worker as a failed tool, not thrown here. A host tool
         that throws is something the agent has to cope with, and coping with it
         is part of what is being measured. */
      shim.deliver({ kind: "tool-result", id: record.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    async turn(request: TurnRequest): Promise<TurnResult> {
      const id = randomUUID();
      writer.emit({ kind: "turn_started", turnKind: request.turnKind, session: request.sessionId });
      const promise = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }));
      shim.deliver({ kind: "request", id, method: "turn", payload: request });
      const value = (await promise) as TurnResult;
      const text = value?.text ?? "";
      writer.emit({ kind: "reply", chars: text.length, textHash: digest(text), text: text.slice(0, 400) });
      writer.emit({ kind: "note", text: `turn finished ${String(value?.finishReason ?? "")} in ${Number(value?.phaseSteps ?? 0)} phases` });
      return value;
    },
    close() {
      shim.outbound.off("message", onMessage);
      for (const item of pending.values()) item.reject(new Error("The eval closed the worker while a turn was still running."));
      pending.clear();
    },
  };
}

/** The host's own verdicts on a tool call, which are the richest label in the
 *  system — the eval scores them rather than second-guessing them. */
function checksOf(output: unknown): Array<{ name: string; passed: boolean; detail: string }> {
  const report = (output as { report?: { checks?: unknown } } | null)?.report;
  const checks = (report as { checks?: unknown } | undefined)?.checks;
  if (!Array.isArray(checks)) return [];
  return checks.map((check) => {
    const row = check as { name?: unknown; passed?: unknown; detail?: unknown };
    return { name: String(row.name ?? ""), passed: row.passed !== false, detail: String(row.detail ?? "") };
  });
}
