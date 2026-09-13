import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { IconAlert, IconBook, IconCheck, IconCode, IconChevronRight, IconChip, IconDossier, IconDot, IconEdit, IconFile, IconFolder, IconGlobe, IconHistory, IconLightning, IconList, IconPlay, IconPuzzle, IconQuestion, IconSearch, IconSparkle, IconTerminal } from "./threadIcons";
import { ToolDetail } from "./ToolDetail";
import { toolSubject } from "./toolSubject";
import { thoughts } from "./thoughts";
import { useMarkdownLinks } from "./MarkdownLinks";
import { FadedScroll, RawPayload } from "./ToolPayload";
import { SourceGlyph } from "../common/SourceGlyph";
import { diffTotals, isSourceTool, toolRowTitle, type ReasoningPart, type RunPart } from "./agentRun";

type ToolPart = Extract<RunPart, { kind: "tool" }>;

/**
 * Which orb a running step spins.
 *
 * Nine states ship, and a transcript that used three of them was throwing away
 * the only thing the orb is for: telling the reader, before any text is read,
 * what kind of work is under way. Going out to the network does not look like
 * reading a file, and recording what someone understands does not look like
 * either. Names are matched both hyphenated and underscored because the
 * transcript carries tools from v0.7 as well as Construct's own.
 */
function orbFor(tool: string): OrbState {
  const name = tool.replace(/-/g, "_");
  /* Out to the internet: the wires, not the globe. */
  if (name.startsWith("web_") || name.startsWith("fetch_") || name.startsWith("sync_")) return "connecting";
  if (name.startsWith("search_") || name.startsWith("read_") || name.startsWith("inspect_") || name.startsWith("list_") || name.startsWith("grep") || name === "replay_attempt") return "searching";
  if (name.startsWith("write_") || name.startsWith("edit_") || name.startsWith("apply_") || name.startsWith("create_file")) return "shaping";
  if (name === "create_question" || name === "replace_current_question" || name.startsWith("plan_") || name.startsWith("path")) return "weaving";
  if (name === "evaluate_attempt" || name.startsWith("run_") || name.startsWith("terminal") || name.startsWith("shell")) return "solving";
  if (name === "ask_user_question") return "listening";
  if (name.startsWith("record_") || name.startsWith("upsert_") || name.startsWith("flow_memory") || name.startsWith("remember")) return "breathing";
  if (name.startsWith("set_") || name.startsWith("propose_") || name.startsWith("commit_") || name.startsWith("update_")) return "composing";
  return "working";
}

/**
 * What a step did, as a mark.
 *
 * Every row used to end here with a tick, and the reason is worth recording:
 * the cases below tested v0.7's underscored tool names — `read_`, `search_` —
 * and Construct's tools are hyphenated, so not one of them ever matched. A
 * transcript of identical green ticks says only "something happened", which is
 * the one thing the reader already knows.
 *
 * Solid, not stroked. See `threadIcons` for why: at 16px a stroked glyph beside
 * 14px text is a smudge, and no stroke weight fixes it — filled shapes are what
 * hold a silhouette this small, and what make the marks read as one column
 * rather than as noise beside the words.
 */
const MARK = "size-4";

