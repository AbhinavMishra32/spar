import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  Check,
  ChevronRight,
  CircleDashed,
  FlaskConical,
  FolderTree,
  Hammer,
  Loader2,
  Search,
  Sparkles,
  Terminal,
} from "lucide-react";
import type { SessionDetail } from "@pracai/domain";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { toolLabel, type AgentRun, type RunPart, type ToolPhase } from "./agentRun";

type Message = SessionDetail["messages"][number];

/** Tool families get a glyph so a long run stays scannable. */
function toolIcon(tool: string) {
  const key = tool.toLowerCase();
  if (key.includes("search") || key.includes("retrieve") || key.includes("history")) return Search;
  if (key.includes("test") || key.includes("validate") || key.includes("check")) return FlaskConical;
  if (key.includes("file") || key.includes("workspace") || key.includes("write")) return FolderTree;
  if (key.includes("run") || key.includes("exec") || key.includes("command")) return Terminal;
  if (key.includes("generate") || key.includes("compile") || key.includes("build")) return Hammer;
  return Sparkles;
}

function PhaseMark({ phase }: { phase: ToolPhase }) {
  if (phase === "running") return <Loader2 className="size-3 animate-spin text-muted-foreground" />;
  if (phase === "error") return <AlertTriangle className="size-3 text-destructive" />;
  return <Check className="size-3 text-[var(--success)]" />;
}

function ToolRow({ part }: { part: Extract<RunPart, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(part.tool);
  const detail = part.detail.replace(/^(done|error)\s*/, "").trim();

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-lg border border-border bg-[var(--color-background-elevated-secondary)] transition-colors",
        detail && "hover:bg-accent/60",
      )}
    >
      <button
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
        disabled={!detail}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-md border border-border bg-[var(--color-background-surface)] text-muted-foreground">
          <Icon className="size-3" />
        </span>
        {/* The tool name never truncates; the detail preview absorbs the squeeze. */}
        <span className="shrink-0 text-ui font-medium">{toolLabel(part.tool)}</span>
        {detail && !open && (
          <span className="min-w-0 flex-1 truncate text-right font-mono text-ui-sm text-muted-foreground">{detail}</span>
        )}
        {(!detail || open) && <span className="flex-1" />}
        <PhaseMark phase={part.phase} />
        {detail && (
          <ChevronRight className={cn("size-3 text-muted-foreground transition-transform", open && "rotate-90")} />
        )}
      </button>
      {open && detail && (
        <pre className="app-scroll max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-border/70 px-2.5 py-2 font-mono text-ui-sm text-muted-foreground">
          {detail}
        </pre>
      )}
    </div>
  );
}

function LiveRun({ run }: { run: AgentRun }) {
  return (
    <div className="space-y-2">
      {run.parts.map((part) => {
        if (part.kind === "text") {
          return (
            <div key={part.id} className="text-foreground">
              <Markdown source={part.body} />
            </div>
          );
        }
        if (part.kind === "tool") return <ToolRow key={part.id} part={part} />;
        if (part.kind === "error") {
          return (
            <div
              key={part.id}
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-ui text-destructive"
            >
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0 whitespace-pre-wrap">{part.body}</span>
            </div>
          );
        }
        return (
          <div key={part.id} className="flex items-center gap-2 text-ui text-muted-foreground">
            <CircleDashed className="size-3 animate-spin [animation-duration:2.4s]" />
            <span>{part.body}</span>
          </div>
        );
      })}
      {run.status === "streaming" && <ThinkingLine parts={run.parts} />}
    </div>
  );
}

function ThinkingLine({ parts }: { parts: RunPart[] }) {
  const openTool = [...parts].reverse().find((part) => part.kind === "tool" && part.phase === "running");
  const label = openTool && openTool.kind === "tool" ? `${toolLabel(openTool.tool)}…` : "Thinking…";
  return <div className="thinking-shimmer text-ui font-medium">{label}</div>;
}

function LearnerMessage({ body }: { body: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-[calc(0.8rem*var(--squircle-factor))] bg-[var(--app-user-message-background)] px-3 py-2 text-content leading-[1.55] whitespace-pre-wrap">
        {body}
      </div>
    </div>
  );
}

function SystemMessage({ body }: { body: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-ui-sm text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      <span className="shrink-0">{body}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function AgentThread({
  messages,
  run,
  header,
  empty,
  className,
}: {
  messages: Message[];
  run: AgentRun | null;
  header?: React.ReactNode;
  empty?: React.ReactNode;
  className?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  // Auto-follow only while the learner is already at the live edge, so scrolling
  // back to re-read an earlier explanation is not yanked away mid-stream.
  useLayoutEffect(() => {
    if (!pinned) return;
    const node = viewport.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, run, pinned]);

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const onScroll = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      setPinned(distance < 48);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  const isEmpty = messages.length === 0 && !run;

  return (
    <div className={cn("agent-transcript relative min-h-0 flex-1", className)}>
      <div ref={viewport} className="app-scroll h-full overflow-y-auto px-4 pt-3 pb-6">
        {/* Short threads sit against the composer rather than floating at the top. */}
        <div
          className={cn(
            "transcript-column flex min-h-full flex-col space-y-3",
            isEmpty ? "justify-center" : "justify-end",
          )}
        >
          {header}
          {isEmpty
            ? empty
            : (
              <>
                {messages.map((item) =>
                  item.role === "learner" ? (
                    <LearnerMessage key={item.id} body={item.body} />
                  ) : item.role === "system" ? (
                    <SystemMessage key={item.id} body={item.body} />
                  ) : (
                    <Markdown key={item.id} source={item.body} />
                  ),
                )}
                {run && <LiveRun run={run} />}
              </>
            )}
        </div>
      </div>

      {!pinned && (
        <button
          className="app-no-drag absolute bottom-3 left-1/2 grid size-7 -translate-x-1/2 place-items-center rounded-full border border-border bg-popover text-muted-foreground shadow-[var(--app-shadow-overlay)] transition hover:text-foreground"
          onClick={() => {
            setPinned(true);
            const node = viewport.current;
            if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
          }}
          title="Jump to latest"
          type="button"
        >
          <ArrowDown className="size-3.5" />
        </button>
      )}
    </div>
  );
}
