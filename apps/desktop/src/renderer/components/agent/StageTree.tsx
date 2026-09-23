import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProviderGlyph, hasProviderGlyph } from "../common/ProviderGlyph";
import { IconAlert, IconCheck, IconChevronRight, IconCircleX, IconEdit, IconFile, IconPlay, IconPuzzle, IconSearch, IconSparkle } from "./threadIcons";
import { FileCodeBlock } from "./Markdown";
import type { AgentActivityFile, ChallengeDraft, ToolStage, ToolStageRun } from "../../../shared/api";

/**
 * A private process under one row, drawn the way a parent step draws the work
 * it spawned: the thread's own line running down from the parent's mark and
 * curving into each child.
 *
 * The fit reviewer, each compile and each repair are not agent calls — they run
 * inside the one `create_question` the agent made — but they are work the
 * learner waits through, and a single line of detail that overwrote itself
 * every few seconds was not an account of it. Each stage is a child row, added
 * the moment it starts and settled in place when it lands, so the tree grows
 * while you watch it rather than being written up afterwards.
 *
 * Geometry: the tree sits in the parent row's label column, and the parent's
 * rail is `RAIL_X` to the left of that column (a 24px gutter centred at 12px,
 * then a 6px gap). Every connector is measured from there, so the curves land
 * on the parent's line instead of next to it.
 */
const RAIL_X = 18;
/** Where a child row's mark centres: half the 24px row box. */
const MID = 12;
const LINE = "0.5px solid var(--transcript-rail)";

/* ---------------------------------------------------------------------------
   Motion. Nothing in the tree appears, changes or leaves in one frame: a row
   grows open from nothing and pushes what is under it down, the line extends to
   a new child before the child is there, a mark crosses to the next rather than
   swapping, and text that is still being written grows its box a line at a time.
   The point is that the eye can follow where each thing went — the tree is live,
   and a live thing that jumps is a thing you have to re-read.
   ------------------------------------------------------------------------- */

/** The app's disclosure curve (see `ui/collapsible`): quick off the mark, a long tail. */
const EASE = [0.32, 0.72, 0, 1] as const;
const GROW: Transition = {
  height: { type: "spring", visualDuration: 0.42, bounce: 0.06 },
  opacity: { duration: 0.3, delay: 0.05, ease: EASE },
  y: { type: "spring", visualDuration: 0.42, bounce: 0.1 },
};
const SHRINK: Transition = { height: { type: "tween", duration: 0.26, ease: EASE }, opacity: { duration: 0.14, ease: "linear" } };
const POP: Transition = { type: "spring", visualDuration: 0.3, bounce: 0.3 };

/** False on a component's first render, true after — so a turn read back from
 *  history is drawn settled, and only what arrives while you watch animates. */
function useMounted() {
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; }, []);
  return mounted.current;
}

/**
 * A block that opens from zero height and closes back to it. It clips only
 * while it moves: settled, the connectors that reach up into the row above and
 * the code block's edge are drawn in full.
 */
function Grow({ children, appear, className }: { children: ReactNode; appear: boolean; className?: string | undefined }) {
  const reduced = useReducedMotion();
  const [moving, setMoving] = useState(appear && !reduced);
  return (
    <motion.div
      animate={{ height: "auto", opacity: 1, y: 0 }}
      className={className}
      exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0, transition: SHRINK }}
      initial={appear && !reduced ? { height: 0, opacity: 0, y: -3 } : false}
      onAnimationComplete={() => setMoving(false)}
      onAnimationStart={() => setMoving(true)}
      style={{ overflow: moving ? "hidden" : "visible" }}
      transition={GROW}
    >
      {children}
    </motion.div>
  );
}

