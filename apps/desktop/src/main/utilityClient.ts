import { utilityProcess, type UtilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

type EventSink = (value: Record<string, unknown>) => void;

export class UtilityClient {
  private child: UtilityProcess | null = null;
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  constructor(private readonly workerFile: string, private readonly onEvent: EventSink, private readonly onTool?: (name: string, input: unknown, context: { requestId: string; sessionId?: string }) => Promise<unknown>) {}
  request(method: string, payload: unknown) {
    const id = randomUUID();
    const promise = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ensure().postMessage({ kind: "request", id, method, payload });
    return { id, promise };
  }
  stop() { this.child?.kill(); this.child = null; }
  private ensure() {
    if (this.child) return this.child;
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const child = utilityProcess.fork(path.join(dirname, `../workers/${this.workerFile}.js`), [], { serviceName: `Spar ${this.workerFile}` });
    child.on("message", (message: unknown) => void this.handle(message as Record<string, unknown>));
    child.on("exit", (code) => { for (const item of this.pending.values()) item.reject(new Error(`${this.workerFile} exited (${code})`)); this.pending.clear(); this.child = null; });
    this.child = child; return child;
  }
  private async handle(message: Record<string, unknown>) {
    if (message.kind === "event") { this.onEvent(message); return; }
    if (message.kind === "tool-call" && this.onTool) {
      const requestId = String(message.requestId ?? "");
      const name = String(message.name);
      try {
        const value = await this.onTool(name, message.input, { requestId, ...(typeof message.sessionId === "string" ? {sessionId:message.sessionId}: {}) });
        this.child?.postMessage({ kind: "tool-result", id: message.id, ok: true, value });
      }
      catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.child?.postMessage({ kind: "tool-result", id: message.id, ok: false, error: detail });
      }
      return;
    }
    if (message.kind === "result") {
      const item = this.pending.get(String(message.id)); if (!item) return; this.pending.delete(String(message.id));
      if (message.ok) item.resolve(message.value); else item.reject(new Error(String(message.error)));
    }
  }
}
