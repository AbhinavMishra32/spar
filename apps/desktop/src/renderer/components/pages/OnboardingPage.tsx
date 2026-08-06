import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import type { Language, LearnerProfile, SessionSuggestion } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { message } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useProviders } from "../../hooks/use-providers";
import { LanguageGlyph, LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { ProviderGlyph } from "../common/ProviderGlyph";
import { LeetCodeGlyph } from "../common/SourceGlyph";
import { SparDots } from "../common/SparDots";
import { PANEL, STEP, TEXT, useMarkPass } from "../auth/arrival";
import { SparWordmark } from "../common/SparWordmark";
import { ProviderConnectDialog, type Provider } from "../settings/ProviderConnectDialog";

type StepId = "name" | "experience" | "focus" | "weakness" | "language" | "provider" | "source";

type Step = {
  id: StepId;
  /** What the answer is called when it is read back. */
  header: string;
  question: string;
  /** One line under the question, where a question needs a reason. */
  caption?: string;
  /** Free-text steps open straight into the field; the rest list options. */
  kind: "text" | "one" | "many" | "provider" | "source";
  placeholder?: string;
  optional?: boolean;
};

/* The labels are the subject of the question, not a category the answer was
   filed under: "Name", read back beside `abhinav`, says what it is. The one-word
   abstractions this replaced — Identity, Standing, Direction, Runtime — read as a
   form's internal field names leaking onto the screen.

   The questions themselves are asked the way a person would ask them. Spar is
   about to spend an hour on someone's weakest work; opening with career-ladder
   vocabulary sets the wrong tone for that. */
const STEPS: Step[] = [
  { id: "name", header: "Name", question: "What should we call you?", caption: "It is how Spar addresses you, nothing more.", kind: "text", placeholder: "Your name" },
  { id: "experience", header: "Experience", question: "How long have you been writing code?", kind: "one" },
  { id: "focus", header: "Focus", question: "What would you like to get sharper at?", caption: "Pick as many as you like, or none — Spar works it out from your attempts either way.", kind: "many", optional: true },
  { id: "weakness", header: "Sticking point", question: "Where do you usually get stuck?", caption: "In your own words. This is the single most useful thing you can tell Spar.", kind: "text", placeholder: "I can read async code, but I never know what actually needs awaiting…", optional: true },
  { id: "language", header: "Language", question: "Which language should challenges be in?", caption: "You can change this per session later.", kind: "one" },
  /* Not optional, and last on purpose. Spar is the agent — an intake that ends
     with no model behind it produces an account that can answer nothing, and
     the learner finds that out at their first question instead of here. */
  { id: "provider", header: "Model", question: "Which model should Spar run on?", kind: "provider" },
  /* Optional, and after the model, because it changes what Spar can offer rather
     than whether it works at all. Asked here rather than left to Settings for one
     reason: someone who already grinds LeetCode should find their history waiting
     for them on the first session, not discover three weeks later that Spar could
     have been using it. Skipping is a real answer and costs nothing — every
     challenge is then one Spar writes. */
  { id: "source", header: "LeetCode", question: "Practise real LeetCode problems too?", caption: "Optional. Connect it and Spar can set you real problems, judged by LeetCode, alongside the ones it writes for you.", kind: "source", optional: true },
];

const EXPERIENCE: Array<{ value: LearnerProfile["experience"]; label: string; hint: string }> = [
  { value: "new", label: "Getting started", hint: "Learning to program, or a year or so in" },
  { value: "working", label: "Shipping regularly", hint: "Writing code most days" },
  { value: "senior", label: "Designing and reviewing", hint: "Shaping systems and other people's work" },
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

/** The sunken group the sign-in window puts its fields in, reused for a list of
 *  choices: one container, hairlines between the rows, and the selection filling
 *  a row rather than outlining it. The intake is the same arrival as sign-in, so
 *  it is built out of the same two shapes rather than out of cards. */
const GROUP = "overflow-hidden rounded-xl bg-[var(--color-background-elevated-secondary)] shadow-[inset_0_0_0_0.5px_var(--border-strong)]";

/** One choice. The number is not decoration — it is the key that picks it, the
 *  way the agent's own questions are answered mid-session. */
function OptionRow({
  index,
  selected,
  children,
  hint,
  onClick,
  trailing,
}: {
  index: number;
  selected: boolean;
  children: React.ReactNode;
  /** The line under the label, where the choice needs explaining. */
  hint?: string;
  onClick(): void;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors not-first:border-t not-first:border-border",
        selected ? "bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)]" : "hover:bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)]",
      )}
      onClick={onClick}
      type="button"
    >
      {index > 0 && (
        <span className={cn("w-3 shrink-0 text-ui tabular-nums transition-colors", selected ? "text-foreground/70" : "text-muted-foreground/55")}>{index}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-content text-foreground">{children}</span>
        {hint && <span className="mt-0.5 block truncate text-ui text-muted-foreground">{hint}</span>}
      </span>
      {trailing}
      <Check className={cn("size-3.5 shrink-0 transition-opacity", selected ? "opacity-70" : "opacity-0")} />
    </button>
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
    /* Centred in the same box the drafted sessions will fill, so the wait and the
       answer are one object changing rather than two things in different places.
       The mark is the app's own, not a generic orb: this is Spar reading. */
    <div className="flex items-center justify-center gap-2.5 px-4 py-5">
      <SparDots pattern="wave" size={18} />
      <motion.span animate={{ opacity: 1 }} className="thinking-shimmer text-content" initial={{ opacity: 0 }} key={line} transition={{ duration: 0.28 }}>
        {READING[line]}
      </motion.span>
    </div>
  );
}

/** Where the intake has got to. Six ticks rather than "3/6": the count is the
 *  same information, and a row of ticks says it without asking anyone to read a
 *  fraction while they are thinking about the question above it. */
function Progress({ index, total }: { index: number; total: number }) {
  return (
    <div aria-hidden className="flex items-center justify-center gap-1.5">
      {Array.from({ length: total }, (_, position) => (
        <motion.span
          animate={{ width: position === index ? 18 : 6 }}
          className={cn(
            "h-1 rounded-full transition-colors duration-300",
            position < index ? "bg-[color-mix(in_oklab,var(--foreground)_40%,transparent)]" : position === index ? "bg-foreground" : "bg-[color-mix(in_oklab,var(--foreground)_12%,transparent)]",
          )}
          key={position}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
        />
      ))}
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

  const { pass, awake, rouse } = useMarkPass(busy);
  const step = STEPS[index]!;
  const providers = inventory?.providers ?? [];
  const connected = providers.filter((provider) => provider.state !== "disconnected");
  const offered = providers.filter((provider) => provider.state === "disconnected").slice(0, 6);
  /* The main process decides this, not the row states: a connected provider
     whose sign-in has since expired cannot run a turn either. */
  const runnable = inventory?.ready === true;

  useEffect(() => { if (step.kind === "text") field.current?.focus(); }, [step.id, step.kind]);

  /* The practice source, asked for once during intake and otherwise left alone.
     Held here rather than read from an inventory hook because there is exactly
     one question being answered — is it connected, and as whom — and the sign-in
     window is the only thing that can change it. */
  const [sourceAccount, setSourceAccount] = useState<string | null>(null);
  const [connectingSource, setConnectingSource] = useState(false);
  const [sourceError, setSourceError] = useState("");
  useEffect(() => {
    if (!api) return;
    void api.practiceSource().then((source) => setSourceAccount(source.state === "connected" ? source.account?.username ?? source.name : null)).catch(() => undefined);
  }, [api]);
  const connectSource = async () => {
    if (!api || connectingSource) return;
    setConnectingSource(true);
    setSourceError("");
    try {
      const result = await api.connectPracticeSource();
      if (result.status === "connected") setSourceAccount(result.username);
      /* Cancelling is a decision, not an error: the step is optional and the
         learner closing the window has answered it. */
      else if (result.status === "failed") setSourceError(result.message);
    } catch (cause) {
      setSourceError(message(cause));
    } finally {
      setConnectingSource(false);
    }
  };

  const answered = (id: StepId): string | null => {
    if (id === "name") return name.trim() || null;
    if (id === "experience") return EXPERIENCE.find((item) => item.value === experience)?.label ?? null;
    if (id === "focus") return focus.length ? focus.join(", ") : null;
    if (id === "weakness") return weakness.trim() || null;
    if (id === "language") return language ? LANGUAGE_LABEL[language] : null;
    if (id === "source") return sourceAccount;
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
    rouse();
    if (last) return void finish();
    setIndex((value) => Math.min(STEPS.length - 1, value + 1));
  };

  // The options are numbered on screen, so the number keys have to work. Typing
  // into the free-text steps must not be read as a choice, hence the kind guard.
  const options = step.kind === "one" && step.id === "experience" ? EXPERIENCE.length
    : step.kind === "one" ? LANGUAGES.length
    : step.kind === "many" ? FOCUS.length
    : step.kind === "source" ? 0
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

  /** The one action, and the quiet ways around it — the same two rows the
   *  sign-in window ends on. */
  const footer = (
    <>
      <Button className="mt-3 h-11 w-full text-[0.8125rem]" disabled={busy || !canAdvance} onClick={proceed} size="lg" type="button">
        <motion.span animate={{ opacity: 1 }} className="inline-flex items-center gap-1.5" initial={{ opacity: 0 }} key={last ? "begin" : "next"} transition={TEXT}>
          {last ? (busy ? "Reading your intake…" : "Begin") : step.optional && !answered(step.id) ? "Skip for now" : "Continue"}
          {!busy && <ArrowRight data-icon="inline-end" />}
        </motion.span>
      </Button>
      <p aria-live="polite" className={cn("mt-2.5 min-h-4 text-center text-ui", error ? "text-destructive" : "text-muted-foreground/70")} role="status">
        {error ??
          (step.id === "provider" && !runnable
            ? inventory ? "Connect a provider to continue" : ""
            : step.kind === "text"
              ? "Return to continue"
              : options
                ? `Press 1–${options} to choose${step.kind === "many" ? ", or several" : ""}`
                : "")}
      </p>
      {index > 0 && (
        <div className="mt-1 flex justify-center text-ui">
          <button className="rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-45" disabled={busy} onClick={() => setIndex((value) => value - 1)} type="button">
            Back to {STEPS[index - 1]!.header.toLowerCase()}
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className="app-drag app-pane relative grid h-full place-items-center overflow-y-auto px-6 py-10">
      {/* The same grid the sign-in window stands in. The intake is the second
          room of one arrival, not a different building — which is also why there
          is no card here: the question sits on the pane exactly as the sign-in
          fields do. */}
      <div aria-hidden className="auth-field text-foreground" />

      <motion.div className="app-no-drag relative w-full max-w-[23rem]" layout transition={PANEL}>
        <motion.div className="flex flex-col items-center gap-3.5" layout="position" transition={PANEL}>
          <div className="flex items-center justify-center gap-2.5">
            <SparDots key={pass} pattern={awake ? "pass" : "still"} size={26} />
            <SparWordmark className="text-[1.75rem] leading-none text-foreground" />
          </div>
          {phase === "intake" && <Progress index={index} total={STEPS.length} />}
        </motion.div>

        {/* One step replaces another, with no exit to wait on — see the note in
            AuthPage: an interrupted exit leaves a half-gone form on screen. */}
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          initial={{ opacity: 0, y: 6 }}
          key={phase === "intake" ? step.id : phase}
          transition={STEP}
        >
            <div className="mt-6 text-center">
              <h1 className="text-[1.0625rem] font-medium leading-snug tracking-[-0.01em] text-foreground">
                {phase === "intake"
                  ? step.question
                  : phase === "reading"
                    ? `One moment, ${name.trim().split(" ")[0] || "there"}.`
                    : drafted.length
                      ? "Where would you like to start?"
                      : "Start a session in your own words."}
              </h1>
              <p className="mx-auto mt-1.5 max-w-[19rem] text-ui leading-[1.6] text-muted-foreground">
                {phase === "intake"
                  ? step.caption ?? ""
                  : phase === "reading"
                    ? "Spar is reading what you told it and drafting a few places to begin."
                    : drafted.length
                      ? suggestions?.source === "starter"
                        ? "Starting points, until Spar has watched you work."
                        : "Drafted from your intake. Pick one, or write your own once you are inside."
                      : "Spar could not reach a provider to draft sessions — describe what you want to get better at once you are inside."}
              </p>
            </div>

            <div className="mt-4">
              {phase === "reading" && (
                <div className={GROUP}>
                  <Reading />
                </div>
              )}

              {phase === "sparring" && drafted.length > 0 && (
                <div className={GROUP}>
                  {/* Staggered, not dealt out one at a time: they were drafted
                      together and arriving together is the honest reading of that. */}
                  {drafted.map((suggestion, position) => (
                    <motion.div animate={{ opacity: 1 }} initial={{ opacity: 0 }} key={suggestion.title} transition={{ delay: 0.06 * position, duration: 0.3 }}>
                      <OptionRow
                        hint={suggestion.why}
                        index={position + 1}
                        onClick={() => setPicked(position)}
                        selected={picked === position}
                        trailing={language ? <LanguageGlyph className="size-3.5 shrink-0 text-muted-foreground" language={language} /> : undefined}
                      >
                        {suggestion.title}
                      </OptionRow>
                    </motion.div>
                  ))}
                </div>
              )}

              {phase === "intake" && step.kind === "text" && (
                <div className={cn(GROUP, "px-3.5 py-3 transition-shadow focus-within:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_26%,transparent)]")}>
                  <Textarea
                    ref={field}
                    className="field-sizing-content min-h-6 resize-none rounded-none border-0 bg-transparent p-0 text-content leading-6 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
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

              {phase === "intake" && step.id === "experience" && (
                <div className={GROUP}>
                  {EXPERIENCE.map((option, position) => (
                    <OptionRow hint={option.hint} index={position + 1} key={option.value} onClick={() => setExperience(option.value)} selected={experience === option.value}>
                      {option.label}
                    </OptionRow>
                  ))}
                </div>
              )}

              {/* Ten of these, and none of them needs a row of its own: as chips
                  they read as a palette to pick from rather than as a checklist
                  somebody has to work down. */}
              {phase === "intake" && step.id === "focus" && (
                <div className="flex flex-wrap justify-center gap-1.5">
                  {FOCUS.map((option) => {
                    const on = focus.includes(option);
                    return (
                      <button
                        aria-pressed={on}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-ui transition-colors",
                          on
                            ? "bg-primary text-primary-foreground"
                            : "bg-[var(--color-background-elevated-secondary)] text-muted-foreground shadow-[inset_0_0_0_0.5px_var(--border-strong)] hover:text-foreground",
                        )}
                        key={option}
                        onClick={() => setFocus((current) => (current.includes(option) ? current.filter((value) => value !== option) : [...current, option]))}
                        type="button"
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              )}

              {phase === "intake" && step.id === "language" && (
                <div className={GROUP}>
                  {LANGUAGES.map((option, position) => (
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
                </div>
              )}

              {phase === "intake" && step.id === "source" && (
                <>
                  <div className={GROUP}>
                    <button
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-accent/60 disabled:pointer-events-none disabled:opacity-60"
                      disabled={connectingSource}
                      onClick={() => void connectSource()}
                      type="button"
                    >
                      <LeetCodeGlyph className="size-4 shrink-0 text-foreground/80" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-content">{sourceAccount ? `Connected as ${sourceAccount}` : "Connect LeetCode"}</span>
                        <span className="mt-0.5 block text-ui text-muted-foreground">
                          {sourceAccount
                            ? "Spar can set you real problems and read what you have already solved."
                            : "You sign in on LeetCode's own page. Spar never sees your password."}
                        </span>
                      </span>
                      {connectingSource
                        ? <SparDots pattern="pulse" size={16} />
                        : sourceAccount
                          ? <Check className="size-4 shrink-0 text-[var(--success)]" />
                          : <ArrowRight className="size-4 shrink-0 text-muted-foreground/60" />}
                    </button>
                  </div>
                  <p className="mx-auto mt-3 max-w-[22rem] text-center text-ui leading-[1.6] text-muted-foreground">
                    {sourceError || "Skip this and every challenge is one Spar writes for you. You can connect it later in Settings."}
                  </p>
                </>
              )}

              {phase === "intake" && step.id === "provider" && (
                <>
                  {/* Said before the list, not after a failed Begin: connecting one
                      of these is the step, and the sentence is what makes the
                      disabled button read as a requirement rather than a bug. */}
                  {!runnable && (
                    <p className="mx-auto -mt-1 mb-3 max-w-[20rem] text-center text-ui leading-[1.6] text-muted-foreground">
                      Spar runs on your own subscription or API key — nothing is proxied through us.
                    </p>
                  )}
                  <div className={GROUP}>
                    {connected.map((provider) => (
                      <OptionRow index={0} key={provider.id} onClick={() => setConnecting(provider)} selected trailing={<ProviderGlyph className="size-3.5 shrink-0 text-muted-foreground" provider={provider.id} />}>
                        {provider.name}
                      </OptionRow>
                    ))}
                    {offered.map((provider, position) => (
                      <OptionRow index={position + 1} key={provider.id} onClick={() => setConnecting(provider)} selected={false} trailing={<ProviderGlyph className="size-3.5 shrink-0 text-muted-foreground" provider={provider.id} />}>
                        {provider.name}
                      </OptionRow>
                    ))}
                    {!inventory && (
                      <p className="flex items-center gap-2.5 px-3.5 py-3 text-ui text-muted-foreground">
                        <SparDots pattern="pulse" size={16} />Reading the provider inventory…
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            {phase === "intake" ? (
              footer
            ) : phase === "sparring" ? (
              <>
                <Button className="mt-3 h-11 w-full text-[0.8125rem]" disabled={busy || (drafted.length > 0 && picked === null)} onClick={() => void leave(drafted.length ? drafted[picked ?? 0]?.goal : undefined)} size="lg" type="button">
                  {busy ? "Opening Spar…" : drafted.length ? "Start sparring" : "Open Spar"}
                  {!busy && <ArrowRight data-icon="inline-end" />}
                </Button>
                <p aria-live="polite" className={cn("mt-2.5 min-h-4 text-center text-ui", error ? "text-destructive" : "text-muted-foreground/70")} role="status">
                  {error ?? (drafted.length ? `Press 1–${drafted.length} to choose` : "")}
                </p>
                {drafted.length > 0 && (
                  <div className="mt-1 flex justify-center text-ui">
                    <button className="rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-45" disabled={busy} onClick={() => void leave()} type="button">
                      I'll write my own
                    </button>
                  </div>
                )}
              </>
            ) : null}
          </motion.div>
      </motion.div>

      <ProviderConnectDialog
        api={api}
        onClose={() => setConnecting(null)}
        onConnected={() => void reload().catch(() => undefined)}
        provider={connecting}
      />
    </div>
  );
}
