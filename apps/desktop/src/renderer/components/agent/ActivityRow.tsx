import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronRight, X } from "lucide-react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { cn } from "@/lib/utils";
import { diffTotals, toolVerb, type RunPart } from "./agentRun";

type ToolPart = Extract<RunPart, { kind: "tool" }>;

/** Each tool family gets the orb state that matches what it is actually doing. */
function orbFor(tool: string): OrbState {
  if (tool.startsWith("search_")) return "searching";
  if (tool.startsWith("read_") || tool.startsWith("inspect_")) return "searching";
  if (tool === "create_question") return "shaping";
  if (tool === "evaluate_attempt") return "solving";
  if (tool === "ask_user_question") return "listening";
  if (tool.startsWith("set_") || tool.startsWith("propose_") || tool.startsWith("commit_")) return "composing";
  return "working";
}

function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 font-mono text-ui-sm tabular-nums">
      {added > 0 && <span className="text-[var(--success)]">+{added}</span>}
      {added > 0 && removed > 0 && " "}
      {(removed > 0 || added === 0) && <span className="text-destructive">-{removed}</span>}
    </span>
  );
}

/**
 * One unit of agent work. Deliberately a row rather than a card — a long turn is
 * a readable list of what happened, not a stack of boxes.
 */
export function ActivityRow({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const running = part.phase === "running";
  const rejectedCandidate = part.tool === "create_question" && part.phase === "error" && part.detail.startsWith("status invalid");
  const totals = diffTotals(part.files);
  const expandable = part.files.length > 0 || Boolean(part.detail);

  return (
    <div className="min-w-0">
      <button
        className={cn(
          "group/row flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors",
          expandable && "hover:bg-accent/60",
        )}
        disabled={!expandable}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="grid size-4 shrink-0 place-items-center">
          {running ? (
            <span className="relative grid size-5 place-items-center">
              <span className="absolute inset-0 rounded-full bg-[var(--accent)]/10 blur-sm" />
              <ThinkingOrb aria-label="Working" size={20} state={orbFor(part.tool)} style={{ width: 18, height: 18 }} />
            </span>
          ) : part.phase === "error" ? (
            <X className="size-3 text-destructive" />
          ) : (
            <Check className="size-3 text-[var(--success)]" />
          )}
        </span>

        <span className={cn("shrink-0 text-ui", running ? "text-foreground" : "text-muted-foreground")}>
          {toolVerb(part.tool, running, rejectedCandidate)}
        </span>

        {part.label && (
          <span className="min-w-0 flex-1 truncate text-ui text-foreground/80">{part.label}</span>
        )}
        {!part.label && <span className="flex-1" />}

        {part.files.length > 0 && <DiffStat added={totals.added} removed={totals.removed} />}

        {expandable && (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground/50 transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && expandable && (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className="ml-[1.65rem] space-y-px border-l border-border/70 py-1 pl-2.5">
              {part.files.map((file) => (
                <div key={file.path} className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-muted-foreground">{file.path}</span>
                  <DiffStat added={file.added} removed={file.removed} />
                </div>
              ))}
              {part.detail && (
                <p className="break-words font-mono text-ui-sm text-muted-foreground/80">{part.detail}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Files stream in as the agent writes them, so the collapsed summary shows the
 * running total the moment a create_question call reports its design.
 */
export function ActivityGroupSummary({ parts }: { parts: ToolPart[] }) {
  const files = parts.flatMap((part) => part.files);
  if (!files.length) return null;
  const totals = diffTotals(files);
  return (
    <div className="flex items-center gap-2 px-1.5 text-ui-sm text-muted-foreground">
      <span>
        {files.length} file{files.length === 1 ? "" : "s"}
      </span>
      <DiffStat added={totals.added} removed={totals.removed} />
    </div>
  );
}