function ToolIcon({ part }: { part: ToolPart }) {
  if (part.phase === "running") return <ThinkingOrb aria-label="Working" size={20} state={orbFor(part.tool)} style={{ width: 15, height: 15 }} />;
  if (part.phase === "error") return <IconAlert className={cn(MARK, "text-[var(--warning)]")} />;
  /* Anything that reached the practice source is marked with the source's own logo.
     A magnifying glass over "Searching LeetCode for a problem" says the agent
     searched something; the mark says what. */
  if (isSourceTool(part.tool)) return <SourceGlyph className="size-4" source={sourceFor(part)} />;

  switch (part.tool) {
    /* Going out to the web gets its own mark. Every other row in the transcript
       is the agent reading the learner's own project, and a globe is the
       one-glance difference between "it read your files" and "it read the internet". */
    case "web-search":
    case "web_search":
      return <IconSearch className={MARK} />;
    case "web-fetch":
    case "web_fetch":
      return <IconGlobe className={MARK} />;
    case "read-file":
      return <IconFile className={MARK} />;
    case "write-file":
      return <IconEdit className={MARK} />;
    /* Memory is marked as notes, not as files. A page-and-pen next to "Updated
       memory" reads as another write into the learner's source tree; what
       actually changed is Construct's own notebook about them. */
    case "flow-memory-fetch":
      return <IconChip className={MARK} />;
    case "flow-memory-patch":
      return <IconDossier className={MARK} />;
    case "list-files":
      return <IconFolder className={MARK} />;
    case "run-terminal-command":
      return <IconTerminal className={MARK} />;
    case "record-concept":
      return <IconBook className={MARK} />;
    case "plan-learning-path":
      return <IconSparkle className={MARK} />;
    case "set-practice-task":
      return <IconList className={MARK} />;
    case "judge-practice-task":
      return <IconCheck className={MARK} />;
    /* A wrench over "Asked a question" said a tool ran. This row is a turn of
       conversation, and it is marked as one. */
    case "ask_user_question":
    case "ask-user-question":
      return <IconQuestion className={MARK} />;

    /* Spar's own tools. Every one of these was falling through to the neutral
       dot below, so a turn spent in the visualiser drew six identical grey
       bullets — a column with no shape to it, where the mark is supposed to be
       the thing you read before the words. They are marked by what the learner
       watched happen, not by which module the tool lives in: running code,
       looking through a run, reading one instant of it, drawing the picture. */
    case "open_visualizer":
    case "visualize_run":
      return <IconPlay className={MARK} />;
    case "visualize_find":
      return <IconSearch className={MARK} />;
    case "visualize_read_step":
      return <IconList className={MARK} />;
    case "visualize_explain":
      return <IconSparkle className={MARK} />;
    /* A challenge is the thing the learner is handed, and the mark says so
       whether it was written, replaced, or fell back to a stock one. */
    case "create_question":
    case "replace_current_question":
    case "create_fallback_question":
    case "assign_practice_problem":
      return <IconPuzzle className={MARK} />;
    /* Reading what they wrote. It comes back with their file in it now, so the
       mark is their code rather than the neutral page every `read_` fell to. */
    case "inspect_current_attempt":
    case "read_attempt":
      return <IconCode className={MARK} />;
    case "replay_attempt":
      return <IconHistory className={MARK} />;
    case "evaluate_attempt":
      return <IconCheck className={MARK} />;
    case "upsert_ability":
    case "propose_ability_update":
    case "read_ability":
      return <IconBook className={MARK} />;
    case "read_concept_graph":
    case "search_concept_evidence":
      return <IconChip className={MARK} />;
    case "commit_session_decision":
      return <IconLightning className={MARK} />;
    default:
      break;
  }

  if (part.tool.startsWith("search_") || part.tool.startsWith("search-")) return <IconSearch className={MARK} />;
  if (part.tool.startsWith("read_") || part.tool.startsWith("inspect_")) return <IconFile className={MARK} />;
  if (part.tool.startsWith("set_") || part.tool.startsWith("propose_") || part.tool.startsWith("commit_")) return <IconEdit className={MARK} />;
  /* Neutral, and deliberately not a tick: a tool that ran is not a tool that
     succeeded at anything the reader cares about. */
  return <IconDot />;
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
    <span className={cn("shrink-0 rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-thread font-medium", tone)}>{text}</span>
  );
}

/**
 * What the call was, and what it was about.
 *
 * `Read main.py` rather than `Read a file`. A column of bare verbs says the
 * agent did five things and nothing about which, so the only way to find the
 * one that matters was to open all five.
 *
 * A path is underlined and opens the file: the row names something real, and
 * the thing you do after seeing it is look at it. The short name is shown and
 * the full path is the title, because two `index.ts` in one project are only
 * told apart by the directories a row has no width for.
 */
