import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type RuntimeLog = {
  id: string;
  at: string;
  prefix: "TRAINING" | "TOOL" | "RUNNER" | "VALIDATOR" | "SYNC";
  message: string;
  tone?: "muted" | "success" | "error";
};

const PREFIX_TONE: Record<RuntimeLog["prefix"], string> = {
  TRAINING: "text-foreground/80",
  TOOL: "text-foreground/70",
  RUNNER: "text-muted-foreground",
  VALIDATOR: "text-muted-foreground",
  SYNC: "text-muted-foreground",
};

/** Raw utility-process trace. Deliberately terminal-flavoured: this is evidence, not chat. */
export function RuntimeConsole({ logs, className }: { logs: RuntimeLog[]; className?: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [logs.length]);

  return (
    <div className={cn("app-scroll min-h-0 overflow-y-auto px-3 py-2 font-mono text-ui-sm leading-[1.7]", className)}>
      {logs.length === 0 ? (
        <div className="text-muted-foreground/70">Waiting for the Training Agent utility process…</div>
      ) : (
        logs.map((log) => (
          <div key={log.id} className="grid grid-cols-[4.5rem_5.5rem_minmax(0,1fr)] gap-2">
            <time className="text-muted-foreground/55">{log.at}</time>
            <span
              className={cn(
                "font-medium",
                log.tone === "error" ? "text-destructive" : log.tone === "success" ? "text-[var(--success)]" : PREFIX_TONE[log.prefix],
              )}
            >
              [{log.prefix}]
            </span>
            <span
              className={cn(
                "min-w-0 break-words whitespace-pre-wrap",
                log.tone === "error" ? "text-destructive" : log.tone === "success" ? "text-[var(--success)]" : "text-muted-foreground",
              )}
            >
              {log.message}
            </span>
          </div>
        ))
      )}
      <div ref={end} />
    </div>
  );
}
