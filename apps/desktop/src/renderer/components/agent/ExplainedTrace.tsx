import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { hydrateView, type Snapshot } from "@spar/visualizer";
import type { VisualizerView } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { TraceFigure } from "./TraceFigure";
import type { ToolPart } from "./agentRun";

/**
 * An explanation the agent animated.
 *
 * Two things this is not, and both were versions of it.
 *
 * It is not the visualiser page in a box. That page is a three-pane debugger
 * with a transport, an inspector and a console, and dropping it into a
 * conversation produces exactly the thing that reads as an iframe someone
 * pasted in: a widget with its own chrome and its own idea of where it is. Chat
 * is one column of things being said, and a picture in it is a thing being said.
 *
 * It is also not a scrollable window onto the heap. The first version kept the
 * page's layout — every object in scope, stacked down a column — inside a fixed
 * box, so three dictionaries became a small pane you had to scroll to see any of
 * them. A picture you have to scroll is not a picture; it is a list. What
 * replaced it: the agent names what to draw, only that is drawn, and whatever is
 * drawn is scaled to fit the frame. Nothing here scrolls, ever. If it is on
 * screen you can see all of it.
 *
 * And it plays. The agent chooses the steps, the sentence for each, what to
 * spotlight and how long to hold — so the step where the invariant breaks gets
 * four seconds and the two setting it up get one. That pacing is the difference
 * between a sequence of stills and watching something happen.
 */
export function ExplainedTrace({ part }: { part: ToolPart }) {
  const id = visualizationId(part);
  const [view, setView] = useState<VisualizerView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!id) {
      setState("missing");
      return;
    }
    let live = true;
    void window.spar?.visualizerView({ id })
      .then((found) => {
        if (!live) return;
        /* Hydrated, never cast. The row was written by whatever version of Spar
           was running when the agent drew it, and reading it as though it were
           today's shape is what took the whole renderer down on a payload whose
           steps predated `focus`. */
        const payload = hydrateView(found?.payload) as VisualizerView | null;
        setView(payload);
        setState(payload ? "ready" : "missing");
        /* Autoplay is the agent's call, and reduced motion is the learner's, and
           the learner's wins. Someone who has asked the system for less movement
           has not asked for a diagram that starts moving on its own. */
        setPlaying(Boolean(payload?.autoplay) && !reduced);
      })
      .catch(() => live && setState("missing"));
    return () => { live = false; };
  }, [id, reduced]);

  const steps = view?.steps ?? [];
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;

  /* The pace is per step, which is the whole point of the agent setting it, so
     this is a timer restarted on each step rather than one interval for the
     sequence. It stops at the end instead of looping: a loop would make "the
     algorithm finished" and "the animation is going round again" look the
     same. */
  useEffect(() => {
    if (!playing || !step || last) {
      if (last) setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex((current) => current + 1), step.hold * 1_000);
    return () => clearTimeout(timer);
  }, [playing, step, last]);

  const go = useCallback((next: number) => {
    setPlaying(false);
    setIndex(next);
  }, []);

  if (state === "loading") {
    return (
      <Shell>
        <div className="flex items-center gap-2 px-3.5 py-3 text-ui text-[var(--transcript-step)]">
          <Loader2 className="size-3.5 animate-spin" />
          Drawing what happened…
        </div>
      </Shell>
    );
  }

  /* A picture that is gone is said plainly, once. This happens when a database
     was restored from a backup older than the message — rare, but a card that
     drew an empty canvas instead would look like the agent had explained
     nothing. */
  if (state === "missing" || !view || !step) {
    return (
      <Shell>
        <p className="px-3.5 py-3 text-ui text-[var(--transcript-step)]">
          {part.actionTitle || "This diagram is no longer stored."}
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* The title owns the row. An earlier version put the traced call beside it
          with `shrink-0`, which meant a long call took the whole width and left
          the title wrapping one word per line. The call is a subtitle now:
          useful, secondary, and on its own line where its length is nobody
          else's problem. */}
      <header className="min-w-0 px-3.5 pt-3">
        <h4 className="text-ui font-medium text-foreground">{view.title}</h4>
        {view.setup && <p className="mt-0.5 truncate font-mono text-ui-sm text-[var(--transcript-step-mark)]">{view.setup}</p>}
      </header>

      <Stage focus={step.focus} frame={step.frame} language={view.language} previous={step.previous} />

      <div className="flex items-start gap-2.5 px-3.5 pb-2 pt-2.5">
        <Caption index={index} text={step.caption} />
        <Controls
          atEnd={last}
          atStart={index === 0}
          count={steps.length}
          index={index}
          onPlay={() => (last ? (setIndex(0), setPlaying(true)) : setPlaying(!playing))}
          onStep={go}
          playing={playing}
        />
      </div>

      {/* Where you are, and how long this step is being held for. The bar fills
          across the step it is on, so the sequence has a visible pulse instead of
          changing without warning — and a learner who wants longer can see
          exactly how much longer they have before it moves. */}
      <Rail hold={step.hold} index={index} onSelect={go} playing={playing} steps={steps} />

      <div className="flex items-baseline gap-2 px-3.5 pb-3 pt-2">
        <span className="shrink-0 font-mono text-ui-sm text-[var(--transcript-step-mark)]">line {step.frame.line}</span>
        <code className="min-w-0 flex-1 truncate font-mono text-ui-sm text-[var(--transcript-step)]">{step.source || step.frame.function}</code>
      </div>

      {view.takeaway && (
        <p className="border-t border-border/60 px-3.5 py-2.5 text-ui leading-[1.55] text-[var(--transcript-step-strong)]">{view.takeaway}</p>
      )}

      {view.error && (
        <p className="border-t border-border/60 px-3.5 py-2 text-ui-sm text-destructive/85">This run ended in an error: {view.error}</p>
      )}
    </Shell>
  );
}

