import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown, Check, Copy, Pencil, ThumbsDown, ThumbsUp } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import type { AgentActivityStep, SessionDetail } from "@spar/domain";
import { cn } from "@/lib/utils";
import { FADE_SLACK, transcriptFadeStyle } from "@/hooks/use-transcript-fade";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MESSAGE_ACTION_ROW, MessageAction, MessageActionButton } from "./MessageActions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Markdown } from "./Markdown";
import { parseReference, Reference, ReferenceCards, REFERENCE_PATTERN, type ReferenceKind } from "./MarkdownLinks";
import { ChallengePublished, FINAL_GAP, PROSE_GAP, Reasoning, ROW_GLYPH, RunFailure, SolveRead, STEP_GAP, ToolRow } from "./ActivityRow";
import { ExplainedTrace } from "./ExplainedTrace";
import { LessonCard } from "./LessonCard";
import { SystemEvent } from "./SystemEvent";
import { groupParts, isPublishedArtifact, publishedRunArtifacts, type AgentRun, type RunPart } from "./agentRun";
import { RunFold } from "./RunFold";
import { unreconciledOptimisticMessages, type OptimisticLearnerMessage } from "./optimisticMessages";
import type { ChallengeTrail } from "../workspace/ChallengeStepper";

export type { OptimisticLearnerMessage } from "./optimisticMessages";

/** Construct stores the same shape Spar streamed, so the thread needs no
 *  adapter — only the name of the type it reads. */
type Message = SessionDetail["messages"][number];

const PHASE_LABEL: Record<string, string> = {
  research: "Reading up on this project",
  opening: "Planning your path",
};

/** What that work actually is, for the wait before it has anything to show.
 *  Only shown while there is nothing else on screen: once tool rows are
 *  arriving they say it better than a sentence can. */
const PHASE_DETAIL: Record<string, string> = {
  research: "Construct is reading the docs and the code for this before it teaches anything. It takes a minute, and what it finds is saved to .construct/research.md.",
  opening: "Construct is laying out the steps between here and what you said you wanted to build. They will appear in the Path panel.",
};

/** The line that names a turn Construct started for itself.
 *
 *  A learner who has just made a project did not ask for this turn, so the
 *  first thing they see has to say what it is — otherwise a minute of tool rows
 *  is a minute of unexplained activity. It shimmers while the turn is live and
 *  settles to plain when it is not: a static label over a minute of tool calls
 *  is the thing that made a running turn look stalled. */
function PhaseLine({ live, phase }: { live: boolean; phase?: string | null | undefined }) {
  const label = phase ? PHASE_LABEL[phase] : undefined;
  if (!label) return null;
  return (
    /* In the rows' own gutter, not hard against the column edge. The dot takes
       the slot a tool's mark would take and the label starts where a tool's
       label starts, so the line that names the turn belongs to the list of work
       under it rather than floating to the left of everything. */
    <p className="-mx-1 mb-1.5 flex items-center gap-1.5 text-thread font-medium tracking-wide uppercase">
      <span aria-hidden className={ROW_GLYPH}>
        <span className="size-1.5 rounded-full bg-[var(--brand)]" />
      </span>
      <span className={cn("min-w-0", live ? "thinking-shimmer" : "text-[var(--transcript-step-strong)]")}>{label}</span>
    </p>
  );
}

/**
 * A turn that is running and has not said anything yet.
 *
 * The gap this fills is the whole of "my new project did nothing": between
 * pressing Create and the first tool row there is a model call, and on a slow
 * provider that is most of a minute. Before this, that minute was an empty
 * thread, which is indistinguishable from a project where the kickoff never
 * ran. It is also what the window falls back to when it mounts into a turn
 * already in flight and has no stream to draw.
 */
function PhaseWait({ phase }: { phase?: string | null | undefined }) {
  if (!phase || !PHASE_LABEL[phase]) return null;
  return (
    <div className="min-w-0">
      <PhaseLine live phase={phase} />
      <p className="text-thread leading-[1.6] text-muted-foreground">{PHASE_DETAIL[phase]}</p>
    </div>
  );
}

/**
 * The turn as it happens: the work, then the answer.
 *
 * The split is the worker's own — it says which phase it has opened, and the
 * phase with no tools is the one that replies. Everything before that point is
 * the work and folds itself away when the answer starts; everything after is
 * the answer and stays where the learner is already reading.
 */
