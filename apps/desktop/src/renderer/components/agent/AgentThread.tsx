import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, PencilLine } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import type { AgentActivityStep, SessionDetail } from "@spar/domain";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { ChallengePublished, PROSE_GAP, ROW_GLYPH, RunFailure, SolveRead, STEP_GAP, ToolRow } from "./ActivityRow";
import { ExplainedTrace } from "./ExplainedTrace";
import { SystemEvent } from "./SystemEvent";
import { groupParts, reasoningAtLiveEdge, type AgentRun, type RunPart } from "./agentRun";
import { RunFold } from "./RunFold";
import { unreconciledOptimisticMessages, type OptimisticLearnerMessage } from "./optimisticMessages";

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
function LiveRun({ run, phase }: { run: AgentRun; phase?: string | null | undefined }) {
  const streaming = run.status === "streaming";
  const boundary = run.finalFrom ?? run.parts.length;
  const work = run.parts.slice(0, boundary);
  const reply = run.parts.slice(boundary);
  const thinkingAtEdge = reasoningAtLiveEdge(work, streaming, run.finalStartedAt);
  return (
    <div className="min-w-0">
      <PhaseLine live={streaming} phase={phase} />
      <RunFold finalStartedAt={run.finalStartedAt} live={streaming} startedAt={run.startedAt}>
        <Rows parts={work} />
        {thinkingAtEdge && <div style={{ marginTop: STEP_GAP }}><ThinkingLine /></div>}
        {streaming && run.finalStartedAt === undefined && <div style={{ marginTop: STEP_GAP }}><WaitingLine parts={work} /></div>}
      </RunFold>
      {reply.length > 0 && <div style={{ marginTop: PROSE_GAP }}><Rows parts={reply} /></div>}
    </div>
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

function Rows({ parts }: { parts: RunPart[] }) {
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
        if (part.kind === "reasoning") {
          /* Provider reasoning is runtime state, not transcript content. Its
             position in this chronological array used to leave old "Thinking"
             rows above later prose and tools. The live edge draws one transient
             loader in `LiveRun`; settled reasoning draws nothing. */
          return null;
        }
        if (part.kind === "tool-row") {
          /* Tool input and output remain inspectable. Provider reasoning bound to
             the tool is intentionally not rendered as another content surface. */
          return wrap(<ToolRow continues={continues} part={part.part} />);
        }
        if (part.kind === "challenge") return wrap(<ChallengePublished part={part.part} />);
        if (part.kind === "solve-read") return wrap(<SolveRead part={part.part} />);
        if (part.kind === "explained-trace") return wrap(<ExplainedTrace part={part.part} />);
        if (part.kind === "error") return wrap(<RunFailure body={part.body} />);
        return wrap(<div className="truncate text-thread text-[var(--transcript-step)]">{part.body}</div>);
      })}
    </>
  );
}

/** One transient state, always after everything that has already happened. */
function ThinkingLine() {
  return (
    <div className="-mx-1 flex items-center gap-1.5 py-0.5">
      <span className={cn(ROW_GLYPH, "relative")}>
        <ThinkingOrb aria-label="Thinking" size={20} state="working" style={{ width: 16, height: 16 }} />
      </span>
      <span className="thinking-shimmer min-w-0 truncate text-thread font-medium">Thinking</span>
    </div>
  );
}

/**
 * The gap before the provider has sent anything at all.
 *
 * This used to be a permanent "Thinking" row that covered every quiet moment of a
 * turn, which is what made the transcript look like one opaque label with a tool
 * list above it — the reasoning and the replies were arriving and the row simply
 * sat on top of them. Now anything the model is actually doing has its own part
 * in the transcript, and this only fills the wait before the first token.
 */
