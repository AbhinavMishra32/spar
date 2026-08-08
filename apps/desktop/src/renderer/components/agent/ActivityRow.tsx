import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, Check, ChevronDown, CircleAlert, FilePenLine, Globe, History, Link2, Search } from "lucide-react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { SourceGlyph } from "../common/SourceGlyph";
import { diffTotals, isSourceTool, toolRowTitle, type RunPart } from "./agentRun";

type ToolPart = Extract<RunPart, { kind: "tool" }>;

function orbFor(tool: string): OrbState {
  if (tool.startsWith("search_") || tool.startsWith("read_") || tool.startsWith("inspect_") || tool === "replay_attempt" || tool.startsWith("web_")) return "searching";
  if (tool === "create_question" || tool === "replace_current_question") return "shaping";
  if (tool === "evaluate_attempt") return "solving";
  if (tool === "ask_user_question") return "listening";
  if (tool.startsWith("set_") || tool.startsWith("propose_") || tool.startsWith("commit_") || tool === "upsert_ability") return "composing";
  return "working";
}

function ToolIcon({ part }: { part: ToolPart }) {
  if (part.phase === "running") return <ThinkingOrb aria-label="Working" size={20} state={orbFor(part.tool)} style={{ width: 15, height: 15 }} />;
  if (part.phase === "error") return <CircleAlert className="size-3.5 text-[var(--warning)]" />;
  /* Anything that reached the practice source is marked with the source's own logo.
     A magnifying glass over "Searching LeetCode for a problem" says the agent
     searched something; the mark says what. Unconditional today because a
     ChallengeSource can only be LeetCode — a second source means carrying which one
     on the row rather than guessing from the tool name. */
  if (isSourceTool(part.tool)) return <SourceGlyph className="size-3.5" source={sourceFor(part)} />;
  /* Going out to the web gets its own mark. Every other row in the transcript is
     the agent reading the learner's own record, and a globe is the one-glance
     difference between "it looked at your attempts" and "it looked outside". */
  if (part.tool === "web_search") return <Globe className="size-3.5" />;
  if (part.tool === "web_fetch") return <Link2 className="size-3.5" />;
  if (part.tool.startsWith("search_")) return <Search className="size-3.5" />;
  if (part.tool.startsWith("read_") || part.tool.startsWith("inspect_")) return <BookOpen className="size-3.5" />;
  if (part.tool === "create_question" || part.tool === "replace_current_question" || part.tool.startsWith("set_") || part.tool.startsWith("propose_") || part.tool.startsWith("commit_") || part.tool === "upsert_ability") return <FilePenLine className="size-3.5" />;
  return <Check className="size-3.5" />;
}

/** What the call did, as one word, in the corner of its panel. */
function StatusPill({ part }: { part: ToolPart }) {
  const rejected = part.phase === "error" && (part.tool === "create_question" || part.tool === "replace_current_question" || part.tool === "create_fallback_question");
  const [text, tone] = part.phase === "running"
    ? ["Running", "text-muted-foreground"]
    : rejected
      ? ["Rejected", "text-[var(--warning)]"]
      : part.phase === "error"
        ? ["Failed", "text-destructive"]
        : ["Success", "text-[var(--success)]"];
  return (
    <span className={cn("shrink-0 rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-ui-sm font-medium", tone)}>{text}</span>
  );
}

/**
 * A fixed-height scroll box whose ends fade toward whatever is out of view.
 *
 * One primitive for the two kinds of unbounded content in a transcript row — the
 * model's thinking and a tool's payload — so both live in the same amount of
 * space, and a thought that streamed inside 1.5in does not suddenly become a
 * screenful the instant it settles.
 *
 * `follow` keeps the newest line in view while content is still arriving. It sets
 * `scrollTop` rather than calling `scrollIntoView`, which looks like the same
 * thing and is not: `scrollIntoView` scrolls every ancestor that can scroll, so
 * each delta also aimed the thread's viewport at this box, the thread's own
 * auto-follow undid it, and the transcript juddered for as long as the model was
 * thinking. A layout effect, so the tail is never painted at the old offset.
 */
