import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconArrowRight, IconBlocks, IconBook, IconChainLink1, IconCheckmark1, IconCompassRound, IconPencilLine, IconStopwatch, IconSuitcase, IconTranslate, IconTrophy, IconWeight } from "central-icons";
import type { CentralIcon } from "@/lib/icons";
import { LANGUAGES as SUPPORTED_LANGUAGES, type Language, type LearnerProfile, type ProblemSource } from "@spar/domain";
import type { PracticeSourceAccount, ThemePreference } from "../../../shared/api";
import { Meter, MeterKey, type MeterBand } from "@/components/ui/meter";
import { cn } from "@/lib/utils";
import { LANGUAGE_LABEL, SelectableLanguageGlyph } from "../common/LanguageGlyph";
import { ProviderGlyph } from "../common/ProviderGlyph";
import { SourceGlyph } from "../common/SourceGlyph";
import { SparDots, SparDotsLine } from "../common/SparDots";
import type { Provider } from "../settings/ProviderConnectDialog";
import { AFTER_QUESTION, CoachLine, Key, MarkLevel, PICKED, SURFACE, Tilt } from "./kit";
import { EASE_OUT, GLIDE, POP, SPRING } from "./motion";

/** A check that draws itself in, for anything that is on rather than picked. */
export function DrawnCheck({ className }: { className?: string }) {
  return (
    <motion.svg animate={{ opacity: 1, scale: 1 }} className={cn("size-3.5", className)} exit={{ opacity: 0, scale: 0.6 }} fill="none" initial={{ opacity: 0, scale: 0.6 }} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} viewBox="0 0 24 24">
      <motion.path animate={{ pathLength: 1 }} d="M4 12.5l5 5L20 6.5" initial={{ pathLength: 0 }} transition={{ duration: 0.3, ease: EASE_OUT, delay: 0.05 }} />
    </motion.svg>
  );
}

/** The small square an option's icon sits in: quiet until it is the answer. */
function IconTile({ Icon, on }: { Icon: CentralIcon; on: boolean }) {
  return (
    <motion.span
      animate={{ rotate: on ? [0, -12, 8, 0] : 0, scale: on ? 1.08 : 1 }}
      className={cn("grid size-8 place-items-center rounded-lg transition-colors duration-200", on ? "bg-foreground text-background" : "bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] text-muted-foreground group-hover:text-foreground")}
      transition={{ duration: 0.5, ease: EASE_OUT }}
    >
      <Icon className="size-4" />
    </motion.span>
  );
}

/* ---- Goal ------------------------------------------------------------------ */

export type GoalId = "interviews" | "work" | "contests" | "language" | "fundamentals" | "own";

/** What someone is training for. Each is a different first Track, and each gets
 *  a line back from the coach saying what that will mean. */
export const GOALS: Array<{ id: GoalId; label: string; hint: string; Icon: CentralIcon; reply: string }> = [
  { id: "interviews", label: "Interviews", hint: "Coding rounds, on the clock", Icon: IconStopwatch, reply: "Then we'll practise on the clock, out loud." },
  { id: "work", label: "My day job", hint: "The code I ship", Icon: IconSuitcase, reply: "Then we'll work on code that looks like yours." },
  { id: "contests", label: "Contests", hint: "Harder problems, faster", Icon: IconTrophy, reply: "Then we'll turn patterns into speed." },
  { id: "language", label: "A new language", hint: "Fluent, not just familiar", Icon: IconTranslate, reply: "Then you'll learn to think in it, not translate into it." },
  { id: "fundamentals", label: "The fundamentals", hint: "Data structures, properly", Icon: IconBlocks, reply: "Then we'll go deep on what everything else rests on." },
  { id: "own", label: "Something else", hint: "In my own words", Icon: IconPencilLine, reply: "" },
];

/** The kinds of reasoning each goal leans on, filed as the profile's focus so
 *  every turn's context carries it. Only for the goals that clearly imply some. */
