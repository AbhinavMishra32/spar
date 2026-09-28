import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Pencil } from "lucide-react";
import { PROBLEM_SOURCES, type Language, type LearnerProfile, type ProblemSource } from "@spar/domain";
import { LEARNER_NOTEBOOK, type SparApi, type ThemePreference } from "../../../shared/api";
import { message } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useProviders } from "../../hooks/use-providers";
import { LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { SparDots } from "../common/SparDots";
import { SparWordmark } from "../common/SparWordmark";
import { AssemblingMark, CoachLine, MARK_DIAGONAL, MARK_DOTS, ActionButton, ProgressMark, Swap, Words, useLatest } from "../onboarding/kit";
import { EASE_OUT, GLIDE, SPRING, scene } from "../onboarding/motion";
import {
  EXPERIENCE, ExperiencePick, GOALS, GOAL_FOCUS, GoalPick, LANGUAGES, LOOKS, LanguageGrid, LookPick, ProviderList, SOURCES, SourcePick, STYLES, StylePick, trackFor,
  type CoachStyle, type ConnectedSource, type GoalId, type SourceId,
} from "../onboarding/scenes";
import { BugRound, PredictRound, ROUND, ROUNDS, SortedRound, WarmupReady, WarmupRecap, grade, optionCount, warmupNotes, type Answer } from "../onboarding/warmup";
import { Flyer, NotebookPage, NotebookPill, composeNotebook, notebookMarkdown, type Flight } from "../onboarding/notebook";
import { TrackCard } from "../onboarding/track";
import { ProviderConnectDialog, type Provider } from "../settings/ProviderConnectDialog";

/* The arrival. The coach speaks for itself — "I" — because v0.7 is one coach,
   and every step decides something about the first Track rather than filling in
   a form: what it is for, what it is in, where its problems come from.

   Nothing explains how Spar works. A one-minute warm-up does instead: the
   learner works three short rounds, the coach watches, and the recap is the
   loop every Track runs with their own numbers in it. The last two screens are
   the payoff — user.md typed out from all of it, and the Track it
   became, ready to start.

   Copy is a line, never a paragraph: the pictures and the motion carry the rest. */

type ChapterId = "goal" | "language" | "level" | "warmup" | "style" | "model" | "problems" | "look" | "notebook" | "track";
type Chapter = { id: ChapterId; title: string; caption?: string };

const CHAPTERS: Chapter[] = [
  { id: "goal", title: "What are you training for?", caption: "It shapes your first Track." },
  { id: "language", title: "Which language?", caption: "You can change it for each Track." },
  { id: "level", title: "Which sounds like you?" },
  { id: "warmup", title: "Warm up with me?", caption: "Three quick rounds. No stakes." },
  { id: "style", title: "When you're stuck, what should I do?" },
  /* Required, because the coach is the model: an intake that ends with nothing
     behind it produces an account that cannot answer its first question. */
  { id: "model", title: "What should I run on?" },
  { id: "problems", title: "Where should problems come from?", caption: "Mine, real ones, or both." },
  { id: "look", title: "How should Spar look?" },
  { id: "notebook", title: "Here's what I know so far.", caption: "It's saved as user.md. Edit it any time, here or as a file." },
  { id: "track", title: "Here's your first Track.", caption: "Change anything. I'll take it from there." },
];

const at = (id: ChapterId) => CHAPTERS.findIndex((chapter) => chapter.id === id);
/** The questions, as the footer counts them: everything before the notebook. */
const QUESTIONS = at("notebook");
/** The warm-up's own steps: ready, one per round, then the recap. */
const RECAP = ROUNDS.length + 1;
/** Leaving: the window opening out, then the app. */
const DEPART_MS = 1_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clip = (text: string, length = 26) => (text.length > length ? `${text.slice(0, length).trimEnd()}…` : text);

/** A name as the greeting uses it. An all-lowercase account name was typed
 *  quickly, not chosen, so it is capitalised; anything with capitals is left
 *  exactly as its owner wrote it. */
function greetingName(value: string) {
  const name = value.trim();
  return name && name === name.toLowerCase() ? name.replace(/(^|[\s-])(\p{Ll})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase()) : name;
}

/** Where problems come from before the learner has said: mine, plus the site
 *  their goal lives on, plus any account they have already connected. */
function suggestedSources(goal: GoalId | null, accounts: ConnectedSource[]): ProblemSource[] {
  const on = new Set<ProblemSource>(["spar", ...accounts.map((account) => account.id)]);
  if (goal === "interviews") on.add("leetcode");
  if (goal === "contests") on.add("codeforces");
  return PROBLEM_SOURCES.filter((source) => on.has(source));
}

export function OnboardingPage({
  api,
  displayName,
  theme,
  onDone,
  onStartTrack,
  onTheme,
  onSignOut,
}: {
  api: SparApi | undefined;
  displayName: string;
  /** The app's theme as it stands, which the look step starts on. */
  theme: ThemePreference;
  onDone(profile: LearnerProfile): Promise<void>;
  onStartTrack(input: { goal: string; title?: string; language?: Language; problemSources?: ProblemSource[] }): Promise<void>;
  onTheme(theme: ThemePreference): Promise<void>;
  /** Leaves this account before it has a profile; the app returns to sign-in. */
  onSignOut?(): Promise<void>;
}) {
  const [intro, setIntro] = useState(true);
  const [index, setIndex] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [direction, setDirection] = useState(1);
  const [name, setName] = useState(() => greetingName(displayName));
  const [goal, setGoal] = useState<GoalId | null>(null);
  const [own, setOwn] = useState("");
  const [language, setLanguage] = useState<Language | null>(null);
  const [experience, setExperience] = useState<LearnerProfile["experience"] | null>(null);
  const [warm, setWarm] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [style, setStyle] = useState<CoachStyle | null>(null);
  const { inventory, reload } = useProviders();
  const [connecting, setConnecting] = useState<Provider | null>(null);
  const [sources, setSources] = useState<ProblemSource[]>(["spar"]);
  const [sourcesTouched, setSourcesTouched] = useState(false);
  const [look, setLook] = useState<ThemePreference>(theme);
  const [notebook, setNotebook] = useState<string[]>([]);
  const [written, setWritten] = useState(false);
  const [words, setWords] = useState("");
  const [trackTitle, setTrackTitle] = useState("");
  const [trackGoal, setTrackGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<LearnerProfile | null>(null);
  const [departing, setDeparting] = useState(false);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [noted, setNoted] = useState<Set<ChapterId>>(() => new Set());
  const [bump, setBump] = useState(0);

  const action = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const roundStarted = useRef(0);
  /** What the Track card was last composed from, so coming back to it after
   *  changing nothing keeps the learner's edits. */
  const trackBasis = useRef("");
  /** Set once this intake has written the notebook, so a second pass through
   *  it may replace its own page but never one the coach wrote. */
  const wroteNotebook = useRef(false);

  /* The layer over the desktop lives exactly as long as this page. Skipped for
     reduced motion: it exists only to move. */
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    api?.arrival?.open();
    return () => api?.arrival?.close();
  }, [api]);

  /** A ring out across the desktop, from an element in this window. Kept for
   *  the few moments worth it: the mark landing, the notebook stamped, leaving. */
  const pulseFrom = useCallback((element: HTMLElement | null, strength: number, kind: "ring" | "bloom" = "ring") => {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    api?.arrival?.pulse({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, strength, kind });
  }, [api]);

  const chapter = CHAPTERS[index]!;
  const first = name.trim().split(/\s+/)[0] || "";
  const providers = (inventory?.providers ?? []) as Provider[];
  const connected = providers.filter((provider) => provider.state !== "disconnected");
  const offered = providers.filter((provider) => provider.state === "disconnected").slice(0, 6);
  /* The main process decides this, not the row states: a connected provider
     whose sign-in has since expired cannot run a turn either. */
  const runnable = inventory?.ready === true;
  const round = chapter.id === "warmup" && warm >= 1 && warm <= ROUNDS.length ? ROUNDS[warm - 1]! : null;
  const answer = round ? answers.find((entry) => entry.round === round) : undefined;
  const warmedUp = answers.length === ROUNDS.length;

  useEffect(() => setFurthest((value) => Math.max(value, index)), [index]);
  useEffect(() => { if (round) roundStarted.current = Date.now(); }, [round]);

  /* The mark in the header is the progress: its diagonal before anything is
     said, the whole mark once the first Track is ready. Measured on the
     furthest step reached, so going back to change an answer never unlights it. */
  const lit = departing ? MARK_DOTS : MARK_DIAGONAL + Math.round(((MARK_DOTS - MARK_DIAGONAL) * furthest) / (CHAPTERS.length - 1));

  /* The practice accounts. The username lands with the credential and the record
     takes another round trip, so the row confirms itself the moment the window
     closes and fills in the numbers a beat later. */
  const [accounts, setAccounts] = useState<ConnectedSource[]>([]);
  const [sourceBusy, setSourceBusy] = useState<{ id: SourceId; action: "connect" | "disconnect" } | null>(null);
  const [sourceError, setSourceError] = useState("");
  const readAccounts = async () => {
    const inventory = await api?.practiceSources().catch(() => null);
    if (!inventory) return;
    setAccounts(inventory.filter((entry) => entry.state === "connected").map((entry) => ({ id: entry.source, username: entry.account?.username ?? entry.name, account: entry.account })));
  };
  // Once, when the api arrives.
  useEffect(() => { void readAccounts(); }, [api]);
  const connectAccount = async (id: SourceId) => {
    if (!api || sourceBusy) return;
    setSourceBusy({ id, action: "connect" });
    setSourceError("");
    try {
      const result = await api.connectPracticeSource(id);
      if (result.status === "connected") {
        setAccounts((current) => [...current.filter((entry) => entry.id !== id), { id, username: result.username, account: null }]);
        await readAccounts();
      // Closing the sign-in window answers an optional question; it is not an error.
      } else if (result.status === "failed") setSourceError(result.message);
    } catch (cause) {
      setSourceError(message(cause));
    } finally {
      setSourceBusy(null);
    }
  };
  const disconnectAccount = async (id: SourceId) => {
    if (!api || sourceBusy) return;
    setSourceBusy({ id, action: "disconnect" });
    setSourceError("");
    try {
      await api.disconnectPracticeSource(id);
      setAccounts((current) => current.filter((entry) => entry.id !== id));
    } catch (cause) {
      setSourceError(message(cause));
    } finally {
      setSourceBusy(null);
    }
  };
  const toggleSource = (source: ProblemSource) => {
    setSourcesTouched(true);
    setSources((current) => {
      const next = PROBLEM_SOURCES.filter((entry) => (entry === source ? !current.includes(entry) : current.includes(entry)));
      return next.length ? next : current;
    });
  };

  /** The answer as the notebook will file it — short enough to fly. */
  const answered = (id: ChapterId): string | null => {
    if (id === "goal") return goal === "own" ? (own.trim() ? `“${clip(own.trim())}”` : null) : GOALS.find((item) => item.id === goal)?.label ?? null;
    if (id === "language") return language ? LANGUAGE_LABEL[language] : null;
    if (id === "level") return EXPERIENCE.find((item) => item.value === experience)?.label ?? null;
    if (id === "warmup") return warmedUp ? `${answers.filter((entry) => entry.right).length} of ${ROUNDS.length} · ${Math.max(1, Math.round(answers.reduce((sum, entry) => sum + entry.ms, 0) / 1000))}s` : null;
    if (id === "style") return STYLES.find((item) => item.value === style)?.label ?? null;
    if (id === "model") return runnable ? connected[0]?.name ?? "Model ready" : null;
    if (id === "problems") return sources.map((source) => SOURCES.find((item) => item.id === source)?.short).join(" + ");
    return null;
  };

  const canAdvance = (() => {
    switch (chapter.id) {
      case "goal": return goal !== null && (goal !== "own" || own.trim().length >= 3);
      case "language": return language !== null;
      case "level": return experience !== null;
      case "warmup": return !round || Boolean(answer);
      case "model": return runnable;
      case "problems": return sources.length > 0;
      case "notebook": return written;
      case "track": return trackGoal.trim().length >= 3;
      default: return true;
    }
  })();

  const compose = () => composeNotebook({ name, experience, language, goal, own, warmup: warmedUp ? answers : null, style, sources, accounts });

  const go = (next: number) => {
    const target = CHAPTERS[next];
    if (!target) return;
    setDirection(next > index ? 1 : -1);
    setError("");
    if (target.id === "warmup") {
      // Finished, it waits on its recap; half done, it starts over.
      if (warmedUp) setWarm(RECAP);
      else {
        setWarm(0);
        setAnswers([]);
      }
    }
    if (target.id === "problems" && !sourcesTouched) setSources(suggestedSources(goal, accounts));
    if (target.id === "notebook") {
      const lines = compose();
      if (lines.join("\n") !== notebook.join("\n")) {
        setNotebook(lines);
        setWritten(false);
      }
    }
    if (target.id === "track" && goal) {
      const basis = JSON.stringify([goal, own.trim(), language]);
      if (basis !== trackBasis.current) {
        trackBasis.current = basis;
        const composed = trackFor(goal, own, language);
        setTrackTitle(composed.title);
        setTrackGoal(composed.goal);
      }
    }
    setIndex(next);
  };

  /** Sends the answer up into the notebook in the corner. */
  const fileAnswer = (id: ChapterId) => {
    const text = answered(id);
    const from = stage.current?.getBoundingClientRect();
    const to = pill.current?.getBoundingClientRect();
    if (!text || !from || !to) return;
    setFlights((current) => [...current, {
      id: Date.now() + Math.random(),
      text,
      from: { x: from.left + from.width / 2, y: from.top + from.height * 0.6 },
      to: { x: to.left + to.width / 2, y: to.top + to.height / 2 },
    }]);
    setNoted((current) => new Set(current).add(id));
  };
  const landed = useCallback((id: number) => {
    setFlights((current) => current.filter((flight) => flight.id !== id));
    setBump((value) => value + 1);
  }, []);

  const answerRound = (pick: number) => {
    if (!round || answer) return;
    setAnswers((current) => [...current, { round, pick, right: grade(round, pick), ms: Date.now() - roundStarted.current }]);
  };

  const skipWarmup = () => {
    setAnswers([]);
    go(index + 1);
  };

  /* Saving the profile is the only step that may fail loudly, so it happens as
     the notebook is filed, with the learner's own line in it. The notebook write
     runs behind the next screen and can fail without stranding anyone: the
     coach starts the notebook itself if this one never lands. */
  const fileNotebook = async () => {
    if (!api || !experience || !language) return;
    setBusy(true);
    setError("");
    let profile: LearnerProfile;
    try {
      profile = await api.saveProfile({ name: name.trim() || greetingName(displayName) || "You", experience, focus: goal ? GOAL_FOCUS[goal] : [], weakness: words.trim(), language });
    } catch (cause) {
      setError(message(cause));
      setBusy(false);
      return;
    }
    setSaved(profile);
    const markdown = notebookMarkdown(notebook, words);
    void (async () => {
      /* Only a blank notebook is started here. A learner coming back through the
         intake on a new device already has a page the coach wrote, and that is
         worth more than what they answered in the last two minutes. */
      const existing = await api.readNotebook(LEARNER_NOTEBOOK).catch(() => null);
      if (existing && (!wroteNotebook.current || existing.markdown === markdown)) return;
      wroteNotebook.current = true;
      await api.writeNotebook({ trackId: LEARNER_NOTEBOOK, markdown, note: "From onboarding" }).catch(() => undefined);
    })();
    setBusy(false);
    go(at("track"));
  };

  /** Leaving: a bloom rolls out across the desktop, the window opens to full
   *  size, and only then is the page swapped for the app and the Track begun. */
  const depart = async () => {
    const goalText = trackGoal.trim();
    if (!api || !saved || busy || goalText.length < 3) return;
    const title = trackTitle.trim();
    setBusy(true);
    setError("");
    setDeparting(true);
    pulseFrom(action.current, 2.4, "bloom");
    await wait(DEPART_MS * 0.55);
    await api.enterApp?.().catch(() => undefined);
    await wait(DEPART_MS * 0.45);
    try {
      await onDone(saved);
      api.arrival?.close();
      await onStartTrack({ goal: goalText, ...(title ? { title } : {}), ...(language ? { language } : {}), problemSources: sources });
    } catch (cause) {
      setError(message(cause));
      setDeparting(false);
      setBusy(false);
    }
  };

  /** The look applies as it is picked, revealed from the card that picked it
   *  (or the middle of the window, from the keyboard) as a growing circle. */
  const pickLook = (value: ThemePreference, from?: HTMLElement) => {
    if (value === look) return;
    setLook(value);
    const root = document.documentElement;
    const apply = async () => {
      await onTheme(value).catch(() => undefined);
      /* Resolved after the theme is set rather than before: while a theme is
         forced, the system query reports the forced one. */
      root.classList.toggle("dark", value === "dark" || (value === "system" && matchMedia("(prefers-color-scheme: dark)").matches));
    };
    if (typeof document.startViewTransition !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches) return void apply();
    const rect = from?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : innerHeight / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.classList.add("theme-reveal");
    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 720, easing: "cubic-bezier(0.16, 1, 0.3, 1)", pseudoElement: "::view-transition-new(root)" },
      ))
      .catch(() => undefined);
    void transition.finished.finally(() => root.classList.remove("theme-reveal"));
  };

  const proceed = () => {
    if (busy || departing || !canAdvance) return;
    if (chapter.id === "warmup" && warm < RECAP) return setWarm(warm + 1);
    if (chapter.id === "notebook") return void fileNotebook();
    if (chapter.id === "track") return void depart();
    fileAnswer(chapter.id);
    go(index + 1);
  };

  const back = () => {
    if (busy || departing) return;
    if (index === 0) return setIntro(true);
    go(index - 1);
  };

  const begin = () => {
    if (!name.trim()) setName(greetingName(displayName));
    setDirection(1);
    setIntro(false);
  };

  const primary = () => (intro ? begin() : proceed());
  const primaryRef = useLatest(primary);
  const canAdvanceRef = useLatest(canAdvance);

  /* Return advances from anywhere that is not itself a control. A choice that is
     focused counts as nowhere once the step can move on: Space picks it, and
     Return is what someone presses next. The text fields submit on their own. */
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || connecting) return;
      const target = event.target as HTMLElement | null;
      const choice = target?.closest("[data-choice]");
      if (choice ? !canAdvanceRef.current : target?.closest("button, input, textarea, a, [role=dialog]")) return;
      event.preventDefault();
      primaryRef.current();
    };
    addEventListener("keydown", listener);
    return () => removeEventListener("keydown", listener);
  }, [canAdvanceRef, connecting, primaryRef]);

  // Every numbered choice answers to its number key. The tenth is 0, matching
  // the physical number row.
  const options = intro ? 0
    : chapter.id === "goal" ? GOALS.length
    : chapter.id === "language" ? LANGUAGES.length
    : chapter.id === "level" ? EXPERIENCE.length
    : chapter.id === "warmup" ? (round && !answer ? optionCount(round, language ?? "javascript") : 0)
    : chapter.id === "style" ? STYLES.length
    : chapter.id === "model" ? offered.length
    : chapter.id === "problems" ? SOURCES.length
    : chapter.id === "look" ? LOOKS.length
    : 0;
  const pickRef = useLatest((position: number) => {
    if (chapter.id === "goal") setGoal(GOALS[position]!.id);
    if (chapter.id === "language") setLanguage(LANGUAGES[position]!);
    if (chapter.id === "level") setExperience(EXPERIENCE[position]!.value);
    if (chapter.id === "warmup") answerRound(position);
    if (chapter.id === "style") setStyle(STYLES[position]!.value);
    if (chapter.id === "model") setConnecting(offered[position] ?? null);
    if (chapter.id === "problems") toggleSource(SOURCES[position]!.id);
    if (chapter.id === "look") pickLook(LOOKS[position]!.value);
  });
  useEffect(() => {
    if (!options || connecting) return;
    const listener = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea")) return;
      const choice = event.key === "0" && options === 10 ? 10 : Number(event.key);
      if (!Number.isInteger(choice) || choice < 1 || choice > Math.min(options, 10)) return;
      event.preventDefault();
      pickRef.current(choice - 1);
    };
    addEventListener("keydown", listener);
    return () => removeEventListener("keydown", listener);
  }, [connecting, options, pickRef]);

  const onWritten = useCallback(() => setWritten(true), []);
  const onStamped = useCallback((element: HTMLElement) => pulseFrom(element, 1), [pulseFrom]);

  const heading = round
    ? { title: ROUND[round].title, caption: ROUND[round].caption }
    : chapter.id === "warmup" && warm === RECAP ? { title: "That's how we'll train.", caption: "" }
    : chapter.id === "language" && goal === "language" ? { title: "Which language are you learning?", caption: chapter.caption }
    : { title: chapter.title, caption: chapter.caption };
  const sceneKey = chapter.id === "warmup" ? `warmup-${warm}` : chapter.id;

  const actionLabel = intro ? "Begin"
    : chapter.id === "warmup" ? (warm === 0 ? "Start the warm-up" : warm === RECAP ? "Continue" : !answer ? "Pick an answer" : warm < ROUNDS.length ? "Next round" : "See how it went")
    : chapter.id === "style" && !style ? "Skip"
    : chapter.id === "look" ? "Write my notebook"
    : chapter.id === "notebook" ? (busy ? "Saving…" : written ? "Continue" : "Writing…")
    : chapter.id === "track" ? (departing ? "Opening Spar…" : "Start training")
    : "Continue";
  const writing = chapter.id === "notebook" && !written && !intro;
  const disabled = busy || departing || (!intro && !canAdvance);

  const keys = (count: number) => (count >= 10 ? "1–9, 0" : `1–${count}`);
  const hint = intro ? "or press Return"
    : chapter.id === "goal" ? (goal === "own" ? (own.trim().length >= 3 ? "Return to continue" : "A few words is enough") : `Press ${keys(GOALS.length)}`)
    : chapter.id === "warmup" ? (round ? (answer ? `Return for ${warm < ROUNDS.length ? "the next round" : "the recap"}` : `Press ${keys(options)}`) : "")
    : chapter.id === "model" ? (runnable ? "" : inventory ? "Connect one to continue" : "")
    : chapter.id === "notebook" ? (written ? "Return to continue" : "")
    : chapter.id === "track" ? "Return to start"
    : options ? `Press ${keys(options)}${chapter.id === "problems" ? " to switch" : ""}`
    : "";
  /* One status line. `||` rather than `??`: these are empty strings, not nulls. */
  const problem = error || (chapter.id === "problems" && !intro ? sourceError : "");
  const status = problem || hint;

  const question = !intro && index < QUESTIONS ? index + 1 : null;
  const pillSide = api?.chrome?.controls === "right" ? "left-4" : "right-4";
  const showPill = !intro && index < QUESTIONS;
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    if (!onSignOut) return;
    setSigningOut(true);
    try { await onSignOut(); } catch (cause) { setError(message(cause)); setSigningOut(false); }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-pane relative flex h-full flex-col overflow-hidden bg-background [&_[role=radio]]:cursor-pointer [&_button:not(:disabled)]:cursor-pointer">
        {/* The mark's own grid at the scale of the room — see `.auth-field` in
            theme.css — the same backdrop the sign-in window stands on, so the
            two read as one arrival. Clear behind the content, out at the edges. */}
        <motion.div animate={{ opacity: departing ? 0 : 1 }} aria-hidden className="absolute inset-0" transition={{ duration: 0.5, ease: EASE_OUT }}>
          <div className="auth-field onboarding-field text-foreground" />
        </motion.div>

        <motion.div
          animate={departing ? { opacity: 0, scale: 1.06, filter: "blur(14px)" } : { opacity: 1, scale: 1, filter: "blur(0px)" }}
          className="relative flex min-h-0 flex-1 flex-col"
          transition={{ duration: DEPART_MS / 1000, ease: EASE_OUT }}
        >
          {/* The strip the window is dragged by, and nothing else. */}
          <header className="app-drag relative z-10 flex h-14 shrink-0 items-center justify-center">
            {!intro && (
              <div className="flex items-center gap-2" title={`${Math.min(lit, MARK_DOTS)} of ${MARK_DOTS}`}>
                <motion.div className="text-foreground" layoutId="spar-mark" transition={GLIDE}>
                  <ProgressMark lit={lit} size={20} />
                </motion.div>
                <motion.div layoutId="spar-wordmark" transition={GLIDE}>
                  <SparWordmark className="block text-[1.125rem] leading-none text-foreground" />
                </motion.div>
              </div>
            )}
            <div className={cn("absolute top-1/2 flex -translate-y-1/2 items-center gap-1", pillSide, api?.chrome?.controls === "right" && "flex-row-reverse")}>
              {onSignOut && !departing && (
                <button
                  className="app-no-drag h-7 rounded-md px-2 text-ui-sm text-muted-foreground/70 transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] hover:text-foreground disabled:opacity-40"
                  disabled={signingOut}
                  onClick={() => void signOut()}
                  type="button"
                >
                  Sign out
                </button>
              )}
              <AnimatePresence>
                {showPill && (
                  <motion.div exit={{ opacity: 0, scale: 0.8 }} key="pill">
                    <NotebookPill bump={bump} count={noted.size} ref={pill} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </header>

          <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8">
            <div className="my-auto w-full py-4" ref={stage}>
              <AnimatePresence custom={direction} initial={false} mode="wait">
                {intro ? (
                  <Intro displayName={greetingName(displayName)} key="intro" name={name} onLanded={(element) => pulseFrom(element, 1.4)} onName={setName} onSubmit={begin} />
                ) : (
                  <motion.div animate="center" custom={direction} exit="exit" initial="enter" key={sceneKey} variants={scene}>
                    <div className="mx-auto mb-6 max-w-[28rem] text-center">
                      <h1 className="text-[1.25rem] font-medium leading-snug tracking-[-0.015em] text-foreground">
                        <Words delay={0.08} text={heading.title} />
                      </h1>
                      {heading.caption && (
                        <motion.p
                          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                          className="mx-auto mt-1.5 max-w-[22rem] text-ui text-muted-foreground"
                          initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
                          transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.22 }}
                        >
                          {heading.caption}
                        </motion.p>
                      )}
                    </div>

                    {chapter.id === "goal" && (
                      <GoalPick onOwn={setOwn} onPick={setGoal} onSubmit={proceed} own={own} value={goal} />
                    )}
                    {chapter.id === "language" && <LanguageGrid onPick={setLanguage} value={language} />}
                    {chapter.id === "level" && <ExperiencePick onPick={setExperience} value={experience} />}
                    {chapter.id === "warmup" && (() => {
                      const code = language ?? "javascript";
                      if (warm === 0) return <WarmupReady language={code} />;
                      if (warm === RECAP) return <WarmupRecap answers={answers} />;
                      if (round === "predict") return <PredictRound answer={answer} language={code} onPick={answerRound} />;
                      if (round === "bug") return <BugRound answer={answer} language={code} onPick={answerRound} />;
                      return <SortedRound answer={answer} onPick={answerRound} />;
                    })()}
                    {chapter.id === "style" && <StylePick onPick={setStyle} value={style} />}
                    {chapter.id === "model" && <ProviderList connected={connected} loaded={Boolean(inventory)} offered={offered} onConnect={setConnecting} runnable={runnable} />}
                    {chapter.id === "problems" && (
                      <SourcePick
                        accounts={accounts}
                        busy={sourceBusy}
                        onConnect={(id) => void connectAccount(id)}
                        onDisconnect={(id) => void disconnectAccount(id)}
                        onToggle={toggleSource}
                        value={sources}
                      />
                    )}
                    {chapter.id === "look" && <LookPick onPick={pickLook} value={look} />}
                    {chapter.id === "notebook" && (
                      <NotebookPage lines={notebook} onStamped={onStamped} onSubmit={proceed} onWords={setWords} onWritten={onWritten} words={words} />
                    )}
                    {chapter.id === "track" && (
                      <TrackCard
                        first={warmedUp ? warmupNotes(answers).first : "A short diagnostic"}
                        goal={trackGoal}
                        language={language}
                        onGoal={setTrackGoal}
                        onSubmit={proceed}
                        onTitle={setTrackTitle}
                        {...(api?.revealUserFile ? { onRevealUser: () => void api.revealUserFile().catch(() => undefined) } : {})}
                        sources={sources}
                        style={style}
                        title={trackTitle}
                      />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </main>

          <footer className="relative z-10 shrink-0 px-6 pb-5 pt-2">
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-[1fr_auto_1fr] items-center gap-3"
              initial={{ opacity: 0, y: 16 }}
              transition={{ ...GLIDE, delay: 2.1 }}
            >
              <div className="justify-self-start">
                <AnimatePresence>
                  {!intro && !departing && (
                    <motion.button
                      animate={{ opacity: 1, x: 0 }}
                      className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-ui text-muted-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] hover:text-foreground disabled:opacity-40"
                      disabled={busy}
                      exit={{ opacity: 0, x: -6 }}
                      initial={{ opacity: 0, x: -6 }}
                      onClick={back}
                      transition={SPRING}
                      type="button"
                    >
                      <ArrowLeft className="size-3.5" /> Back
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
              <ActionButton disabled={disabled} label={actionLabel} onClick={primary} ref={action}>
                {writing && <SparDots pattern="wave" size={14} />}
                {actionLabel}
                {!busy && !writing && !departing && <ArrowRight className="size-4" />}
              </ActionButton>
              <div className="justify-self-end pr-2 text-ui tabular-nums text-muted-foreground/60">
                {round ? (
                  <Swap value={`round-${warm}`}>Round {warm} of {ROUNDS.length}</Swap>
                ) : question !== null ? (
                  <Swap value={question}>{question} of {QUESTIONS}</Swap>
                ) : null}
              </div>
            </motion.div>
            <div aria-live="polite" className={cn("mt-2.5 flex h-4 justify-center text-center text-ui", problem ? "text-destructive" : "text-muted-foreground/70")} role="status">
              {!intro && chapter.id === "warmup" && warm === 0 ? (
                <button className="text-muted-foreground/80 underline decoration-[color-mix(in_oklab,var(--foreground)_25%,transparent)] underline-offset-[3px] transition-colors hover:text-foreground" onClick={skipWarmup} type="button">
                  Skip the warm-up
                </button>
              ) : (
                <Swap value={status}>{status || " "}</Swap>
              )}
            </div>
          </footer>
        </motion.div>

        {flights.map((flight) => <Flyer flight={flight} key={flight.id} onLanded={() => landed(flight.id)} />)}

        <ProviderConnectDialog api={api} onClose={() => setConnecting(null)} onConnected={() => void reload().catch(() => undefined)} provider={connecting} />
      </div>
    </MotionConfig>
  );
}

/** The first thing anyone sees: the mark assembling out of the room's own dots,
 *  the wordmark rising under it, and hello — with their name as something they
 *  can change in place rather than a step of its own. Beginning flies the mark
 *  and wordmark up into the header. */
function Intro({ name, displayName, onName, onSubmit, onLanded }: { name: string; displayName: string; onName(value: string): void; onSubmit(): void; onLanded(element: HTMLElement): void }) {
  const mark = useRef<HTMLDivElement>(null);
  const land = useLatest(onLanded);
  useEffect(() => {
    // The moment the last dot lands, the desktop answers it.
    const timer = setTimeout(() => mark.current && land.current(mark.current), 1_150);
    return () => clearTimeout(timer);
  }, [land]);
  return (
    <motion.div className="flex flex-col items-center text-center" exit={{ opacity: 0, y: -20, filter: "blur(12px)", transition: { duration: 0.3 } }}>
      <motion.div className="text-foreground" layoutId="spar-mark" ref={mark} transition={GLIDE}>
        <AssemblingMark delay={0.1} size={64} />
      </motion.div>
      <motion.div className="mt-4" layoutId="spar-wordmark" transition={GLIDE}>
        <span aria-label="Spar" className="flex font-spar text-[3rem] font-semibold leading-none tracking-[-0.055em] text-foreground">
          {"Spar".split("").map((letter, index) => (
            <motion.span
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              aria-hidden
              className="inline-block"
              initial={{ opacity: 0, y: 30, filter: "blur(12px)" }}
              key={letter}
              transition={{ y: { ...GLIDE, delay: 0.95 + index * 0.07 }, opacity: { duration: 0.4, delay: 0.95 + index * 0.07 }, filter: { duration: 0.6, ease: EASE_OUT, delay: 0.95 + index * 0.07 } }}
            >
              {letter}
            </motion.span>
          ))}
        </span>
      </motion.div>
      <h1 className="mt-7 flex items-baseline justify-center text-[1.25rem] font-medium leading-snug tracking-[-0.015em] text-foreground">
        <Words delay={1.5} text="Hi" />
        <motion.label
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          className="group relative ml-[0.28em] inline-flex items-baseline"
          initial={{ opacity: 0, y: "0.55em", filter: "blur(10px)" }}
          transition={{ y: { ...SPRING, delay: 1.56 }, opacity: { duration: 0.4, delay: 1.56 }, filter: { duration: 0.55, ease: EASE_OUT, delay: 1.56 } }}
        >
          <input
            aria-label="What I should call you"
            autoComplete="given-name"
            className="field-sizing-content -mx-1 min-w-[3ch] max-w-[16rem] rounded-md bg-transparent px-1 text-center outline-none transition-colors placeholder:text-muted-foreground/45 hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] focus:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]"
            maxLength={60}
            onBlur={() => { if (!name.trim()) onName(displayName); }}
            onChange={(event) => onName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSubmit();
              }
            }}
            placeholder="you"
            spellCheck={false}
            value={name}
          />
          <span>.</span>
          <Pencil aria-hidden className="pointer-events-none absolute -right-5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70 group-focus-within:opacity-0" />
        </motion.label>
      </h1>
      <CoachLine className="mt-2" delay={1.95} text="I'm your coach. Give me two minutes, then we train." />
    </motion.div>
  );
}
