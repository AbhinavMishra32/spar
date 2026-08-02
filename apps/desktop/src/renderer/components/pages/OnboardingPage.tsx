import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Loader2 } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import type { Language, LearnerProfile, SessionSuggestion } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { message } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useProviders } from "../../hooks/use-providers";
import { LanguageGlyph, LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { ProviderGlyph } from "../common/ProviderGlyph";
import { SparWordmark } from "../common/SparWordmark";
import { ProviderConnectDialog, type Provider } from "../settings/ProviderConnectDialog";

type StepId = "name" | "experience" | "focus" | "weakness" | "language" | "provider";

type Step = {
  id: StepId;
  header: string;
  question: string;
  /** Free-text steps open straight into the field; the rest list options. */
  kind: "text" | "one" | "many" | "provider";
  placeholder?: string;
  optional?: boolean;
};

const STEPS: Step[] = [
  { id: "name", header: "Identity", question: "What should Spar call you?", kind: "text", placeholder: "Your name" },
  { id: "experience", header: "Standing", question: "Where are you in your career?", kind: "one" },
  { id: "focus", header: "Direction", question: "What do you want to get better at?", kind: "many", optional: true },
  { id: "weakness", header: "Weak spot", question: "Where do you get stuck?", kind: "text", placeholder: "I can read async code but I never know what actually needs awaiting…", optional: true },
  { id: "language", header: "Language", question: "Which language should challenges use?", kind: "one" },
  /* Not optional, and last on purpose. Spar is the agent — an intake that ends
     with no model behind it produces an account that can answer nothing, and
     the learner finds that out at their first question instead of here. */
  { id: "provider", header: "Runtime", question: "Which model should the agent run on?", kind: "provider" },
];

const EXPERIENCE: Array<{ value: LearnerProfile["experience"]; label: string }> = [
  { value: "new", label: "Learning to program, or a year or so in" },
  { value: "working", label: "Shipping code most days" },
  { value: "senior", label: "Designing systems and reviewing others' work" },
];

/** Kinds of reasoning, not frameworks: Spar trains judgement, and a framework
 *  list would collect answers the agent has nothing to do with. */
const FOCUS = [
  "Async and concurrency",
  "Data structures",
  "Algorithms",
  "Types and interfaces",
  "Memory and ownership",
  "State management",
  "Debugging",
  "Testing",
  "Performance",
  "API design",
];

const LANGUAGES: Language[] = ["javascript", "typescript", "cpp"];

/** One answered question, as the record shows it back. Reads as the start of the
 *  evidence trace rather than as a completed form field — the same quiet
 *  label-then-value line the activity rows use inside a session. */
function Settled({ label, value, onEdit }: { label: string; value: string; onEdit?: (() => void) | undefined }) {
  return (
    <motion.button
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors",
        onEdit ? "hover:bg-accent/40" : "cursor-default",
      )}
      disabled={!onEdit}
      initial={{ opacity: 0, y: -4 }}
      onClick={onEdit}
      transition={{ duration: 0.2 }}
      type="button"
    >
      <Check className="size-3 shrink-0 text-muted-foreground/60" />
      <span className="w-[5.5rem] shrink-0 text-ui text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-ui text-foreground/90">{value}</span>
    </motion.button>
  );
}

/** A numbered option row. The number is not decoration — it is the key that
 *  picks it, the way the agent's own questions are answered mid-session. */
function OptionRow({
  index,
  selected,
  children,
  onClick,
  trailing,
}: {
  index: number;
  selected: boolean;
  children: React.ReactNode;
  onClick(): void;
  trailing?: React.ReactNode;
}) {
  return (
    <Button
      aria-pressed={selected}
      className={cn("h-auto min-h-8 w-full justify-start gap-2.5 px-3 py-2 text-left ring-0", selected && "bg-accent text-accent-foreground")}
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      <span className="w-4 shrink-0 text-sm leading-none font-medium tabular-nums text-muted-foreground">{index}.</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
      {selected && <Check data-icon="inline-end" />}
    </Button>
  );
}