export const GOAL_FOCUS: Record<GoalId, string[]> = {
  interviews: ["Algorithms", "Data structures"],
  work: ["Debugging", "Testing", "API design"],
  contests: ["Algorithms", "Performance"],
  language: [],
  fundamentals: ["Data structures", "Algorithms"],
  own: [],
};

/** A title for a goal in someone's own words: its first clause, capitalised,
 *  cut at a word before it outgrows a sidebar row. */
function titleFrom(text: string) {
  const clause = text.trim().split(/[.!?:;\n]/)[0]!.trim().replace(/^(i want to|i'd like to|i would like to|to)\s+/i, "");
  const cut = clause.length > 44 ? clause.slice(0, 44).replace(/\s+\S*$/, "") : clause;
  return cut ? cut[0]!.toUpperCase() + cut.slice(1) : "My first Track";
}

/** The first Track a goal becomes: a title for the sidebar, and a goal written
 *  as the learner's own sentence, because the coach starts the Track on it. */
export function trackFor(goal: GoalId, own: string, language: Language | null): { title: string; goal: string } {
  const name = language ? LANGUAGE_LABEL[language] : "a new language";
  switch (goal) {
    case "interviews": return { title: "Interview prep", goal: "Get ready for coding interviews: solve under time, explain my approach out loud, and handle the follow-ups." };
    case "work": return { title: "Everyday engineering", goal: "Get better at the code I write at work: reading it, debugging it, and designing it." };
    case "contests": return { title: "Contest training", goal: "Get faster and more accurate on contest problems, and move up to harder ones." };
    case "language": return { title: `${name} fluency`, goal: `Get fluent in ${name}: its idioms, its standard library, and the mistakes it makes easy.` };
    case "fundamentals": return { title: "Fundamentals", goal: "Build solid fundamentals: data structures, algorithms, and what each one costs." };
    case "own": return { title: titleFrom(own), goal: own.trim() };
  }
}

export function GoalPick({ value, own, onPick, onOwn, onSubmit }: { value: GoalId | null; own: string; onPick(value: GoalId): void; onOwn(value: string): void; onSubmit(): void }) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (value !== "own") return;
    const timer = setTimeout(() => field.current?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(timer);
  }, [value]);
  const reply = GOALS.find((goal) => goal.id === value)?.reply ?? "";
  return (
    <div className="mx-auto w-full max-w-[34rem]">
      <div className="grid grid-cols-3 gap-2 [perspective:1200px]" role="radiogroup">
        {GOALS.map((option, index) => {
          const selected = value === option.id;
          return (
            <motion.div animate={{ opacity: 1, y: 0, rotateX: 0 }} initial={{ opacity: 0, y: 40, rotateX: 28 }} key={option.id} transition={{ ...GLIDE, delay: AFTER_QUESTION + (Math.floor(index / 3) + (index % 3)) * 0.06 }}>
              <Tilt
                aria-checked={selected}
                className={cn(SURFACE, "flex h-[7.25rem] w-full flex-col justify-between rounded-xl p-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-foreground/25")}
                max={6}
                onClick={() => onPick(option.id)}
                role="radio"
                whileTap={{ scale: 0.97 }}
              >
                {selected && <motion.span className={PICKED} layoutId="goal-pick" transition={SPRING} />}
                <span className="relative flex items-start justify-between">
                  <IconTile Icon={option.Icon} on={selected} />
                  <Key on={selected}>{index + 1}</Key>
                </span>
                <span className="relative">
                  <span className="block text-content font-medium text-foreground">{option.label}</span>
                  <span className="mt-0.5 block truncate text-ui text-muted-foreground">{option.hint}</span>
                </span>
              </Tilt>
            </motion.div>
          );
        })}
      </div>
      <AnimatePresence initial={false}>
        {value === "own" && (
          <motion.div animate={{ height: "auto", opacity: 1 }} className="overflow-hidden" exit={{ height: 0, opacity: 0 }} initial={{ height: 0, opacity: 0 }} transition={SPRING}>
            <label className={cn(SURFACE, "mt-2 flex h-11 items-center gap-2.5 rounded-xl px-3.5 transition-shadow focus-within:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_30%,transparent)]")}>
              <IconPencilLine className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                aria-label="What you want to get better at"
                className="min-w-0 flex-1 bg-transparent text-content text-foreground outline-none placeholder:text-muted-foreground/55"
                maxLength={300}
                onChange={(event) => onOwn(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    onSubmit();
                  }
                }}
                placeholder="In a sentence: what do you want to get better at?"
                ref={field}
                spellCheck={false}
                value={own}
              />
            </label>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mt-4 flex h-5 justify-center">
        {reply && <CoachLine key={value} text={reply} />}
      </div>
    </div>
  );
}

/* ---- Language -------------------------------------------------------------- */

export const LANGUAGES: Language[] = [...SUPPORTED_LANGUAGES];

export function LanguageGrid({ value, onPick }: { value: Language | null; onPick(value: Language): void }) {
  return (
    <div aria-label="Language" className="mx-auto grid w-full max-w-[34rem] grid-cols-5 gap-1.5 [perspective:1000px]" role="radiogroup">
      {LANGUAGES.map((option, index) => {
        const selected = value === option;
        const row = Math.floor(index / 5);
        const column = index % 5;
        return (
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            initial={{ opacity: 0, scale: 0.6, y: 30 }}
            key={option}
            transition={{ ...POP, delay: AFTER_QUESTION + (row + column) * 0.045 }}
          >
            <Tilt
              aria-checked={selected}
              aria-label={LANGUAGE_LABEL[option]}
              className={cn(SURFACE, "flex h-[4.75rem] w-full flex-col items-center justify-center gap-1.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-foreground/25")}
              max={12}
              onClick={() => onPick(option)}
              role="radio"
              whileTap={{ scale: 0.94 }}
            >
              {selected && <motion.span className={PICKED} layoutId="language-pick" transition={SPRING} />}
              <span className="absolute left-1.5 top-1.5"><Key on={selected}>{index === 9 ? 0 : index + 1}</Key></span>
              <motion.span animate={{ scale: selected ? 1.18 : 1, y: selected ? -2 : 0 }} className="relative" transition={POP}>
                <SelectableLanguageGlyph className="size-6" language={option} selected={selected} />
              </motion.span>
              <span className={cn("relative w-full truncate px-2 text-center text-ui text-foreground", selected && "font-medium")}>{LANGUAGE_LABEL[option]}</span>
            </Tilt>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ---- Level ----------------------------------------------------------------- */

export const EXPERIENCE: Array<{ value: LearnerProfile["experience"]; label: string; hint: string; level: 0 | 1 | 2 }> = [
  { value: "new", label: "Getting started", hint: "Learning to program, or a year or so in", level: 0 },
  { value: "working", label: "Shipping regularly", hint: "Writing code most days", level: 1 },
  { value: "senior", label: "Designing and reviewing", hint: "Shaping systems and other people's work", level: 2 },
];

export function ExperiencePick({ value, onPick }: { value: LearnerProfile["experience"] | null; onPick(value: LearnerProfile["experience"]): void }) {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <div className="mx-auto grid w-full max-w-[32rem] grid-cols-3 gap-2 [perspective:1200px]" role="radiogroup">
      {EXPERIENCE.map((option, index) => {
        const selected = value === option.value;
        return (
          <motion.div animate={{ opacity: 1, y: 0, rotateX: 0 }} initial={{ opacity: 0, y: 40, rotateX: 28 }} key={option.value} transition={{ ...GLIDE, delay: AFTER_QUESTION + index * 0.08 }}>
            <Tilt
              aria-checked={selected}
              className={cn(SURFACE, "flex h-[10rem] w-full flex-col justify-between rounded-xl p-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-foreground/25")}
              onClick={() => onPick(option.value)}
              onPointerEnter={() => setHovered(option.value)}
              onPointerLeave={() => setHovered(null)}
              role="radio"
              whileTap={{ scale: 0.97 }}
            >
              {selected && <motion.span className={PICKED} layoutId="experience-pick" transition={SPRING} />}
              <span className="relative flex items-start justify-between">
                <span className="text-foreground"><MarkLevel active={selected || hovered === option.value} level={option.level} size={32} /></span>
                <Key on={selected}>{index + 1}</Key>
              </span>
              <span className="relative">
                <span className="block text-content font-medium text-foreground">{option.label}</span>
                <span className="mt-1 block text-ui leading-[1.5] text-muted-foreground">{option.hint}</span>
              </span>
            </Tilt>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ---- Coaching -------------------------------------------------------------- */

export type CoachStyle = "struggle" | "nudge" | "teach";

export const STYLES: Array<{ value: CoachStyle; label: string; hint: string; Icon: CentralIcon; note: string }> = [
  { value: "struggle", label: "Let me struggle", hint: "Hints only when I ask", Icon: IconWeight, note: "Wants room to struggle: hold hints back until they ask." },
  { value: "nudge", label: "Nudge me", hint: "Step in when I drift", Icon: IconCompassRound, note: "Wants a nudge when they drift off track, not a wait for them to ask." },
  { value: "teach", label: "Teach first", hint: "The idea, then the try", Icon: IconBook, note: "Learns best from the idea first, then an attempt of their own." },
];

export function StylePick({ value, onPick }: { value: CoachStyle | null; onPick(value: CoachStyle): void }) {
  return (
    <div className="mx-auto grid w-full max-w-[32rem] grid-cols-3 gap-2 [perspective:1200px]" role="radiogroup">
      {STYLES.map((option, index) => {
        const selected = value === option.value;
        return (
          <motion.div animate={{ opacity: 1, y: 0, rotateX: 0 }} initial={{ opacity: 0, y: 40, rotateX: 28 }} key={option.value} transition={{ ...GLIDE, delay: AFTER_QUESTION + index * 0.08 }}>
            <Tilt
              aria-checked={selected}
              className={cn(SURFACE, "flex h-[9rem] w-full flex-col justify-between rounded-xl p-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-foreground/25")}
              onClick={() => onPick(option.value)}
              role="radio"
              whileTap={{ scale: 0.97 }}
            >
              {selected && <motion.span className={PICKED} layoutId="style-pick" transition={SPRING} />}
              <span className="relative flex items-start justify-between">
                <IconTile Icon={option.Icon} on={selected} />
                <Key on={selected}>{index + 1}</Key>
              </span>
              <span className="relative">
                <span className="block text-content font-medium text-foreground">{option.label}</span>
                <span className="mt-0.5 block text-ui text-muted-foreground">{option.hint}</span>
              </span>
            </Tilt>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ---- Model ----------------------------------------------------------------- */

export function ProviderList({ connected, offered, loaded, runnable, onConnect }: { connected: Provider[]; offered: Provider[]; loaded: boolean; runnable: boolean; onConnect(provider: Provider): void }) {
  const rows = [...connected.map((provider) => ({ provider, on: true })), ...offered.map((provider) => ({ provider, on: false }))];
  return (
    <div className="mx-auto w-full max-w-[23rem]">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.p
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className={cn("mx-auto mb-4 flex w-fit items-center gap-2 rounded-full px-3 py-1 text-ui", runnable ? "bg-[color-mix(in_oklab,var(--success)_14%,transparent)] text-[var(--success)]" : "text-muted-foreground")}
          exit={{ opacity: 0, y: -8, scale: 0.9 }}
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          key={runnable ? "ready" : "ask"}
          transition={POP}
        >
          {runnable
            ? <><IconCheckmark1 className="size-3.5" /> I have a model to run on</>
            : "Your own subscription or API key. Nothing goes through us."}
        </motion.p>
      </AnimatePresence>
      <div className="flex flex-col gap-1.5">
        {rows.map(({ provider, on }, index) => (
          <motion.button
            animate={{ opacity: 1, y: 0 }}
            className={cn(SURFACE, "group relative flex h-12 w-full items-center gap-3 rounded-xl px-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-foreground/25")}
            initial={{ opacity: 0, y: 22 }}
            key={provider.id}
            layout
            onClick={() => onConnect(provider)}
            transition={{ ...GLIDE, delay: AFTER_QUESTION + index * 0.05, layout: SPRING }}
            type="button"
            whileHover={{ scale: 1.012 }}
            whileTap={{ scale: 0.98 }}
          >
            {on && <motion.span className={cn(PICKED, "bg-[color-mix(in_oklab,var(--success)_7%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--success)_55%,transparent)]")} layoutId={`provider-on-${provider.id}`} />}
            <span className="relative grid size-8 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]">
              <ProviderGlyph className="size-4 text-foreground" provider={provider.id} />
            </span>
            <span className="relative min-w-0 flex-1 truncate text-content text-foreground">{provider.name}</span>
            {on ? (
              <motion.span animate={{ scale: 1 }} className="relative flex items-center gap-1.5 text-ui text-[var(--success)]" initial={{ scale: 0 }} transition={POP}>
                <span className="relative flex size-2">
                  <span className="absolute inset-0 animate-ping rounded-full bg-[var(--success)] opacity-50" />
                  <span className="relative size-2 rounded-full bg-[var(--success)]" />
                </span>
                Connected
              </motion.span>
            ) : (
              <span className="relative flex items-center gap-2.5">
                {index - connected.length < 9 && <Key>{index - connected.length + 1}</Key>}
                <IconArrowRight className="size-3.5 text-muted-foreground/60 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-foreground" />
              </span>
            )}
          </motion.button>
        ))}
        {!loaded && (
          <div className={cn(SURFACE, "flex h-14 items-center rounded-xl px-4")}>
            <SparDotsLine pattern="pulse" size={16}>Reading the provider inventory…</SparDotsLine>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- Problems -------------------------------------------------------------- */

export type SourceId = "leetcode" | "codeforces";
export type ConnectedSource = { id: SourceId; username: string; account: PracticeSourceAccount | null };

/** Where a Track's problems come from, in the same words the session setting
 *  uses later, so the choice made here is recognisably the one found there. */
export const SOURCES: Array<{ id: ProblemSource; name: string; short: string; detail: string }> = [
  { id: "spar", name: "Written by me", short: "Spar", detail: "Shaped to your gaps, checked before you see them" },
  { id: "leetcode", name: "LeetCode", short: "LeetCode", detail: "Real problems, matched to your target and rating" },
  { id: "codeforces", name: "Codeforces", short: "Codeforces", detail: "Rated contest problems, matched to your rating" },
];

/** Their record at the source, in the app's own difficulty tones. Same bands as
 *  the Settings panel draws, so the two readings are one picture. */
function solvedBands(account: PracticeSourceAccount): MeterBand[] {
  return [
    { key: "easy", value: account.solved.easy, className: "bg-success", label: "Easy" },
    { key: "medium", value: account.solved.medium, className: "bg-warning", label: "Medium" },
    { key: "hard", value: account.solved.hard, className: "bg-destructive", label: "Hard" },
  ];
}

/** Switches rather than a single choice: the three are not exclusive, and
 *  "only real problems" is a real answer. The last one on cannot be switched
 *  off — a Track with nowhere to take a problem from could never be set one.
 *  An account is a second, optional thing under a site: it is what lets me
 *  leave out what they have already solved. */
export function SourcePick({ value, onToggle, accounts, busy, onConnect, onDisconnect }: {
  value: ProblemSource[];
  onToggle(source: ProblemSource): void;
  accounts: ConnectedSource[];
  busy: { id: SourceId; action: "connect" | "disconnect" } | null;
  onConnect(id: SourceId): void;
  onDisconnect(id: SourceId): void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[26rem] flex-col gap-1.5">
      {SOURCES.map((source, index) => {
        const on = value.includes(source.id);
        const locked = on && value.length === 1;
        const external = source.id === "spar" ? null : source.id;
        const account = external ? accounts.find((entry) => entry.id === external) : undefined;
        const bands = account?.account ? solvedBands(account.account) : [];
        const connecting = busy?.id === external && busy?.action === "connect";
        return (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className={cn(SURFACE, "relative overflow-hidden rounded-xl")}
            initial={{ opacity: 0, y: 22 }}
            key={source.id}
            layout
            transition={{ ...GLIDE, delay: AFTER_QUESTION + index * 0.06, layout: SPRING }}
          >
            <AnimatePresence initial={false}>
              {on && <motion.span animate={{ opacity: 1 }} className="pointer-events-none absolute inset-0 bg-[color-mix(in_oklab,var(--foreground)_4.5%,transparent)]" exit={{ opacity: 0 }} initial={{ opacity: 0 }} transition={{ duration: 0.18 }} />}
            </AnimatePresence>
            <button
              aria-disabled={locked || undefined}
              aria-pressed={on}
              className={cn("relative flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none focus-visible:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)]", locked ? "cursor-default!" : !on && "hover:bg-[color-mix(in_oklab,var(--foreground)_3%,transparent)]")}
              data-choice=""
              onClick={() => { if (!locked) onToggle(source.id); }}
              title={locked ? "One source has to stay on" : undefined}
              type="button"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] text-foreground">
                {external ? <SourceGlyph className="size-[1.05rem]" source={external} /> : <SparDots pattern="still" size={15} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-content text-foreground">{source.name}</span>
                <span className="block truncate text-ui text-muted-foreground">{source.detail}</span>
              </span>
              <span className="grid w-[1.125rem] shrink-0 place-items-center">
                <AnimatePresence initial={false} mode="popLayout">
                  {on
                    ? <DrawnCheck className="text-foreground" key="on" />
                    : <motion.span animate={{ opacity: 1 }} exit={{ opacity: 0 }} initial={{ opacity: 0 }} key="key"><Key>{index + 1}</Key></motion.span>}
                </AnimatePresence>
              </span>
            </button>
            <AnimatePresence initial={false}>
              {external && on && (
                <motion.div animate={{ height: "auto", opacity: 1 }} className="relative" exit={{ height: 0, opacity: 0 }} initial={{ height: 0, opacity: 0 }} transition={SPRING}>
                  <div className="ml-[3.625rem] mr-3.5 border-t border-border pb-3 pt-2.5">
                    {account ? (
                      account.account ? (
                        <>
                          {/* The mix, not the fraction of the catalogue: 412 of
                              3,600 draws a sliver nobody can read. */}
                          <Meter animate bands={bands} height="0.3125rem" />
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                            {bands.filter((band) => band.value > 0).map((band) => <MeterKey band={band} key={band.key} />)}
                            <span className="ml-auto shrink-0 text-ui tabular-nums text-muted-foreground">
                              <span className="text-foreground/80">{account.account.solved.total.toLocaleString()}</span> solved
                            </span>
                          </div>
                          <div className="mt-1.5 flex items-center justify-between gap-3 text-ui text-muted-foreground">
                            <span className="truncate">{account.username}</span>
                            <button className="shrink-0 transition-colors hover:text-destructive disabled:opacity-45" disabled={busy !== null} onClick={() => onDisconnect(account.id)} type="button">
                              {busy?.id === account.id && busy.action === "disconnect" ? "Disconnecting…" : "Disconnect"}
                            </button>
                          </div>
                        </>
                      ) : (
                        <SparDotsLine pattern="pulse" size={14}>Reading your record…</SparDotsLine>
                      )
                    ) : (
                      <button
                        className="group/connect flex w-full items-center gap-2 text-left text-ui text-muted-foreground transition-colors hover:text-foreground disabled:opacity-45"
                        disabled={busy !== null}
                        onClick={() => onConnect(external)}
                        type="button"
                      >
                        {connecting ? <SparDots pattern="wave" size={14} /> : <IconChainLink1 className="size-3.5" />}
                        <span className="flex-1">{connecting ? "Finish signing in in the other window" : "Connect your account"}</span>
                        {!connecting && <span className="text-ui-sm text-muted-foreground/60 transition-colors group-hover/connect:text-muted-foreground">So I skip what you've solved</span>}
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ---- Look ------------------------------------------------------------------ */

export const LOOKS: Array<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match system" },
];

/** The app's own two backgrounds, drawn small: a sidebar, a heading, a few lines. */
const THUMB = {
  light: { window: "#ffffff", side: "#f2f2f2", line: "#e2e2e2", strong: "#a3a3a3", mark: "#1b1b1b" },
  dark: { window: "#222222", side: "#1a1a1a", line: "#383838", strong: "#737373", mark: "#f5f5f5" },
} as const;

function ThemeThumb({ tone, style }: { tone: keyof typeof THUMB; style?: React.CSSProperties }) {
  const colors = THUMB[tone];
  return (
    <div className="absolute inset-0 flex" style={{ background: colors.window, ...style }}>
      <div className="flex w-[28%] flex-col gap-1 p-1.5" style={{ background: colors.side }}>
        <span className="mb-0.5 grid size-2 grid-cols-2 gap-px">
          {[0, 1, 2, 3].map((dot) => <span className="rounded-full" key={dot} style={{ background: colors.mark, opacity: dot === 0 || dot === 3 ? 1 : 0.45 }} />)}
        </span>
        {[70, 90, 55].map((width) => <span className="h-[3px] rounded-full" key={width} style={{ width: `${width}%`, background: colors.line }} />)}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2">
        <span className="h-1 w-1/2 rounded-full" style={{ background: colors.strong }} />
        {[92, 80, 86, 60].map((width) => <span className="h-[3px] rounded-full" key={width} style={{ width: `${width}%`, background: colors.line }} />)}
      </div>
    </div>
  );
}

/** The pick applies the moment it is made — the window itself is the preview —
 *  so the caller is handed the card, to reveal the new look from where it was chosen. */
export function LookPick({ value, onPick }: { value: ThemePreference; onPick(value: ThemePreference, from: HTMLElement): void }) {
  return (
    <div aria-label="Appearance" className="mx-auto grid w-full max-w-[32rem] grid-cols-3 gap-2 [perspective:1200px]" role="radiogroup">
      {LOOKS.map((option, index) => {
        const selected = value === option.value;
        return (
          <motion.div animate={{ opacity: 1, y: 0, rotateX: 0 }} initial={{ opacity: 0, y: 40, rotateX: 28 }} key={option.value} transition={{ ...GLIDE, delay: AFTER_QUESTION + index * 0.08 }}>
            <Tilt
              aria-checked={selected}
              className={cn(SURFACE, "flex w-full flex-col gap-3 rounded-xl p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-foreground/25")}
              onClick={(event) => onPick(option.value, event.currentTarget)}
              role="radio"
              whileTap={{ scale: 0.97 }}
            >
              {selected && <motion.span className={PICKED} layoutId="look-pick" transition={SPRING} />}
              <span className="relative block h-[4.75rem] overflow-hidden rounded-lg shadow-[0_0_0_0.5px_var(--border-strong),0_6px_16px_-10px_color-mix(in_oklab,var(--foreground)_45%,transparent)]">
                {option.value === "system" ? (
                  <>
                    <ThemeThumb tone="light" />
                    <ThemeThumb style={{ clipPath: "polygon(62% 0, 100% 0, 100% 100%, 38% 100%)" }} tone="dark" />
                  </>
                ) : (
                  <ThemeThumb tone={option.value} />
                )}
              </span>
              <span className="relative flex items-center justify-between px-1 pb-0.5">
                <span className="text-content font-medium text-foreground">{option.label}</span>
                <Key on={selected}>{index + 1}</Key>
              </span>
            </Tilt>
          </motion.div>
        );
      })}
    </div>
  );
}
