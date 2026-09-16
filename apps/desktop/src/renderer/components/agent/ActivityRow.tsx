import { ArtifactCard, ArtifactCardRow } from "./ArtifactCard";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from "motion/react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { FileSearch } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { IconAlert, IconBook, IconCheck, IconCode, IconChevronRight, IconChip, IconDossier, IconDot, IconEdit, IconFile, IconFolder, IconGlobe, IconHistory, IconLightning, IconList, IconPlay, IconPuzzle, IconQuestion, IconSearch, IconSparkle, IconTerminal } from "./threadIcons";
import { ToolDetail } from "./ToolDetail";
import { toolSubject } from "./toolSubject";
import { latestHeading, thoughts } from "./thoughts";
import { useMarkdownLinks } from "./MarkdownLinks";
import { FadedScroll, RawPayload } from "./ToolPayload";
import { SourceGlyph } from "../common/SourceGlyph";
import { LanguageGlyph, LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { BAND_WORD, ChallengeCardMeta, ChallengeCardMenu, ChallengeOutcomeTag, DIFFICULTY_WORD } from "./ChallengeCardMeta";
import { ChallengePreview, hasChallengePreview, publishedPreviewData, stopPreviewData, useCursorPreview } from "./ChallengePreview";
import { SaveProblem } from "../common/SaveProblem";
import { readPublishedChallenge } from "./publishedChallenge";
import { useRevealOnExpand } from "./useRevealOnExpand";
import { diffTotals, isSourceTool, toolRowTitle, type ReasoningPart, type RunPart } from "./agentRun";
import { solveStats, spentOn, type SolveStats } from "./solveStats";
import type { ChallengeStop, ChallengeTrail } from "../workspace/ChallengeStepper";

type ToolPart = Extract<RunPart, { kind: "tool" }>;

/**
 * How a step arrives.
 *
 * A turn is a list that writes itself while you watch it, and the arrival is the
 * only thing that tells you a line is new rather than one you have already read.
 * Before, it was 5px and a fade on a flat curve, which at the speed steps land
 * is indistinguishable from the row simply being there — so a turn that ran
 * twelve tools read as a block of text growing rather than as work happening.
 *
 * So: up eight pixels on a spring with a little bounce, and a fraction under
 * full size on the way. The scale is the part that does the work — it is what
 * makes the row read as coming forward into the transcript rather than sliding
 * up it — and it is held to one and a half percent, because at 96% a line of
 * text visibly re-renders its glyphs and the arrival becomes a blur.
 *
 * The fade leads slightly and finishes early: the row is fully opaque before it
 * has stopped moving, so what settles is a line you are already reading rather
 * than one still resolving. A card is the same gesture with more of everything,
 * because a published challenge is a bigger thing to land.
 *
 * Only mounts animate. A streaming row updates its own text several times a
 * second, and re-running the entrance on each of those is a step that vibrates.
 */
export function useThreadArrival(card = false) {
  const reduced = useReducedMotion();
  return {
    initial: { opacity: 0, y: reduced ? 0 : card ? 14 : 8, scale: reduced ? 1 : card ? 0.97 : 0.985 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: reduced
      ? { duration: 0.1 }
      : {
          type: "spring" as const,
          visualDuration: card ? 0.5 : 0.38,
          bounce: card ? 0.08 : 0.16,
          opacity: { duration: card ? 0.24 : 0.16, ease: "easeOut" as const },
        },
  };
}

/** The gutter mark's own arrival, a beat behind its row.
 *
 *  It is a 16px glyph on a line of text, so it can afford a gesture the row
 *  cannot: it comes in from three quarters size with real bounce, and the delay
 *  is what turns that into a sequence — the row arrives, then the mark lands on
 *  it — rather than two things springing at once. This is the piece of a step
 *  that reads as mechanical, in the good sense: the transcript stamping the line
 *  it just wrote. */
function useMarkArrival() {
  const reduced = useReducedMotion();
  if (reduced) return { initial: false as const, animate: { opacity: 1, scale: 1 } };
  return {
    initial: { opacity: 0, scale: 0.72 },
    animate: { opacity: 1, scale: 1 },
    transition: {
      type: "spring" as const,
      visualDuration: 0.34,
      bounce: 0.42,
      delay: 0.06,
      opacity: { duration: 0.14, delay: 0.06 },
    },
  };
}

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
    /* Lucide already ships the combined document-lines + search glyph. It says
       both what is being read and that this row is inspecting it. */
    case "read_attempt":
      return <IconHistory className={MARK} />;
    /* Both retired into read_attempt, and both still drawn: a transcript written
       before the merge is still a transcript somebody scrolls back through. */
    case "inspect_current_attempt":
      return <FileSearch className={MARK} strokeWidth={1.75} />;
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
  const block = useRevealOnExpand<HTMLDivElement>(open);
  const arrival = useThreadArrival();
  const mark = useMarkArrival();
  const reduced = useReducedMotion();
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
          past the column, which is where the thread clipped its edge off.

          That bottom padding is the gap to the *next step*, so it is only paid
          when there is one. A step at the end of a cluster was adding it on top
          of the prose gap the paragraph beneath already sets, which is why a
          sentence sat 22px under a tool row and 14px above the next one — the
          asymmetry read as the rows being attached to the wrong paragraph. An
          open row keeps it: there the padding is what the thread's line runs
          through to reach the panel. */}
      <motion.div {...arrival} className={cn("relative -ml-1 flex min-w-0 items-start gap-1.5", (continues || open) && "pb-2")} ref={block}>
        <div className="relative flex min-h-6 w-6 shrink-0 items-start justify-center self-stretch">
          {/* One element, not three. The line starts below this row's mark and
              runs to the foot of its block — which grows when the panel opens,
              so opening a row stretches the thread rather than adding a second
              piece of it. Consecutive rows join with no seam because each one's
              own bottom padding is inside the box the line is measured against. */}
          {/* Drawn downward from under the mark, at the speed the next row is
              arriving, so the thread reads as being run between the two steps
              rather than as a rule that was already there waiting. */}
          <motion.span
            aria-hidden
            animate={{ scaleY: 1 }}
            className={cn(RAIL, !continues && RAIL_LAST)}
            data-line
            initial={reduced ? false : { scaleY: 0 }}
            style={{ transformOrigin: "top" }}
            transition={{ duration: reduced ? 0 : 0.34, ease: [0.22, 0.61, 0.36, 1], delay: reduced ? 0 : 0.08 }}
          />
          <motion.span className={cn(ROW_GLYPH, "text-[var(--transcript-step-mark)]")} {...mark}>
            {/* The mark changes when the call lands — an orb while it runs, the
                tool's own glyph once it has. Crossing them on a scale rather
                than cutting is what makes the finish of a step something you
                can see out of the corner of your eye, which is where a reader
                following a turn actually has it. */}
            <AnimatePresence initial={false}>
              {/* Stacked in the mark's own 24px box rather than laid out, so the
                  two glyphs cross without either of them costing a measurement:
                  a turn finishing eight calls should not be eight reflows of the
                  transcript, and nothing here needs to know how wide an icon is.
                  The size selector rides on this span because the icon is no
                  longer the gutter's direct child. */}
              <motion.span
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 grid place-items-center [&>svg]:size-4"
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                initial={reduced ? false : { opacity: 0, scale: 0.6 }}
                key={running ? "running" : part.phase}
                transition={reduced ? { duration: 0 } : { type: "spring", visualDuration: 0.3, bounce: 0.3 }}
              ><ToolIcon part={part} /></motion.span>
            </AnimatePresence>
          </motion.span>
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
          {/* One rounded box, not two. The surface lives on the element that
              clips, because that element is also the one animating the height —
              and a bordered panel nested inside a clip of exactly its own radius
              loses half its stroke to the curve at every corner, which is what
              ate the top-left. The clip owns the corner, the border, the
              background and the lift; what is inside it is only content. */}
          {hasPayload && (
            <CollapsibleContent className={cn("mt-1.5", BLOCK_SURFACE)} expandDuration={0.42}>
              <div className="agent-tool-detail min-w-0">
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
      </motion.div>
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
/**
 * Every block inside a turn wears the one material, and it is declared in CSS.
 *
 * `.transcript-block` is the same rule the fenced code block in a reply draws —
 * literally the same rule, a shared selector in `theme.css` — so the panel a
 * tool row opens, the published challenge and the reading of the solve cannot
 * drift from it or from each other again. Stroke, fill, lift and corner all come
 * from there — there is nothing left to decide here, which is the point.
 *
 * In CSS rather than in a string of utilities because the last attempt at it was
 * `border-[0.5px]` beside `border-[var(--x)]` — two arbitrary values in one
 * utility family that neither Tailwind nor `cn`'s merge can tell apart, so the
 * merge kept the last, the width fell back to the `border: 0` default, and the
 * cards were drawn with no edge at all beside a code block whose border, being
 * plain CSS, was fine.
 */
export const BLOCK_SURFACE = "transcript-block";

/* The session pile becomes a scroller once it outgrows a few stops, so its ends
   are faded rather than cut: a hard edge at the top reads as a clipped card, a
   fade reads as more list. The bottom fade is shorter because the live card
   sits right under it and closes the list off on its own. */
const STACK_FADE_BOTH = "linear-gradient(to bottom, transparent 0, #000 24px, #000 calc(100% - 18px), transparent 100%)";
const STACK_FADE_TOP = "linear-gradient(to bottom, transparent 0, #000 24px)";
const STACK_FADE_BOTTOM = "linear-gradient(to bottom, #000 calc(100% - 18px), transparent 100%)";

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
/* No `border-0` here. Preflight already zeroes every element's border, so it was
   saying nothing — right up until this string was put on a card that wants one,
   where it silently won: a utility sits in a layer declared after `components`,
   so it beats `.transcript-block` no matter how specific that rule is, and the
   solve reading was drawn with no edge while the code block three lines below it
   kept its own. */
const TRIGGER = "group/row cursor-default p-0 text-[var(--transcript-step)] transition-colors outline-none hover:text-[var(--transcript-step-strong)]";
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
export const PROSE_GAP = "0.75rem";
/** A slightly clearer handoff from the expanded work to the final response. */
export const FINAL_GAP = "0.875rem";
/** Exactly where a row's label starts: the inset, plus the icon, plus the gap
 *  after it. A note under a row uses this so it lines up with the words it belongs
 *  to rather than nearly lining up with them. */
export const UNDER_LABEL = "1.625rem";

/** The thread, as one absolutely positioned line per row: it hangs from the
 *  bottom of this row's mark (`top-6`) to 16px short of the block's foot, and
 *  the block's foot moves when the panel opens. */
const RAIL = "bg-[var(--transcript-rail)] absolute top-6 left-1/2 h-[calc(100%-16px)] min-h-2 w-px -translate-x-1/2";
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
function Caret({ className, open, standing = false }: { className?: string; open: boolean; standing?: boolean }) {
  return (
    <IconChevronRight
      className={cn(
        /* The same curve the panel opens on, so the caret and the thing it
           opens are one movement rather than two that start together. */
        "size-4 shrink-0 text-[var(--transcript-step-mark)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        /* Hidden until hover on a row that already shows its own heading: the
           caret is an offer to see the working behind a line you have read.
           `standing` is for a row that is standing in for rows you cannot see —
           there, nothing else on screen says the rest of the thinking is in
           there, so the affordance cannot be something you have to find. */
        standing ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
        open && "rotate-90 opacity-100",
        className,
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
 * The model's own reasoning: one row, titled with what it is thinking about.
 *
 * The row carries the model's own heading for the work in hand — "Designing
 * deterministic test cases with oracle" — and the thinking behind it is inside,
 * behind the same disclosure every other step uses. A fixed "Thinking" label
 * was standing in for text the model had already written. A row per heading was
 * the opposite mistake: six naked lines spilled into the column, no mark beside
 * them and nothing to open, which is not a step and not a paragraph either. One
 * block of thought is one step; its headings are its contents.
 *
 * While it streams the title follows the section being written, so the row says
 * where the model is now rather than where it started; when it settles that
 * heading stays, so nothing swaps under a reader mid-sentence.
 */
export function Reasoning({ part }: { part: Extract<RunPart, { kind: "reasoning" }> }) {
  const sections = thoughts(part.body);
  const seconds = Math.max(1, Math.round(((part.endedAt ?? Date.now()) - part.startedAt) / 1_000));
  /* The heading the row wears. Trailing prose with no heading of its own belongs
     to the last one, so the last *titled* section is the one being written —
     and `latestHeading` has the fallback for thinking with no headings in it. */
  const titled = sections.map((section, index) => (section.title ? index : -1)).filter((index) => index >= 0).at(-1) ?? -1;
  const heading = latestHeading(part.body);

  /* Live, the row is what says the turn is alive, so it draws before the first
     delta lands. Settled, it has to have something behind it.

     "Something" means prose. A provider that summarises its reasoning as titles
     and no working leaves a block that is only headings, and a row per heading
     — or one row opening onto a list of them — is a table of contents for a
     chapter nobody wrote. Those headings are live status and nothing more: they
     name the row while the model is in them and go when it is done. The main
     process drops them on the way to storage for the same reason, so a turn read
     back and a turn just finished agree — see `dropHeadingOnly`. */
  const prose = sections.some((section) => section.body);
  if (!part.open && !prose) return null;

  return (
    <Thought
      body={part.body}
      headingIndex={titled}
      id={part.id}
      live={part.open}
      /* No prose means nothing to open onto. A live block of headings is a row
         that says what the model is thinking about and nothing else, which is
         all that block will ever have to say. */
      sections={prose ? sections : []}
      /* A stored step has no clock on it — see `storedPart`. Reading a transcript
         back is not watching one settle, and every thought in it sliding into
         place on mount would be motion for nothing. */
      settling={!part.open && part.startedAt > 0}
      title={heading ?? (part.open ? "Thinking" : `Thought for ${seconds}s`)}
    />
  );
}

/**
 * A block of thinking: its heading, and the thinking behind it.
 *
 * Live, the mark is the orb and the title shimmers, and the stream inside
 * follows its own tail — so opening it mid-thought shows where the model is, not
 * the paragraph it opened with — and is held to a height, because a thought is
 * as long as it is and the row it opens should not push the turn off the screen.
 *
 * Settled, the orb goes, and with it the gutter it stood in. A glyph on every
 * one of these was decoration, but removing it and keeping its column was worse
 * than either: the text sat indented under a blank space, which reads as a child
 * of the row above rather than as a step beside it. The thought ends at the
 * margin.
 *
 * `settling` is how it gets there. While the model thinks, the row's words sit a
 * label's width in; the moment the orb goes they have to travel that width, and
 * doing it in one frame is a jump in the middle of a paragraph the reader is
 * already looking at. It is only ever true for a thought that has just finished
 * in front of them — a transcript read back from storage was never indented and
 * has nothing to travel.
 */
function Thought({
  body,
  headingIndex,
  id,
  live,
  sections,
  settling,
  title,
}: {
  body: string;
  /** The section whose heading the row is already wearing, so it is not said twice. */
  headingIndex: number;
  id: string;
  live: boolean;
  sections: Array<{ title?: string; body: string }>;
  settling: boolean;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const block = useRevealOnExpand<HTMLDivElement>(open);
  /* Starts where the live row left it, then moves on the next frame. Setting both
     the start and the end in one commit would give the browser a single computed
     value and nothing to interpolate between. */
  const [home, setHome] = useState(!settling);
  useEffect(() => {
    if (home) return;
    const frame = requestAnimationFrame(() => setHome(true));
    return () => cancelAnimationFrame(frame);
  }, [home]);

  /* Live, the orb holds the gutter open and there is nothing to travel. */
  const travel = live
    ? undefined
    : { paddingLeft: home ? ROW_INSET : UNDER_LABEL, transition: "padding-left 260ms cubic-bezier(0.32, 0.72, 0, 1)" };

  const trigger = (
    <>
      {live && (
        <span className={ROW_GLYPH}>
          <ThinkingOrb aria-label="Thinking" size={20} state="solving" style={{ width: 15, height: 15 }} />
        </span>
      )}
      <span className={cn("min-w-0 truncate", live && "thinking-shimmer")}>{title}</span>
      {sections.length > 0 && <Caret open={open} />}
    </>
  );

  /* Nothing behind it yet — the first frames of a thought, before the provider
     has written a word of it. A caret onto an empty panel is worse than no
     caret, so the row is a row. */
  if (!sections.length) {
    return <div className={cn(ROW, "motion-reduce:transition-none text-[var(--transcript-step)]")} style={travel}>{trigger}</div>;
  }

  return (
    <Collapsible onOpenChange={setOpen} open={open} ref={block}>
      <CollapsibleTrigger className={cn(ROW, TRIGGER, "motion-reduce:transition-none")} style={travel}>{trigger}</CollapsibleTrigger>
      <CollapsibleContent>
        {/* Same height it had while it streamed. A thought that filled 1.5in and
            then expanded to a screenful on settling would reflow the thread under
            the reader at the exact moment they started reading it. */}
        <FadedScroll className="mx-1.5 mb-1" follow={live} watch={body}>
          <div className="space-y-2 border-l border-border/70 pl-2.5 text-thread leading-[1.6] text-[var(--transcript-step)]">
            {sections.map((section, index) => (
              <div key={`${id}-${index}`}>
                {section.title && index !== headingIndex && (
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
 * Construct reading how the challenge was actually solved.
 *
 * This is the step the rest of the turn is built on, and the learner should be
 * able to see it happen: what it looked at, and what it found in their own
 * attempt. It is deliberately not a retrieval row — "read your solve" is a
 * statement about them, and it is the difference between a tutor that saw the
 * verdict and one that watched the work.
 *
 * And because it is about them, it is the one step in a turn that gets a card.
 * The replay counts the things a learner actually remembers about an attempt —
 * how long they were in it, how many times they ran it, which cases never once
 * went green — and those numbers were being flattened into a grey clause at the
 * end of a row, in the same weight as every tool label above it. A count that
 * carries a verdict should look like one: the cases that never passed are red,
 * because they are the reason the attempt went the way it did.
 *
 * Two lines, deliberately. It is the account of a step the agent took, not a
 * dashboard tile dropped into the middle of one — so it carries no shadow, no
 * chart and no row it does not need, and the case split is a ring in the corner
 * of the header rather than anything with a row of its own. Their code was
 * behind it for a while, at the opacity of a watermark; it is gone, because a
 * card whose background is illegible text is a card with a texture rather than
 * a fact, and the code is one click away in the panel that opens under it.
 *
 * The numbers come from the call's own result rather than from the sentence the
 * worker wrote about it — see `solveStats`. A replay still running, and one with
 * nothing to count, fall back to the plain row: a card with no numbers in it is
 * a frame around a sentence.
 */
export function SolveRead({ part }: { part: ToolPart }) {
  const arrival = useThreadArrival(true);
  /* The card opens like any other step. It is the summary of the one call a turn
     makes about the learner's work, and that call now carries the work itself —
     their file and the whole event log — so a card that could not be opened would
     be the only row in the transcript that hid its own payload. */
  const [open, setOpen] = useState(false);
  const block = useRevealOnExpand<HTMLDivElement>(open);
  const running = part.phase === "running";
  const stats = running ? null : solveStats(part.output);

  if (!stats || (!stats.casesTracked && !stats.runs && !stats.elapsedMs)) {
    return (
      <motion.div {...arrival} className={cn(ROW, "text-[var(--transcript-step)]")}>
        <span className={cn(ROW_GLYPH, "text-[var(--transcript-step-mark)]")}>
          {running
            ? <ThinkingOrb aria-label="Reading your attempt" size={20} state="searching" style={{ width: 15, height: 15 }} />
            : <IconHistory className="size-4" />}
        </span>
        <span className={cn("min-w-0 truncate", running && "thinking-shimmer")}>
          {running ? "Reading your attempt" : "Read your attempt"}
        </span>
        {/* What the replay found, on the same line. It used to be a stack of chips
            built by splitting the label on an em dash — a shape that broke the day
            that field started carrying the agent's own title for the step. */}
        {!running && part.detail && (
          <span className="min-w-0 truncate text-[var(--transcript-step-mark)]">{part.detail}</span>
        )}
      </motion.div>
    );
  }

  const verdict = stats.outcome ? VERDICT[stats.outcome] : null;
  /* Every case that went green at least once. The replay reports the complement,
     because a case that never passed is the durable fact — one that passed and
     broke again is counted separately, as a regression. */
  const passing = Math.max(0, stats.casesTracked - stats.neverPassed);

  return (
    <Collapsible className="group/step" onOpenChange={setOpen} open={open}>
      {/* One surface, opening.
          The panel used to be a second card 6px under the first, so asking to see
          the replay produced another object in the thread rather than more of the
          one already there. The card is the thing being opened, so the card is
          what grows: header and payload share one bordered, clipped surface, and
          the spring on the panel's height (see `CollapsibleContent`) is the card
          itself getting taller. */}
      <motion.div {...arrival} className={cn("relative isolate min-w-0 overflow-hidden", BLOCK_SURFACE)} ref={block}>
        <CollapsibleTrigger className={cn("relative block w-full min-w-0", TRIGGER)}>
          <div className="flex min-w-0 items-center gap-2 px-2.5 pt-1.5">
            <IconHistory className="size-4 shrink-0 text-[var(--transcript-step-mark)]" />
            <span className="min-w-0 truncate text-thread font-medium text-foreground">Read your attempt</span>
            {stats.casesTracked > 0 && (
              <CaseRing className="ml-auto" neverPassed={stats.neverPassed} passing={passing} regressions={stats.regressions} total={stats.casesTracked} />
            )}
            {verdict && (
              <span
                className={cn("shrink-0 rounded-md px-1.5 text-thread font-medium", !stats.casesTracked && "ml-auto")}
                style={{ color: verdict.tone, background: `color-mix(in oklab, ${verdict.tone} 12%, transparent)` }}
              >
                {verdict.word}
              </span>
            )}
            <Caret className={cn(!stats.casesTracked && !verdict && "ml-auto")} open={open} />
          </div>

          {/* Under the title rather than under the mark, so the card is two lines of
              one statement instead of a header with a table beneath it. */}
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 pr-2.5 pb-1.5 pl-[2.125rem]">
            <Stat label="on it" value={spentOn(stats.elapsedMs)} />
            <Stat label={stats.runs === 1 ? "run" : "runs"} value={stats.runs} />
            {stats.submissions > 0 && <Stat label={stats.submissions === 1 ? "submission" : "submissions"} value={stats.submissions} />}

            {stats.casesTracked > 0 && (
              <Stat label={passing === stats.casesTracked ? "cases, all passing" : `of ${stats.casesTracked} cases passing`} tone="var(--success)" value={passing} />
            )}
            {stats.neverPassed > 0 && <Stat label="never passed" tone="var(--destructive)" value={stats.neverPassed} />}
            {stats.regressions > 0 && <Stat label="broke after passing" tone="var(--warning)" value={stats.regressions} />}
            {/* The thing the counts cannot show, and it explains more failed attempts
                than any of them. */}
            {stats.submittedBlind && <span className="text-thread whitespace-nowrap text-[var(--warning)]">submitted without running</span>}
          </div>
        </CollapsibleTrigger>

        {/* Their code and the log behind the numbers, inside the card rather than
            under it — so the card is a step you can look inside rather than a
            summary with somewhere else to go. The rule is the only new edge the
            expansion draws, and it arrives with the panel it separates. */}
        <CollapsibleContent expandDuration={0.42}>
          <div className="agent-tool-detail min-w-0 border-t border-[var(--border-surface-strong)]">
            <ToolDetail input={part.input} output={part.output} tool={part.tool} />
          </div>
        </CollapsibleContent>
      </motion.div>
    </Collapsible>
  );
}

/** What the attempt came to, in the corner of its card. */
const VERDICT: Record<Exclude<SolveStats["outcome"], "">, { word: string; tone: string }> = {
  passed: { word: "Passed", tone: "var(--success)" },
  failed: { word: "Failed", tone: "var(--destructive)" },
  abandoned: { word: "Left unfinished", tone: "var(--warning)" },
  "in-progress": { word: "Still open", tone: "var(--transcript-step-mark)" },
};

/**
 * How the cases stand, as one mark.
 *
 * This replaces a two-pixel bar along the card's bottom edge. The bar was
 * efficient — colour that cost no height — and wrong in a way efficiency does
 * not fix: at the foot of a card, spanning its whole width, it read as the
 * card's own border having gone green, which is a decorative state rather than a
 * measurement. Nothing about it invited a second look, so the one number in it
 * had nowhere to go.
 *
 * A ring reads as a figure because it is round and small and sits beside a
 * label, and it can hold what the bar could not: the ratio at a glance, and the
 * whole of it — including the cases that broke after passing, which the bar
 * never had a third colour for — on hover.
 */
function CaseRing({ className, neverPassed, passing, regressions, total }: { className?: string; neverPassed: number; passing: number; regressions: number; total: number }) {
  /* Drawn as a dash on one circle rather than as an arc path: one length to
     compute, no trigonometry, and no seam where two arcs meet. Rotated so it
     starts at twelve o'clock, which is where a proportion is read from. */
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const complete = total > 0 && passing === total;
  const tone = complete ? "var(--success)" : neverPassed > 0 ? "var(--destructive)" : "var(--warning)";

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn("grid size-4 shrink-0 cursor-default place-items-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring", className)}
        tabIndex={0}
        type="button"
      >
        <svg aria-hidden className="size-4 -rotate-90" viewBox="0 0 16 16">
          <circle cx="8" cy="8" fill="none" r={radius} stroke="var(--border-surface-strong)" strokeWidth="2.5" />
          <circle
            cx="8"
            cy="8"
            fill="none"
            r={radius}
            stroke={tone}
            strokeDasharray={`${(circumference * passing) / Math.max(1, total)} ${circumference}`}
            strokeLinecap={complete ? "butt" : "round"}
            strokeWidth="2.5"
          />
        </svg>
        <span className="sr-only">{`${passing} of ${total} cases passing`}</span>
      </TooltipTrigger>
      {/* Everything the mark stands for, in the order it matters. The two lines
          below the count are only drawn when they happened, so a clean solve
          gets one line rather than a report with two zeroes in it. */}
      <TooltipContent className="max-w-[16rem]">
        <span className="block">{passing === total ? `All ${total} cases passing` : `${passing} of ${total} cases passing`}</span>
        {neverPassed > 0 && <span className="mt-0.5 block opacity-80">{neverPassed} never passed in any run</span>}
        {regressions > 0 && <span className="mt-0.5 block opacity-80">{regressions} passed and then broke again</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/** One number and what it counts. The number carries the weight and the colour
 *  and the word after it stays at the step's own grey, so a row of these reads as
 *  figures with captions rather than as a sentence with numerals in it. */
function Stat({ value, label, tone }: { value: string | number; label: string; tone?: string }) {
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-thread font-medium tabular-nums" style={tone ? { color: tone } : undefined}>{value}</span>
      <span className="text-thread text-[var(--transcript-step-mark)]">{label}</span>
    </span>
  );
}

/**
 * The moment the session exists to reach.
 *
 * A card, and the only one in a turn that is allowed to look like an object
 * rather than a line of a log — because it is the one thing in the transcript
 * the learner is being handed rather than told about. It earns the shape by
 * carrying what a handover actually has to carry: which language they are about
 * to write, what the problem is called, what it is aimed at, and what will grade
 * it. As a single grey line — `Typed Record Partitioning · validated` — every one
 * of those facts was somewhere else on the screen or nowhere at all.
 *
 * It is deliberately not the card this replaced two revisions ago. That one was
 * a bordered green panel with an uppercase kicker, a spring-scaled badge and a
 * light sweep across it, and it read as a component from a different application
 * pasted into the thread; the note it left behind when it was cut back to a row
 * is worth keeping, because it is the failure mode this has to stay clear of.
 * So: the transcript's own surface and hairline, the same as `SolveRead` beside
 * it, no fill, no accent panel. The language mark and the weight on the title do
 * the work.
 *
 * Nothing here is claimed that the row cannot prove. A challenge Spar compiled
 * says how many cases will run because the compiler counted them; a problem Spar
 * mounted says which judge decides it, and nothing about cases, because Spar
 * never compiled it and has no number of its own to give.
 */

export function ChallengePublished({
  part,
  compact = false,
  currentQuestionId,
  trail,
}: {
  part: ToolPart;
  compact?: boolean;
  currentQuestionId?: string | undefined;
  trail?: ChallengeTrail | undefined;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const reduced = useReducedMotion();
  const arrival = useThreadArrival(true);
  const challenge = readPublishedChallenge(part);
  const sourced = challenge.source !== null;
  /* Falls back to the sniffer for a row stored before the result carried the
     mounted problem — the old row guessed the same way, and guessing which of
     two logos to draw is a different order of claim from guessing a fact. */
  const source = challenge.source ?? sourceFor(part);
  const sourceName = source === "codeforces" ? "Codeforces" : "LeetCode";
  const stop = challenge.questionId ? trail?.stops.find((item) => item.id === challenge.questionId) : undefined;
  const current = challenge.questionId === currentQuestionId;
  const open = stop && !current ? () => trail?.onGo(stop) : undefined;
  const ordinal = challenge.ordinal ?? stop?.ordinal;
  const sessionStops = trail?.stops ?? [];
  const historyStops = useMemo(
    () => sessionStops.filter((item) => item.id !== challenge.questionId),
    [sessionStops, challenge.questionId],
  );
  const behind = Math.min(2, historyStops.length);
  const maskId = useId().replace(/:/g, "");
  const stackRef = useRef<HTMLDivElement | null>(null);
  const frontRef = useRef<HTMLDivElement | null>(null);
  const cardTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pinHistoryRef = useRef(true);
  const historyAnimatingRef = useRef(false);
  const stackHeightsRef = useRef({ viewport: 0, content: 0 });
  const [historyEdges, setHistoryEdges] = useState({ top: false, bottom: false });
  const updateHistoryEdges = useCallback(() => {
    const element = stackRef.current;
    if (!element || !historyOpen) return;
    const tolerance = 1;
    const next = {
      top: element.scrollTop > tolerance,
      bottom: element.scrollTop + element.clientHeight < element.scrollHeight - tolerance,
    };
    setHistoryEdges((previous) => previous.top === next.top && previous.bottom === next.bottom ? previous : next);
  }, [historyOpen]);
  const pinHistory = () => {
    if (!pinHistoryRef.current || !stackRef.current) return;
    const { content, viewport } = stackHeightsRef.current;
    // Both values come from Motion; avoid a forced layout read on every frame.
    stackRef.current.scrollTop = Math.max(0, content - viewport);
  };
  const [cardGeometry, setCardGeometry] = useState({ width: 0, radius: 22.4 });
  useLayoutEffect(() => {
    const element = frontRef.current;
    if (!element) return;
    const measure = () => {
      const surface = element.firstElementChild;
      const width = element.getBoundingClientRect().width;
      const radius = surface ? parseFloat(getComputedStyle(surface).borderTopLeftRadius) : 22.4;
      setCardGeometry((previous) => previous.width === width && previous.radius === radius
        ? previous
        : { width, radius });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact]);
  const closedHeight = behind * 10;
  /* Give every card its own timestamp across one bounded deal. A fixed capped
     per-card delay made the oldest cards in a long session share the cap and
     drop as a clump. Normalising the whole list preserves the same cadence for
     ordinary sessions, compresses only when the list is genuinely long, and
     gives collapse an exact set of timestamps to mirror. */
  const dealSteps = Math.max(0, historyStops.length - 1);
  const lastDealDelay = Math.min(0.42, dealSteps * 0.038);
  const maskBottom = useMotionValue(closedHeight + 80);
  const [historyClipped, setHistoryClipped] = useState(false);
  useEffect(() => {
    historyAnimatingRef.current = true;
    if (historyOpen) setHistoryClipped(true);
    const timer = window.setTimeout(() => {
      historyAnimatingRef.current = false;
      if (historyOpen) updateHistoryEdges();
      else setHistoryClipped(false);
    }, reduced ? 0 : Math.ceil((0.95 + lastDealDelay) * 1_000));
    return () => window.clearTimeout(timer);
  }, [historyOpen, lastDealDelay, reduced, updateHistoryEdges]);
  const rowPitch = 60;
  const listHeight = historyStops.length * rowPitch;
  const contentHeight = historyOpen ? listHeight : closedHeight;
  const historyFade = historyEdges.top && historyEdges.bottom
    ? STACK_FADE_BOTH
    : historyEdges.top
      ? STACK_FADE_TOP
      : historyEdges.bottom
        ? STACK_FADE_BOTTOM
        : undefined;
  const stackTransition = reduced
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 105, damping: 22, mass: 1.5 };
  const occlusionPaths = useMemo(() => [0, 1].map((depth) => stackOcclusionPath(
    cardGeometry.width * depth * 0.05,
    0,
    cardGeometry.width * (1 - depth * 0.1),
    cardGeometry.radius,
  )), [cardGeometry]);

  /* Never on the challenge they are on. The current one is open in the pane
     beside the transcript with its own code in it, so a panel on the cursor
     saying what it starts from is the app showing them a smaller copy of what
     they are looking at. Suppressed while the stack is open too, for the reason
     a tooltip is suppressed while its menu is: they are reading the session's
     other challenges, and a panel about this one riding over them answers a
     question nobody asked. */
  const previewData = useMemo(
    () => publishedPreviewData(challenge, sourced ? source : null, sourceName),
    [challenge, sourced, source, sourceName],
  );
  const preview = useCursorPreview(
    <ChallengePreview data={previewData} stop={stop} />,
    !compact && !current && !historyOpen && hasChallengePreview(previewData),
  );

  /* One hook for the whole stack rather than one per row — rows are a `map`, and
     a hook cannot live in one. Which row the pointer is on is state the list
     owns anyway, since only one of them can be hovered. */
  const [hoveredStop, setHoveredStop] = useState<ChallengeStop | null>(null);
  const hoveredData = useMemo(() => hoveredStop ? stopPreviewData(hoveredStop) : null, [hoveredStop]);
  const listPreview = useCursorPreview(
    hoveredData && hoveredStop && hasChallengePreview(hoveredData)
      ? <ChallengePreview data={hoveredData} stop={hoveredStop} />
      : null,
    historyOpen,
  );

  if (compact) {
    return (
      <div className="flex min-w-0 items-center gap-2 py-1 text-thread text-muted-foreground">
        <span className="grid size-5 shrink-0 place-items-center text-[var(--transcript-step-mark)]">
          {sourced
            ? <SourceGlyph className="size-3.5" source={source} />
            : challenge.language
              ? <LanguageGlyph className="size-3.5" language={challenge.language} />
              : <IconPuzzle className="size-3.5" />}
        </span>
        {ordinal && <span className="shrink-0 font-mono text-thread tabular-nums text-muted-foreground/60">#{ordinal}</span>}
        <span className="min-w-0 truncate text-thread text-foreground/80">{challenge.title}</span>
        <span className="shrink-0 truncate text-thread text-muted-foreground/70">
          {challenge.difficulty ? DIFFICULTY_WORD[challenge.difficulty] : ""}
          {challenge.concepts[0] ? ` · ${challenge.concepts[0]}` : ""}
          {sourced ? ` · ${sourceName}` : ""}
        </span>
      </div>
    );
  }

  const card = (
    <ArtifactCard
      animate={arrival.animate}
      data-stack-front={behind > 0 && !historyOpen ? "true" : undefined}
      /* Lifted a little further than a step row's entrance, and no further: this
         arrives after a minute of work and should land rather than appear, but a
         card that slides in from 10px past a settled list is the transcript
         performing. */
      className={cn(
        "group/challenge relative my-0 min-w-0 overflow-visible transition-[background-color,box-shadow] duration-100",
        BLOCK_SURFACE,
        open && "hover:bg-[var(--surface-primary)]",
        sessionStops.length > 1 && "hover:bg-[var(--surface-primary)]",
        historyOpen && "shadow-[var(--app-shadow-composer)]",
      )}
      onClick={(event) => {
        if (sessionStops.length < 2 || (event.target as HTMLElement).closest("button,a,input,textarea,select")) return;
        pinHistoryRef.current = true;
        setHistoryOpen((value) => !value);
      }}
      {...preview.handlers}
      style={{ marginBlock: 0 }}
      initial={arrival.initial}
      transition={{ ...stackTransition, opacity: { duration: 0.18 } }}
    >
      <ArtifactCardRow icon={sourced
            ? <SourceGlyph className="size-4" source={source} />
            : challenge.language
              ? <LanguageGlyph aria-label={LANGUAGE_LABEL[challenge.language]} className="size-4" language={challenge.language} role="img" />
              : <IconPuzzle className="size-4 text-[var(--transcript-step-mark)]" />}>
        {/* The controls float over the card's top-right corner rather than sitting
            in this row, so the reserved gutter is the only trace they leave in
            the flow — a title that stops short of running under them. */}
        <div className={cn(
          "min-w-0 flex-1",
          stop?.outcome
            ? current ? "pr-28" : "pr-20"
            : current ? "pr-14" : "pr-8",
        )}>
          <div className="flex min-w-0 items-center gap-1.5">
            {ordinal ? <span className="shrink-0 font-mono text-thread tabular-nums text-muted-foreground/60">#{ordinal}</span> : null}
            <button
              ref={cardTriggerRef}
              aria-current={current ? "page" : undefined}
              aria-controls={sessionStops.length > 1 ? `${maskId}-history` : undefined}
              aria-expanded={sessionStops.length > 1 ? historyOpen : undefined}
              className="min-w-0 truncate rounded-md text-left text-thread font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
              disabled={sessionStops.length < 2 && !open}
              onClick={() => {
                if (sessionStops.length > 1) {
                  pinHistoryRef.current = true;
                  setHistoryOpen((value) => !value);
                  return;
                }
                open?.();
              }}
              title={sessionStops.length > 1 ? (historyOpen ? "Hide session challenges" : "Show session challenges") : open ? `Open challenge ${challenge.title}` : current ? "Current challenge" : undefined}
              type="button"
            >{challenge.title}</button>
          </div>

          {/* One line, in the order it is read: how hard, what it is about, who
              grades it. Wraps rather than truncates — losing the grader to an
              ellipsis is losing the only part of this that is a promise. */}
          {stop ? <ChallengeCardMeta stop={stop} /> : <span className="mt-px flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-thread text-[var(--transcript-step-mark)]">
            {challenge.difficulty && <span className="font-medium text-foreground/70">{DIFFICULTY_WORD[challenge.difficulty]}</span>}
            {challenge.band && <span className="font-medium text-foreground/70">{BAND_WORD[challenge.band]}</span>}
            {challenge.concepts.slice(0, 2).map((concept) => (
              <span className="min-w-0 truncate" key={concept}>· {concept}</span>
            ))}
            <span className="whitespace-nowrap">
              {sourced
                ? `· judged by ${sourceName}${challenge.displayId ? ` · ${challenge.displayId}` : ""}`
                : challenge.cases
                  ? `· ${challenge.cases} cases will grade it`
                  : "· validated"}
            </span>
          </span>}
        </div>
      </ArtifactCardRow>

      {/* Status and actions share the same top-right alignment used by every
          revealed history card. The card surface itself opens the stack. */}
      <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5">
        {stop && <ChallengeOutcomeTag outcome={stop.outcome} />}
        {current && <SaveProblem problemKey={challenge.questionId ? `spar:${challenge.questionId}` : null} title={challenge.title} />}
        {stop && trail
          ? <ChallengeCardMenu includeSave={!current} stop={stop} trail={trail} />
          : !current && <SaveProblem problemKey={challenge.questionId ? `spar:${challenge.questionId}` : null} title={challenge.title} />}
      </div>
    </ArtifactCard>
  );

  return (
    <div
      className="relative isolate my-4 min-w-0"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          pinHistoryRef.current = true;
          setHistoryOpen(false);
          cardTriggerRef.current?.focus({ preventScroll: true });
        }
      }}
    >
      <motion.div
        ref={stackRef}
        id={`${maskId}-history`}
        className="relative"
        onScroll={() => { if (!historyAnimatingRef.current) updateHistoryEdges(); }}
        onWheel={() => { pinHistoryRef.current = false; }}
        onTouchStart={() => { pinHistoryRef.current = false; }}
        onPointerDown={() => { pinHistoryRef.current = false; }}
        onKeyDown={() => { pinHistoryRef.current = false; }}
        initial={false}
        animate={{ height: historyOpen ? Math.min(216, listHeight) : closedHeight }}
        transition={stackTransition}
        style={{
          overflow: historyOpen || historyClipped ? "auto" : "visible",
          overflowX: historyOpen || historyClipped ? "hidden" : "visible",
          scrollbarWidth: "none",
          maskImage: historyOpen || historyClipped ? historyFade : undefined,
          WebkitMaskImage: historyOpen || historyClipped ? historyFade : undefined,
        }}
        onUpdate={(latest) => {
          stackHeightsRef.current.viewport = Number(latest.height);
          pinHistory();
        }}
      >
        <motion.div
          className="relative"
          style={{ overflow: historyOpen || historyClipped ? "hidden" : "visible" }}
          initial={false}
          animate={{ height: contentHeight }}
          transition={stackTransition}
          onUpdate={(latest) => {
            stackHeightsRef.current.content = Number(latest.height);
            maskBottom.set(Number(latest.height) + 80);
            pinHistory();
          }}
        >
          {historyStops.map((item, index) => {
            const depth = historyStops.length - index;
            const visibleDepth = Math.min(depth, 2);
            const nextDepth = Math.max(0, visibleDepth - 1);
            const cutout = `${maskId}-${item.id}`;
            const delayFor = (cardDepth: number) => {
              const progress = dealSteps > 0 ? Math.max(0, cardDepth - 1) / dealSteps : 0;
              const openingDelay = lastDealDelay * progress;
              return reduced ? 0 : historyOpen ? openingDelay : lastDealDelay - openingDelay;
            };
            const dealTransition = { ...stackTransition, delay: delayFor(depth) };
            const nearerTransition = { ...stackTransition, delay: depth > 1 ? delayFor(depth - 1) : 0 };
            return (
              // These same mounted cards move into the list and back. Each mask
              // subtracts the nearer card's silhouette, including rounded corners,
              // instead of painting over it or cutting a detached horizontal strip.
              <div
                key={item.id}
                className="pointer-events-none absolute inset-x-0 top-0"
                style={{ height: "calc(100% + 80px)", zIndex: index }}
              >
                <svg aria-hidden className="absolute h-full w-full overflow-visible">
                  <defs>
                    <mask id={cutout} maskUnits="userSpaceOnUse" x="0" y="-1" width="100%" height="100%" style={{ maskType: "luminance" }}>
                      <rect x="0" y="-1" width="100%" height="100%" fill="white" />
                      <motion.g style={{ y: maskBottom }}>
                        <motion.g
                          initial={false}
                          animate={{ y: -80 - (historyOpen ? (depth - 1) * rowPitch : nextDepth * 10) }}
                          transition={nearerTransition}
                        >
                          <motion.path
                            initial={false}
                            animate={{ d: occlusionPaths[historyOpen ? 0 : nextDepth]! }}
                            fill="black"
                            transition={nearerTransition}
                          />
                        </motion.g>
                      </motion.g>
                    </mask>
                  </defs>
                </svg>
                <div className="absolute inset-0" style={{ mask: `url(#${cutout})`, WebkitMask: `url(#${cutout})` }}>
                  <motion.div
                    initial={false}
                    animate={{
                      y: -80 - (historyOpen ? depth * rowPitch : visibleDepth * 10),
                      left: historyOpen ? "0%" : `${visibleDepth * 5}%`,
                      width: historyOpen ? "100%" : `${100 - visibleDepth * 10}%`,
                      opacity: historyOpen ? 1 : depth <= 2 ? 1 - depth * 0.15 : 0,
                    }}
                    data-stack-depth={historyOpen ? undefined : visibleDepth}
                    aria-hidden={!historyOpen}
                    inert={!historyOpen}
                    className={cn(BLOCK_SURFACE, "absolute my-0 flex h-14 min-w-0 items-center gap-2.5 px-3 text-left outline-none transition-colors duration-100 hover:bg-[var(--surface-primary)]")}
                    /* The row tells the stack's one preview which challenge it is
                       before handing the pointer on, so the panel that opens is
                       about the row under the cursor rather than the last one.
                       The challenge they are on is the exception, here as on the
                       front card: it is already open in the pane beside this. */
                    onPointerEnter={(event) => {
                      setHoveredStop(item.id === currentQuestionId ? null : item);
                      listPreview.handlers.onPointerEnter(event);
                    }}
                    onPointerDown={listPreview.handlers.onPointerDown}
                    onPointerLeave={listPreview.handlers.onPointerLeave}
                    onPointerMove={listPreview.handlers.onPointerMove}
                    style={{ top: "100%", pointerEvents: historyOpen ? "auto" : "none", marginBlock: 0 }}
                    transition={dealTransition}
                  >
                    <motion.span
                      className="flex w-full min-w-0 items-center gap-2.5"
                      initial={false}
                      animate={{ opacity: historyOpen ? 1 : 0 }}
                      transition={dealTransition}
                    >
                      <button
                        aria-current={item.id === currentQuestionId ? "page" : undefined}
                        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          pinHistoryRef.current = true;
                          setHistoryOpen(false);
                          trail?.onGo(item);
                        }}
                        type="button"
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--color-background-elevated-secondary)] font-mono text-thread tabular-nums text-muted-foreground">#{item.ordinal}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate text-thread font-medium">{item.title}</span>
                            <ChallengeOutcomeTag outcome={item.outcome} />
                          </span>
                          <ChallengeCardMeta stop={item} />
                        </span>
                      </button>
                      {trail && <ChallengeCardMenu stop={item} trail={trail} />}
                    </motion.span>
                  </motion.div>
                </div>
              </div>
            );
          })}
        </motion.div>
      </motion.div>
      <div className="relative z-20" ref={frontRef}>{card}</div>
      {preview.overlay}
      {listPreview.overlay}
    </div>
  );
}

/** Match transcript-block's superellipse(1.4) top corners. The cutout
 * continues below the card so no deeper layer can bleed through its surface. */
function stackOcclusionPath(x: number, y: number, width: number, radius: number): string {
  const r = Math.min(radius, width / 2, 24);
  const power = 2 / 2 ** 1.4;
  const points: string[] = [`M ${x} ${y + 10000}`, `L ${x} ${y + r}`];
  for (let step = 1; step <= 20; step++) {
    const angle = step / 20 * Math.PI / 2;
    points.push(`L ${x + r - r * Math.cos(angle) ** power} ${y + r - r * Math.sin(angle) ** power}`);
  }
  points.push(`L ${x + width - r} ${y}`);
  for (let step = 1; step <= 20; step++) {
    const angle = step / 20 * Math.PI / 2;
    points.push(`L ${x + width - r + r * Math.sin(angle) ** power} ${y + r - r * Math.cos(angle) ** power}`);
  }
  points.push(`L ${x + width} ${y + 10000} Z`);
  return points.join(" ");
}

function formatChallengeTime(elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

/** Spar's own bands, and a judge's, in the one word each that fits on the line. */

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
