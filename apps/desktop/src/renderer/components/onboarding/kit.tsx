import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionTemplate, useMotionValue, useSpring, useTransform, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/utils";
import { SparDots } from "../common/SparDots";
import { EASE_OUT, GLIDE, POP, SPRING } from "./motion";

/* The pieces the arrival is built from. Each one is a single idea about motion —
   words that surface, a card that leans, a button that is drawn to the pointer —
   so the scenes can be written as layout and copy, not as animation code. */

/** The surface every choice sits on. One shape across the whole arrival, so a
 *  card on the goal step and a row on the model step read as kin. */
export const SURFACE = "bg-[color-mix(in_oklab,var(--color-background-elevated-secondary)_94%,transparent)] shadow-[inset_0_0_0_0.5px_var(--border-strong),0_1px_2px_0_color-mix(in_oklab,var(--foreground)_5%,transparent)] backdrop-blur-md";
/** The selection, drawn once and moved between choices rather than toggled on each. */
export const PICKED = "absolute inset-0 rounded-[inherit] bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)] shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_55%,transparent)]";
/** Choices arrive after the question has surfaced, not with it. */
export const AFTER_QUESTION = 0.28;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A line of copy that surfaces a word at a time, each one rising out of a blur.
 *  The words are hidden from assistive tech and the sentence is read once, whole. */
export function Words({ text, className, delay = 0, stagger = 0.045 }: { text: string; className?: string; delay?: number; stagger?: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      {words.map((word, index) => {
        const at = delay + index * stagger;
        return (
          <span aria-hidden className="inline-block whitespace-pre [perspective:600px]" key={`${index}:${word}`}>
            <motion.span
              animate={{ opacity: 1, y: 0, rotateX: 0, filter: "blur(0px)" }}
              className="inline-block origin-bottom will-change-transform"
              initial={{ opacity: 0, y: "0.55em", rotateX: -55, filter: "blur(10px)" }}
              transition={{
                y: { ...SPRING, delay: at },
                rotateX: { ...SPRING, delay: at },
                opacity: { duration: 0.4, ease: EASE_OUT, delay: at },
                filter: { duration: 0.55, ease: EASE_OUT, delay: at },
              }}
            >
              {word}
            </motion.span>
            {index < words.length - 1 ? " " : null}
          </span>
        );
      })}
    </span>
  );
}

/** Content that rolls over to its next value: the old one leaves upwards as the
 *  new one arrives from below, inside a window the height of one line. */
export function Swap({ value, children, className }: { value: string | number; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("relative inline-flex overflow-hidden align-bottom", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
          className="inline-flex items-center gap-1.5 whitespace-nowrap"
          exit={{ y: "-105%", opacity: 0, filter: "blur(4px)" }}
          initial={{ y: "105%", opacity: 0, filter: "blur(4px)" }}
          key={value}
          transition={SPRING}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** A card that leans towards the pointer, with a soft light where it is. The
 *  tilt is small on purpose — enough to feel like an object, not a gimmick. */
export function Tilt({ className, children, max = 7, style, onPointerMove, onPointerLeave, ...props }: HTMLMotionProps<"button"> & { max?: number }) {
  const pointerX = useMotionValue(0.5);
  const pointerY = useMotionValue(0.5);
  const lean = { stiffness: 260, damping: 22, mass: 0.6 };
  const rotateX = useSpring(useTransform(pointerY, [0, 1], [max, -max]), lean);
  const rotateY = useSpring(useTransform(pointerX, [0, 1], [-max, max]), lean);
  const lightX = useTransform(pointerX, (value) => `${value * 100}%`);
  const lightY = useTransform(pointerY, (value) => `${value * 100}%`);
  const light = useMotionTemplate`radial-gradient(240px circle at ${lightX} ${lightY}, color-mix(in oklab, var(--foreground) 9%, transparent), transparent 70%)`;
  return (
    <motion.button
      className={cn("group relative", className)}
      data-choice=""
      onPointerLeave={(event) => {
        pointerX.set(0.5);
        pointerY.set(0.5);
        onPointerLeave?.(event);
      }}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        pointerX.set((event.clientX - rect.left) / rect.width);
        pointerY.set((event.clientY - rect.top) / rect.height);
        onPointerMove?.(event);
      }}
      style={{ rotateX, rotateY, transformPerspective: 900, ...style }}
      type="button"
      {...props}
    >
      <motion.span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: light }} />
      {children as React.ReactNode}
    </motion.button>
  );
}

/** The one action on the screen. It stays put under the pointer, darkens a
 *  touch on hover, and its label rolls over rather than blinking. */