function WaitingLine({ parts }: { parts: RunPart[] }) {
  const live = parts.some((part) =>
    (part.kind === "tool" && part.phase === "running") || (part.kind === "reasoning" && part.open),
  );
  if (live || parts.length > 0) return null;
  return (
    <div className="-mx-1 flex items-center gap-1.5 py-0.5">
      <span className={cn(ROW_GLYPH, "relative")}>
        <span className="absolute inset-0 rounded-full bg-[var(--accent)]/10 blur-sm" />
        <ThinkingOrb aria-label="Working" size={20} state="working" style={{ width: 16, height: 16 }} />
      </span>
      <span className="thinking-shimmer min-w-0 truncate text-thread font-medium">Connecting to the model</span>
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
function AgentMessage({ body, activity, activityCount, messageId, workedMs }: {
  body: string;
  activity: AgentActivityStep[];
  activityCount: number;
  messageId: string;
  /** How long the turn behind this message ran. Zero for turns recorded before
   *  it was kept, which fold without naming a length. */
  workedMs: number;
}) {
  /* Older turns arrive with their steps left on disk — see the window in the
     store. The row says how many there were and fetches them when asked, so the
     saving is in what is resident rather than in what the learner can see. */
  const [fetched, setFetched] = useState<AgentActivityStep[] | null>(null);
  const steps = fetched ?? activity;
  /* Steps this turn has on disk but not in memory. The fold offers them and
     fetches them when it is opened, so an old turn reads as a turn that did
     work rather than one that did nothing. */
  const deferred = !steps.length && activityCount > 0;
  const open = async () => {
    setFetched(await window.spar!.messageActivity({ messageId }));
  };
  return (
    /* No `space-y` here. It reaches every row `Rows` emits — they are direct
       children of this element, not of the fragment — and put a margin between
       two steps that `Rows` had deliberately left touching, which is space the
       thread down the icon column cannot be drawn in. That is what turned the
       line into a column of dashes on every settled turn while a live one
       looked right. Spacing between steps belongs to `Rows`; the only gap this
       element owns is the one before the reply. */
    <div className="min-w-0">
      {(steps.length > 0 || deferred) && (
        <RunFold bodyLoaded={!deferred} live={false} onOpen={open} workedMs={workedMs}>
          <Rows parts={steps.map(storedPart)} />
        </RunFold>
      )}
      {body.trim() && (
        <div className="min-w-0 pb-2" style={{ marginTop: steps.length || deferred ? PROSE_GAP : undefined }}>
          <Markdown source={body} />
        </div>
      )}
    </div>
  );
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
function LearnerMessage({ body, editable, queued = false, onEdit }: { body: string; editable: boolean; queued?: boolean; onEdit?: ((body: string) => void) | undefined }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);

  if (editing) {
    return (
      <div className="flex min-w-0 justify-end">
        <div className="w-[85%] min-w-0 rounded-xl bg-secondary p-2">
          <textarea
            autoFocus
            className="app-scroll block max-h-40 w-full resize-none bg-transparent px-1 py-0.5 text-thread leading-[1.55] outline-none"
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
          <div className="mt-1 flex items-center justify-end gap-1.5 px-1">
            <span className="mr-auto min-w-0 truncate text-thread text-muted-foreground/85">Replies after this leave the thread · your record stays</span>
            <button
              className="rounded-md px-2 py-0.5 text-thread text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => {
                setDraft(body);
                setEditing(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="click-depth-effect-slightly rounded-md bg-[var(--foreground)] px-2 py-0.5 text-thread font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-40"
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
    <div className="group/said flex min-w-0 items-center justify-end gap-1">
      {/* On hover only, and outside the bubble: a permanent pencil beside every
          thing the learner ever said is a column of controls down a
          conversation. */}
      {editable && onEdit && (
        <button
          aria-label="Edit and run again from here"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/0 transition-colors group-hover/said:text-muted-foreground focus-visible:text-foreground hover:!text-foreground"
          onClick={() => {
            setDraft(body);
            setEditing(true);
          }}
          title="Edit and run again from here"
          type="button"
        >
          <PencilLine className="size-3.5" />
        </button>
      )}
      {/* Held back until the turn picks it up: dimmed, with the reason on hover.
          The bubble is the learner's own words either way — what changes is
          whether the agent has them yet. */}
      <div
        className={cn(
          "max-w-[min(fit-content,80%)] min-w-0 break-words learner-bubble rounded-xl bg-secondary px-3 py-2 text-thread leading-[1.55] whitespace-pre-wrap transition-opacity",
          queued && "opacity-60",
        )}
        {...(queued ? { title: "Waiting for the agent to finish this step" } : {})}
      >
        {body}
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
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
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
      <div ref={viewport} className="app-scroll h-full overflow-y-auto overflow-x-hidden px-5 pt-4 pb-6">
        <div
          className={cn(
            "transcript-column flex min-h-full min-w-0 flex-col gap-6",
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
                      editable={undoable?.has(item.id) ?? false}
                      queued={queued.has(item.id)}
                      {...(onEditMessage ? { onEdit: (body: string) => onEditMessage(item.id, body) } : {})}
                    />
                  ) : item.role === "system" ? (
                    <SystemEvent key={item.id} body={item.body} />
                  ) : (
                    <AgentMessage activity={item.activity} activityCount={item.activityCount ?? 0} body={item.body} key={item.id} messageId={item.id} workedMs={item.workedMs ?? 0} />
                  ),
                )}
                {visibleOptimistic.map((item) => (
                  <LearnerMessage body={item.body} editable={false} key={item.id} queued={run?.status === "streaming"} />
                ))}
                {visibleRun ? <LiveRun phase={phase} run={visibleRun} /> : <PhaseWait phase={phase} />}
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