/**
 * The card.
 *
 * Quieter than a challenge card on purpose: this is the agent showing you
 * something mid-sentence, not an outcome of the turn. One hairline border, the
 * elevated surface the transcript's own blocks use, and no shadow — a shadow
 * would lift it off the column and make it the first thing the eye lands on.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="my-0.5 min-w-0 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-[var(--color-background-elevated-secondary,var(--card))]"
      initial={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The drawing, scaled to fit.
 *
 * The frame is a fixed height because a card that resized per step would push
 * the conversation around under someone who is reading it. Given a fixed frame,
 * the content has to meet it — so this measures what the canvas actually drew
 * and scales it down to fit, rather than clipping it or handing over a
 * scrollbar. Both of those were the previous version, and both of them meant the
 * learner could be looking at a third of the picture the sentence beside it was
 * describing.
 *
 * It only ever scales *down*. A two-variable step blown up to fill a wide frame
 * would be a different kind of wrong — enormous boxes implying enormous
 * importance — so small pictures sit at their natural size, centred.
 */
function Stage({ focus, frame, previous, language }: {
  focus: readonly string[];
  frame: Snapshot;
  previous: Snapshot | null;
  language: VisualizerView["language"];
}) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  /* Layout effect, so the first paint is already at the right size: measuring in
     a passive effect shows one frame of the unscaled picture, which for a
     picture that needs halving is a visible lurch on every step. */
  useLayoutEffect(() => {
    const outer = box.current;
    const inner = content.current;
    if (!outer || !inner) return;
    const fit = () => {
      const available = outer.getBoundingClientRect();
      const drawn = inner.getBoundingClientRect();
      const width = drawn.width / scale;
      const height = drawn.height / scale;
      if (!width || !height) return;
      const next = Math.min(1, (available.width - 16) / width, (available.height - 16) / height);
      setScale((current) => (Math.abs(current - next) < 0.01 ? current : Math.max(next, 0.3)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [frame, focus, scale]);

  return (
    <div
      className="relative mt-2.5 grid h-[13rem] place-items-center overflow-hidden border-y border-border/60 bg-[var(--color-background-surface-under)]"
      ref={box}
    >
      <div ref={content} style={{ transform: `scale(${scale})`, transformOrigin: "center" }}>
        <TraceFigure focus={focus} frame={frame} language={language} previous={previous} />
      </div>
    </div>
  );
}

/** The caption, swapped rather than rewritten, so moving a step reads as motion
 *  in the direction you moved rather than as text mutating in place. */
function Caption({ index, text }: { index: number; text: string }) {
  const previous = useRef(index);
  const forward = index >= previous.current;
  previous.current = index;
  const reduced = useReducedMotion();
  return (
    <div className="min-w-0 flex-1">
      <AnimatePresence initial={false} mode="wait">
        <motion.p
          animate={{ opacity: 1, y: 0 }}
          className="min-w-0 text-ui leading-[1.55] text-foreground"
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: forward ? -4 : 4 }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: forward ? 6 : -6 }}
          key={index}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
        >
          {text}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

/** Play, and the two steps either side of it. No scrubber and no speed control:
 *  there are four of these, not four hundred, and the pace was set by whoever
 *  knew which step mattered. */
function Controls({ atEnd, atStart, count, index, onPlay, onStep, playing }: {
  atEnd: boolean;
  atStart: boolean;
  count: number;
  index: number;
  onPlay(): void;
  onStep(index: number): void;
  playing: boolean;
}) {
  if (count < 2) return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Glyph disabled={atStart} label="Previous step" onClick={() => onStep(index - 1)}><ArrowLeft className="size-3.5" /></Glyph>
      <Glyph
        disabled={false}
        label={atEnd ? "Play again" : playing ? "Pause" : "Play"}
        onClick={onPlay}
      >
        {atEnd ? <RotateCcw className="size-3.5" /> : playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </Glyph>
      <Glyph disabled={atEnd} label="Next step" onClick={() => onStep(index + 1)}><ArrowRight className="size-3.5" /></Glyph>
    </div>
  );
}

/** The sequence as ticks, one per step, the current one filling over exactly the
 *  time it is being held for. Ticks rather than a slider because a slider would
 *  imply a continuous run to scrub, and this is four chosen moments. */
function Rail({ hold, index, onSelect, playing, steps }: {
  hold: number;
  index: number;
  onSelect(index: number): void;
  playing: boolean;
  steps: VisualizerView["steps"];
}) {
  if (steps.length < 2) return null;
  return (
    <div className="flex items-center gap-1 px-3.5">
      {steps.map((step, position) => (
        <button
          aria-label={`Step ${position + 1}: ${step.caption}`}
          className="group/tick h-3 flex-1 cursor-default"
          key={position}
          onClick={() => onSelect(position)}
          title={step.caption}
          type="button"
        >
          <span className="block h-[3px] w-full overflow-hidden rounded-full bg-[var(--transcript-step-mark)]/20 transition-colors group-hover/tick:bg-[var(--transcript-step-mark)]/40">
            {position <= index && (
              <motion.span
                /* Keyed on the step and on whether it is running, so arriving at
                   a step remounts this and the fill starts from empty. The bar
                   for the step being held fills over its own dwell, which gives
                   the sequence a pulse and means the next change is never a
                   surprise; every step behind it is simply full. */
                animate={{ scaleX: 1 }}
                className="block h-full w-full origin-left rounded-full bg-[var(--trace-1)]"
                initial={{ scaleX: position === index && playing ? 0 : 1 }}
                key={`${position}-${index}-${playing}`}
                transition={position === index && playing ? { duration: hold, ease: "linear" } : { duration: 0 }}
              />
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

function Glyph({ children, disabled, label, onClick }: { children: React.ReactNode; disabled: boolean; label: string; onClick(): void }) {
  return (
    <button
      aria-label={label}
      className="grid size-6 place-items-center rounded-md text-[var(--transcript-step-mark)] transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

/** The row only knows the id; the frames are fetched. See `visualize_explain`. */
export function visualizationId(part: ToolPart): string {
  try {
    const value = JSON.parse(part.output) as { visualizationId?: unknown };
    return typeof value.visualizationId === "string" ? value.visualizationId : "";
  } catch {
    return "";
  }
}