function LiveRun({ run, phase, currentQuestionId, trail }: { run: AgentRun; phase?: string | null | undefined; currentQuestionId?: string | undefined; trail?: ChallengeTrail | undefined }) {
  const streaming = run.status === "streaming";
  const boundary = run.finalFrom ?? run.parts.length;
  const work = run.parts.slice(0, boundary);
  const reply = run.parts.slice(boundary);
  // Published artifacts remain accessible even when the work is collapsed.
  const published = publishedRunArtifacts(run);
  const reduced = useReducedMotion();
  /* The same rule live: the fold is the lid on the work, and a turn that went
     straight to answering has no work under it. While it is still waiting for
     the first token the lid stays — there the transient line inside it is the
     only thing saying the turn is alive. */
  const waiting = streaming && run.finalStartedAt === undefined;
  const shows = waiting || work.length > 0;
  return (
    /* The turn opening. A send used to be answered by a header, a rule and a
       waiting line all appearing in one frame in the empty space under the
       bubble — the reply to pressing Return was a block of chrome landing on the
       page, which reads as something having gone wrong rather than as work
       starting. It comes up from under the message it answers instead, on the
       bubble's own spring, so the send and the turn it starts are one movement. */
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="min-w-0"
      initial={reduced ? false : { opacity: 0, y: 10 }}
      transition={{ type: "spring", visualDuration: 0.45, bounce: 0 }}
    >
      <PhaseLine live={streaming} phase={phase} />
      {/* "Working for 0s" over an empty fold, before the provider has sent a
          token, is the turn reporting on a wait rather than on work. The header
          arrives with the first thing the model says. */}
      {shows && (
      <RunFold connected={work.length > 0 || run.finalStartedAt !== undefined} finalStartedAt={run.finalStartedAt} live={streaming} startedAt={run.startedAt}>
        <Rows compactChallenges currentQuestionId={currentQuestionId} parts={work} trail={trail} />
        {/* The one transient line of a live turn: the wait before the provider
            has sent anything. Everything after it — the thinking included — is a
            real part with a row of its own, so there is nothing left to swap. */}
        <AnimatePresence initial={false} mode="popLayout">
          {streaming && run.finalStartedAt === undefined && (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              key="waiting"
              style={{ marginTop: STEP_GAP }}
              transition={{ type: "spring", visualDuration: 0.35, bounce: 0 }}
            ><WaitingLine parts={work} /></motion.div>
          )}
        </AnimatePresence>
      </RunFold>
      )}
      {published.length > 0 && <div style={{ marginTop: PROSE_GAP }}><Rows currentQuestionId={currentQuestionId} parts={published} trail={trail} /></div>}
      {reply.length > 0 && <FinalReply gap={shows || published.length > 0}><Rows currentQuestionId={currentQuestionId} parts={reply} trail={trail} /></FinalReply>}
    </motion.div>
  );
}

/**
 * The answer arriving, once.
 *
 * The moment the work stops and the reply starts is the one the learner has been
 * waiting through a minute of tool rows for, and it used to be the least marked
 * thing on screen: the fold collapsed and text was simply there, in the space
 * the steps had been, with no frame between the two states. So the reply rises
 * the same few pixels the fold falls, on the fold's own timing — the two read as
 * one exchange rather than as a disappearance followed by an appearance.
 *
 * Only on mount, and only here. The settled turn draws the same words from
 * storage a moment later, and animating those too would play the arrival twice
 * for one answer.
 */
function FinalReply({ children, gap }: { children: React.ReactNode; gap: boolean }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="min-w-0"
      initial={reduced ? false : { opacity: 0, y: 10 }}
      style={{ marginTop: gap ? FINAL_GAP : 0 }}
      transition={{ type: "spring", visualDuration: 0.5, bounce: 0 }}
    >{children}</motion.div>
  );
}

/**
 * Every row of a turn, live or read back from storage, in the order it happened.
 *
 * Spacing is per-row rather than one gap between all of them. A uniform
 * `space-y` set every step the same distance from its neighbour, which spread a
 * run of calls down the page as far apart as the sentences around them — and the
 * reference this is matched against does the opposite: consecutive calls sit
 * tight as one cluster, and the prose is what gets the room. That contrast is
 * what makes a turn scannable, because the shape of the page tells you where the
 * agent was working and where it was talking to you before you read a word.
 */
/**
 * Whether this row is drawn with the icon gutter the thread runs down.
 *
 * A published challenge and a solve reading are full-width blocks with no mark
 * in the gutter, so joining one to the row above it would draw a line into the
 * side of a card.
 */
function hasGutter(row: ReturnType<typeof groupParts>[number] | undefined): boolean {
  return row?.kind === "tool-row";
}