function ToolTitle({ part }: { part: ToolPart }) {
  const { onOpenFile } = useMarkdownLinks();
  const running = part.phase === "running";
  const subject = toolSubject(part.tool, part.input, running);
  if (!subject) return <>{toolRowTitle(part)}</>;

  return (
    <>
      {subject.verb}{" "}
      {subject.path ? (
        <span
          className={cn(
            "cursor-default underline decoration-dotted underline-offset-2",
            /* Darker only under the pointer that is about to open it, and never
               while the row is shimmering: the sweep is a background clipped to
               the text, and a child that sets `color` renders opaque and sits
               dead in the middle of it. */
            !running && "hover:text-foreground",
          )}
          onClick={(event) => {
            /* The row itself is a disclosure; opening the file must not also
               toggle the panel under it. */
            event.stopPropagation();
            onOpenFile?.(subject.path!);
          }}
          title={subject.path}
        >
          {subject.subject}
        </span>
      ) : (
        /* No colour of its own. The subject used to be printed darker than the
           verb in front of it, which made every settled row a two-tone line and
           a column of them a stripe of dark words with grey ones between. The
           whole row is grey, and the whole row goes dark together on hover. */
        <span>{subject.subject}</span>
      )}
    </>
  );
}

/**
 * One step of a turn: its mark, what it did, and what it did it to.
 *
 * The mark sits in a column of its own rather than inside the label, and that
 * column is the thread. The line under a mark is a flex child that fills
 * whatever height is left in the row's block, so a row that opens does not
 * *add* a line beside its panel: the line it already had grows, because the
 * block it is measured against got taller. Two rows in the same run of work
 * meet with no seam because the space between them is padding inside the upper
 * block, which the line runs through, and the lower block opens with the short
 * lead-in above its own mark.
 *
 * This replaced three absolutely positioned segments that were each nudged into
 * place separately. Every one of those joins was arithmetic that had to be kept
 * true by hand, and none of them survived a change to the row's padding.
 */
/**
 * The thinking behind one step, inside the step.
 *
 * Same shape the folded thought row uses — headings bold, prose under them,
 * against a rule — so reasoning reads the same wherever it is found. Held to a
 * height and faded, because a block of thinking is as long as it is and the row
 * it opens should not push the rest of the turn off the screen.
 */
function Thinking({ heading = "Thinking", sections, ruled }: { heading?: string; sections: Array<{ title?: string; body: string }>; ruled: boolean }) {
  return (
    <div className={cn("px-3 py-2.5", ruled && "border-b border-[var(--border-surface-strong)]/60")}>
      <p className="mb-1.5 text-thread font-medium text-[var(--transcript-step-mark)]">{heading}</p>
      <FadedScroll>
        <div className="border-l border-border/70 pl-2.5">
          {sections.map((section, index) => (
            <div className={index > 0 ? "mt-2" : undefined} key={index}>
              {section.title ? (
                <p className="text-thread font-medium leading-[1.6] text-[var(--transcript-step-strong)]">{section.title}</p>
              ) : null}
              {section.body ? (
                <p className="text-thread leading-[1.6] text-[var(--transcript-step)]">{section.body}</p>
              ) : null}
            </div>
          ))}
        </div>
      </FadedScroll>
    </div>
  );
}

/** One line, and short enough to sit after a title. A detail that wrapped would
 *  turn a row into a paragraph, which is the shape the thread is built to avoid;
 *  the whole thing is in the panel the row opens. */
function oneLine(value: string, limit = 72): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