/** The intake ends, and Spar reads it back before it offers anything. The lines
 *  are what it is actually doing, in order, and each one holds long enough to be
 *  read — a progress theatre that outlasts the work would be a lie about it. */
const READING = ["Reading your intake…", "Weighing where you get stuck…", "Shaping sparring sessions…"];

function Reading() {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setLine((value) => Math.min(READING.length - 1, value + 1)), 2_200);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-6">
      <ThinkingOrb aria-label="Working" size={20} state="shaping" style={{ width: 16, height: 16 }} />
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          animate={{ opacity: 1, y: 0 }}
          className="thinking-shimmer text-content"
          exit={{ opacity: 0, y: -4 }}
          initial={{ opacity: 0, y: 4 }}
          key={line}
          transition={{ duration: 0.28 }}
        >
          {READING[line]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

export function OnboardingPage({
  api,
  displayName,
  onDone,
  onStartSession,
}: {
  api: SparApi | undefined;
  displayName: string;
  onDone(profile: LearnerProfile): Promise<void>;
  onStartSession(goal: string): Promise<void>;
}) {
  const [index, setIndex] = useState(0);
  const [name, setName] = useState(displayName);
  const [experience, setExperience] = useState<LearnerProfile["experience"] | null>(null);
  const [focus, setFocus] = useState<string[]>([]);
  const [weakness, setWeakness] = useState("");
  const [language, setLanguage] = useState<Language | null>(null);
  const { inventory, reload } = useProviders();
  const [connecting, setConnecting] = useState<Provider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  /* "intake" is the questions; "reading" is Spar working; "sparring" is the offer.
     The profile is already saved by the time we leave intake — the suggestions are
     drafted from it, so nothing here can strand a learner without a profile. */
  const [phase, setPhase] = useState<"intake" | "reading" | "sparring">("intake");
  const [suggestions, setSuggestions] = useState<{ source: "agent" | "starter"; suggestions: SessionSuggestion[] } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [saved, setSaved] = useState<LearnerProfile | null>(null);

  const step = STEPS[index]!;
  const providers = inventory?.providers ?? [];
  const connected = providers.filter((provider) => provider.state !== "disconnected");
  const offered = providers.filter((provider) => provider.state === "disconnected").slice(0, 6);
  /* The main process decides this, not the row states: a connected provider
     whose sign-in has since expired cannot run a turn either. */
  const runnable = inventory?.ready === true;

  useEffect(() => { if (step.kind === "text") field.current?.focus(); }, [step.id, step.kind]);

  const answered = (id: StepId): string | null => {
    if (id === "name") return name.trim() || null;
    if (id === "experience") return EXPERIENCE.find((item) => item.value === experience)?.label ?? null;
    if (id === "focus") return focus.length ? focus.join(", ") : null;
    if (id === "weakness") return weakness.trim() || null;
    if (id === "language") return language ? LANGUAGE_LABEL[language] : null;
    if (!runnable) return null;
    return connected.length ? connected.map((provider) => provider.name).join(", ") : "Ready";
  };

  const canAdvance = step.optional || answered(step.id) !== null;
  const last = index === STEPS.length - 1;

  /* Saving the profile and drafting the sessions are one move from the learner's
     side, but only the save may fail loudly: a provider that cannot draft still
     leaves them with a finished intake, and the starter set covers the rest. */
  const finish = async () => {
    if (!api || !experience || !language || !runnable) return;
    setBusy(true);
    setError("");
    try {
      setSaved(await api.saveProfile({ name: name.trim(), experience, focus, weakness: weakness.trim(), language }));
    } catch (cause) {
      setError(message(cause));
      setBusy(false);
      return;
    }
    setPhase("reading");
    const drafted = await api.suggestSessions().catch(() => null);
    setSuggestions(drafted ?? { source: "starter", suggestions: [] });
    setBusy(false);
    setPhase("sparring");
  };

  /** Leaving onboarding, with or without a session to open. The profile is saved
   *  either way, so `onDone` is what actually retires this page. */
  const leave = async (goal?: string) => {
    if (!api || !saved) return;
    setBusy(true);
    setError("");
    try {
      await onDone(saved);
      if (goal) await onStartSession(goal);
    } catch (cause) {
      setError(message(cause));
      setBusy(false);
    }
  };

  const proceed = () => {
    if (!canAdvance || busy) return;
    if (last) return void finish();
    setIndex((value) => Math.min(STEPS.length - 1, value + 1));
  };

  // The options are numbered on screen, so the number keys have to work. Typing
  // into the free-text steps must not be read as a choice, hence the kind guard.
  const options = step.kind === "one" && step.id === "experience" ? EXPERIENCE.length
    : step.kind === "one" ? LANGUAGES.length
    : step.kind === "many" ? FOCUS.length
    : step.kind === "provider" ? offered.length
    : 0;

  useEffect(() => {
    if (!options) return;
    const listener = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const choice = Number(event.key);
      if (!Number.isInteger(choice) || choice < 1 || choice > options) return;
      event.preventDefault();
      const position = choice - 1;
      if (step.id === "experience") setExperience(EXPERIENCE[position]!.value);
      if (step.id === "language") setLanguage(LANGUAGES[position]!);
      if (step.id === "focus") {
        const item = FOCUS[position]!;
        setFocus((current) => (current.includes(item) ? current.filter((value) => value !== item) : [...current, item]));
      }
      if (step.id === "provider") setConnecting(offered[position] ?? null);
    };
    addEventListener("keydown", listener);
    return () => removeEventListener("keydown", listener);
  }, [offered, options, step.id]);

  const drafted = suggestions?.suggestions ?? [];

  // Same contract on the sparring screen: the rows are numbered, so the numbers pick them.
  useEffect(() => {
    if (phase !== "sparring" || !drafted.length) return;
    const listener = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const choice = Number(event.key);
      if (!Number.isInteger(choice) || choice < 1 || choice > drafted.length) return;
      event.preventDefault();
      setPicked(choice - 1);
    };
    addEventListener("keydown", listener);
    return () => removeEventListener("keydown", listener);
  }, [drafted.length, phase]);

  return (
    <div className="app-drag app-pane grid h-full place-items-center overflow-y-auto px-6 py-10">
      <div className="app-no-drag w-full max-w-[34rem]">
        <div className="flex items-baseline gap-2 px-1.5 pb-3">
          <SparWordmark className="text-[1rem] text-foreground/90" />
          <span className="text-ui text-muted-foreground/70">{phase === "intake" ? "intake" : "sparring"}</span>
        </div>

        {/* The answers stay on screen as they settle. Nothing about this app is a
            form you fill and submit; it is a record that accumulates, and the
            intake is simply its first few lines. */}
        <div className="mb-2.5">
          {STEPS.slice(0, phase === "intake" ? index : STEPS.length).map((earlier, position) => {
            const value = answered(earlier.id);
            return (
              <Settled
                key={earlier.id}
                label={earlier.header}
                onEdit={phase === "intake" ? () => setIndex(position) : undefined}
                value={value ?? "Skipped"}
              />
            );
          })}
        </div>

        <AnimatePresence initial={false} mode="wait">
          {phase !== "intake" ? (
            <motion.div
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              className="overflow-hidden rounded-xl bg-card shadow-[var(--app-shadow-overlay)] ring-[0.5px] ring-[var(--border-strong)]"
              initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
              key="sparring"
              transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            >
              <div className="flex items-center justify-between gap-2 px-3.5 pt-2.5">
                <p className="text-ui-sm font-medium text-muted-foreground">Today's focus</p>
                {suggestions?.source === "starter" && drafted.length > 0 && (
                  <span className="text-ui-sm text-muted-foreground/70">Starting points</span>
                )}
              </div>
              <h1 className="px-3.5 pb-2.5 pt-1.5 text-base font-medium leading-snug">
                {phase === "reading" ? `One moment, ${name.trim().split(" ")[0] || "there"}.` : drafted.length ? "Where do you want to start sparring?" : "Start a session in your own words."}
              </h1>

              {phase === "reading" ? (
                <Reading />
              ) : (
                <div className="px-2.5 pb-1.5">
                  {/* Staggered, not dealt out one at a time: they were drafted together
                      and arriving together is the honest reading of that. */}
                  {drafted.map((suggestion, position) => (
                    <motion.div
                      animate={{ opacity: 1, y: 0 }}
                      initial={{ opacity: 0, y: 6 }}
                      key={suggestion.title}
                      transition={{ delay: 0.06 * position, duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
                    >
                      <Button
                        aria-pressed={picked === position}
                        className={cn("h-auto w-full items-start justify-start gap-2.5 px-3 py-2.5 text-left ring-0", picked === position && "bg-accent text-accent-foreground")}
                        onClick={() => setPicked(position)}
                        type="button"
                        variant="ghost"
                      >
                        <span className="w-4 shrink-0 pt-px text-sm leading-none font-medium tabular-nums text-muted-foreground">{position + 1}.</span>
                        <span className="min-w-0 flex-1 whitespace-normal">
                          <span className="block truncate text-content font-medium">{suggestion.title}</span>
                          <span className="mt-0.5 block text-ui leading-[1.5] text-muted-foreground">{suggestion.why}</span>
                        </span>
                        {language && <LanguageGlyph className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" language={language} />}
                        {picked === position && <Check className="mt-0.5 size-3.5 shrink-0" />}
                      </Button>
                    </motion.div>
                  ))}
                  {!drafted.length && (
                    <p className="px-3 py-2 text-ui leading-[1.6] text-muted-foreground">
                      Spar could not reach a provider to draft sessions. Open Spar and describe what you want to get better at — the agent reads your intake either way.
                    </p>
                  )}
                </div>
              )}

              {error && <p className="px-3.5 pb-1 text-ui text-destructive">{error}</p>}

              <div className="flex items-center gap-2 p-3 pt-1.5">
                <span className="min-w-0 flex-1 truncate px-0.5 text-ui text-muted-foreground/65">
                  {phase === "sparring" && drafted.length ? `Press 1–${drafted.length} to choose` : null}
                </span>
                {phase === "sparring" && (
                  <>
                    <Button disabled={busy} onClick={() => void leave()} type="button" variant="outline">
                      {drafted.length ? "I'll write my own" : "Open Spar"}
                    </Button>
                    {drafted.length > 0 && (
                      <Button disabled={busy || picked === null} onClick={() => void leave(drafted[picked ?? 0]?.goal)} type="button">
                        {busy && <Loader2 data-icon="inline-start" className="animate-spin" />}
                        Start a session
                      </Button>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          ) : (
          <motion.div
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            className="overflow-hidden rounded-xl bg-card shadow-[var(--app-shadow-overlay)] ring-[0.5px] ring-[var(--border-strong)]"
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
            initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
            key={step.id}
            transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
          >
            <div className="flex items-center justify-between gap-2 px-3.5 pt-2.5">
              <p className="text-ui-sm font-medium text-muted-foreground">{step.header}</p>
              <span className="text-ui-sm font-medium tabular-nums text-muted-foreground">{index + 1}/{STEPS.length}</span>
            </div>
            <h1 className="px-3.5 pb-2.5 pt-1.5 text-base font-medium leading-snug">{step.question}</h1>

            <div className="px-2.5 pb-1.5">
              {step.kind === "text" && (
                <div className="rounded-md bg-secondary px-3 py-2">
                  <Textarea
                    ref={field}
                    className="field-sizing-content min-h-5 resize-none rounded-none border-0 bg-transparent p-0 text-sm leading-5 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
                    maxLength={step.id === "name" ? 60 : 600}
                    onChange={(event) => (step.id === "name" ? setName(event.target.value) : setWeakness(event.target.value))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        proceed();
                      }
                    }}
                    placeholder={step.placeholder}
                    value={step.id === "name" ? name : weakness}
                  />
                </div>
              )}

              {step.id === "experience" && EXPERIENCE.map((option, position) => (
                <OptionRow
                  index={position + 1}
                  key={option.value}
                  onClick={() => setExperience(option.value)}
                  selected={experience === option.value}
                >
                  {option.label}
                </OptionRow>
              ))}

              {step.id === "focus" && FOCUS.map((option, position) => (
                <OptionRow
                  index={position + 1}
                  key={option}
                  onClick={() => setFocus((current) => (current.includes(option) ? current.filter((value) => value !== option) : [...current, option]))}
                  selected={focus.includes(option)}
                >
                  {option}
                </OptionRow>
              ))}

              {step.id === "language" && LANGUAGES.map((option, position) => (
                <OptionRow
                  index={position + 1}
                  key={option}
                  onClick={() => setLanguage(option)}
                  selected={language === option}
                  trailing={<LanguageGlyph className="size-3.5 shrink-0 text-muted-foreground" language={option} />}
                >
                  {LANGUAGE_LABEL[option]}
                </OptionRow>
              ))}

              {step.id === "provider" && (
                <>
                  {/* Said before the list, not after a failed Begin: connecting
                      one of these is the step, and the sentence is what makes
                      the disabled button read as a requirement rather than a bug. */}
                  {!runnable && (
                    <p className="px-3 pb-1.5 pt-0.5 text-ui leading-[1.6] text-muted-foreground">
                      Spar runs the agent on your own subscription or API key — nothing is proxied through us. Connect one
                      to finish; you can add or change providers later in Settings.
                    </p>
                  )}
                  {connected.map((provider) => (
                    <OptionRow
                      index={0}
                      key={provider.id}
                      onClick={() => setConnecting(provider)}
                      selected
                      trailing={<ProviderGlyph className="size-3.5 shrink-0 text-muted-foreground" provider={provider.id} />}
                    >
                      {provider.name}
                    </OptionRow>
                  ))}
                  {offered.map((provider, position) => (
                    <OptionRow
                      index={position + 1}
                      key={provider.id}
                      onClick={() => setConnecting(provider)}
                      selected={false}
                      trailing={<ProviderGlyph className="size-3.5 shrink-0 text-muted-foreground" provider={provider.id} />}
                    >
                      {provider.name}
                    </OptionRow>
                  ))}
                  {!inventory && (
                    <p className="flex items-center gap-2 px-3 py-2 text-ui text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />Reading the provider inventory…
                    </p>
                  )}
                </>
              )}
            </div>

            {error && <p className="px-3.5 pb-1 text-ui text-destructive">{error}</p>}

            <div className="flex items-center gap-2 p-3 pt-1.5">
              <span className="min-w-0 flex-1 truncate px-0.5 text-ui text-muted-foreground/65">
                {step.id === "provider" && !runnable
                  ? inventory ? "Connect a provider to continue" : null
                  : step.kind === "text"
                    ? "Return to continue"
                    : options
                      ? `Press 1–${options} to choose${step.kind === "many" ? ", or several" : ""}`
                      : null}
              </span>
              {index > 0 && <Button disabled={busy} onClick={() => setIndex((value) => value - 1)} type="button" variant="outline">Back</Button>}
              <Button disabled={busy || !canAdvance} onClick={proceed} type="button">
                {busy && <Loader2 data-icon="inline-start" className="animate-spin" />}
                {last ? (busy ? "Reading…" : "Begin") : step.optional && !answered(step.id) ? "Skip" : "Next"}
              </Button>
            </div>
          </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ProviderConnectDialog
        api={api}
        onClose={() => setConnecting(null)}
        onConnected={() => void reload().catch(() => undefined)}
        provider={connecting}
      />
    </div>
  );
}