function Rows({ parts, compactChallenges = false, currentQuestionId, trail }: { parts: RunPart[]; compactChallenges?: boolean; currentQuestionId?: string | undefined; trail?: ChallengeTrail | undefined }) {
  const rows = groupParts(parts);
  return (
    <>
      {rows.map((part, index) => {
        const previous = rows[index - 1];
        /* Steps in the same run of work. Kept tight, and joined by a rule through
           the icon gutter so the cluster reads as one sequence.

           Both rows have to be drawn as rows for that to be true: a published
           challenge is a card with no icon column for a rule to run down, so a
           cluster containing one is not a thread — see `hasGutter`. */
        const linked = hasGutter(part) && hasGutter(previous);
        /* And whether the run continues past this row. A step needs to know both:
           the line above its mark is only drawn when something came before, and
           the line below it only when something follows. */
        const continues = hasGutter(part) && hasGutter(rows[index + 1]);
        /* No margin between two steps of the same run: that gap is padding
           inside the upper row, so the thread can run through it. Everything
           else is spaced from the outside as before. */
        /* Prose claims its room from both sides. Reading only this row's kind
           gave a paragraph air above it and left the next step tight underneath,
           so a sentence looked attached to the work that came after it rather
           than to the turn it belongs to. */
        const prose = part.kind === "text" || previous?.kind === "text";
        const gap = index === 0 || linked ? undefined : prose ? PROSE_GAP : STEP_GAP;
        const wrap = (node: React.ReactNode) => (
          <div key={part.id} className="min-w-0" {...(gap ? { style: { marginTop: gap } } : {})}>
            {node}
          </div>
        );

        /* No bottom padding: the gap under a paragraph is PROSE_GAP now, set by
           the row beneath it, and a pad here on top of that was the part that
           made the spacing around prose impossible to predict. */
        if (part.kind === "text") return wrap(<div className="text-foreground"><Markdown source={part.body} /></div>);
        /* The model's own thinking, in its place in the column. A generic
           "Thinking" row pinned to the live edge threw away the part worth
           reading — the heading the model gave its own working — and left a
           turn's reasoning unaccounted for once it settled. `Reasoning` draws
           one row per block of thought, titled with that heading and opening
           onto the thinking behind it. */
        if (part.kind === "reasoning") return wrap(<Reasoning part={part} />);
        if (part.kind === "tool-row") {
          /* Tool input and output remain inspectable. Provider reasoning bound to
             the tool is intentionally not rendered as another content surface. */
          return wrap(<ToolRow continues={continues} part={part.part} />);
        }
        if (part.kind === "challenge") return wrap(<ChallengePublished compact={compactChallenges} currentQuestionId={currentQuestionId} part={part.part} trail={trail} />);
        if (part.kind === "solve-read") return wrap(<SolveRead part={part.part} />);
        if (part.kind === "explained-trace") return wrap(<ExplainedTrace part={part.part} />);
        /* The turn's other handover. Same weight as a published challenge,
           because that is what it is. */
        if (part.kind === "lesson") return compactChallenges ? wrap(<ToolRow continues={continues} part={part.part} />) : wrap(<LessonCard part={part.part} />);
        if (part.kind === "error") return wrap(<RunFailure body={part.body} />);
        return wrap(<div className="truncate text-thread text-[var(--transcript-step)]">{part.body}</div>);
      })}
    </>
  );
}

/**
 * Any moment of a live turn with nothing of its own on screen.
 *
 * This used to be a permanent "Thinking" row that covered every quiet moment of a
 * turn, which is what made the transcript look like one opaque label with a tool
 * list above it — the reasoning and the replies were arriving and the row simply
 * sat on top of them. The fix for that went too far the other way: it drew only
 * before the first part, so every later gap — and a turn is mostly gaps, because
 * the agent narrates a step in prose and then waits on a provider call before the
 * step's row exists — ended with a settled sentence and no sign of anything
 * running. A learner watching that has no way to tell a turn thinking about the
 * challenge it is about to write from a turn that died.
 *
 * So the rule is not "before the first part" but "whenever nothing else is live":
 * no tool running, no thought open. The instant either starts, that row says it
 * better and this one goes.
 */
function WaitingLine({ parts }: { parts: RunPart[] }) {
  const live = parts.some((part) =>
    (part.kind === "tool" && part.phase === "running") || (part.kind === "reasoning" && part.open),
  );
  if (live) return null;
  /* Before anything has arrived the wait is the provider call itself, and saying
     so is the difference between a slow turn and a broken one. After that the
     turn has already told the learner what it is doing — in the sentence directly
     above this row — and repeating it here in worse words would be noise. */
  const opening = parts.length === 0;
  return (
    <div className="-mx-1 flex items-center gap-1.5 py-0.5">
      <span className={cn(ROW_GLYPH, "relative")}>
        <span className="absolute inset-0 rounded-full bg-[var(--accent)]/10 blur-sm" />
        <ThinkingOrb aria-label="Working" size={20} state={opening ? "connecting" : "working"} style={{ width: 16, height: 16 }} />
      </span>
      <span className="thinking-shimmer min-w-0 truncate text-thread font-medium">
        {opening ? "Connecting to the model" : "Working"}
      </span>
    </div>
  );
}

/**
 * A finished turn: what it did, then what it said.
 *
 * The steps are drawn from the same components the live stream uses, so a turn
 * looks the same after it lands as it did while it ran — which is the whole point
 * of storing them. A turn with no reply is still a turn worth seeing; that is
 * what an attempt-complete turn is, and it used to leave nothing behind at all.
 */