export function ActionButton({
  children,
  label,
  className,
  disabled,
  onClick,
  ref,
}: {
  children: React.ReactNode;
  /** Identity of the label, so a change of wording rolls instead of snapping. */
  label: string;
  className?: string;
  disabled?: boolean;
  onClick(): void;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <motion.button
      animate={{ opacity: disabled ? 0.4 : 1 }}
      className={cn(
        "relative inline-flex h-11 w-[23rem] max-w-full items-center justify-center overflow-hidden rounded-xl bg-primary px-7 text-[0.8125rem] font-medium text-primary-foreground outline-none transition-[background-color] duration-150",
        "shadow-[0_1px_0_0_color-mix(in_oklab,var(--primary-foreground)_18%,transparent)_inset,0_8px_20px_-14px_color-mix(in_oklab,var(--foreground)_60%,transparent)]",
        "enabled:hover:bg-[color-mix(in_oklab,var(--primary)_88%,var(--background))]",
        "focus-visible:ring-2 focus-visible:ring-foreground/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed",
        className,
      )}
      disabled={disabled}
      onClick={onClick}
      ref={ref}
      type="button"
      {...(disabled ? {} : { whileTap: { scale: 0.985 } })}
    >
      <Swap value={label}>{children}</Swap>
    </motion.button>
  );
}

/** The key that picks a choice, drawn on it: numbers are the fast way through. */
export function Key({ children, on }: { children: React.ReactNode; on?: boolean }) {
  return (
    <span className={cn("inline-grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-[5px] px-1 font-mono text-[0.625rem] tabular-nums transition-colors", on ? "bg-foreground text-background" : "bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)] text-muted-foreground")}>
      {children}
    </span>
  );
}

/** Focus a field once its scene has arrived, so the ring is not drawn mid-flight. */
export function useArrivalFocus(ref: React.RefObject<HTMLElement | null>, delay = 320) {
  useEffect(() => {
    const timer = setTimeout(() => ref.current?.focus({ preventScroll: true }), delay);
    return () => clearTimeout(timer);
  }, [ref, delay]);
}

/** How fast the coach's lines stream in: quick enough to read as speech rather
 *  than an effect, slow enough to see that it is being said. */
const SPOKEN_PER_SECOND = 62;

/** Text that is typed out rather than shown, with a thin caret at its end while
 *  it is. The whole text is laid out invisibly underneath, so a centred line
 *  does not re-centre itself with every character. */