export function ToolRow({ part, after, continues = false, thinking }: { part: ToolPart; after?: ReasoningPart | undefined; continues?: boolean; thinking?: ReasoningPart | undefined }) {
  const [open, setOpen] = useState(false);
  const reasons = thinking ? thoughts(thinking.body) : [];
  const concluded = after ? thoughts(after.body) : [];
  const hasCall = Boolean(part.input.trim() || part.output.trim());
  const hasPayload = hasCall || reasons.length > 0 || concluded.length > 0;
  const totals = diffTotals(part.files);
  const running = part.phase === "running";

  const label = (
    <>
      <span className={cn("min-w-0 truncate", running && "thinking-shimmer")}>
        <ToolTitle part={part} />
        {/* What the call came back with, beside what it was for.
            The worker has always written this — `23 steps`, `w_sum: 6 → 10 at
            step 14`, `status invalid` — and the row threw it away, so a turn
            spent looking for something read as a list of intentions with no
            findings: eight rows saying what the agent was about to do and not
            one saying what it learned. It is the agent's own summary of its
            result, so it is as specific as the result was.

            Dimmer than the title and after it, because the title is the question
            and this is the answer to that one question, not a headline. */}
        {part.phase === "done" && part.detail.trim() && (
          <span className="ml-1.5 text-[var(--transcript-step-mark)]">{oneLine(part.detail)}</span>
        )}
        {took(part) && <span className="ml-1.5 tabular-nums text-[var(--transcript-step-mark)]">{took(part)}</span>}
      </span>
      <DiffStat added={totals.added} removed={totals.removed} />
      {/* Only when it did not simply work. A row of green "Success" badges down a
          transcript is noise; the one that says Error is the one worth seeing. */}
      {part.phase === "error" && <StatusPill part={part} />}
      {hasPayload && <Caret open={open} />}
    </>
  );

  return (
    <Collapsible className="group/step" onOpenChange={setOpen} open={open}>
      {/* The block, at the reference's geometry: a 24px gutter, a 6px gap, and
          the gap to the next step held inside the block as padding rather than
          outside it as a margin — a margin is space the thread's line cannot
          cross. The whole row is pulled 4px left of the prose column so the
          16px mark centres where the reference centres it — left only: the
          matching right pull bought nothing and pushed every open panel 4px
          past the column, which is where the thread clipped its edge off. */}
      <div className="relative -ml-1 flex min-w-0 items-start gap-1.5 pb-2">
        <div className="relative flex min-h-6 w-6 shrink-0 items-start justify-center self-stretch">
          {/* One element, not three. The line starts below this row's mark and
              runs to the foot of its block — which grows when the panel opens,
              so opening a row stretches the thread rather than adding a second
              piece of it. Consecutive rows join with no seam because each one's
              own bottom padding is inside the box the line is measured against. */}
          <span aria-hidden className={cn(RAIL, !continues && RAIL_LAST)} data-line />
          <span className={cn(ROW_GLYPH, "text-[var(--transcript-step-mark)]")}><ToolIcon part={part} /></span>
        </div>

        <div className="min-w-0 flex-1">
          {hasPayload ? (
            <CollapsibleTrigger className={cn(LABEL_ROW, TRIGGER)}>{label}</CollapsibleTrigger>
          ) : (
            /* Same hover as a row that opens. Whether a step happens to have a
               payload is not a reason for it to read as a different kind of
               line. */
            <div className={cn(LABEL_ROW, "text-[var(--transcript-step)] transition-colors hover:text-[var(--transcript-step-strong)]")}>{label}</div>
          )}
          {hasPayload && (
            <CollapsibleContent>
              {/* A ring, not a border. A 1px border and a shadow on the same box
                  draw a hard line and then a soft edge just outside it; the
                  reference draws one half-pixel ring and lets the shadow start
                  from there, which is the same rule `smooth-shadow-ring` states
                  for the rest of this app. */}
              <div className="mt-1.5 min-w-0 overflow-hidden rounded-xl bg-[var(--surface-primary)] shadow-sm ring-[0.5px] ring-[var(--border-surface-strong)]">
                {/* Built for the tool when there is a view for it, raw when there is
                    not — `ToolDetail` decides, and falls back itself.

                    It cannot be decided here. `<ToolDetail/>` is an element, never
                    null, so testing it for nullishness always took the drawn branch
                    and a tool with no view of its own rendered an empty panel.

                    A failed call keeps the raw payload: the error text is the whole
                    point, and a drawn view of arguments that did not work hides it. */}
                {/* Why it did this, then what it did. The thinking is first
                    because it is the earlier of the two and because it is the
                    half that reads as prose — a wall of arguments above it would
                    bury the sentences that explain them. */}
                {reasons.length > 0 && <Thinking ruled={hasCall} sections={reasons} />}
                {/* A call whose only payload is the thinking behind it draws
                    nothing more. `ToolDetail` is an element rather than null, so
                    asking it for a view of two empty strings gets an empty panel
                    rather than no panel. */}
                {!hasCall ? null : part.phase === "error" ? (
                  <RawPayload input={part.input} output={part.output} />
                ) : (
                  <ToolDetail input={part.input} output={part.output} tool={part.tool} />
                )}
                {/* And what it made of the result, under the result. The turn's
                    last stretch of thinking has no call of its own to lead to,
                    and read where it happened it is a wall of headings above the
                    reply that restates them. */}
                {concluded.length > 0 && (
                  <div className="border-t border-[var(--border-surface-strong)]/60">
                    <Thinking heading="What it made of it" ruled={false} sections={concluded} />
                  </div>
                )}
              </div>
            </CollapsibleContent>
          )}
        </div>
      </div>
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
const ROW = "relative inline-flex w-fit min-w-0 max-w-full items-center gap-2.5 px-1.5 py-[3px] text-left text-thread";
/** The icon column every row of a turn hangs its mark in.
 *
 *  Named, and reserved even when there is no mark to put in it. A settled
 *  thought used to draw no slot at all, so "Thought for 43s" started where the
 *  tool rows' *icons* start and the two lines under it started 26px further in
 *  — and the same row jumped left by that much the moment the turn finished,
 *  because the live version does draw one. A transcript with four left edges is
 *  what "the padding feels off" turns out to be. */
export const ROW_GLYPH = "relative z-10 flex size-6 shrink-0 items-center justify-center [&>svg]:size-4";
/* `cursor-default` for the same reason the sidebar sets it: AppKit shows the arrow
   over a list of rows, never the hand, and the pointer cursor is the clearest tell
   that a desktop app was built in a browser. These rows are a list, not controls. */
const TRIGGER = "group/row cursor-default border-0 p-0 text-[var(--transcript-step)] transition-colors outline-none hover:text-[var(--transcript-step-strong)]";
/** The row's own horizontal inset, which anything hanging beneath a row aligns to.
 *  This is also the transcript's prose edge: a paragraph starts where a row's
 *  mark starts, not where its label does. */
export const ROW_INSET = "0rem";
/** The gap between two steps of the same run of work, and therefore exactly the
 *  height of the rule that joins them. Exported so the row that sets the margin
 *  and the rule that fills it cannot drift apart.
 *
 *  Tight, and tighter than it reads: a step also carries the clearance its mark
 *  keeps off the line above and below it, so the space between two rows is this
 *  plus that. Widening it to give the line more room was the wrong knob — it
 *  pushed the steps apart and cost the cluster the tightness that makes a run of
 *  work read as one thing. */
export const LINKED_GAP = "0rem";
/** A step that opens a new run of work, and a paragraph of prose. Prose gets the
 *  most room of anything in a turn: the contrast between a tight cluster of steps
 *  and a sentence with air around it is what makes a long turn scannable. */
export const STEP_GAP = "0.25rem";
/* Set from the prose side and applied on both, so a paragraph has the same room
   above it and below it. It was equal to STEP_GAP, which meant a sentence sat as
   close to the tool row under it as two tool calls sit to each other — the
   contrast the comment above describes was written down and then not spent. */
export const PROSE_GAP = "0.875rem";
/** Exactly where a row's label starts: the inset, plus the icon, plus the gap
 *  after it. A note under a row uses this so it lines up with the words it belongs
 *  to rather than nearly lining up with them. */
export const UNDER_LABEL = "1.625rem";

/** The thread, as one absolutely positioned line per row: it hangs from the
 *  bottom of this row's mark (`top-6`) to 16px short of the block's foot, and
 *  the block's foot moves when the panel opens. */
const RAIL = "bg-border absolute top-6 left-1/2 h-[calc(100%-16px)] min-h-2 w-px -translate-x-1/2";
/** The last step of a run draws no line — there is nothing under it to reach.
 *  Except when its own panel is open, where the line is what ties the panel to
 *  the row that opened it. */
const RAIL_LAST = "hidden h-[calc(100%-32px)] group-data-[state=open]/step:block";

/** A row's words: everything except the mark, which is now a column of its own.
 *  Keeps the row's height at exactly the mark's, so the two line up without
 *  either of them being nudged. */
const LABEL_ROW = "flex min-h-6 w-full min-w-0 items-center justify-start gap-1 overflow-hidden text-left text-thread";

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
function Caret({ open, standing = false }: { open: boolean; standing?: boolean }) {
  return (
    <IconChevronRight
      className={cn(
        "size-4 shrink-0 text-[var(--transcript-step-mark)] transition-all duration-200",
        /* Hidden until hover on a row that already shows its own heading: the
           caret is an offer to see the working behind a line you have read.
           `standing` is for a row that is standing in for rows you cannot see —
           there, nothing else on screen says the rest of the thinking is in
           there, so the affordance cannot be something you have to find. */
        standing ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
        open && "rotate-90 opacity-100",
      )}
    />
  );
}

/** How long a settled call took. Absent for a stored row, which does not keep
 *  timings, and for anything under a second, where the number is noise. */
function took(part: ToolPart): string {
  /* A question is not work the agent did — it is a wait on the learner. "Asked a
     question in 25s" times how long somebody took to read and think, which is a
     stopwatch held on them and tells them nothing about their project. */
  if (part.tool === "ask_user_question" || part.tool === "ask-user-question") return "";
  if (part.phase === "running" || !part.startedAt || !part.endedAt) return "";
  const seconds = (part.endedAt - part.startedAt) / 1_000;
  return seconds < 1 ? "" : `in ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

function DiffStat({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) return null;
  return (
    <span className="shrink-0 font-mono text-thread tabular-nums">
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
    <p className="min-w-0 break-words text-thread leading-[1.55] text-[var(--transcript-step)]" style={{ paddingLeft: UNDER_LABEL }}>
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

  /* Live, and folded like everything else.
     
     This used to print the whole stream inline while the model wrote it: a
     paragraph of half-finished reasoning that pushed the conversation off the
     screen and then vanished when the turn settled. Thinking is the agent's
     working, not its answer — the row says it is thinking and what about, and
     the stream is there for anybody who wants it.
     
     Open state survives the deltas because the part keeps its identity for the
     length of the run, so a thought opened mid-stream stays open and keeps
     following the tail. */
  if (part.open) {
    const current = sections.at(-1);
    return (
      <LiveThought
        body={part.body}
        id={part.id}
        sections={sections}
        title={current?.title ?? "Thinking"}
      />
    );
  }

  if (!sections.length) return null;
  /* Settled: one row per heading the model gave its own thinking, which is what
     makes a long turn readable — "Resolving the language conflict" says something,
     and seven rows of "Thought for 9s" say nothing.

     Up to a point. Reasoning summaries are not all written the same way: some
     models narrate a turn in two or three headings, and some head every
     paragraph, which turned a single block of thinking into a column of ten grey
     lines that pushed the actual work off the screen. Past that point the block
     folds back into one row — the first heading still says what it was about, and
     the rest is one click away. */
  if (sections.length > THOUGHT_ROWS) {
    return <ThoughtCluster sections={sections} settling={part.startedAt > 0} />;
  }
  return (
    <div className="min-w-0">
      {sections.map((section, index) => (
        <div key={`${part.id}-${index}`} className="min-w-0" {...(index > 0 ? { style: { marginTop: LINKED_GAP } } : {})}>
          {/* Several headings from one block of thinking are one cluster, spaced
              like consecutive steps rather than like separate paragraphs. */}
          <Thought
            body={section.body}
            /* A stored step has no clock on it — see `storedPart`. Reading a
               transcript back is not watching one settle, and every thought in
               it sliding into place on mount would be motion for nothing. */
            settling={part.startedAt > 0}
            title={section.title ?? `Thought for ${seconds}s`}
          />
        </div>
      ))}
    </div>
  );
}

/** How many headings one settled block of thinking may spend on its own rows
 *  before it folds into a single one. Three is the most a reader takes in as a
 *  list of steps rather than as a wall. */
const THOUGHT_ROWS = 3;

/**
 * A long block of thinking, folded.
 *
 * The first heading is the title, because it is the one the model wrote before
 * it knew where the thinking would end up and is the closest thing to a subject.
 * Opening it shows every section with its own heading, so nothing is lost — the
 * rows are just not all on screen at once.
 */
function ThoughtCluster({ sections, settling }: { sections: Array<{ title?: string; body: string }>; settling: boolean }) {
  const [open, setOpen] = useState(false);
  const [home, setHome] = useState(!settling);
  useEffect(() => {
    if (home) return;
    const frame = requestAnimationFrame(() => setHome(true));
    return () => cancelAnimationFrame(frame);
  }, [home]);

  const travel = {
    paddingLeft: home ? ROW_INSET : UNDER_LABEL,
    transition: "padding-left 260ms cubic-bezier(0.32, 0.72, 0, 1)",
  };
  const lead = sections.find((section) => section.title)?.title ?? sections[0]?.body ?? "Thinking";

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger className={cn(ROW, TRIGGER, "motion-reduce:transition-none")} style={travel}>
        <span className="min-w-0 truncate">{lead}</span>
        {/* What is behind the row, counted. "+11" beside a heading is the only
            thing telling the learner that eleven more thoughts exist, so it is
            drawn as a standing chip rather than as dimmed trailing text. */}
        <span className="shrink-0 rounded-full bg-[var(--transcript-step-mark)]/12 px-1.5 py-px text-thread tabular-nums text-[var(--transcript-step)]">
          +{sections.length - 1}
        </span>
        <Caret open={open} standing />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <FadedScroll className="mx-1.5 mb-1">
          <div className="border-l border-border/70 pl-2.5">
            {sections.map((section, index) => (
              <div key={index} className={index > 0 ? "mt-2" : undefined}>
                {section.title ? (
                  <p className="text-thread leading-[1.6] font-medium text-[var(--transcript-step-strong)]">{section.title}</p>
                ) : null}
                {section.body ? (
                  <p className="text-thread leading-[1.6] text-[var(--transcript-step)]">{section.body}</p>
                ) : null}
              </div>
            ))}
          </div>
        </FadedScroll>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Thinking as it arrives, behind a disclosure.
 *
 * The trigger is the same row every other step uses, so a turn in flight reads
 * as one column of steps rather than as a wall with rows either side of it. The
 * orb and the shimmer are what say this one is still happening.
 *
 * The stream inside follows its own tail and is capped, so opening it during a
 * long thought shows the end — where the model is now — rather than the
 * beginning, and never grows past a screenful.
 */
function LiveThought({
  body,
  id,
  sections,
  title,
}: {
  body: string;
  id: string;
  sections: Array<{ title?: string; body: string }>;
  title: string;
}) {
  const [open, setOpen] = useState(false);

  const trigger = (
    <>
      <span className={ROW_GLYPH}>
        <ThinkingOrb aria-label="Thinking" size={20} state="solving" style={{ width: 15, height: 15 }} />
      </span>
      <span className="thinking-shimmer min-w-0 truncate">{title}</span>
      {sections.length > 0 && <Caret open={open} />}
    </>
  );

  if (sections.length === 0) return <div className={cn(ROW, "text-[var(--transcript-step)]")}>{trigger}</div>;

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger className={cn(ROW, TRIGGER)}>{trigger}</CollapsibleTrigger>
      <CollapsibleContent>
        <FadedScroll className="mx-1.5 mb-1" follow watch={body}>
          <div className="space-y-2 border-l border-border/70 pl-2.5 text-thread leading-[1.6] text-[var(--transcript-step)]">
            {sections.map((section, index) => (
              <div key={`${id}-live-${index}`}>
                {/* The heading of a section that has finished. The one still
                    being written is already the row's own title. */}
                {section.title && index < sections.length - 1 && (
                  <p className="font-medium text-[var(--transcript-step-strong)]">{section.title}</p>
                )}
                {section.body && <p>{section.body}</p>}
              </div>
            ))}
          </div>
        </FadedScroll>
      </CollapsibleContent>
    </Collapsible>
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
 *
 * `settling` is how it gets there. While the model is thinking the row carries
 * an orb in the gutter, so its words sit a label's width in; the moment the orb
 * goes the words have to travel that width to the margin, and doing it in one
 * frame is a jump in the middle of a paragraph the reader is already looking at.
 * It is only ever true for a thought that has just finished in front of them —
 * a transcript read back from storage was never indented and has nothing to
 * travel.
 */
function Thought({ title, body, settling }: { title: string; body: string; settling: boolean }) {
  const [open, setOpen] = useState(false);
  /* Starts where the live row left it, then moves on the next frame. Setting
     both the start and the end in one commit would give the browser a single
     computed value and nothing to interpolate between. */
  const [home, setHome] = useState(!settling);
  useEffect(() => {
    if (home) return;
    const frame = requestAnimationFrame(() => setHome(true));
    return () => cancelAnimationFrame(frame);
  }, [home]);

  const travel = {
    paddingLeft: home ? ROW_INSET : UNDER_LABEL,
    transition: "padding-left 260ms cubic-bezier(0.32, 0.72, 0, 1)",
  };

  if (!body) {
    return (
      <div className={cn(ROW, "motion-reduce:transition-none text-[var(--transcript-step)]")} style={travel}>
        <span className="min-w-0 truncate">{title}</span>
      </div>
    );
  }
  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger className={cn(ROW, TRIGGER, "motion-reduce:transition-none")} style={travel}>
        <span className="min-w-0 truncate">{title}</span>
        <Caret open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* Same height it had while it streamed. A thought that filled 1.5in and
            then expanded to a screenful on settling would reflow the thread under
            the reader at the exact moment they started reading it. */}
        <FadedScroll className="mx-1.5 mb-1">
          <p className="border-l border-border/70 pl-2.5 text-thread leading-[1.6] text-[var(--transcript-step)]">{body}</p>
        </FadedScroll>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Construct reading how the challenge was actually solved.
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
    <div className={cn(ROW, "text-[var(--transcript-step)]")}>
      <span className={cn(ROW_GLYPH, "text-[var(--transcript-step-mark)]")}>
        {running
          ? <ThinkingOrb aria-label="Reading your solve" size={20} state="searching" style={{ width: 15, height: 15 }} />
          : <IconHistory className="size-4" />}
      </span>
      <span className={cn("min-w-0 truncate", running && "thinking-shimmer")}>
        {running ? "Reading your solve" : "Read your solve"}
      </span>
      {/* What the replay found, on the same line. It used to be a stack of chips
          built by splitting the label on an em dash — a shape that broke the day
          that field started carrying the agent's own title for the step. */}
      {!running && part.detail && (
        <span className="min-w-0 truncate text-[var(--transcript-step-mark)]">{part.detail}</span>
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
        {sourced ? <SourceGlyph className="size-3.5" source={source} /> : <IconCheck className="size-4" />}
      </span>
      <span className="min-w-0 truncate">
        <span className="text-thread font-medium text-foreground">{part.label || (sourced ? "Problem set" : replaced ? "Challenge replaced" : "Challenge ready")}</span>
        <span className="ml-1.5 text-muted-foreground">
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
        <IconAlert className="mt-px size-4 shrink-0 text-destructive/80" />
        <div className="min-w-0 flex-1">
          <p className="text-thread font-medium text-foreground">That turn did not finish</p>
          <p className="mt-0.5 min-w-0 break-words text-thread leading-[1.55] text-muted-foreground">
            {headline?.trim().replace(/\.$/, "") ?? "Construct could not complete that turn"}.
          </p>
          {detail && (
            <>
              <button
                className="mt-1.5 inline-flex items-center gap-1 text-thread text-muted-foreground/85 transition-colors hover:text-foreground"
                onClick={() => setOpen((value) => !value)}
                type="button"
              >
                <IconChevronRight className={cn("size-3.5 transition-transform duration-200", open && "rotate-90")} />
                {open ? "Hide details" : "Show details"}
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.pre
                    animate={{ height: "auto", opacity: 1 }}
                    className="mt-1.5 overflow-x-auto rounded-lg bg-[var(--accent)] px-2.5 py-2 font-mono text-thread leading-[1.5] text-muted-foreground/90"
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