export function AgentMessage({ body, createdAt, activity, activityCount, messageId, workedMs, landing = false, latest = false, rating = null, currentQuestionId, trail }: {
  body: string;
  createdAt?: string | number;
  activity: AgentActivityStep[];
  activityCount: number;
  messageId: string;
  /** Whether this turn has just finished and is taking the live run's place, as
   *  opposed to being drawn with a transcript that was already there. */
  landing?: boolean;
  /** How long the turn behind this message ran. Zero for turns recorded before
   *  it was kept, which fold without naming a length. */
  workedMs: number;
  /** Whether this is the newest reply in the thread. The one reply whose footer
   *  stands without being asked for — see `ResponseFooter`. */
  latest?: boolean;
  /** The verdict already recorded against this reply, if any. */
  rating?: "good" | "bad" | null;
  currentQuestionId?: string | undefined;
  trail?: ChallengeTrail | undefined;
}) {
  /* Older turns arrive with their steps left on disk — see the window in the
     store. The row says how many there were and fetches them when asked, so the
     saving is in what is resident rather than in what the learner can see. */
  const [fetched, setFetched] = useState<AgentActivityStep[] | null>(null);
  const steps = fetched ?? activity;
  const parts = steps.map(storedPart);
  const published = parts.filter(isPublishedArtifact);
  /* Steps this turn has on disk but not in memory. The fold offers them and
     fetches them when it is opened, so an old turn reads as a turn that did
     work rather than one that did nothing. */
  const deferred = fetched === null && activityCount > steps.length;
  /* Steps that draw something. Thinking counts — a turn that only thought still
     has its heading and its working to show, which is the whole reason the fold
     is there. No drawn rows, no fold. */
  const shows = deferred || parts.length > 0;
  const open = async () => {
    setFetched(await window.spar!.messageActivity({ messageId }));
  };
  const reduced = useReducedMotion();
  return (
    /* No `space-y` here. It reaches every row `Rows` emits — they are direct
       children of this element, not of the fragment — and put a margin between
       two steps that `Rows` had deliberately left touching, which is space the
       thread down the icon column cannot be drawn in. That is what turned the
       line into a column of dashes on every settled turn while a live one
       looked right. Spacing between steps belongs to `Rows`; the only gap this
       element owns is the one before the reply. */
    <motion.div
      animate={{ opacity: 1 }}
      className="min-w-0"
      /* Not from zero. The turn underneath this one is the same turn, so the
         crossing only has to cover the seam between them — starting from
         invisible would be the answer fading in over itself, which is a longer
         and more conspicuous event than the swap it is hiding. */
      initial={landing && !reduced ? { opacity: 0.35 } : false}
      transition={{ duration: 0.28, ease: "linear" }}
    >
      {shows && (
        <RunFold bodyLoaded={!deferred} live={false} onOpen={open} workedMs={workedMs}>
          <Rows compactChallenges currentQuestionId={currentQuestionId} parts={parts} trail={trail} />
        </RunFold>
      )}
      {published.length > 0 && <div style={{ marginTop: PROSE_GAP }}><Rows currentQuestionId={currentQuestionId} parts={published} trail={trail} /></div>}
      {body.trim() && (
        <div className="group/final-response min-w-0 pb-2" style={{ marginTop: shows ? FINAL_GAP : undefined }}>
          <Markdown source={body} />
          <ReferenceCards source={body} />
          <ResponseFooter body={body} createdAt={createdAt} latest={latest} messageId={messageId} rating={rating} />
        </div>
      )}
    </motion.div>
  );
}

const VERDICT_NAME = { good: "Good response", bad: "Bad response" } as const;

/**
 * Actions belong to the final answer, never the work fold or the thread.
 *
 * The newest reply keeps its actions on screen. Everywhere else they are a
 * hover affordance, which is right for a transcript you are scrolling back
 * through — but the reply you are reading right now is the one you might copy
 * or rate, and hiding those behind a hover is asking the reader to guess that
 * the controls exist. A reply that has already been rated keeps its footer for
 * the same reason: the verdict is part of what the message now says.
 *
 * The time does not follow that rule. It is the one thing here that is never
 * acted on, so it stays on hover in every case — a clock under the live answer
 * is the kind of detail that reads as important the first ten times you see it
 * and as clutter after that.
 */