export function Typed({ text, delay = 0, speed = SPOKEN_PER_SECOND, className, onDone }: { text: string; delay?: number; speed?: number; className?: string; onDone?(): void }) {
  const [shown, setShown] = useState(0);
  const done = shown >= text.length;
  const finished = useLatest(onDone);
  useEffect(() => {
    if (reducedMotion()) {
      setShown(text.length);
      return;
    }
    setShown(0);
    let raf = 0;
    const from = performance.now() + delay * 1000;
    const tick = (now: number) => {
      const count = now < from ? 0 : Math.min(text.length, Math.floor(((now - from) / 1000) * speed));
      setShown(count);
      if (count < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [delay, speed, text]);
  useEffect(() => {
    if (done) finished.current?.();
  }, [done, finished]);
  return (
    <span className={cn("relative inline-block", className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="invisible">{text}</span>
      <span aria-hidden className="absolute inset-0 text-left">
        {text.slice(0, shown)}
        {!done && shown > 0 && <span className="ml-px inline-block h-[1.05em] w-[1.5px] translate-y-[0.18em] rounded-full bg-current" />}
      </span>
    </span>
  );
}

/** The coach saying something: its mark, then the line streaming out after it,
 *  the way it answers everywhere else in the app. The caller keys it on the
 *  text, so a new line is said afresh instead of being spliced into the last. */
export function CoachLine({ text, delay = 0, className }: { text: string; delay?: number; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <motion.p
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex items-start justify-center gap-2 text-ui leading-[1.5] text-muted-foreground", className)}
      initial={{ opacity: 0, y: 4 }}
      transition={{ ...SPRING, delay }}
    >
      {/* Centred on the first line, not sat on its baseline. */}
      <span className="mt-[calc(0.75em-5.5px)] flex shrink-0 text-foreground">
        <SparDots pattern={done ? "still" : "pulse"} size={11} />
      </span>
      <Typed delay={delay + 0.12} onDone={() => setDone(true)} text={text} />
    </motion.p>
  );
}

/* The mark's geometry, shared with SparDots: a five-by-five grid, largest and
   brightest along the leading diagonal. */
const GRID = 5;
const FILL = 0.78;
const TAPER = 0.55;
const PITCH = 100 / (GRID - 1 + FILL);
const RADIUS = (PITCH * FILL) / 2;

function markDots(seed: number) {
  let state = seed;
  // A tiny deterministic generator, so the scatter is the same every render.
  const random = () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: GRID * GRID }, (_, index) => {
    const row = Math.floor(index / GRID);
    const column = index % GRID;
    const rest = 1 - (TAPER * Math.abs(row - column)) / (GRID - 1);
    const angle = random() * Math.PI * 2;
    const distance = 140 + random() * 160;
    return {
      index,
      row,
      column,
      cx: RADIUS + column * PITCH,
      cy: RADIUS + row * PITCH,
      rest,
      tone: 0.45 + 0.55 * rest,
      along: (row + column) / (2 * (GRID - 1)),
      scatterX: Math.cos(angle) * distance,
      scatterY: Math.sin(angle) * distance,
      jitter: random() * 0.12,
    };
  });
}

/** The mark, assembling: every dot flies in from somewhere off in the window and
 *  lands on its place in the grid, top-left corner first, the diagonal last. */
export function AssemblingMark({ size, delay = 0 }: { size: number; delay?: number }) {
  const dots = useMemo(() => markDots(7), []);
  return (
    <svg aria-hidden fill="currentColor" height={size} overflow="visible" viewBox="0 0 100 100" width={size}>
      {dots.map((dot) => {
        const at = delay + dot.along * 0.6 + dot.jitter;
        return (
          <motion.circle
            animate={{ x: 0, y: 0, scale: [0, dot.rest * 1.6, dot.rest], opacity: dot.tone }}
            cx={dot.cx}
            cy={dot.cy}
            initial={{ x: dot.scatterX, y: dot.scatterY, scale: 0, opacity: 0 }}
            key={dot.index}
            r={RADIUS}
            transition={{
              x: { ...GLIDE, delay: at },
              y: { ...GLIDE, delay: at },
              scale: { duration: 1.1, times: [0, 0.55, 1], ease: EASE_OUT, delay: at },
              opacity: { duration: 0.35, delay: at },
            }}
          />
        );
      })}
    </svg>
  );
}

/** The mark as a gauge: the diagonal alone, the diagonal and its neighbours, or
 *  the whole grid. Used for experience, where "how much of the grid is lit" is
 *  the answer read as a picture. Wakes with a pass along the diagonal. */
export function MarkLevel({ level, active, size = 44 }: { level: 0 | 1 | 2; active: boolean; size?: number }) {
  const dots = useMemo(() => markDots(3), []);
  const spread = [0, 1, 4][level]!;
  return (
    <svg aria-hidden fill="currentColor" height={size} viewBox="0 0 100 100" width={size}>
      {dots.map((dot) => {
        const lit = Math.abs(dot.row - dot.column) <= spread;
        return (
          <motion.circle
            animate={active ? "on" : "off"}
            custom={{ lit, rest: dot.rest, along: dot.along }}
            cx={dot.cx}
            cy={dot.cy}
            initial={false}
            key={dot.index}
            r={RADIUS}
            variants={{
              on: ({ lit, rest, along }: { lit: boolean; rest: number; along: number }) => ({
                scale: lit ? [rest, rest * 1.45, rest] : 0.35,
                opacity: lit ? 1 : 0.16,
                transition: { duration: 0.6, delay: along * 0.35, ease: "easeInOut" },
              }),
              off: ({ lit, rest }: { lit: boolean; rest: number }) => ({
                scale: lit ? rest : 0.35,
                opacity: lit ? 0.6 : 0.13,
                transition: { duration: 0.3 },
              }),
            }}
          />
        );
      })}
    </svg>
  );
}

/** The order the progress mark fills in: its diagonal first, then each band
 *  either side of it, top-left to bottom-right within a band — the same
 *  direction every one of the mark's animations travels. */
const FILL_ORDER = (() => {
  const dots = markDots(1);
  const order = [...dots].sort((a, b) => Math.abs(a.row - a.column) - Math.abs(b.row - b.column) || a.along - b.along || a.row - b.row);
  const rank = new Array<number>(dots.length);
  order.forEach((dot, position) => { rank[dot.index] = position; });
  return rank;
})();
export const MARK_DOTS = GRID * GRID;
export const MARK_DIAGONAL = GRID;

/** The mark as the intake's progress. Before anything has been said only its
 *  diagonal is lit; each answer lights the next few dots out from it, and the
 *  mark is whole — the logo itself — once the first Track is ready. */
export function ProgressMark({ lit, size = 20 }: { lit: number; size?: number }) {
  const dots = useMemo(() => markDots(1), []);
  /* Where the fill stood before this render, so the dots that light together
     light one after another rather than all at once. */
  const before = useRef(lit);
  const from = before.current;
  useEffect(() => { before.current = lit; }, [lit]);
  return (
    <svg aria-hidden fill="currentColor" height={size} viewBox="0 0 100 100" width={size}>
      {dots.map((dot) => {
        const rank = FILL_ORDER[dot.index]!;
        return (
          /* Variant labels rather than values, so a render that changes nothing
             about a dot never restarts the pop it is halfway through. */
          <motion.circle
            animate={rank < lit ? "on" : "off"}
            custom={{ rest: dot.rest, tone: dot.tone, delay: 0.25 + Math.max(0, rank - from) * 0.07 }}
            cx={dot.cx}
            cy={dot.cy}
            initial={false}
            key={dot.index}
            r={RADIUS}
            variants={{
              on: ({ rest, tone, delay }: { rest: number; tone: number; delay: number }) => ({
                scale: [0.62, rest * 1.55, rest],
                opacity: tone,
                transition: { duration: 0.55, times: [0, 0.5, 1], ease: EASE_OUT, delay },
              }),
              off: { scale: 0.62, opacity: 0.16, transition: POP },
            }}
          />
        );
      })}
    </svg>
  );
}

/** Lets a component run something once, after its first paint, without the
 *  effect re-running when the callback's identity changes. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
