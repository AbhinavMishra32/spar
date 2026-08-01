import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDown } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import type { SessionDetail } from "@pracai/domain";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { ActivityRow } from "./ActivityRow";
import { SystemEvent } from "./SystemEvent";
import { toolVerb, type AgentRun, type RunPart } from "./agentRun";

type Message = SessionDetail["messages"][number];

function LiveRun({ run }: { run: AgentRun }) {
  return (
    <div className="min-w-0 space-y-1.5">
      {run.parts.map((part) => {
        if (part.kind === "text") {
          return (
            <div key={part.id} className="min-w-0 px-1.5 text-foreground">
              <Markdown source={part.body} />
            </div>
          );
        }
        if (part.kind === "tool") return <ActivityRow key={part.id} part={part} />;
        if (part.kind === "error") {
          return (
            <div
              key={part.id}
              className="flex min-w-0 items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-ui text-destructive"
            >
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0 break-words whitespace-pre-wrap">{part.body}</span>
            </div>
          );
        }
        return (
          <div key={part.id} className="min-w-0 truncate px-1.5 text-ui-sm text-muted-foreground/70">
            {part.body}
          </div>
        );
      })}
      {run.status === "streaming" && <ThinkingLine parts={run.parts} />}
    </div>
  );
}

function ThinkingLine({ parts }: { parts: RunPart[] }) {
  const open = [...parts].reverse().find((part) => part.kind === "tool" && part.phase === "running");
  // While a tool is open its own row already animates; this line covers the gaps.
  if (open) return null;
  const lastTool = [...parts].reverse().find((part): part is Extract<RunPart, { kind: "tool" }> => part.kind === "tool");
  const label = lastTool ? `${toolVerb(lastTool.tool, false)} — deciding what is next` : "Thinking";
  return (
    <div className="flex items-center gap-2 px-1.5 py-0.5">
      <ThinkingOrb aria-label="Thinking" size={20} state="working" style={{ width: 16, height: 16 }} />
      <span className="thinking-shimmer min-w-0 truncate text-ui font-medium">{label}</span>
    </div>
  );
}

function LearnerMessage({ body }: { body: string }) {
  return (
    <div className="flex min-w-0 justify-end">
      <div className="max-w-[85%] min-w-0 break-words rounded-[calc(0.8rem*var(--squircle-factor))] bg-[var(--app-user-message-background)] px-3 py-2 text-content leading-[1.55] whitespace-pre-wrap">
        {body}
      </div>
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
    <div className={cn("agent-transcript relative min-h-0 min-w-0 flex-1", className)}>
      {/* overflow-x-hidden: the column never scrolls sideways. Anything genuinely
          wide (a code block) scrolls inside its own box instead. */}
      <div ref={viewport} className="app-scroll h-full overflow-y-auto overflow-x-hidden px-4 pt-3 pb-6">
        <div
          className={cn(
            "transcript-column flex min-h-full min-w-0 flex-col gap-2.5",
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
                    <SystemEvent key={item.id} body={item.body} />
                  ) : (
                    <div key={item.id} className="min-w-0 px-1.5">
                      <Markdown source={item.body} />
                    </div>
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
