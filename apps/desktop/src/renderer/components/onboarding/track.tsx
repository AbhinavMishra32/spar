import { motion } from "motion/react";
import { IconPencil } from "central-icons";
import type { Language, ProblemSource } from "@spar/domain";
import { cn } from "@/lib/utils";
import { LANGUAGE_LABEL, LanguageGlyph } from "../common/LanguageGlyph";
import { SourceGlyph } from "../common/SourceGlyph";
import { SparDots } from "../common/SparDots";
import { AFTER_QUESTION, SURFACE } from "./kit";
import { GLIDE, SPRING } from "./motion";
import { SOURCES, STYLES, type CoachStyle } from "./scenes";

/** Plain text that is quietly editable: no box until it is pointed at. */
const EDITABLE = "-mx-2 w-[calc(100%+1rem)] rounded-lg bg-transparent px-2 outline-none transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] focus:bg-[color-mix(in_oklab,var(--foreground)_5.5%,transparent)]";

/** The first Track, composed from everything the intake decided: what it is
 *  for, what it is in, where its problems come from and what the coach opens
 *  on. The title and the goal are the learner's to change — the goal is the
 *  sentence the coach starts the Track from, so it should sound like them. */
export function TrackCard({ title, goal, language, sources, style, first, onTitle, onGoal, onSubmit, onRevealUser }: {
  title: string;
  goal: string;
  language: Language | null;
  sources: ProblemSource[];
  style: CoachStyle | null;
  /** What the first session opens on, from the warm-up. */
  first: string;
  onTitle(value: string): void;
  onGoal(value: string): void;
  onSubmit(): void;
  /** Shows user.md on disk, where the app can. */
  onRevealUser?(): void;
}) {
  const coaching = STYLES.find((item) => item.value === style)?.label ?? "I'll find what helps";
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: "Problems",
      value: (
        <span className="flex items-center gap-2">
          {sources.map((source) => (
            <span className="flex items-center gap-1.5" key={source}>
              {source === "spar" ? <SparDots pattern="still" size={12} /> : <SourceGlyph className="size-3.5" source={source} />}
              {source === "spar" ? "Spar" : SOURCES.find((item) => item.id === source)?.short}
            </span>
          ))}
        </span>
      ),
    },
    { label: "Coaching", value: coaching },
    { label: "First up", value: first },
    {
      label: "Knows you from",
      value: (
        <span className="flex items-center gap-2">
          <span className="font-mono text-ui-sm">user.md</span>
          {onRevealUser && (
            <button className="rounded-md px-1.5 py-0.5 text-ui-sm text-muted-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] hover:text-foreground" onClick={onRevealUser} type="button">
              Show
            </button>
          )}
        </span>
      ),
    },
  ];
  const submitOnEnter = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
    }
  };
  return (
    <div className="mx-auto w-full max-w-[26rem] [perspective:1400px]">
      <motion.div
        animate={{ opacity: 1, rotateX: 0, y: 0, scale: 1 }}
        className={cn(SURFACE, "rounded-2xl px-5 pb-2 pt-4")}
        initial={{ opacity: 0, rotateX: -32, y: 56, scale: 0.96 }}
        transition={{ ...GLIDE, delay: AFTER_QUESTION * 0.5 }}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-muted-foreground/80">Track</span>
          {language && (
            <span className="flex items-center gap-1.5 text-ui-sm text-muted-foreground">
              <LanguageGlyph className="size-3.5" language={language} />
              {LANGUAGE_LABEL[language]}
            </span>
          )}
        </div>
        <label className="group relative mt-1.5 block">
          <input
            aria-label="Track title"
            className={cn(EDITABLE, "h-10 pr-8 font-spar text-[1.375rem] font-semibold tracking-[-0.035em] text-foreground")}
            maxLength={80}
            onChange={(event) => onTitle(event.target.value)}
            onKeyDown={submitOnEnter}
            spellCheck={false}
            value={title}
          />
          <IconPencil className="pointer-events-none absolute right-1 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70 group-focus-within:text-muted-foreground/70" />
        </label>
        <textarea
          aria-label="What this Track is for"
          className={cn(EDITABLE, "field-sizing-content mt-0.5 block max-h-[7.5rem] min-h-[2.75rem] resize-none py-1 text-ui leading-[1.6] text-muted-foreground focus:text-foreground")}
          maxLength={1000}
          onChange={(event) => onGoal(event.target.value)}
          onKeyDown={submitOnEnter}
          rows={2}
          value={goal}
        />
        <div className="mt-3 border-t border-border">
          {rows.map((row, index) => (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className={cn("flex h-10 items-center justify-between gap-4 text-ui", index > 0 && "border-t border-border")}
              initial={{ opacity: 0, y: 8 }}
              key={row.label}
              transition={{ ...SPRING, delay: AFTER_QUESTION + 0.25 + index * 0.08 }}
            >
              <span className="text-muted-foreground">{row.label}</span>
              <span className="min-w-0 truncate text-foreground">{row.value}</span>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