function FadedScroll({
  children,
  className,
  follow = false,
  watch,
  uncapped = false,
}: {
  children: React.ReactNode;
  className?: string;
  follow?: boolean;
  /** Changes that mean the content grew, so the fades are re-measured. */
  watch?: unknown;
  /** Released once the reader has asked for the whole thing. */
  uncapped?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<"none" | "top" | "bottom" | "both">("none");

  const measure = useCallback(() => {
    const node = box.current;
    if (!node) return;
    // A rounding slack: a box scrolled to the end is routinely a fraction of a
    // pixel short of it, and a fade that never quite clears reads as a bug.
    const above = node.scrollTop > 1;
    const below = node.scrollTop + node.clientHeight < node.scrollHeight - 1;
    setFade(above && below ? "both" : above ? "top" : below ? "bottom" : "none");
  }, []);

  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    if (follow) node.scrollTop = node.scrollHeight;
    measure();
  }, [follow, measure, watch, uncapped]);

  return (
    <div
      className={cn("agent-scroll app-scroll min-w-0", className)}
      data-fade={fade}
      onScroll={measure}
      ref={box}
      {...(uncapped ? { style: { maxHeight: "none" } } : {})}
    >
      {children}
    </div>
  );
}

/**
 * One labelled block of JSON — what went in, or what came back.
 *
 * Capped like everything else in a row, with the way out being explicit: a
 * payload longer than the box says so and offers the whole thing, rather than
 * leaving the reader to guess from a scrollbar whether there are three more lines
 * or three hundred.
 */
function Payload({ title, body }: { title: string; body: string }) {
  const [full, setFull] = useState(false);
  const trimmed = body.trim();
  if (!trimmed) return null;
  const lines = trimmed.split("\n").length;
  return (
    <div className="min-w-0">
      <p className="px-2.5 pt-2 pb-1 text-ui-sm font-medium tracking-wide text-muted-foreground/70 uppercase">{title}</p>
      <FadedScroll uncapped={full} watch={body}>
        <pre className="px-2.5 pb-2 font-mono text-ui-sm leading-[1.5] whitespace-pre text-muted-foreground/90">{trimmed}</pre>
      </FadedScroll>
      {lines > 8 && (
        <button
          className="mx-2.5 mb-2 cursor-default rounded-md bg-[var(--accent)] px-2 py-1 font-mono text-ui-sm text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setFull((value) => !value)}
          type="button"
        >
          {full ? "Collapse output" : `Show full output · ${lines} lines`}
        </button>
      )}
    </div>
  );
}

/**
 * The call, opened up: its arguments and its result.
 *
 * The transcript used to name each call and stop there — deliberately, on the
 * grounds that arguments are raw internals. But a tutor that says "searched your
 * history" and will not say what for is asking to be taken on faith, and the
 * learner is the one whose record it searched. Everything is shown except the
 * parts of a challenge design that are its answer, which the worker has already
 * replaced with a note saying so before this ever sees them.
 */