function ResponseFooter({ body, createdAt, latest = false, messageId, rating = null }: {
  body: string;
  createdAt?: string | number | undefined;
  latest?: boolean;
  messageId: string;
  rating?: "good" | "bad" | null;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  /* Painted on click and reconciled from the store's answer. Rating is not a
     thing to wait on — the click is the whole interaction — and a thumb that
     lights a beat after it was pressed reads as a control that nearly missed. */
  const [verdict, setVerdict] = useState<"good" | "bad" | null>(rating);
  useEffect(() => setVerdict(rating), [rating, messageId]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const label = failed ? "Copy failed — try again" : copied ? "Copied" : "Copy";
  const timestamp = createdAt === undefined ? "" : responseTime(createdAt);
  /* Clicking the lit thumb takes the verdict back. Rating is a judgement, and a
     judgement you cannot withdraw is one people stop making. */
  const rate = (next: "good" | "bad") => {
    const value = verdict === next ? null : next;
    setVerdict(value);
    void window.spar?.rateMessage({ messageId, rating: value })
      .then((stored) => setVerdict(stored))
      .catch(() => setVerdict(verdict));
  };
  const held = latest || verdict !== null;

  return (
    <div
      className={cn(
        MESSAGE_ACTION_ROW,
        "mt-4 transition-opacity focus-within:opacity-100 group-hover/final-response:opacity-100",
        held ? "opacity-100" : "opacity-0",
      )}
    >
      <MessageAction
        label={label}
        onClick={() => {
          void navigator.clipboard.writeText(body).then(() => {
            setFailed(false);
            setCopied(true);
          }).catch(() => setFailed(true));
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </MessageAction>

      {/* One thumb, then the two verdicts by name. A pair of bare thumbs asks
          the learner to work out which way round the glyphs are before they can
          rate anything, and it doubles the number of targets in a row that is
          already mostly hover affordance. Rating is rare enough to afford the
          second click, and the named rows say what the rating means. */}
      <DropdownMenu>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <MessageActionButton active={verdict !== null} aria-label="Rate this response">
                {verdict === "bad" ? <ThumbsDown aria-hidden /> : <ThumbsUp aria-hidden />}
              </MessageActionButton>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{verdict ? `${VERDICT_NAME[verdict]} — rate again to change` : "Rate this response"}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="min-w-[10rem]">
          {(["good", "bad"] as const).map((value) => {
            const Icon = value === "good" ? ThumbsUp : ThumbsDown;
            const on = verdict === value;
            return (
              <DropdownMenuItem
                className={cn(on && "text-foreground [&_svg]:fill-current")}
                key={value}
                onSelect={() => rate(value)}
              >
                <Icon aria-hidden />
                {VERDICT_NAME[value]}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Never held. See the note on this component. */}
      {timestamp && (
        <time
          className="ml-1.5 opacity-0 transition-opacity group-hover/final-response:opacity-100"
          dateTime={new Date(createdAt!).toISOString()}
        >
          {timestamp}
        </time>
      )}
    </div>
  );
}

export function responseTime(value: string | number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }).format(date);
}

export function relativeMessageTime(value: string | number, now = Date.now()): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

/** A stored step as the transcript's own part shape, so the rows a finished turn
 *  draws are the same rows it drew while it was running. */
function storedPart(step: AgentActivityStep, index: number): RunPart {
  // A note is what the agent said between its calls, so it reads as what it was.
  if (step.kind === "note") return { kind: "text", id: `stored-${index}-note`, body: step.text };
  if (step.kind === "reasoning") {
    return {
      kind: "reasoning",
      id: `stored-${index}-thinking`,
      body: step.text,
      open: false,
      startedAt: 0,
      endedAt: step.seconds * 1_000,
    };
  }
  return {
    kind: "tool",
    id: `stored-${index}-${step.tool}`,
    tool: step.tool,
    label: step.label,
    actionTitle: step.actionTitle,
    detail: step.detail,
    phase: step.ok ? "done" : "error",
    files: [],
    input: step.input,
    output: step.output,
    startedAt: 0,
  };
}

/**
 * Something the learner said, and the chance to say it differently.
 *
 * Editing is a rewind of the conversation: this message and everything after it
 * leave the thread, and the rewritten one is answered in its place. What the
 * agent recorded on the way does not leave — a challenge it published was
 * attempted, and an attempt is evidence. The line in the footer says exactly
 * that, because a control that promised to undo the record would be lying about
 * the one thing the learner would most want to be true.
 */
/**
 * The learner's own words, with their `@` references live.
 *
 * Not markdown. What the learner typed is what they typed — a bubble that
 * silently reflowed their asterisks and swallowed their underscores would be
 * editing them. The one exception is the references they inserted deliberately
 * from the picker, which were never text to begin with: they are markup the
 * composer wrote on their behalf, and leaving it raw in the bubble would show
 * them the plumbing of a thing they did with one keystroke.
 */
function LearnerBody({ body }: { body: string }) {
  const parts = useMemo(() => splitReferences(body), [body]);
  if (parts.length === 1 && typeof parts[0] === "string") return <>{body}</>;
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string"
          ? <span key={index}>{part}</span>
          : <Reference key={index} kind={part.kind} label={part.label} target={part.target} />)}
    </>
  );
}

const REFERENCE_SCAN = new RegExp(REFERENCE_PATTERN.source, "g");

/** The body cut into text and references, in order. Scanned rather than split:
 *  the pattern has capture groups, and `split` hands those back as pieces of
 *  their own. */
function splitReferences(body: string): Array<string | { kind: ReferenceKind; target: string; label: string }> {
  const parts: Array<string | { kind: ReferenceKind; target: string; label: string }> = [];
  let cursor = 0;
  for (const match of body.matchAll(REFERENCE_SCAN)) {
    const reference = parseReference(match[0]);
    if (!reference) continue;
    if (match.index > cursor) parts.push(body.slice(cursor, match.index));
    parts.push(reference);
    cursor = match.index + match[0].length;
  }
  if (cursor < body.length) parts.push(body.slice(cursor));
  return parts.length ? parts : [body];
}

function LearnerMessage({ body, createdAt, editable, queued = false, sending = false, onEdit }: { body: string; createdAt?: string | number; editable: boolean; queued?: boolean; /** Whether this bubble is arriving now, rather than being drawn with the rest of a transcript that was already there. */ sending?: boolean; onEdit?: ((body: string) => void) | undefined }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [copied, setCopied] = useState(false);
  const reduced = useReducedMotion();
  const [hovering, setHovering] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hovering) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [hovering]);
  const timestamp = createdAt === undefined ? "" : relativeMessageTime(createdAt, now);

  if (editing) {
    return (
      <div className="flex min-w-0 justify-end">
        <div className="w-[90%] min-w-0 rounded-[calc(1rem*1.4)] bg-secondary px-3 py-2.5 [corner-shape:superellipse(1.4)]">
          <textarea
            autoFocus
            className="app-scroll block max-h-40 w-full resize-none bg-transparent py-0.5 text-thread leading-[1.55] outline-none"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
              if (event.key === "Enter" && !event.shiftKey && draft.trim()) {
                event.preventDefault();
                setEditing(false);
                onEdit?.(draft.trim());
              }
            }}
            rows={Math.min(6, draft.split("\n").length)}
            value={draft}
          />
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <button
              className="h-7 rounded-lg bg-background px-2.5 text-thread text-foreground shadow-sm ring-[0.5px] ring-[var(--border-surface-strong)] transition-colors hover:bg-accent"
              onClick={() => {
                setDraft(body);
                setEditing(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="click-depth-effect-slightly h-7 rounded-lg bg-[var(--foreground)] px-2.5 text-thread font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-40"
              disabled={!draft.trim()}
              onClick={() => {
                setEditing(false);
                onEdit?.(draft.trim());
              }}
              type="button"
            >
              Send again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group/said flex min-w-0 flex-col items-end" onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
      {/* Held back until the turn picks it up: dimmed, with the reason on hover.
          The bubble is the learner's own words either way — what changes is
          whether the agent has them yet.

          It arrives from the composer: up a few pixels, off a corner nearest the
          field it was typed in, on a spring with just enough bounce to land
          rather than stop. The draft clearing and the bubble appearing in one
          frame was the send reading as a field that lost what you typed —
          watching the words travel the short distance to the transcript is the
          whole confirmation the action needs, which is why there is no other. */}
      <motion.div
        animate={{ opacity: queued ? 0.6 : 1, y: 0, scale: 1 }}
        className="max-w-[min(fit-content,80%)] min-w-0 break-words learner-bubble rounded-[calc(1rem*1.4)] bg-secondary px-3 py-2 text-thread leading-[1.55] whitespace-pre-wrap [corner-shape:superellipse(1.4)]"
        initial={sending && !reduced ? { opacity: 0, y: 14, scale: 0.94 } : false}
        style={{ transformOrigin: "bottom right" }}
        transition={{
          opacity: { duration: 0.2 },
          default: { type: "spring", visualDuration: 0.42, bounce: 0.2 },
        }}
        {...(queued ? { title: "Waiting for the agent to finish this step" } : {})}
      >
        <LearnerBody body={body} />
      </motion.div>
      {/* Mirrored, not redesigned: the time leads instead of trails because the
          row is right-aligned, and everything else is the answer footer's own
          sizing and spacing. */}
      <div
        className={cn(
          MESSAGE_ACTION_ROW,
          "mt-1 justify-end pr-1 opacity-0 transition-opacity group-hover/said:opacity-100 focus-within:opacity-100",
        )}
      >
        {timestamp && <time className="mr-1.5" dateTime={new Date(createdAt!).toISOString()}>{timestamp}</time>}
        <MessageAction
          label={copied ? "Copied" : "Copy"}
          onClick={() => {
            void navigator.clipboard.writeText(body).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1_500);
            }).catch(() => undefined);
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </MessageAction>
        {editable && onEdit && (
          <MessageAction
            label="Edit and run again from here"
            onClick={() => {
              setDraft(body);
              setEditing(true);
            }}
          >
            <Pencil aria-hidden />
          </MessageAction>
        )}
      </div>
    </div>
  );
}

export function AgentThread({
  messages,
  run,
  phase,
  header,
  empty,
  footer,
  onEditMessage,
  undoable,
  optimisticMessages = [],
  className,
  currentQuestionId,
  trail,
}: {
  messages: Message[];
  run: AgentRun | null;
  /** What the live turn is, when Construct started it rather than the learner. */
  phase?: "research" | "opening" | "reply" | null;
  header?: React.ReactNode;
  empty?: React.ReactNode;
  /** Rendered after the last message, inside the scroller. Used for a failed
   *  turn, which belongs in the transcript beside the message it failed to
   *  answer rather than in a notification that fades. */
  footer?: React.ReactNode;
  /** Rewrites one of the learner's messages and runs again from there. */
  onEditMessage?: ((messageId: string, body: string) => void) | undefined;
  /** Message ids that can still be rewound to: the learner's own, while no turn
   *  is running. Editing under a live turn would cut the transcript beneath the
   *  turn still writing into it. */
  undoable?: ReadonlySet<string> | undefined;
  /** Learner bubbles inserted before IPC persistence/agent startup completes. */
  optimisticMessages?: OptimisticLearnerMessage[] | undefined;
  className?: string;
  /** Challenge cards use the same route as the toolbar stepper. The active
   *  card stays inert; earlier cards reopen their read-only practice surface. */
  currentQuestionId?: string | undefined;
  trail?: ChallengeTrail | undefined;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  /* Which ends of the transcript have content past them, and so are faded.
     Re-measured on resize as well as on scroll: whether a thread overflows
     changes when the pane changes and never because someone scrolled it. */
  const [edges, setEdges] = useState({ top: false, bottom: false });
  /* Which bubbles are new to this screen. Opening a session is not forty
     messages being sent, so everything present at the first commit is recorded
     as already seen and only what appears after it animates in.

     `spoken` is the hand-off: a learner message is drawn optimistically the
     instant they press Return and again, under a different id, once the session
     comes back from disk. Both are the same words being said once, so the
     durable one inherits the arrival the optimistic one already played instead
     of repeating it. */
  const seen = useRef<Set<string>>(new Set());
  const spoken = useRef<Set<string>>(new Set());
  const firstCommit = useRef(true);
  useEffect(() => {
    for (const item of messages) seen.current.add(item.id);
    for (const item of optimisticMessages ?? []) {
      seen.current.add(item.id);
      spoken.current.add(item.body.trim());
    }
    firstCommit.current = false;
  });
  const arriving = (id: string, body: string) =>
    !firstCommit.current && !seen.current.has(id) && !spoken.current.has(body.trim());
  /* A stored turn that was not on screen a moment ago is one that has just
     finished, and it is crossing with the live run it replaces. One read back
     from storage is not. */
  const landing = (id: string) => !firstCommit.current && !seen.current.has(id);
  /* Completion persists the final streamed text before the refreshed session
     reaches the renderer. Reconcile by content during that narrow hand-off so the
     durable message and its live precursor can never render twice. Dropping the
     live run no longer loses the turn's work: the steps are stored on the message
     and drawn from there, which is what a finished turn is made of. */
  const streamedText=run?.parts.filter((part)=>part.kind==="text").map((part)=>part.body).join("").trim()??"";
  const lastAgentMessage=[...messages].reverse().find((item)=>item.role==="agent");
  const visibleRun=run&&streamedText&&lastAgentMessage?.body.trim()===streamedText?null:run;

  // Auto-follow only while the learner is already at the live edge, so scrolling
  // back to re-read an earlier explanation is not yanked away mid-stream.
  useLayoutEffect(() => {
    if (!pinned) return;
    const node = viewport.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, optimisticMessages, run, pinned]);

  /* Read by the resize observer below, which is registered once and so cannot
     see this through its closure. */
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const onScroll = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      setPinned(distance < 48);
      /* The fades, on only while there is something past that end — see
         `.transcript-fade`. Measured against the live edge rather than against
         `pinned`, which carries 48px of slack so that a stream does not stop
         auto-following the moment a line reflows: inside that slack there is
         still content under the composer, and the fade is what says so. */
      setEdges((current) => {
        const top = node.scrollTop > FADE_SLACK;
        const bottom = distance > FADE_SLACK;
        return current.top === top && current.bottom === bottom ? current : { top, bottom };
      });
    };
    onScroll();
    node.addEventListener("scroll", onScroll, { passive: true });
    /* The scroller loses height whenever the composer grows a line, which is a
       resize and not a scroll: the browser keeps `scrollTop` where it was, so
       the live edge slides down under the composer and — with the transcript
       now sitting flush against it — takes the last line with it. Re-stick
       first, then measure, so following a stream survives a draft being typed
       underneath it and the fades answer to the height the scroller ended up
       with rather than the one it had. */
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) node.scrollTop = node.scrollHeight;
      onScroll();
    });
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  /* A turn with nothing to show yet is not an empty thread. `PhaseWait` is what
     stands in its place, and showing the project's empty state over a running
     kickoff is how a project that was working came to look like one that had
     never started. */
  const visibleOptimistic = unreconciledOptimisticMessages(messages, optimisticMessages);
  const isEmpty = messages.length === 0 && visibleOptimistic.length === 0 && !visibleRun && !phase;

  /* Which of the learner's messages the running turn has not picked up yet.
     Anything they said after the turn started was queued, and the turn drains
     the queue at its next phase boundary — so until it reports having done so,
     the message is in the thread but not yet in front of the agent. Saying so is
     the difference between a wait the learner understands and one where they
     assume they have been ignored. */
  const queued = new Set<string>();
  if (run && run.status === "streaming") {
    const sent = messages.filter((item) => item.role === "learner" && new Date(item.createdAt).getTime() >= run.startedAt);
    for (const item of sent.slice(run.steersConsumed)) queued.add(item.id);
  }

  return (
    <div className={cn("agent-transcript relative min-h-0 min-w-0 flex-1", className)}>
      {/* overflow-x-hidden: the column never scrolls sideways. Anything genuinely
          wide (a code block) scrolls inside its own box instead. */}
      {/* The inset is `.transcript-scroller`, which lands the column on the
          composer's own 16px and keeps the clearance `overflow-x: hidden` leaves
          for a card's shadow — which is what that padding was really buying.
          (`overflow-x: clip` with a clip margin would say the clearance
          directly, but a clip on one axis computes to `hidden` when the other
          axis scrolls, which is where this started.) */}
      <div ref={viewport} className="app-scroll transcript-fade transcript-scroller h-full overflow-y-auto overflow-x-hidden"
        style={transcriptFadeStyle(edges)}>
        <div
          className={cn(
            "transcript-column relative flex min-h-full min-w-0 flex-col gap-6",
            isEmpty ? "justify-center" : "justify-start",
          )}
        >
          {header}
          {isEmpty
            ? empty
            : (
              <>
                {messages.map((item) =>
                  item.role === "learner" ? (
                    <LearnerMessage
                      key={item.id}
                      body={item.body}
                      createdAt={item.createdAt}
                      editable={undoable?.has(item.id) ?? false}
                      queued={queued.has(item.id)}
                      sending={arriving(item.id, item.body)}
                      {...(onEditMessage ? { onEdit: (body: string) => onEditMessage(item.id, body) } : {})}
                    />
                  ) : item.role === "system" ? (
                    <SystemEvent key={item.id} body={item.body} />
                  ) : (
                    <AgentMessage activity={item.activity} activityCount={item.activityCount ?? 0} body={item.body} createdAt={item.createdAt} currentQuestionId={currentQuestionId} key={item.id} landing={landing(item.id)} latest={item.id === lastAgentMessage?.id && !visibleRun} messageId={item.id} rating={item.rating ?? null} trail={trail} workedMs={item.workedMs ?? 0} />
                  ),
                )}
                {visibleOptimistic.map((item) => (
                  <LearnerMessage body={item.body} createdAt={item.createdAt} editable={false} key={item.id} queued={run?.status === "streaming"} sending={arriving(item.id, item.body)} />
                ))}
                {/* The end of a turn is a hand-off, not an event: the live run
                    stops being rendered and the stored message takes its place,
                    drawing the same steps and the same words from disk. They are
                    two subtrees, so React cannot reconcile one into the other —
                    which is why the finish read as a flicker, the whole turn
                    being torn down and rebuilt in a frame under a reader already
                    looking at it.

                    `popLayout` is what makes that a dissolve. The outgoing run
                    is lifted out of the flow at the position it already held, so
                    the stored message can take that space in the same frame
                    rather than after it, and the two identical turns cross over
                    each other in place. No movement, because nothing has
                    actually moved — the only thing the reader should see at the
                    end of a turn is the shimmer stopping. */}
                <AnimatePresence initial={false} mode="popLayout">
                  {visibleRun ? (
                    <motion.div
                      className="min-w-0"
                      exit={{ opacity: 0, transition: { duration: 0.22, ease: "linear" } }}
                      key="live-run"
                    >
                      <LiveRun currentQuestionId={currentQuestionId} phase={phase} run={visibleRun} trail={trail} />
                    </motion.div>
                  ) : <PhaseWait key="phase-wait" phase={phase} />}
                </AnimatePresence>
                {footer}
              </>
            )}
        </div>
      </div>

      {!pinned && (
        <button
          className="app-no-drag absolute bottom-3 left-1/2 grid size-7 -translate-x-1/2 place-items-center rounded-full bg-[var(--surface-primary)] text-muted-foreground shadow-lg ring-[0.5px] ring-[var(--border-surface-strong)] backdrop-blur-md transition hover:text-foreground"
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
