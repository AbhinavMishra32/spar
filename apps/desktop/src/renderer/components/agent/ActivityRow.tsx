import { useState } from "react";
import { BookOpen, Check, ChevronDown, CircleAlert, FilePenLine, Search } from "lucide-react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { activityGroupLabel, diffTotals, safeToolLabel, type RunPart } from "./agentRun";

type ToolPart = Extract<RunPart, { kind: "tool" }>;

function orbFor(tool: string): OrbState {
  if (tool.startsWith("search_") || tool.startsWith("read_") || tool.startsWith("inspect_")) return "searching";
  if (tool === "create_question" || tool === "replace_current_question") return "shaping";
  if (tool === "evaluate_attempt") return "solving";
  if (tool === "ask_user_question") return "listening";
  if (tool.startsWith("set_") || tool.startsWith("propose_") || tool.startsWith("commit_") || tool === "upsert_ability") return "composing";
  return "working";
}

function ToolIcon({ part }: { part: ToolPart }) {
  if (part.phase === "running") return <ThinkingOrb aria-label="Working" size={20} state={orbFor(part.tool)} style={{ width: 16, height: 16 }} />;
  if (part.phase === "error") return <CircleAlert className="size-3.5 text-destructive" />;
  if (part.tool.startsWith("search_")) return <Search className="size-3.5" />;
  if (part.tool.startsWith("read_") || part.tool.startsWith("inspect_")) return <BookOpen className="size-3.5" />;
  if (part.tool === "create_question" || part.tool === "replace_current_question" || part.tool.startsWith("set_") || part.tool.startsWith("propose_") || part.tool.startsWith("commit_") || part.tool === "upsert_ability") return <FilePenLine className="size-3.5" />;
  return <Check className="size-3.5" />;
}

function DiffStat({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) return null;
  return (
    <span className="shrink-0 font-mono text-ui-sm tabular-nums">
      {added > 0 && <span className="text-[var(--success)]">+{added}</span>}
      {added > 0 && removed > 0 && " "}
      {removed > 0 && <span className="text-destructive">-{removed}</span>}
    </span>
  );
}

/** Codex-style activity: one compact, collapsible operation group per phase. */
export function ActivityGroup({ parts }: { parts: ToolPart[] }) {
  const [open, setOpen] = useState(true);
  const running = parts.some((part) => part.phase === "running");
  const failed = parts.some((part) => part.phase === "error");
  const compacted = parts.reduce<Array<{ part: ToolPart; count: number }>>((rows, part) => {
    const previous = rows.at(-1);
    if (previous?.part.tool === part.tool && previous.part.phase === part.phase) {
      previous.part = part;
      previous.count += 1;
    } else rows.push({ part, count: 1 });
    return rows;
  }, []);

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger className="group/activity flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-ui transition-colors hover:bg-accent/60">
        <span className="grid size-4 shrink-0 place-items-center text-muted-foreground">
          {running ? (
            <ThinkingOrb aria-label="Working" size={20} state="working" style={{ width: 16, height: 16 }} />
          ) : failed ? (
            <CircleAlert className="size-3.5 text-destructive" />
          ) : (
            <FilePenLine className="size-3.5" />
          )}
        </span>
        <span className={cn("min-w-0 flex-1 truncate", running ? "text-foreground" : "text-muted-foreground")}>
          {activityGroupLabel(parts)}
        </span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="ml-3 flex min-w-0 flex-col gap-0.5 border-l border-border/70 py-1 pl-3">
          {compacted.map(({ part, count }) => {
            const totals = diffTotals(part.files);
            return (
              <div key={part.id} className="flex min-w-0 items-center gap-2 py-0.5 text-ui text-muted-foreground">
                <span className="grid size-4 shrink-0 place-items-center"><ToolIcon part={part} /></span>
                <span className="min-w-0 flex-1 truncate">
                  {safeToolLabel(part.tool, part.phase === "running", part.phase === "error")}
                  {count > 1 && <span className="ml-1 text-muted-foreground/70">×{count}</span>}
                </span>
                <DiffStat added={totals.added} removed={totals.removed} />
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
