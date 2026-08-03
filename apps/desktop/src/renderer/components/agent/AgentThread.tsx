import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import type { SessionDetail } from "@spar/domain";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { ActivityGroup, ChallengePublished, RunFailure, SolveRead } from "./ActivityRow";
import { SystemEvent } from "./SystemEvent";
import { isChallengePublished, type AgentRun, type RunPart } from "./agentRun";

type Message = SessionDetail["messages"][number];

function LiveRun({ run }: { run: AgentRun }) {
  type ToolPart = Extract<RunPart, { kind: "tool" }>;
  type NonToolPart = Exclude<RunPart, { kind: "tool" }>;
  const grouped: Array<
    | NonToolPart
    | { kind: "activity-group"; id: string; parts: ToolPart[] }
    | { kind: "challenge"; id: string; part: ToolPart }
    | { kind: "solve-read"; id: string; part: ToolPart }
  > = [];
  for (const part of run.parts) {
    const previous = grouped.at(-1);
    // A published challenge leaves the group it was produced in. It is the
    // outcome of the turn rather than another step toward it, and folding it
    // back in among the retrieval rows is what made it disappear.
    if (part.kind === "tool" && isChallengePublished(part)) grouped.push({ kind: "challenge", id: `challenge-${part.id}`, part });
    // Reading the solve leaves the group for the same reason: it is what the
    // rest of the turn is a response to.
    else if (part.kind === "tool" && part.tool === "replay_attempt" && part.phase !== "error") grouped.push({ kind: "solve-read", id: `solve-${part.id}`, part });
    else if (part.kind === "tool" && previous?.kind === "activity-group") previous.parts.push(part);
    else if (part.kind === "tool") grouped.push({ kind: "activity-group", id: `group-${part.id}`, parts: [part] });
    else grouped.push(part);
  }
  return (
    <div className="min-w-0 space-y-1.5">
      {grouped.map((part) => {
        if (part.kind === "text") {
          return (
            <div key={part.id} className="min-w-0 px-1.5 text-foreground">
              <Markdown source={part.body} />
            </div>
          );
        }
        if (part.kind === "activity-group") return <ActivityGroup key={part.id} parts={part.parts} />;
        if (part.kind === "challenge") return <ChallengePublished key={part.id} part={part.part} />;
        if (part.kind === "solve-read") return <SolveRead key={part.id} part={part.part} />;
        if (part.kind === "error") return <RunFailure key={part.id} body={part.body} />;
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
  return (
    <div className="flex items-center gap-2 px-1.5 py-0.5">
      <span className="relative grid size-5 place-items-center">
        <span className="absolute inset-0 rounded-full bg-[var(--accent)]/10 blur-sm" />
        <ThinkingOrb aria-label="Thinking" size={20} state="working" style={{ width: 18, height: 18 }} />
      </span>
      <span className="thinking-shimmer min-w-0 truncate text-ui font-medium">Thinking</span>
    </div>
  );
}

function LearnerMessage({ body }: { body: string }) {
  return (
    <div className="flex min-w-0 justify-end">
      <div className="max-w-[85%] min-w-0 break-words rounded-[var(--radius-xl)] bg-[var(--app-user-message-background)] px-3 py-2 text-content leading-[1.55] whitespace-pre-wrap">
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
  // Completion persists the final streamed text before the refreshed session
  // reaches the renderer. Reconcile by content during that narrow hand-off so
  // the durable message and its live precursor can never render twice.
  const streamedText=run?.parts.filter((part)=>part.kind==="text").map((part)=>part.body).join("").trim()??"";
  const lastAgentMessage=[...messages].reverse().find((item)=>item.role==="agent");
  const visibleRun=run&&streamedText&&lastAgentMessage?.body.trim()===streamedText?null:run;

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

  const isEmpty = messages.length === 0 && !visibleRun;

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
                {visibleRun && <LiveRun run={visibleRun} />}
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
