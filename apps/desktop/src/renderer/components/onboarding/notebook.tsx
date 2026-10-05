import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconPencilWave } from "central-icons";
import type { Language, LearnerProfile, ProblemSource } from "@spar/domain";
import { cn } from "@/lib/utils";
import { LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { SparDots } from "../common/SparDots";
import { SURFACE, useLatest } from "./kit";
import { GLIDE, POP } from "./motion";
import { EXPERIENCE, STYLES, type CoachStyle, type ConnectedSource, type GoalId } from "./scenes";
import { warmupNotes, type Answer } from "./warmup";

/* ---- The page -------------------------------------------------------------- */

const GOAL_LINE: Record<GoalId, (language: string) => string> = {
  interviews: () => "Training for coding interviews.",
  work: () => "Training for the code they write at work.",
  contests: () => "Training for contests.",
  language: (language) => `Learning ${language}.`,
  fundamentals: () => "Building their fundamentals.",
  own: () => "",
};

/** user.md's first page, written from the intake and the warm-up.
 *  Only what was said and seen, in the coach's plain register — no diagnosis it
 *  has not made yet. The learner's own line, if they add one, goes on after. */
export function composeNotebook(input: {
  name: string;
  experience: LearnerProfile["experience"] | null;
  language: Language | null;
  goal: GoalId | null;
  own: string;
  /** Null when the warm-up was skipped. */
  warmup: Answer[] | null;
  style: CoachStyle | null;
  sources: ProblemSource[];
  accounts: ConnectedSource[];
}) {
  const level = EXPERIENCE.find((item) => item.value === input.experience);
  const style = STYLES.find((item) => item.value === input.style);
  const language = input.language ? LANGUAGE_LABEL[input.language] : "";
  const goal = input.goal === "own" ? (input.own.trim() ? `Training for: “${input.own.trim()}”` : "") : input.goal ? GOAL_LINE[input.goal](language) : "";
  const sites = input.sources.filter((source) => source !== "spar").map((source) => {
    const account = input.accounts.find((entry) => entry.id === source)?.account;
    const name = source === "leetcode" ? "LeetCode" : "Codeforces";
    return account ? `${name} (${account.solved.total.toLocaleString()} solved there)` : name;
  });
  const problems = !input.sources.includes("spar") ? `Only real ones, from ${sites.join(" and ")}.` : sites.length ? `Mine, plus ${sites.join(" and ")}.` : "Only ones I write.";
  const warmup = input.warmup?.length ? warmupNotes(input.warmup) : null;
  // "Learning Rust." already says what they write in.
  const about = input.goal === "language" ? goal : [language ? `Writes ${language}.` : "", goal].filter(Boolean).join(" ");
  const lines = [
    `# About ${input.name.trim() || "you"}`,
    "## Where they are",
    level ? `- ${level.label}: ${level.hint.toLowerCase()}.` : "",
    about ? `- ${about}` : "",
    `- Problems: ${problems.charAt(0).toLowerCase()}${problems.slice(1)}`,
    "## Warm-up",
    ...(warmup ? warmup.lines : ["- Skipped. Find their level from the first attempts."]),
    "## How to coach them",
    style ? `- ${style.note}` : "- No preference given. Watch what helps.",
    "## Plan",
    `- ${warmup ? warmup.plan : `Open with a short diagnostic${language ? ` in ${language}` : ""}.`}`,
  ];
  return lines.filter(Boolean);
}

/** The page as markdown, with the learner's own line after it if they wrote one. */
export function notebookMarkdown(lines: string[], words: string) {
  const own = words.trim() ? ["## In their words", `> ${words.trim().replace(/\n+/g, " ")}`] : [];
  return [...lines, ...own].map((line) => (line.startsWith("## ") ? `\n${line}` : line)).join("\n");
}

/** Typing speed, and how long the carriage rests at the end of a line. */
const CHARACTERS_PER_SECOND = 135;
const LINE_REST = 0.09;
const HEADING_REST = 0.24;

/** A notebook line as it is typed on the page: the markdown's markers dropped. */
const typedAs = (line: string) => line.replace(/^(# |## |> |- )/, "");

/** The notebook's first page, typed out in front of the learner, then stamped
 *  with the mark. After the stamp there is room for one line of their own — the
 *  only free text the intake asks for, and the one place it asks for it. */
export function NotebookPage({ lines, words, onWords, onWritten, onStamped, onSubmit }: {
  lines: string[];
  words: string;
  onWords(value: string): void;
  onWritten(): void;
  /** The stamp has landed: where it is, for anything that wants to answer it. */
  onStamped(element: HTMLElement): void;
  onSubmit(): void;
}) {
  const stamp = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const written = useLatest(onWritten);
  const stamped = useLatest(onStamped);
  const layout = useMemo(() => {
    let offset = 0;
    return lines.map((line) => {
      const text = typedAs(line);
      const start = offset;
      offset += text.length;
      return { line, text, start, end: offset };
    });
  }, [lines]);
  const total = layout.at(-1)?.end ?? 0;
  const [typed, setTyped] = useState(0);
  const done = typed >= total;

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(total);
      return;
    }
    let raf = 0;
    let count = 0;
    let line = 0;
    let rest = 0.55;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (rest > 0) rest -= dt;
      else {
        count += dt * CHARACTERS_PER_SECOND;
        const end = layout[line]?.end ?? total;
        if (count >= end) {
          count = end;
          line += 1;
          rest = layout[line]?.line.startsWith("#") ? HEADING_REST : LINE_REST;
        }
      }
      setTyped(Math.floor(count));
      if (count < total) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layout, total]);

  useEffect(() => {
    if (!done) return;
    written.current();
    // The stamp lands a beat after the last key: that is the page being filed.
    const timer = setTimeout(() => stamp.current && stamped.current(stamp.current), 560);
    const focus = setTimeout(() => field.current?.focus({ preventScroll: true }), 900);
    return () => {
      clearTimeout(timer);
      clearTimeout(focus);
    };
  }, [done, stamped, written]);

  const current = done ? -1 : layout.findIndex((entry) => typed < entry.end);

  return (
    <div className="mx-auto w-full max-w-[26rem] [perspective:1400px]">
      <motion.div animate={{ opacity: 1, rotateX: 0, y: 0 }} className={cn(SURFACE, "relative overflow-hidden rounded-2xl")} initial={{ opacity: 0, rotateX: 30, y: 40 }} transition={GLIDE}>
        <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
          <span className="flex items-center gap-2 text-ui-sm text-muted-foreground">
            <IconPencilWave className="size-3.5" /> <span className="font-mono">user.md</span>
          </span>
          <span className="text-ui-sm text-muted-foreground/70">Every Track reads it</span>
        </div>
        <div aria-live="off" className="relative min-h-[15.5rem] px-5 pb-4 pt-3.5">
          {layout.map((entry, index) => {
            const count = Math.max(0, Math.min(entry.text.length, typed - entry.start));
            if (count === 0 && index !== current) return null;
            const text = entry.text.slice(0, count);
            const caret = index === current && <span className="ml-px inline-block h-[1em] w-[1.5px] translate-y-[0.15em] rounded-full bg-foreground" />;
            if (entry.line.startsWith("# ")) return <p className="mb-1 font-spar text-[1.125rem] font-semibold tracking-[-0.03em] text-foreground" key={index}>{text}{caret}</p>;
            if (entry.line.startsWith("## ")) return <p className="mb-0.5 mt-3 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-muted-foreground/80" key={index}>{text}{caret}</p>;
            if (entry.line.startsWith("> ")) return <p className="border-l-2 border-foreground/25 pl-2.5 text-ui italic leading-[1.55] text-foreground/85" key={index}>{text}{caret}</p>;
            return <p className="flex gap-2 text-ui leading-[1.6] text-foreground/85" key={index}><span className="text-muted-foreground/50">–</span><span>{text}{caret}</span></p>;
          })}
          <AnimatePresence>
            {done && (
              <motion.div
                animate={{ opacity: 0.72, scale: 1, rotate: -8 }}
                className="absolute bottom-3.5 right-4 flex items-center gap-1.5 rounded-[6px] border-[1.5px] border-current px-2 py-1 text-foreground"
                initial={{ opacity: 0, scale: 1.9, rotate: -18 }}
                ref={stamp}
                transition={{ type: "spring", stiffness: 520, damping: 17, mass: 0.8, delay: 0.4 }}
              >
                <SparDots pattern="still" size={11} />
                <span className="font-spar text-[0.75rem] font-semibold tracking-[-0.04em]">Spar</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <AnimatePresence>
          {done && (
            <motion.div animate={{ height: "auto", opacity: 1 }} className="overflow-hidden" initial={{ height: 0, opacity: 0 }} transition={{ ...POP, delay: 0.75 }}>
              <label className="block border-t border-dashed border-border px-5 pb-3.5 pt-3">
                <span className="mb-1 block font-mono text-[0.625rem] uppercase tracking-[0.16em] text-muted-foreground/80">In your words</span>
                <textarea
                  aria-label="Where you usually get stuck"
                  className="field-sizing-content block max-h-[6rem] min-h-[1.5rem] w-full resize-none bg-transparent text-ui leading-[1.6] text-foreground outline-none placeholder:text-muted-foreground/55"
                  maxLength={600}
                  onChange={(event) => onWords(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      onSubmit();
                    }
                  }}
                  placeholder="Where do you usually get stuck? Optional."
                  ref={field}
                  rows={1}
                  value={words}
                />
              </label>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

/* ---- The collector --------------------------------------------------------- */

/** The notebook, pinned in the corner through the intake: every answer flies
 *  into it, so the learner can see they are writing something that lasts. */
export function NotebookPill({ count, bump, ref }: { count: number; bump: number; ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <motion.span
      animate={{ opacity: 1, scale: 1 }}
      className={cn(SURFACE, "app-no-drag flex h-7 items-center gap-1.5 rounded-full pl-2.5 pr-1.5 text-ui text-muted-foreground")}
      initial={{ opacity: 0, scale: 0.8 }}
      ref={ref}
      transition={POP}
    >
      <motion.span animate={bump ? { rotate: [0, -14, 10, 0], scale: [1, 1.25, 1] } : {}} className="inline-flex" key={bump} transition={{ duration: 0.5 }}>
        <IconPencilWave className="size-3.5" />
      </motion.span>
      <span className="font-mono text-ui-sm">user.md</span>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          animate={{ y: 0, opacity: 1 }}
          className="grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 text-[0.625rem] font-medium tabular-nums text-background"
          exit={{ y: -10, opacity: 0 }}
          initial={{ y: 10, opacity: 0 }}
          key={count}
          transition={POP}
        >
          {count}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}

export type Flight = { id: number; text: string; from: { x: number; y: number }; to: { x: number; y: number } };

/** An answer on its way to the notebook: lifted off the page, arcing up to the
 *  corner, shrinking as it lands. */
export function Flyer({ flight, onLanded }: { flight: Flight; onLanded(): void }) {
  const dx = flight.to.x - flight.from.x;
  const dy = flight.to.y - flight.from.y;
  return (
    <motion.span
      animate={{ x: [0, dx * 0.35, dx], y: [0, dy * 0.25 - 60, dy], scale: [1, 0.9, 0.3], opacity: [0, 1, 0.2] }}
      className={cn(SURFACE, "pointer-events-none fixed z-50 max-w-[14rem] -translate-x-1/2 -translate-y-1/2 truncate rounded-full px-3 py-1 text-ui font-medium text-foreground")}
      onAnimationComplete={onLanded}
      style={{ left: flight.from.x, top: flight.from.y }}
      transition={{ duration: 0.8, times: [0, 0.45, 1], ease: [0.5, 0, 0.2, 1] }}
    >
      {flight.text}
    </motion.span>
  );
}
