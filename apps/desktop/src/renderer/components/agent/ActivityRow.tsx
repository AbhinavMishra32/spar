import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
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
  if (part.phase === "running") return <ThinkingOrb aria-label="Working" size={20} state={orbFor(part.tool)} style={{ width: 15, height: 15 }} />;
  if (part.phase === "error") return <CircleAlert className="size-3.5 text-[var(--warning)]" />;
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

/**
 * A rejected candidate is ordinary progress, not a fault: the compiler refuses
 * a design, the agent revises it, and the next one lands. Showing it in alarm
 * colours made the normal path read as breakage, so the reason is offered as
 * quiet detail the learner can look at rather than an interruption they must.
 */
function StepDetail({ detail }: { detail: string }) {
  const trimmed = detail.replace(/^status invalid · /, "").trim();
  if (!trimmed) return null;
  return (
    <p className="min-w-0 break-words pl-6 text-ui-sm leading-[1.55] text-muted-foreground/65">
      {trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed}
    </p>
  );
}

/** Compact, collapsible operation group — one per phase of the agent's work. */
export function ActivityGroup({ parts }: { parts: ToolPart[] }) {
  const [open, setOpen] = useState(false);
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
    <Collapsible onOpenChange={setOpen} open={open || running}>
      <CollapsibleTrigger className="group/activity flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-ui transition-colors hover:bg-accent/50">
        <span className="grid size-4 shrink-0 place-items-center text-muted-foreground">
          {running ? (
            <ThinkingOrb aria-label="Working" size={20} state="working" style={{ width: 15, height: 15 }} />
          ) : failed ? (
            <CircleAlert className="size-3.5 text-muted-foreground/70" />
          ) : (
            <Check className="size-3.5 text-muted-foreground/70" />
          )}
        </span>
        <span className={cn("min-w-0 flex-1 truncate", running ? "thinking-shimmer text-foreground" : "text-muted-foreground")}>
          {activityGroupLabel(parts)}
        </span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-200", !(open || running) && "-rotate-90")} />
      </CollapsibleTrigger>

      {/* Flush with the trigger on purpose: the rows are the same work seen
          closer up, not a nested structure, so nothing is indented and every
          icon stays in the one gutter the whole transcript aligns to. */}
      <CollapsibleContent>
        <div className="flex min-w-0 flex-col gap-px pt-0.5 pb-1">
          {compacted.map(({ part, count }) => {
            const totals = diffTotals(part.files);
            return (
              <div key={part.id} className="min-w-0">
                <div className="flex min-w-0 items-center gap-2 px-1.5 py-[3px] text-ui text-muted-foreground">
                  <span className="grid size-4 shrink-0 place-items-center text-muted-foreground/70"><ToolIcon part={part} /></span>
                  <span className="min-w-0 flex-1 truncate">
                    {safeToolLabel(part.tool, part.phase === "running", part.phase === "error")}
                    {count > 1 && <span className="ml-1 tabular-nums text-muted-foreground/60">×{count}</span>}
                  </span>
                  <DiffStat added={totals.added} removed={totals.removed} />
                </div>
                {part.phase === "error" && <StepDetail detail={part.detail} />}
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The moment the session exists to reach. A compiled, validated challenge is
 * the agent's whole output, and it used to land as one grey line among the
 * retrieval steps that produced it — so it gets its own arrival instead.
 */
export function ChallengePublished({ part }: { part: ToolPart }) {
  const totals = diffTotals(part.files);
  const replaced = part.tool === "replace_current_question";
  return (
    <motion.div
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      className="relative my-1 min-w-0 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--success)]/25 bg-[var(--success)]/[0.06] px-3 py-2.5"
      initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* One sweep across the card as it lands, then gone. The arrival is worth
          marking; a permanently animated panel would just be noise. */}
      <motion.span
        animate={{ x: "180%" }}
        className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-[var(--success)]/15 to-transparent"
        initial={{ x: "-120%" }}
        transition={{ duration: 1.1, ease: "easeOut", delay: 0.15 }}
      />
      <div className="relative flex min-w-0 items-start gap-2.5">
        <motion.span
          animate={{ scale: 1 }}
          className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-[var(--success)]/15 text-[var(--success)]"
          initial={{ scale: 0.4 }}
          transition={{ type: "spring", stiffness: 420, damping: 18, delay: 0.1 }}
        >
          <Check className="size-3.5" />
        </motion.span>
        <div className="min-w-0 flex-1">
          <p className="text-ui-sm font-medium tracking-wide text-[var(--success)] uppercase">
            {replaced ? "Challenge replaced" : "Challenge ready"}
          </p>
          <p className="mt-0.5 min-w-0 truncate text-content font-medium text-foreground">
            {part.label || "Your next challenge is set"}
          </p>
          <p className="mt-0.5 text-ui text-muted-foreground">
            Validated against its own tests
            {part.files.length > 0 && ` · ${part.files.length} file${part.files.length === 1 ? "" : "s"}`}
            {totals.added > 0 && ` · ${totals.added} lines`}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * A turn that could not finish. The learner needs to know what to do next, so
 * the sentence they can act on leads and the machine detail waits behind a
 * disclosure rather than filling the transcript with a stack of internals.
 */
export function RunFailure({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  const [headline, ...rest] = body.split(/(?:\.\s+|\n)/).filter((line) => line.trim().length > 0);
  const detail = rest.join(" ").trim();
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="my-0.5 min-w-0 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-[var(--color-background-elevated-secondary,var(--card))] px-3 py-2.5"
      initial={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.24 }}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <CircleAlert className="mt-px size-4 shrink-0 text-destructive/80" />
        <div className="min-w-0 flex-1">
          <p className="text-ui font-medium text-foreground">That turn did not finish</p>
          <p className="mt-0.5 min-w-0 break-words text-ui leading-[1.55] text-muted-foreground">
            {headline?.trim().replace(/\.$/, "") ?? "Spar could not complete that turn"}.
          </p>
          {detail && (
            <>
              <button
                className="mt-1.5 inline-flex items-center gap-1 text-ui-sm text-muted-foreground/70 transition-colors hover:text-foreground"
                onClick={() => setOpen((value) => !value)}
                type="button"
              >
                <ChevronDown className={cn("size-3 transition-transform duration-200", !open && "-rotate-90")} />
                {open ? "Hide details" : "Show details"}
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.pre
                    animate={{ height: "auto", opacity: 1 }}
                    className="mt-1.5 overflow-x-auto rounded-lg bg-[var(--accent)] px-2.5 py-2 font-mono text-ui-sm leading-[1.5] text-muted-foreground/90"
                    exit={{ height: 0, opacity: 0 }}
                    initial={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                  >
                    {detail}
                  </motion.pre>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