/** A section a row shows or hides — opens and folds instead of cutting. */
function Reveal({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  const mounted = useMounted();
  return <AnimatePresence initial={false}>{show ? <Grow appear={mounted} className={className} key="reveal">{children}</Grow> : null}</AnimatePresence>;
}

/**
 * A box that follows the height of text still being written. A streamed reason
 * or a file being typed grows a line at a time; left alone, everything under it
 * steps down 18px at a time. This eases the box after its content instead.
 */
function FollowHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [height, setHeight] = useState<number | "auto">("auto");
  useLayoutEffect(() => {
    const element = inner.current;
    if (!element || reduced) return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [reduced]);
  return (
    <motion.div animate={{ height }} initial={false} style={{ overflow: "clip", overflowClipMargin: 6 }} transition={{ type: "spring", visualDuration: 0.28, bounce: 0 }}>
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}

/** A mark that crosses to the next one on a scale, in the mark's own box. */
function SwapMark({ id, children }: { id: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <span className="relative size-4">
      <AnimatePresence initial={false}>
        <motion.span
          animate={{ opacity: 1, scale: 1 }}
          className="absolute inset-0 grid place-items-center [&>svg]:size-[15px]"
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
          initial={reduced ? false : { opacity: 0, scale: 0.5 }}
          key={id}
          transition={reduced ? { duration: 0 } : POP}
        >{children}</motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Words that change in place — "checking" to "accepted", a verdict landing —
 *  rise into place instead of being overwritten. A count that ticks while a run
 *  is going is keyed on the run's state, not its number, so it counts rather
 *  than jittering and rises once when the run settles. */
function Settle({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const mounted = useMounted();
  const reduced = useReducedMotion();
  return (
    <motion.span
      animate={{ opacity: 1, y: 0 }}
      className={className}
      initial={mounted && !reduced ? { opacity: 0.35, y: 4 } : false}
      key={id}
      transition={{ type: "spring", visualDuration: 0.26, bounce: 0.15 }}
    >{children}</motion.span>
  );
}

/** `active` marks a child that is working right now; the line from the parent
 *  down to it is drawn brighter, so where the work is can be found by eye. */
type Node = { id: string; row: ReactNode; active?: boolean };

/** Children of a child row: the same line, hung from that row's 16px mark. */
function Nested({ nodes }: { nodes: Node[] }) {
  return <div className="pl-[14px]"><TreeChildren inset={6} lead={4} nodes={nodes} /></div>;
}

export function TreeChildren({ nodes, inset = RAIL_X, lead = 4 }: { nodes: Node[]; inset?: number; lead?: number }) {
  const mounted = useMounted();
  const reduced = useReducedMotion();
  if (!nodes.length) return null;
  const x = -inset + 0.25;
  /* The lit path: the lead, every straight run above the working child, and
     the curve into it. It moves down the tree as the work does. */
  let lit = -1;
  nodes.forEach((node, index) => { if (node.active) lit = index; });
  const ink = (on: boolean) => ({ borderColor: on ? "var(--transcript-step-mark)" : "var(--transcript-rail)", transition: "border-color 400ms cubic-bezier(0.32,0.72,0,1)" });
  return (
    <div className="relative" style={{ paddingLeft: 10 }}>
      {/* Up from the first child into the parent's mark. Drawn by the list, not
          by the child, so a child growing open can clip itself without cutting
          the line it hangs from. */}
      <span aria-hidden className="pointer-events-none absolute" style={{ left: x, top: -lead, height: lead, borderLeft: LINE, ...ink(lit >= 0) }} />
      <AnimatePresence initial={false}>
        {nodes.map((node, index) => {
          const last = index === nodes.length - 1;
          return (
            <Grow appear={mounted} className="relative" key={node.id}>
              {/* Straight through to the next sibling. It is drawn when a sibling
                  arrives, extending down from this row's curve, so the line gets
                  to the new row as the row opens. */}
              {!last && (
                <motion.span
                  animate={{ scaleY: 1 }}
                  aria-hidden
                  className="pointer-events-none absolute bottom-0 origin-top"
                  initial={mounted && !reduced ? { scaleY: 0 } : false}
                  style={{ left: x - 10, top: MID, borderLeft: LINE, ...ink(index < lit) }}
                  transition={{ type: "tween", duration: 0.3, ease: EASE }}
                />
              )}
              {/* The curve into this child's mark. */}
              <span
                aria-hidden
                className="pointer-events-none absolute top-0"
                style={{ left: x - 10, height: MID, width: inset + 6, borderLeft: LINE, borderBottom: LINE, borderBottomLeftRadius: 8, ...ink(index === lit) }}
              />
              {node.row}
            </Grow>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   One child row: mark, verb, subject, and the corner facts. The verb is muted
   and the subject is the thing named, the reference's two-tone line — the
   parent rows stay single-tone, the children are where "what" matters.

   Depth reads from size as well as indent: a stage is thread-sized, and what a
   stage holds — a sandbox run, a file — is set at the smaller tool size, so the
   two levels are told apart at a glance and not only by counting curves.
   ------------------------------------------------------------------------- */

const CHILD_ROW = "group/child flex h-6 min-w-0 items-center gap-2";
const CHILD_MARK = "relative flex size-4 shrink-0 items-center justify-center";

function ChildRow({ mark, markKey, verb, subject, running, corner, onToggle, open, depth = 1 }: {
  mark: ReactNode;
  markKey: string;
  verb: string;
  subject?: string | undefined;
  running?: boolean;
  corner?: ReactNode;
  onToggle?: (() => void) | undefined;
  open?: boolean;
  depth?: 1 | 2;
}) {
  const body = (
    <>
      <span className={cn(CHILD_MARK, "text-[var(--transcript-step-mark)]")}><SwapMark id={markKey}>{mark}</SwapMark></span>
      <span className={cn("min-w-0 flex-1 truncate text-left", running && "thinking-shimmer")}>
        <Settle className="text-[var(--transcript-step)]" id={verb}>{verb}</Settle>
        {subject ? <span className={cn("ml-1.5", depth === 1 ? "text-[var(--transcript-step-strong)]" : "text-[var(--transcript-step)]")}>{subject}</span> : null}
        {onToggle ? (
          <IconChevronRight className={cn("ml-0.5 inline size-3.5 align-[-2px] text-[var(--transcript-step-mark)] opacity-0 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/child:opacity-100", open && "rotate-90 opacity-100")} />
        ) : null}
      </span>
      {corner ? <span className="ml-2 flex shrink-0 items-center gap-1.5">{corner}</span> : null}
    </>
  );
  const size = depth === 1 ? "text-thread" : "text-thread-tool";
  return onToggle
    ? <button className={cn(CHILD_ROW, size, "w-full cursor-default outline-none")} onClick={onToggle} type="button">{body}</button>
    : <div className={cn(CHILD_ROW, size)}>{body}</div>;
}

/** The pill in a row's corner: a model, a count. It pops in when it first has
 *  something to say, recolours in place and its text rises when it changes. */
function Pill({ children, tone, id }: { children: ReactNode; tone?: "good" | "bad" | "added" | undefined; id?: string }) {
  const mounted = useMounted();
  const reduced = useReducedMotion();
  return (
    <motion.span
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "inline-flex h-5 items-center gap-1 overflow-hidden rounded-full bg-[var(--accent)] px-2 font-medium text-thread-tool tabular-nums text-[var(--transcript-step)] transition-colors duration-300",
        tone === "good" && "text-[var(--success)]",
        tone === "bad" && "text-[var(--warning)]",
        tone === "added" && "font-mono text-[var(--success)]",
      )}
      initial={mounted && !reduced ? { opacity: 0, scale: 0.8 } : false}
      transition={POP}
    >
      {id !== undefined ? <Settle className="inline-flex items-center gap-1" id={id}>{children}</Settle> : children}
    </motion.span>
  );
}

function ModelPill({ model, provider }: { model: string; provider?: string | undefined }) {
  return (
    <Pill>
      {provider && hasProviderGlyph(provider) ? <ProviderGlyph className="size-3" provider={provider} /> : null}
      <span className="max-w-[9rem] truncate">{model}</span>
    </Pill>
  );
}

/** Seconds since `since`, ticking while it runs and frozen once `until` lands. */
function Clock({ since, until }: { since: number; until?: number | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [until]);
  if (!since) return null;
  const seconds = Math.max(0, ((until ?? now) - since) / 1_000);
  if (until && seconds < 0.5) return null;
  return <span className="w-9 text-right font-mono text-thread-tool tabular-nums text-[var(--transcript-step-mark)]">{seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s</span>;
}

function Orb({ state }: { state: OrbState }) {
  return <ThinkingOrb aria-label="Working" size={20} state={state} style={{ width: 14, height: 14 }} />;
}

const STAGE_ORB: Record<ToolStage["kind"], OrbState> = {
  draft: "shaping",
  review: "searching",
  revise: "shaping",
  validate: "solving",
  repair: "weaving",
  redraft: "weaving",
  outcome: "working",
};

function StageMark({ stage }: { stage: ToolStage }) {
  if (stage.state === "running") return <Orb state={STAGE_ORB[stage.kind]} />;
  if (stage.kind === "outcome") return stage.state === "done" ? <IconPuzzle className="text-[var(--success)]" /> : <IconCircleX className="text-[var(--warning)]" />;
  if (stage.state === "failed") return <IconAlert className="text-[var(--warning)]" />;
  if (stage.state === "skipped") return <IconSearch className="opacity-50" />;
  switch (stage.kind) {
    case "draft": return <IconFile />;
    case "review": return <IconSearch />;
    case "revise": case "repair": return <IconEdit />;
    case "redraft": return <IconSparkle />;
    case "validate": return <IconCheck className="text-[var(--success)]" />;
    default: return <IconCheck />;
  }
}

function RunMark({ run }: { run: ToolStageRun }) {
  if (run.state === "running") return <Orb state="solving" />;
  return run.state === "passed" ? <IconCheck className="text-[var(--success)]" /> : <IconCircleX className="text-[var(--warning)]" />;
}

/** Lines under a child, aligned with its words. */
function Under({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("pb-1 pl-6 text-thread leading-[1.5] text-[var(--transcript-step-mark)]", className)}>{children}</div>;
}

/** What a stage said — the reviewer's reason, a failed check — set off by a
 *  rule so it reads as the stage's words and not as another step. */
function Said({ children, live }: { children: ReactNode; live: boolean }) {
  return (
    <div className="pb-1.5 pl-6">
      <div className={cn("border-l border-[var(--transcript-rail)] pl-2.5 text-thread-tool leading-[1.55] transition-colors duration-500", live ? "text-[var(--transcript-step)]" : "text-[var(--transcript-step-mark)]")}>
        {children}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Stages
   ------------------------------------------------------------------------- */

export function StageTree({ stages, draft, language }: { stages: ToolStage[]; draft?: ChallengeDraft | null | undefined; language?: string | undefined }) {
  return (
    <TreeChildren
      nodes={stages.map((stage, index) => {
        /* A failure stays open until a later stage of the same kind lands — the
           revalidation that passed, the reviewer that accepted — and then it is
           history, and folds with the rest. */
        const resolved = stage.state === "failed" && stages.slice(index + 1).some((later) => later.kind === stage.kind && later.state === "done");
        return stageNode(stage, stage.kind === "draft" ? draft : undefined, language, index === stages.length - 1, resolved);
      })}
    />
  );
}

function stageNode(stage: ToolStage, draft: ChallengeDraft | null | undefined, language: string | undefined, current: boolean, resolved: boolean): Node {
  return { id: stage.id, active: stage.state === "running", row: <StageRow current={current} draft={draft} language={language} resolved={resolved} stage={stage} /> };
}

/**
 * One stage and everything it has to say.
 *
 * A stage is open while it is the one you are watching — running, or the
 * newest — and folds to its one line the moment the next one starts. That is
 * what keeps a finished build a column of verdicts rather than four screens of
 * reasons, files and runs; and since a folded stage unmounts its body, it is
 * also what keeps a long thread cheap: no settled code blocks, highlighters or
 * case lists stay alive under rows nobody has open. A stage that failed stays
 * open until something later fixes it — until then it is the one you came to
 * read — and any stage opens on a click.
 *
 * Memoised on the stage object: the reducer replaces only the stage an event
 * touched, so a live update re-renders that row and not the tree.
 */
const StageRow = memo(function StageRow({ stage, draft, language, current, resolved }: { stage: ToolStage; draft: ChallengeDraft | null | undefined; language: string | undefined; current: boolean; resolved: boolean }) {
  const running = stage.state === "running";
  const findings = stage.findings ?? [];
  const detail = findings.length > 1 ? "" : stage.detail;
  const hasBody = Boolean(detail) || findings.length > 1 || Boolean(stage.runs?.length) || Boolean(draft?.files.length);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = hasBody && (chosen ?? (running || current || (stage.state === "failed" && !resolved)));
  const nodes: Node[] = open
    ? [
        ...(stage.runs ?? []).map((run) => ({ id: run.id, active: run.state === "running", row: <RunRow run={run} /> })),
        ...(draft ? fileNodes(draft, language ?? draft.language, undefined) : []),
      ]
    : [];
  const tone = stage.kind === "draft" ? "added" : stage.kind !== "validate" || running ? undefined : stage.state === "done" ? "good" : "bad";
  return (
    <>
      <ChildRow
        corner={(
          <>
            {stage.badge ? <Pill id={stage.badge} tone={tone}>{stage.badge}</Pill> : null}
            {stage.model ? <ModelPill model={stage.model} provider={stage.provider} /> : null}
            <Clock since={stage.startedAt} until={stage.endedAt} />
          </>
        )}
        mark={<StageMark stage={stage} />}
        markKey={stage.state}
        onToggle={hasBody && !running ? () => setChosen(!open) : undefined}
        open={open}
        running={running}
        subject={stage.subject}
        verb={stage.verb}
      />
      <Reveal show={open && Boolean(detail)}>
        <Said live={running}><FollowHeight><p className="break-words">{detail}</p></FollowHeight></Said>
      </Reveal>
      <Reveal show={open && findings.length > 1}>
        <Said live={running}>
          <ul className="space-y-0.5">{findings.map((finding, index) => <li className="break-words" key={index}>{finding}</li>)}</ul>
        </Said>
      </Reveal>
      <Reveal show={running && Boolean(stage.writing)}>
        {stage.writing ? (
          <div className="pb-1 pl-6"><FollowHeight><FileCodeBlock body={stage.writing.content} language={language ?? "text"} live path={stage.writing.path} /></FollowHeight></div>
        ) : null}
      </Reveal>
      <Reveal show={nodes.length > 0}><Nested nodes={nodes} /></Reveal>
    </>
  );
});

const RunRow = memo(function RunRow({ run }: { run: ToolStageRun }) {
  const cases = run.cases;
  const caught = run.expect === "fail";
  /* For the run that is meant to fail, the count that matters is how many cases
     caught the wrong solution, not how many it happened to pass. */
  const count = cases && cases.total > 0 ? (caught ? `${cases.failed}/${cases.total} caught` : `${cases.passed}/${cases.total} passed`) : "";
  const named = run.visibleCases ?? [];
  /* The visible cases are the learner's own contract, so they are listed as soon
     as the run reports them; a click folds them away. */
  const [folded, setFolded] = useState(false);
  const open = !folded && named.length > 0;
  return (
    <>
      <ChildRow
        corner={(
          <>
            {count ? <Pill id={run.state} tone={run.state === "running" ? undefined : run.state === "passed" ? "good" : "bad"}>{count}</Pill> : null}
            {run.durationMs !== undefined && run.state !== "running"
              ? <span className="w-9 text-right font-mono text-thread-tool tabular-nums text-[var(--transcript-step-mark)]">{(run.durationMs / 1_000).toFixed(1)}s</span>
              : <span className="w-9" />}
          </>
        )}
        depth={2}
        mark={<RunMark run={run} />}
        markKey={run.state}
        onToggle={named.length ? () => setFolded((value) => !value) : undefined}
        open={open}
        running={run.state === "running"}
        verb={run.label}
      />
      <Reveal show={open}>
        <Under className="text-thread-tool">
          <ul className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
            {named.map((entry, index) => (
              <motion.li
                animate={{ opacity: 1, x: 0 }}
                className="flex min-w-0 items-center gap-1.5"
                initial={{ opacity: 0, x: -4 }}
                key={index}
                transition={{ duration: 0.25, delay: Math.min(index, 12) * 0.03, ease: EASE }}
              >
                {entry.passed ? <IconCheck className="size-3 shrink-0 text-[var(--success)]" /> : <IconCircleX className="size-3 shrink-0 text-[var(--warning)]" />}
                <span className="truncate">{entry.name}</span>
              </motion.li>
            ))}
          </ul>
        </Under>
      </Reveal>
    </>
  );
}, (before, after) => sameRun(before.run, after.run));

/* The worker sends each stage whole, so every progress event carries fresh copies
   of runs that did not change. Compared by value: a run is a handful of fields. */
function sameRun(a: ToolStageRun, b: ToolStageRun) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/* ---------------------------------------------------------------------------
   The design, file by file
   ------------------------------------------------------------------------- */

const GROUP_WORD: Record<ChallengeDraft["files"][number]["group"], string> = {
  starter: "Starter",
  visible: "Visible tests",
  reference: "Reference",
  hidden: "Hidden tests",
  incorrect: "Plausible wrong solution",
};

type DraftFile = ChallengeDraft["files"][number];

/**
 * A design's files as children, in two tiers: what you are handed — starter
 * code and visible tests — each as its own row that opens to its contents, and
 * then everything that is kept from you folded under one "Kept from you" row.
 * Listing the reference, hidden tests and wrong solution as peers of the
 * starter made a design read as six things of the same kind, half of which
 * mysteriously would not open; one row says what they are and why.
 */
function fileNodes(draft: ChallengeDraft, language: string | undefined, writing: string | undefined, live = false): Node[] {
  const shown = draft.files.filter((file) => file.content !== undefined);
  const withheld = draft.files.filter((file) => file.content === undefined);
  return [
    /* The statement comes first in a design, so for the first seconds of a
       draft it is the only thing being written, and it is shown being written. */
    ...(draft.statement ? [{ id: "statement", active: live && !draft.files.length, row: <StatementRow body={draft.statement} writing={live && !draft.files.length} /> }] : []),
    ...shown.map((file) => ({ id: `${file.group}:${file.path}`, active: file.path === writing, row: <FileRow file={file} language={language} writing={file.path === writing} /> })),
    ...(withheld.length ? [{ id: "withheld", row: <WithheldRow files={withheld} /> }] : []),
  ];
}

/**
 * A design still being written, before its call exists — drawn as the same
 * tree the call will draw: one "Drafting" stage with the files under it. When
 * the call starts, its row takes this one's place at exactly this geometry and
 * the stage turns to "Drafted" where it stands, so the hand-over from writing
 * to validating is a word changing rather than the whole block being replaced.
 *
 * The worker never sends the withheld files' contents, so the lock here is a
 * label, not the protection.
 */
export function DraftTree({ draft, startedAt }: { draft: ChallengeDraft; startedAt: number }) {
  /* The file being written is the last one that has any content; that one is
     open, following its own tail. */
  const writing = [...draft.files].reverse().find((file) => file.content !== undefined && file.content.length > 0)?.path;
  const lines = draft.files.reduce((total, file) => total + file.lines, 0);
  const row = (
    <>
      <ChildRow
        corner={(
          <>
            {lines ? <Pill tone="added">+{lines}</Pill> : null}
            <Clock since={startedAt} />
          </>
        )}
        mark={<Orb state="shaping" />}
        markKey="running"
        running
        subject={draft.title ?? "the challenge"}
        verb="Drafting"
      />
      <Nested nodes={fileNodes(draft, draft.language, writing, true)} />
    </>
  );
  return <TreeChildren nodes={[{ id: "stage-0", active: true, row }]} />;
}

const StatementRow = memo(function StatementRow({ body, writing }: { body: string; writing: boolean }) {
  const [open, setOpen] = useState(false);
  const expanded = writing || open;
  return (
    <>
      <ChildRow
        depth={2}
        mark={writing ? <Orb state="shaping" /> : <IconFile />}
        markKey={writing ? "writing" : "done"}
        onToggle={writing ? undefined : () => setOpen((value) => !value)}
        open={expanded}
        running={writing}
        subject="problem statement"
        verb={writing ? "Writing" : "Wrote"}
      />
      <Reveal show={expanded}>
        <Said live={writing}><FollowHeight><p className="line-clamp-6 whitespace-pre-wrap break-words">{body}</p></FollowHeight></Said>
      </Reveal>
    </>
  );
});

/* A draft is re-parsed on every delta, so every file arrives as a new object;
   only the one being written has actually changed. */
const FileRow = memo(function FileRow({ file, language, writing }: { file: DraftFile; language?: string | undefined; writing: boolean }) {
  const [open, setOpen] = useState(false);
  const expanded = writing || open;
  return (
    <>
      <ChildRow
        corner={file.lines ? <Pill id={String(file.lines)} tone="added">+{file.lines}</Pill> : null}
        depth={2}
        mark={writing ? <Orb state="shaping" /> : <IconFile />}
        markKey={writing ? "writing" : "done"}
        onToggle={writing ? undefined : () => setOpen((value) => !value)}
        open={expanded}
        running={writing}
        subject={file.path}
        verb={writing ? `Writing ${GROUP_WORD[file.group].toLowerCase()}` : GROUP_WORD[file.group]}
      />
      <Reveal show={expanded && Boolean(file.content)}>
        <div className="pb-1 pl-6"><FollowHeight><FileCodeBlock body={file.content ?? ""} language={language ?? "text"} live={writing} path={file.path} /></FollowHeight></div>
      </Reveal>
    </>
  );
}, (a, b) => a.writing === b.writing && a.language === b.language && a.file.path === b.file.path && a.file.group === b.file.group && a.file.lines === b.file.lines && a.file.content === b.file.content);

/** The answer and the grader: named, sized, and never opened. */
function WithheldRow({ files }: { files: DraftFile[] }) {
  const [open, setOpen] = useState(false);
  const lines = files.reduce((total, file) => total + file.lines, 0);
  const kinds = [...new Set(files.map((file) => GROUP_WORD[file.group].toLowerCase()))];
  return (
    <>
      <ChildRow
        corner={lines ? <Pill id={String(lines)} tone="added">+{lines}</Pill> : null}
        depth={2}
        mark={<Lock className="size-3.5" strokeWidth={1.75} />}
        markKey="lock"
        onToggle={() => setOpen((value) => !value)}
        open={open}
        subject={kinds.join(", ")}
        verb="Kept from you"
      />
      <Reveal show={open}>
        <Nested
          nodes={files.map((file) => ({
            id: `${file.group}:${file.path}`,
            row: (
              <ChildRow
                corner={file.lines ? <Pill tone="added">+{file.lines}</Pill> : null}
                depth={2}
                mark={<IconPlay className="opacity-60" />}
                markKey="hidden"
                subject={file.path.startsWith("#") ? undefined : file.path}
                verb={GROUP_WORD[file.group]}
              />
            ),
          }))}
        />
      </Reveal>
    </>
  );
}

/**
 * The design a call carries, recovered from its already-redacted arguments.
 *
 * A finished or running call has no draft events, but its input is the same
 * design with the answer withheld by the worker — so the file list and the
 * shown contents are read back from there, and the line counts of the hidden
 * files from the counts the call reported.
 */
export function draftFromCall(input: string, files: AgentActivityFile[]): ChallengeDraft | null {
  let value: Record<string, unknown>;
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    value = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const counted = new Map(files.map((file) => [`${file.group ?? ""}:${file.path}`, file.added]));
  const out: ChallengeDraft["files"] = [];
  const read = (field: string, group: ChallengeDraft["files"][number]["group"]) => {
    const map = value[field];
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      /* A withheld map is a sentence, not a map; its paths are in `files`. */
      return;
    }
    for (const [path, content] of Object.entries(map as Record<string, unknown>)) {
      out.push({ group, path, lines: counted.get(`${group}:${path}`) ?? counted.get(`:${path}`) ?? 0, ...(typeof content === "string" ? { content } : {}) });
    }
  };
  read("starterFiles", "starter");
  read("visibleTests", "visible");
  /* The withheld maps are sentences, so their files come from the call's own
     counts. Stored rows from before files carried a group are told apart by
     name, which is right for tests and a guess for everything else. */
  const shown = new Set(out.map((file) => `${file.group}:${file.path}`));
  for (const file of files) {
    const group = file.group ?? (/test/i.test(file.path) ? "hidden" : "reference");
    if (group === "starter" || group === "visible" || (!file.group && out.some((entry) => entry.path === file.path && entry.lines === file.added))) continue;
    if (!shown.has(`${group}:${file.path}`)) out.push({ group, path: file.path, lines: file.added });
  }
  const incorrect = typeof value.knownIncorrectFiles === "string" ? /(\d+)\s+entr/.exec(value.knownIncorrectFiles)?.[1] : undefined;
  if (incorrect) for (let index = 0; index < Number(incorrect); index += 1) out.push({ group: "incorrect", path: `#${index + 1}`, lines: 0 });
  return {
    key: "call",
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.language === "string" ? { language: value.language } : {}),
    ...(typeof value.statement === "string" ? { statement: value.statement } : {}),
    files: out,
    received: input.length,
  };
}

export { ChildRow, Clock, Orb, Pill, Reveal };