export function ToolRow({ part, linked = false }: { part: ToolPart; linked?: boolean }) {
  const [open, setOpen] = useState(false);
  const hasPayload = Boolean(part.input.trim() || part.output.trim());
  const totals = diffTotals(part.files);
  const running = part.phase === "running";

  const row = (
    <>
      {/* Joins this step to the one above it, up the middle of the icon column.
          Without it a tight cluster is just rows that happen to be near each
          other; with it, it reads as one sequence of work. Sized to exactly the
          margin above the row, so it can never reach over the text either side. */}
      {linked && (
        <span
          aria-hidden
          className="absolute w-px bg-border/60"
          style={{ left: ICON_CENTER, top: `-${LINKED_GAP}`, height: LINKED_GAP }}
        />
      )}
      <span className="grid size-4 shrink-0 place-items-center text-muted-foreground/70"><ToolIcon part={part} /></span>
      <span className={cn("min-w-0 truncate", running && "thinking-shimmer text-foreground")}>
        {toolRowTitle(part)}
        {took(part) && <span className="ml-1.5 tabular-nums text-muted-foreground/50">{took(part)}</span>}
      </span>
      <DiffStat added={totals.added} removed={totals.removed} />
      {/* Only when it did not simply work. A row of green "Success" badges down a
          transcript is noise; the one that says Error is the one worth seeing. */}
      {part.phase === "error" && <StatusPill part={part} />}
      {hasPayload && <Caret open={open} />}
    </>
  );

  if (!hasPayload) return <div className={cn(ROW, "text-muted-foreground")}>{row}</div>;

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger className={cn(ROW, TRIGGER)}>{row}</CollapsibleTrigger>
      <CollapsibleContent>
        {/* A rule from the row down past the panel, and the panel indented off it.
            The line is what ties an opened call to the row that opened it once the
            card is tall enough that they are no longer adjacent on screen. */}
        <div className="flex min-w-0 gap-2.5 pb-1" style={{ paddingLeft: ROW_INSET }}>
          <span aria-hidden className="w-px shrink-0 bg-border/70" />
          <div className="min-w-0 flex-1 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-[var(--color-background-elevated-secondary,var(--card))]">
            <Payload body={part.input} title="Input" />
            {part.input.trim() && part.output.trim() && <div className="mx-2.5 border-t border-border/60" />}
            <Payload body={part.output} title="Result" />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A disclosure row, and the mark that opens it.
 *
 * Both exist because these rows are not buttons. They were built as full-width
 * targets with a hover fill and the chevron pinned to the far right, which turns
 * every step of the agent's work into a control the eye has to dismiss — and put
 * the chevron so far from the words it belonged to that it read as page furniture.
 * A line of text with a caret tucked against its end is the whole affordance:
 * `inline-flex` and no `flex-1` are what keep the row as wide as its content
 * instead of as wide as the thread.
 */
/* One row of the transcript, at the reference's rhythm: a ~26px row box, so two
   clustered steps land on a 32px pitch once the joining gap is added. The padding
   is small on purpose — the space between steps is what separates them, and paying
   for it twice is what spread a run of five calls over half a screen. */
const ROW = "relative inline-flex w-fit min-w-0 max-w-full items-center gap-2.5 px-1.5 py-[3px] text-left text-ui";
/* `cursor-default` for the same reason the sidebar sets it: AppKit shows the arrow
   over a list of rows, never the hand, and the pointer cursor is the clearest tell
   that a desktop app was built in a browser. These rows are a list, not controls. */
const TRIGGER = "group/row cursor-default rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground";
/** The row's own horizontal inset, which anything hanging beneath a row aligns to. */
const ROW_INSET = "0.375rem";
/** Down the middle of the icon column: the row's inset plus half an icon. Where the
 *  rule joining one step to the next is drawn. */
export const ICON_CENTER = "0.875rem";
/** The gap between two steps of the same run of work, and therefore exactly the
 *  height of the rule that joins them. Exported so the row that sets the margin
 *  and the rule that fills it cannot drift apart. */
export const LINKED_GAP = "0.375rem";
/** A step that opens a new run of work, and a paragraph of prose. Prose gets the
 *  most room of anything in a turn: the contrast between a tight cluster of steps
 *  and a sentence with air around it is what makes a long turn scannable. */
export const STEP_GAP = "0.5rem";
export const PROSE_GAP = "0.875rem";
/** Exactly where a row's label starts: the inset, plus the icon, plus the gap
 *  after it. A note under a row uses this so it lines up with the words it belongs
 *  to rather than nearly lining up with them. */
const UNDER_LABEL = "1.9375rem";

/**
 * The mark that opens a row, kept out of the way until it is wanted.
 *
 * Hidden at rest: a transcript is a dozen of these down the page, and a caret on
 * every line is a dozen pieces of furniture around the words that matter. It fades
 * in under the cursor, and stays up while the row is open or focused — an open row
 * with no caret has nothing to say how it closes, and a keyboard user never
 * generates the hover that would reveal it.
 *
 * Faded rather than removed from the layout, because the row is only as wide as its
 * content: taking the caret out of the flow would resize the row on hover.
 *
 * The negative margin pulls it back in from the row's own gap. That gap is set for
 * the distance between an icon and a sentence, which is far too much between a
 * sentence and the small mark that belongs to it.
 */
function Caret({ open }: { open: boolean }) {
  return (
    <ChevronDown
      className={cn(
        "-ml-1.5 size-3.5 shrink-0 text-muted-foreground/50 opacity-0 transition-[transform,opacity] duration-200",
        "group-hover/row:opacity-100 group-focus-visible/row:opacity-100",
        open && "opacity-100",
        !open && "-rotate-90",
      )}
    />
  );
}

/** How long a settled call took. Absent for a stored row, which does not keep
 *  timings, and for anything under a second, where the number is noise. */
function took(part: ToolPart): string {
  if (part.phase === "running" || !part.startedAt || !part.endedAt) return "";
  const seconds = (part.endedAt - part.startedAt) / 1_000;
  return seconds < 1 ? "" : `in ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
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
    <p className="min-w-0 break-words text-ui-sm leading-[1.55] text-muted-foreground/65" style={{ paddingLeft: UNDER_LABEL }}>
      {trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed}
    </p>
  );
}

/**
 * The model's own reasoning, live.
 *
 * While it is arriving the text is shown as it comes, following its own tail so
 * the newest line is the one in view — the point is that the learner can watch it
 * think, not read a finished essay. Once it settles it folds to one line saying
 * how long it took, because a transcript of a long session should be readable and
 * the thinking is still there to open.
 *
 * This replaced a fixed "Thinking" label with a spinner. That label was not
 * standing in for anything: the reasoning deltas were arriving all along and
 * being dropped as protocol noise before they reached the transcript.
 */
export function Reasoning({ part }: { part: Extract<RunPart, { kind: "reasoning" }> }) {
  const sections = thoughts(part.body);
  const seconds = Math.max(1, Math.round(((part.endedAt ?? Date.now()) - part.startedAt) / 1_000));

  /* Live: the heading the model is under right now, with its prose following it.
     Only the tail is shown, because the point while it runs is watching where the
     thinking has got to rather than reading all of it — and it is shown inside the
     same box the settled thought will use, so nothing reflows when it closes. */
  if (part.open) {
    const current = sections.at(-1);
    return (
      <div className="min-w-0 px-1.5">
        <div className="flex items-center gap-2 py-0.5">
          <ThinkingOrb aria-label="Thinking" size={20} state="solving" style={{ width: 15, height: 15 }} />
          <span className="thinking-shimmer min-w-0 truncate text-ui font-medium">{current?.title ?? "Thinking"}</span>
        </div>
        {current?.body && (
          <FadedScroll follow watch={part.body}>
            <p className="border-l border-border/70 pl-2.5 text-ui-sm leading-[1.6] text-muted-foreground/70">
              {current.body}
            </p>
          </FadedScroll>
        )}
      </div>
    );
  }

  if (!sections.length) return null;
  /* Settled: one row per heading the model gave its own thinking, which is what
     makes a long turn readable — "Resolving the language conflict" says something,
     and seven rows of "Thought for 9s" say nothing. */
  return (
    <div className="min-w-0">
      {sections.map((section, index) => (
        <div key={`${part.id}-${index}`} className="min-w-0" {...(index > 0 ? { style: { marginTop: LINKED_GAP } } : {})}>
          {/* Several headings from one block of thinking are one cluster, spaced
              like consecutive steps rather than like separate paragraphs. */}
          <Thought body={section.body} title={section.title ?? `Thought for ${seconds}s`} />
        </div>
      ))}
    </div>
  );
}

/**
 * A settled thought: its own heading, and the thinking behind it.
 *
 * No icon, and no space held where one used to be. A brain glyph on every one of
 * these was decoration — the row already says "Thought for 9s" — but removing it
 * and keeping its gutter was worse than either: the text sat indented under a
 * blank column, which reads as a nested child of the row above rather than as a
 * step beside it. The thought starts at the margin.
 */
function Thought({ title, body }: { title: string; body: string }) {
  const [open, setOpen] = useState(false);
  if (!body) return <div className={cn(ROW, "text-muted-foreground")}><span className="min-w-0 truncate">{title}</span></div>;
  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger className={cn(ROW, TRIGGER)}>
        <span className="min-w-0 truncate">{title}</span>
        <Caret open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* Same height it had while it streamed. A thought that filled 1.5in and
            then expanded to a screenful on settling would reflow the thread under
            the reader at the exact moment they started reading it. */}
        <FadedScroll className="mx-1.5 mb-1">
          <p className="border-l border-border/70 pl-2.5 text-ui-sm leading-[1.6] text-muted-foreground/75">{body}</p>
        </FadedScroll>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Reasoning summaries arrive as `**A heading**` followed by prose, several to a
 * block. Those headings are the model's own account of what it is doing, so they
 * become the rows — and the markup is removed rather than shown, which is what
 * put literal asterisks in the transcript.
 */
function thoughts(body: string): Array<{ title?: string; body: string }> {
  const sections: Array<{ title?: string; body: string }> = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let cursor = 0;
  for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
    const before = clean(body.slice(cursor, match.index));
    if (before) {
      const open = sections.at(-1);
      if (open) open.body = clean(`${open.body} ${before}`);
      else sections.push({ body: before });
    }
    sections.push({ title: clean(match[1] ?? ""), body: "" });
    cursor = match.index + match[0].length;
  }
  const rest = clean(body.slice(cursor));
  if (rest) {
    const open = sections.at(-1);
    if (open) open.body = clean(`${open.body} ${rest}`);
    else sections.push({ body: rest });
  }
  return sections.filter((section) => section.title || section.body);
}

/** Reasoning is emitted with hard wraps and blank runs that read as gaps in the
 *  transcript. The words are what matter here, so the whitespace is normalised. */
function clean(value: string): string {
  return value.replace(/\*\*/g, "").replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Spar reading how the challenge was actually solved.
 *
 * This is the step the rest of the turn is built on, and the learner should be
 * able to see it happen: what it looked at, and what it found in their own
 * attempt. It is deliberately not a retrieval row — "read your solve" is a
 * statement about them, and it is the difference between a tutor that saw the
 * verdict and one that watched the work.
 */
export function SolveRead({ part }: { part: ToolPart }) {
  const running = part.phase === "running";
  return (
    <div className={cn(ROW, "text-muted-foreground")}>
      <span className="grid size-4 shrink-0 place-items-center text-muted-foreground/70">
        {running
          ? <ThinkingOrb aria-label="Reading your solve" size={20} state="searching" style={{ width: 15, height: 15 }} />
          : <History className="size-3.5" />}
      </span>
      <span className={cn("min-w-0 truncate", running && "thinking-shimmer text-foreground")}>
        {running ? "Reading your solve" : "Read your solve"}
      </span>
      {/* What the replay found, on the same line. It used to be a stack of chips
          built by splitting the label on an em dash — a shape that broke the day
          that field started carrying the agent's own title for the step. */}
      {!running && part.detail && (
        <span className="min-w-0 truncate text-muted-foreground/60">{part.detail}</span>
      )}
    </div>
  );
}

/**
 * The moment the session exists to reach.
 *
 * Still the one row that is allowed to draw the eye, because it is the turn's
 * output rather than a step toward it — but a row, not a panel. It was a bordered
 * green card with an uppercase kicker, a chip, a spring-scaled badge and a light
 * sweep across it, which was defensible when the rows around it were dense grey
 * lines and is not now that they are a clean list: it read as a component from a
 * different application that had been pasted into the transcript. The colour on
 * the check and the weight on the title carry it.
 */
export function ChallengePublished({ part }: { part: ToolPart }) {
  const replaced = part.tool === "replace_current_question";
  /* A problem from the source is not "validated" — nothing was compiled, because
     nobody wrote it. What it carries instead is the source's own judge, and the mark
     is how that reads at a glance. */
  const sourced = part.tool === "assign_practice_problem";
  const source = sourceFor(part);
  const sourceName = source === "codeforces" ? "Codeforces" : "LeetCode";
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(ROW, "text-muted-foreground")}
      initial={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <span className={cn("grid size-4 shrink-0 place-items-center", sourced ? "text-foreground/80" : "text-[var(--success)]")}>
        {sourced ? <SourceGlyph className="size-3.5" source={source} /> : <Check className="size-3.5" />}
      </span>
      <span className="min-w-0 truncate">
        <span className="font-medium text-foreground">{part.label || (sourced ? "Problem set" : replaced ? "Challenge replaced" : "Challenge ready")}</span>
        <span className="ml-1.5 text-muted-foreground/60">
          {sourced ? `· from ${sourceName} · judged there` : replaced ? "· replaced · validated" : "· validated"}
        </span>
      </span>
    </motion.div>
  );
}

function sourceFor(part: ToolPart): "leetcode" | "codeforces" {
  const text = `${part.input} ${part.output} ${part.detail} ${part.label} ${part.actionTitle}`.toLowerCase();
  return text.includes("codeforces") || text.includes('"source":"codeforces"') ? "codeforces" : "leetcode";
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
