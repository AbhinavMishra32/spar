import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ChallengeDetail, Language, SessionDetail, SessionSummary, Track } from "@spar/domain";
import type { AgentStreamEvent, BootstrapData, SparApi, ThemePreference } from "../shared/api";
import { cn } from "@/lib/utils";
import { message } from "@/lib/format";
import { Sidebar, type Page, type SessionActions } from "./components/shell/Sidebar";
import { SparWordmark } from "./components/common/SparWordmark";
import { Toolbar } from "./components/shell/Toolbar";
import { SearchPalette } from "./components/common/SearchPalette";
import { HomePage } from "./components/pages/HomePage";
import type { ChallengeTrail } from "./components/workspace/ChallengeStepper";
import { BaselinePage } from "./components/pages/BaselinePage";
import { SIDEBAR_SLIDE, SIDEBAR_SLIDE_CSS } from "./components/shell/sidebarMotion";
import { TracksPage } from "./components/pages/TracksPage";
import { TrackPage } from "./components/pages/TrackPage";
import { ProblemsPage } from "./components/pages/ProblemsPage";
import { VisualizerPage } from "./components/pages/VisualizerPage";
import { SessionsPage } from "./components/pages/SessionsPage";
import { SettingsPage } from "./components/pages/SettingsPage";
import { ChallengesPage } from "./components/pages/ChallengesPage";
import { ConceptSheet } from "./components/concepts/ConceptSheet";
import { ChallengePage } from "./components/pages/ChallengePage";
import { AuthPage } from "./components/pages/AuthPage";
import { OnboardingPage } from "./components/pages/OnboardingPage";
import { Workspace } from "./components/workspace/Workspace";
import { PlanningView } from "./components/workspace/PlanningView";
import { ChatView } from "./components/workspace/ChatView";
import { reduceRunBatch, type AgentRun } from "./components/agent/agentRun";
import { canGoBack, canGoForward, forget, step, visit, type History, type View } from "./hooks/navigation";
import { useSidebarWidth } from "./hooks/use-sidebar-width";
import { SparDots } from "@/components/common/SparDots";
import { Button } from "@/components/ui/button";

const api: SparApi | undefined = window.spar;

/** Pages the shell puts a plain toolbar over. "workspace" and "challenge" draw
 *  their own, because both carry a back button and their own actions. */
const PAGE_TITLE: Record<Exclude<Page, "workspace" | "challenge" | "baseline">, string> = {
  home: "Home",
  tracks: "Tracks",
  track: "Track",
  history: "History",
  problems: "Problems",
  visualizer: "Visualize",
  sessions: "Sessions",
  ability: "Abilities",
  challenges: "Challenges",
  settings: "Settings",
};

export function App() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>("home");
  /* Where the window has been. A browser's model, not a stack's — see
     `hooks/navigation`. Every place-changing call below records into it exactly
     once, and `applyView` is the only thing that moves without recording. */
  const [history, setHistory] = useState<History>({ entries: [{ page: "home" }], index: 0 });
  /* Which ability the Progress surface is showing. It used to live inside
     HomePage, which put one of the app's real places out of reach of the
     history — back from an ability could only land on the Progress index. */
  const [ability, setAbility] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  /* Which challenge the standalone page is showing. Held here rather than inside
     the challenges list so navigating away and back does not silently keep a
     challenge mounted behind the list. */
  const [challengeSeed, setChallengeSeed] = useState<ChallengeDetail | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  /* Every agent turn in flight, by the session it belongs to — not just the one
     the workspace is showing. A turn is started from a session and then survives
     the learner navigating away from it, so the dashboard and the sessions list
     can both keep reporting live work on cards for sessions nobody has open. */
  const [runs, setRuns] = useState<Record<string, AgentRun>>({});
  const [palette, setPalette] = useState(false);
  /** A retry of the cloud pull is in flight, so its button can say so. */
  const [retrying, setRetrying] = useState(false);
  /* One concept sheet for the whole app rather than one per list. A chip appears
     in challenge history, on an ability, and inside the sheet itself, and every
     one of them has to open the same surface — nesting a second dialog inside the
     first is how you end up unable to get back out of it. */
  const [concept, setConcept] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(() => localStorage.getItem("spar.sidebar") !== "hidden");
  const { width: sidebarWidth, dragging, handleProps: sidebarHandle } = useSidebarWidth();
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  /* The back/forward mover, reachable from the window listener. `go` is defined
     below the loading guard — it needs the bootstrap to reopen a session — and a
     hook cannot be. The shortcut is bound on the window rather than in the menu
     because it has to work wherever focus is, including inside the editor: an
     editor that swallowed ⌘[ would make the buttons the only way back, which is
     the thing a shortcut exists to avoid. */
  const goRef = useRef<(direction: -1 | 1) => void>(() => {});
  const detailRef = useRef<SessionDetail | null>(null);
  detailRef.current = detail;

  const refresh = useCallback(async () => {
    if (!api) throw new Error("Spar must run inside its Electron desktop shell.");
    const next = await api.bootstrap();
    setData(next);
    return next;
  }, []);

  /* Sidebar housekeeping. The main process is authoritative for all of it, so each
     one writes and then re-reads the bootstrap rather than patching the copy the
     sidebar is rendering from — pinning reorders the list, and archiving and
     deleting remove rows from it. */
  const mutateSession = useCallback(async (work: (sdk: SparApi) => Promise<unknown>) => {
    if (!api) return;
    try {
      await work(api);
      await refresh();
    } catch (cause) {
      setError(message(cause));
    }
  }, [refresh]);

  /* Forgetting a session's turn. Only ever called for a run that has settled:
     a streaming run is the transcript, and dropping one mid-flight would empty
     the thread the learner is watching. */
  const clearRun = useCallback((sessionId: string, runId?: string) => {
    setRuns((current) => {
      const held = current[sessionId];
      if (!held || (runId && held.runId !== runId)) return current;
      const { [sessionId]: _dropped, ...rest } = current;
      return rest;
    });
  }, []);

  const openSession = useCallback(async (id: string, destination: "workspace" | "baseline" = "workspace", record = true) => {
    if (!api) return;
    setPage(destination);
    setAbility(null);
    if (record) setHistory((current) => visit(current, { page: destination, sessionId: id }));
    setOpening(true);
    try {
      const next = await api.openSession(id);
      if (!next) throw new Error("That session no longer exists.");
      setDetail(next);
      // Opening a session crosses into its Track workspace. Re-read the shell so
      // Today, Progress, and the sidebar all reflect that Track when Back is used.
      setData(await api.bootstrap());
      /* A failed turn is reported on the card until someone goes and looks. Once
         they have, the durable transcript is the record of it and the held run
         would only keep the failure on the card behind them. */
      setRuns((current) => {
        if (!current[id] || current[id].status === "streaming") return current;
        const { [id]: _settled, ...rest } = current;
        return rest;
      });
    } finally {
      setOpening(false);
    }
  }, []);

  const beginBaseline = useCallback(async () => {
    if (!api) return;
    setOpening(true);
    setError(null);
    try {
      const created = await api.startBaseline();
      await refresh();
      await openSession(created.sessionId, "baseline");
    } catch (cause) { setError(message(cause)); }
    finally { setOpening(false); }
  }, [openSession, refresh]);

  /* Starting a session is reachable before the shell exists: the last step of
     onboarding opens the sparring session the learner picked, so this has to be
     declared above the early returns rather than beside the other page actions. */
  const start = useCallback(async (goal: string, trackId?: string) => {
    if (!api) return;
    setError(null);
    try {
      const result = await api.createSession({ goal, trackId });
      await refresh();
      await openSession(result.sessionId);
    } catch (cause) {
      setError(message(cause));
    }
  }, [openSession, refresh]);

  /* The main process writes the token and the account into the keychain, but the
     renderer's copy of the bootstrap is what decides which page is mounted — so
     authenticating has to re-read it, exactly as signing out does. Declared up
     here because the sign-in page is returned long before `signedOut` is. */
  const signedIn = useCallback(async () => {
    setError(null);
    setPage("home");
    /* A different account is a different window. Keeping the old history would
       let Back reopen the last person's session. */
    setHistory({ entries: [{ page: "home" }], index: 0 });

    await refresh();
  }, [refresh]);

  /* Asking for the pull again after it failed. The bootstrap is re-read either
     way: a retry that succeeds has just written the account to disk, and one that
     fails has updated nothing but the state that keeps this screen up. */
  const retryRestore = useCallback(() => {
    if (!api || retrying) return;
    setRetrying(true);
    void api.retryRestore()
      .then(() => refresh())
      .catch((cause) => setError(message(cause)))
      .finally(() => setRetrying(false));
  }, [refresh, retrying]);

  useEffect(() => {
    void refresh().catch((cause) => setError(message(cause)));
  }, [refresh]);

  // A forced theme also updates Electron's nativeTheme in the main process so
  // macOS vibrancy and renderer tokens resolve to the same appearance.
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const resolvedDark = data?.theme === "dark" || (data?.theme !== "light" && query.matches);
      setDark(resolvedDark);
      document.documentElement.classList.toggle("dark", resolvedDark);
    };
    sync();
    if (data?.theme === "system" || !data) query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [data?.theme]);

  /* Deltas arrive far faster than anything needs to be drawn — a fast provider
     sends thousands a second — and each one used to be its own React update over
     a growing transcript. They are buffered here and applied a frame at a time
     instead; see `MAX_BODY` in agentRun for the whole story. */
  const pending = useRef(new Map<string, AgentStreamEvent[]>());
  const flushing = useRef(0);
  useEffect(() => {
    if (!api) return;
    const flush = () => {
      flushing.current = 0;
      const batch = pending.current;
      if (!batch.size) return;
      pending.current = new Map();
      setRuns((current) => {
        let next = current;
        for (const [sessionId, events] of batch) {
          const run = reduceRunBatch(next[sessionId] ?? null, events);
          if (run) next = next === current ? { ...current, [sessionId]: run } : Object.assign(next, { [sessionId]: run });
        }
        return next;
      });
    };
    const offAgent = api.onAgentEvent((event) => {
      /* The main process stamps the session on every event. The fallback is for
         a turn that somehow arrives unattributed: routing it to the open session
         is what this did before runs were held per session, and it keeps the
         workspace transcript working rather than silently dropping the stream. */
      const sessionId = event.sessionId ?? detailRef.current?.summary.id;
      if (!sessionId) return;

      if (event.type === "done") {
        /* The turn's own buffered deltas are dropped: the reply it produced is
           about to be re-read from storage, and replaying a partial stream over
           the top of it would duplicate the transcript. */
        pending.current.delete(sessionId);
        // The summaries every card is drawn from are re-read whichever session
        // finished; only the open one needs its detail re-opened.
        if (detailRef.current?.summary.id === sessionId) {
          void openSession(sessionId, detailRef.current.summary.context === "baseline" ? "baseline" : "workspace").catch((cause) => setError(message(cause))).finally(() => clearRun(sessionId, event.runId));
        } else clearRun(sessionId, event.runId);
        void refresh().catch(() => undefined);
        return;
      }

      pending.current.set(sessionId, [...(pending.current.get(sessionId) ?? []), event]);
      if (!flushing.current) flushing.current = requestAnimationFrame(flush);
    });

    return () => {
      offAgent();
      if (flushing.current) cancelAnimationFrame(flushing.current);
      flushing.current = 0;
      pending.current = new Map();
    };
  }, [clearRun, openSession, refresh]);

  // A planning session has no challenge to show yet, so poll until one exists.
  useEffect(() => {
    if (!detail || detail.question || detail.pendingLearnerQuestion || detail.summary.status !== "planning") return;
    const timer = setInterval(() => void openSession(detail.summary.id, detail.summary.context === "baseline" ? "baseline" : "workspace").catch(() => undefined), 1_800);
    return () => clearInterval(timer);
  }, [detail, openSession]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      if (event.altKey) return;
      if (event.key === "[" || event.key === "]") {
        event.preventDefault();
        goRef.current(event.key === "[" ? -1 : 1);
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        setPage("home");
        setDetail(null);
        setHistory((current) => visit(current, { page: "home" }));
      }
      if (key === "k") {
        event.preventDefault();
        setPalette((value) => !value);
      }
      if (key === "b") {
        event.preventDefault();
        setSidebar((value) => {
          localStorage.setItem("spar.sidebar", value ? "hidden" : "shown");
          return !value;
        });
      }
    };
    addEventListener("keydown", listener);
    return () => removeEventListener("keydown", listener);
  }, []);

  // The native menu bar drives the same actions as the in-app controls.
  useEffect(() => {
    if (!api) return;
    return api.onMenuCommand((command) => {
      if (command === "command-palette") setPalette(true);
      /* The menu is another way to the same places, so it records the same
         entries. A move the history never saw is one Back steps straight past. */
      if (command === "settings") {
        setPage("settings");
        setDetail(null);
        setHistory((current) => visit(current, { page: "settings" }));
      }
      if (command === "new-session") {
        setPage("home");
        setDetail(null);
        setHistory((current) => visit(current, { page: "home" }));
      }
    });
  }, []);

  // Sync progress is pushed from the main process rather than polled at bootstrap.
  useEffect(() => {
    if (!api) return;
    return api.onSyncState((syncState) => setData((current) => (current ? { ...current, syncState } : current)));
  }, []);

  /* The restore reports itself the same way. Re-reading the bootstrap when it
     finishes is the point: the pull writes sessions, challenges and abilities
     straight into the local store, and none of them are in the copy the shell is
     currently rendering from. */
  useEffect(() => {
    if (!api) return;
    return api.onRestoreState((restore) => {
      setData((current) => (current ? { ...current, restore } : current));
      if (restore === "done") void refresh().catch((cause) => setError(message(cause)));
    });
  }, [refresh]);

  if (error && !data) return <FatalError error={error} />;
  if (!data) return <BootShell />;
  if (!data.account) return <AuthPage api={api} error={error} serverConfigured={data.serverConfigured} onAuthenticated={signedIn} onError={setError} />;
  /* Restore is checked before the profile, and the order is the whole fix for
     "signing in sends me through onboarding again".

     A signed-in device with no local profile has three possible explanations, and
     only one of them is a new account: the pull may still be running, it may have
     failed, or this really is someone's first time. Reading an empty
     `learner_profile` as the third case is what asked returning learners for their
     name, their weakest area and their language every time they signed in. */
  if (!data.profile && data.restore === "pending") return <RestoringShell />;
  if (!data.profile && data.restore === "failed") return <RestoreFailed busy={retrying} onRetry={retryRestore} />;
  /* Onboarding is a gate, not a page: until the profile exists the agent has no
     language, no stated weakness, and probably no provider, so there is nothing
     useful behind it. */
  if (!data.profile) {
    return (
      <OnboardingPage
        api={api}
        displayName={data.account.displayName}
        onBaseline={beginBaseline}
        onDone={async (profile) => { setData((current) => (current ? { ...current, profile } : current)); await refresh(); }}
        onStartSession={start}
      />
    );
  }

  /* Landing on a page, without deciding whether the move is worth recording —
     that is `navigate`'s job, and `applyView`'s job is to do this and nothing
     else. Split so a back press cannot append the entry it is standing on. */
  const show = (next: Page) => {
    setPage(next);
    /* The session and a past challenge are one pane, not two pages. Dropping the
       one you are leaving is what made the crossing a teardown: `show("challenge")`
       cleared the open session, so the workspace was gone from the tree before the
       practice page had drawn a pixel, and stepping back cleared the challenge the
       same way. They are both kept for as long as either is on screen, and both are
       let go the moment the pane itself is left. */
    const pane = next === "workspace" || next === "challenge";
    if (!pane) {
      setDetail(null);
      setChallengeId(null);
      setChallengeSeed(null);
    }
    if (next !== "ability") setAbility(null);
  };

  /* A page is a place. Recorded here rather than at each call site so a page
     reached from the sidebar and the same page reached from the palette are one
     entry with one meaning. */
  const navigate = (next: Page) => {
    show(next);
    /* The pages that are a place only together with an id record themselves,
       from the call that knows the id. */
    if (next !== "workspace" && next !== "baseline" && next !== "challenge" && next !== "ability" && next !== "track") {
      setHistory((current) => visit(current, { page: next }));
    }
  };

  /**
   * Puts the window where the history says, without recording the move.
   *
   * Re-entering a session goes through `openSession` so the main process
   * reopens it — the transcript, workspace and attempts are read on open, and
   * restoring the page alone would show a workspace the rest of the app does
   * not believe is open. The same is true of a Track, which is active state the
   * main process owns. Anything deleted since is skipped rather than reopened.
   */
  const applyView = (view: View) => {
    if (view.page === "workspace" || view.page === "baseline") {
      if (!data.sessions.some((session) => session.id === view.sessionId)) return;
      void openSession(view.sessionId, view.page, false).catch((cause) => setError(message(cause)));
      return;
    }
    if (view.page === "challenge") {
      setChallengeId(view.challengeId);
      show("challenge");
      return;
    }
    if (view.page === "ability") {
      show("ability");
      setAbility(view.abilityId);
      return;
    }
    if (view.page === "track") {
      const track = data.tracks.find((entry) => entry.id === view.trackId);
      if (!track) return;
      if (data.activeTrack?.id === track.id) { show("track"); return; }
      void openTrack(track, false);
      return;
    }
    show(view.page);
  };

  /* Read outside the updater on purpose. Applying the view from inside one
     would put a side effect in a function React is free to call twice — which
     it does in development — and reopening a session twice per click is not
     something the second call makes harmless. */
  const go = (direction: -1 | 1) => {
    const moved = step(history, direction);
    if (!moved) return;
    setHistory(moved.history);
    applyView(moved.view);
  };

  goRef.current = go;

  const nav = {
    canBack: canGoBack(history),
    canForward: canGoForward(history),
    onBack: () => go(-1),
    onForward: () => go(1),
  };

  /* The sheet's header renders from this before its own read lands, so a chip
     opens instantly wherever it was clicked. */
  const conceptSummaries = new Map(data.concepts.map((entry) => [entry.slug, entry]));

  /* One bundle rather than three props repeated at every surface that shows a
     concept chip. Every chip in the app previews the same history and opens the
     same sheet, so they all read from this. */
  const conceptContext = { challenges: data.challenges, summaries: conceptSummaries, onOpen: setConcept };

  /**
   * One session's challenges, as a series to step through.
   *
   * Built here because the two surfaces that draw it are not the same component
   * and neither of them knows the session's other challenges: the workspace has
   * the live one, and the practice page has one challenge and the id of the
   * session it came from. Both get the same list, and the same rule about where
   * a step lands — the live challenge is the session, and every other stop is
   * the practice sandbox, which records nothing.
   */
  const trailFor = (sessionId: string | undefined): ChallengeTrail | undefined => {
    if (!sessionId) return undefined;
    const liveId = data.sessions.find((session) => session.id === sessionId)?.activeQuestion?.id ?? null;
    const stops = data.challenges
      .filter((challenge) => challenge.sessionId === sessionId)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((challenge) => ({ id: challenge.id, ordinal: challenge.ordinal, title: challenge.title, live: challenge.id === liveId }));
    if (stops.length < 2) return undefined;
    return {
      stops,
      onGo: (stop) => {
        if (stop.live) void openSession(sessionId).catch((cause) => setError(message(cause)));
        else openChallenge(stop.id);
      },
    };
  };

  const open = (session: SessionSummary) => void openSession(session.id).catch((cause) => setError(message(cause)));
  const openTrack = async (track: Track, record = true) => {
    if (!api) return;
    setOpening(true); setError(null);
    try {
      await api.setActiveTrack(track.id);
      await refresh();
      show("track");
      if (record) setHistory((current) => visit(current, { page: "track", trackId: track.id }));
    } catch (cause) { setError(message(cause)); }
    finally { setOpening(false); }
  };
  /* `from` is gone: a challenge is opened from two libraries, and where Back
     lands is now the history's business rather than a guess recorded at the
     door. */
  const openChallenge = (id: string) => {
    const land = () => {
      setChallengeId(id);
      show("challenge");
      setHistory((current) => visit(current, { page: "challenge", challengeId: id }));
    };
    /* Read first, then navigate. It is a local read of a few files, and doing it
       before the page exists is the difference between arriving on the challenge
       and arriving on a spinner that becomes the challenge. If it fails the page
       still opens and reads for itself — this is a head start, not the load. */
    if (!api) { setChallengeSeed(null); land(); return; }
    void api
      .readChallenge(id)
      .then((next) => { setChallengeSeed(next ?? null); land(); })
      .catch(() => { setChallengeSeed(null); land(); });
  };

  const openAbility = (id: string) => {
    show("ability");
    setAbility(id);
    setHistory((current) => visit(current, { page: "ability", abilityId: id }));
  };

  /* Practice is a real session, so it lands where a new session lands: the sheet
     closes, the workspace opens, and the agent's first turn is already running by
     the time it does. Anything less would make an ability page a set of links. */
  /* The learner picking one specific problem out of the library. Same landing as
     practice — the session exists and its first turn is already running by the
     time the workspace opens — but it can fail in a way practice cannot: the
     problem has to be read from its source first. Awaited rather than fired, so
     the row that was clicked can stay busy until the session is on screen. */
  const startProblem = async (input: { source: "leetcode" | "codeforces"; slug: string }) => {
    if (!api) return;
    setError(null);
    try {
      const created = await api.startPracticeProblem(input);
      await refresh();
      await openSession(created.sessionId);
    } catch (cause) {
      setError(message(cause));
    }
  };

  const practise = (input: { abilityId?: string; conceptSlug?: string; drill?: string }) =>
    void (async () => {
      if (!api) return;
      setError(null);
      try {
        const created = await api.startPractice(input);
        setConcept(null);
        await refresh();
        await openSession(created.sessionId);
      } catch (cause) {
        setError(message(cause));
      }
    })();

  const sessionActions: SessionActions = {
    rename: (session, title) => void mutateSession((sdk) => sdk.renameSession({ sessionId: session.id, title })),
    setPinned: (session, pinned) => void mutateSession((sdk) => sdk.setSessionPinned({ sessionId: session.id, value: pinned })),
    setArchived: (session, archived) => void mutateSession((sdk) => sdk.setSessionArchived({ sessionId: session.id, value: archived })),
    setFinished: (session, finished) => void mutateSession(async (sdk) => {
      await sdk.setSessionStatus({ sessionId: session.id, status: finished ? "completed" : "paused" });
      // The open session's own view is drawn from the detail, not the summary.
      if (detailRef.current?.summary.id === session.id) await openSession(session.id);
    }),
    /* The workspace is closed before the delete lands: the planning poll and the
       agent's own refresh both re-open the session by id, and either one would
       come back to a row that is no longer there. */
    remove: (session) => void mutateSession(async (sdk) => {
      /* Back must not point at a session that no longer exists: the entry would
         reopen something deleted, and the reopen fails rather than no-ops. */
      setHistory((current) => forget(current, session.id));
      if (detailRef.current?.summary.id === session.id) {
        setDetail(null);
        show("home");
      }
      clearRun(session.id);
      await sdk.deleteSession(session.id);
    }),
  };

  const abandon = async (reason: string) => {
    if (!api || !detail?.question) return;
    await api.abandonAttempt({
      sessionId: detail.summary.id,
      attemptId: detail.question.attemptId,
      reason,
    });
    if(detail.summary.context==="baseline")await api.requestNextChallenge({sessionId:detail.summary.id});
    clearRun(detail.summary.id);
    await openSession(detail.summary.id,detail.summary.context==="baseline"?"baseline":"workspace");
    await refresh();
  };

  const toggleSidebar = () =>
    setSidebar((value) => {
      localStorage.setItem("spar.sidebar", value ? "hidden" : "shown");
      return !value;
    });
  const expandSidebar = sidebar ? undefined : toggleSidebar;
  const changeTheme = async (theme: ThemePreference) => {
    if (!api) return;
    await api.setTheme(theme);
    setData((current) => current ? { ...current, theme } : current);
  };
  const signedOut = async () => {
    setRuns({});
    setDetail(null);
    setPage("home");
    /* A different account is a different window. Keeping the old history would
       let Back reopen the last person's session. */
    setHistory({ entries: [{ page: "home" }], index: 0 });

    setError(null);
    await refresh();
  };

  const createTrack = async (input: { goal: string; title?: string; language?: Language }) => {
    if (!api) return;
    setOpening(true); setError(null);
    try {
      const created = await api.createTrack(input);
      await refresh();
      await openSession(created.sessionId);
    } catch (cause) { setError(message(cause)); }
    finally { setOpening(false); }
  };

  const setTrainingMode = async (mode: BootstrapData["trainingMode"]) => {
    if (!api) return;
    await api.setTrainingMode(mode);
    await refresh();
  };

  return (
    <div className="app-vibrant relative flex h-full">
      {/* The column, which is only ever a window onto the sidebar.

             It used to be the sidebar: one element whose width animated from
             zero, with `<Sidebar/>` filling whatever it was that frame. So every
             frame of the collapse re-laid-out the entire source list at a new
             width — labels rewrapping, titles re-truncating, the Track groups
             reflowing — which is the churn that made this read as a browser
             panel rather than a native one, and it was the most expensive
             animation in the window besides.

             Now nothing inside it changes size at all. The sidebar below is
             pinned to its full width and slides; this clips. The two run on the
             same curve, so the sidebar's right edge sits exactly on the clip
             edge for the whole travel: a pure slide, no stretch, no reflow, and
           the icons never move relative to the words beside them.

          Animated rather than mounted and unmounted, unlike the version this
          came from: the sidebar owns state the learner set — which Tracks they
          opened, whether the archive is showing — and unmounting it on collapse
          throws that away every time the column is hidden. */}
      <motion.div
        animate={{ width: sidebar ? sidebarWidth : 0 }}
        className="relative shrink-0 overflow-hidden"
        initial={false}
        /* No transition while the divider is being dragged: the width is
           animated so collapsing eases, and the same easing applied to a drag
           leaves the edge lagging a frame behind the cursor. */
        transition={dragging ? { duration: 0 } : SIDEBAR_SLIDE}
      >
        <motion.div
          /* Laid out once, at the width it will still be when the animation
             ends. `will-change` because this is the one element in the window
             that is worth a compositor layer of its own — a whole source list
             being moved, sixty times a second. */
          animate={{ x: sidebar ? 0 : -sidebarWidth }}
          className="h-full will-change-transform"
          initial={false}
          style={{ width: sidebarWidth }}
          transition={dragging ? { duration: 0 } : SIDEBAR_SLIDE}
        >
          <Sidebar
            // The name the learner gave onboarding, not the one derived from their email.
            account={{ ...data.account, displayName: data.profile.name || data.account.displayName }}
            activeSessionId={detail?.summary.id}
            challenges={data.challenges}
            onCollapse={toggleSidebar}
            onCommandPalette={() => setPalette(true)}
            onNewSession={() => navigate("tracks")}
            onNewTrack={() => navigate("tracks")}
            onOpenSession={open}
            onOpenTrack={(track) => void openTrack(track)}
            nav={nav}
            onPage={navigate}
            page={page}
            runs={runs}
            sessionActions={sessionActions}
            /* Every Track's sessions, not just the open one's: the sidebar groups
               them under their Tracks now, and a list that can only show you the
               Track you are already in is not one. */
            sessions={data.sessions.filter((session) => session.context !== "baseline")}
            syncState={data.syncState}
            tracks={data.tracks}
            {...(data.activeTrack ? { activeTrackId: data.activeTrack.id } : {})}
          />
        </motion.div>
      </motion.div>

      {/* The pane's leading corners round away from the sidebar so the translucent
          material wraps around it and the two read as one continuous surface —
          but only while the sidebar is there to wrap it. Collapsed, the pane owns
          the window edge and has to meet it square. */}
      {/* Floated over the seam rather than placed in the flex row: a handle with
          real width would hold the two panes apart, and on a transparent window
          that gap is a stripe of desktop. The grab target is 8px wide but shows
          only a hairline, and only under the pointer — a permanently drawn
          divider would cut the sidebar off from the pane it flows into. */}
      {sidebar && (
        <div
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          className={cn(
            "app-no-drag absolute inset-y-0 z-20 w-2 cursor-col-resize",
            "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent",
            "after:transition-colors hover:after:bg-[var(--border-strong)]",
            dragging && "after:bg-[var(--border-strong)]",
          )}
          role="separator"
          style={{ left: sidebarWidth - 4 }}
          {...sidebarHandle}
        />
      )}

      {/* The two surfaces you work on rather than read keep the window's glass;
          every other page is opaque, because the desktop moving behind a
          paragraph is the desktop competing with it. */}
      <main
        className={cn(
          "app-pane relative flex min-w-0 flex-1 flex-col",
          /* The content pane's rounded leading corners and inset ring arrive
             with the sidebar rather than the instant it is asked for. */
          "transition-[border-radius,box-shadow]",
          SIDEBAR_SLIDE_CSS,
          sidebar && "app-content-pane",
          (page === "workspace" || page === "challenge" || page === "baseline") && "app-pane-glass",
        )}
      >
        {page !== "workspace" && page !== "challenge" && page !== "baseline" && (
          <Toolbar nav={nav} onExpandSidebar={expandSidebar} title={PAGE_TITLE[page as Exclude<Page, "workspace" | "challenge" | "baseline">]} />
        )}

        {error && (
          <div className="absolute right-3 top-11 z-20 flex w-[min(26rem,calc(100vw-2rem))] items-start gap-2 rounded-xl border border-destructive/30 bg-popover px-3 py-2.5 text-ui text-destructive shadow-[var(--app-shadow-overlay)]">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
            <button className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setError(null)} type="button">
              <X className="size-3.5" />
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1">

          {page === "baseline" && <BaselinePage api={api} busy={opening} concepts={conceptContext} dark={dark} data={data} detail={detail} onAbandon={abandon} nav={nav} onError={setError} onExpandSidebar={expandSidebar} onOpenSettings={() => navigate("settings")} onProgress={() => navigate("home")} onRefresh={async () => { await refresh(); if (detail) await openSession(detail.summary.id,"baseline"); }} onStart={beginBaseline} run={detail ? runs[detail.summary.id]??null : null} />}
          {page === "tracks" && <TracksPage busy={opening} data={data} onCreate={createTrack} onOpen={openTrack} />}
          {page === "track" && data.activeTrack && <TrackPage api={api} busy={opening} challenges={data.challenges.filter((challenge) => data.sessions.find((session) => session.id === challenge.sessionId)?.trackId === data.activeTrack?.id)} onCreate={(goal) => start(goal,data.activeTrack!.id)} onOpen={open} runs={runs} sessions={data.sessions.filter((session) => session.context !== "baseline" && session.trackId === data.activeTrack?.id)} track={data.activeTrack} />}
          {page === "problems" && (
            <ProblemsPage
              api={api}
              challenges={data.challenges}
              onOpenChallenge={openChallenge}
              onStartProblem={startProblem}
            />
          )}
          {/* Mounted only while it is the page. The visualiser holds a trace,
              an editor and a running animation, and none of that is worth
              keeping warm behind four other surfaces. */}
          {page === "visualizer" && <VisualizerPage api={api} dark={dark} onError={setError} />}
          {page === "sessions" && <SessionsPage api={api} challenges={data.challenges} onOpen={open} runs={runs} sessions={data.sessions.filter((session) => session.context !== "baseline")} />}
          {(page === "home" || page === "ability") && (
            <HomePage
              abilities={data.abilities}
              ability={ability}
              api={api}
              busy={opening}
              challenges={data.challenges}
              concepts={data.concepts}
              data={data}
              onBaseline={beginBaseline}
              onCreateTrack={() => navigate("tracks")}
              onMode={setTrainingMode}
              onNavigate={navigate}
              onOpen={open}
              onOpenAbility={(next) => (next ? openAbility(next) : navigate("home"))}
              onOpenConcept={setConcept}
              onOpenSession={(sessionId) => void openSession(sessionId).catch((cause) => setError(message(cause)))}
              onPractise={practise}
            />
          )}
          {(page === "history" || page === "challenges") && (
            <ChallengesPage
              api={api}
              challenges={data.challenges}
              concepts={data.concepts}
              onOpen={(challenge) => openChallenge(challenge.id)}
              onOpenConcept={setConcept}
            />
          )}
          {page === "settings" && (
            <SettingsPage
              api={api}
              baseline={data.baseline}
              language={data.profile.language}
              onBaseline={beginBaseline}
              onLanguageChange={(next) => setData((current) => (current?.profile ? { ...current, profile: { ...current.profile, language: next } } : current))}
              onSignedOut={signedOut}
              onThemeChange={changeTheme}
              theme={data.theme}
            />
          )}
          {/* The session and a past challenge, stacked rather than routed.
              They used to be two branches of this list, so stepping between them
              was an unmount and a mount: Monaco torn down and rebuilt, the
              practice page reading its challenge from disk behind a full-height
              spinner, and the workspace arriving through a blurred, scaled
              dissolve on the way back. That is what read as flicker, and no
              transition inside either page could have covered it — there was
              nothing on screen to transition from.

              Both are mounted for as long as either is in use, and the crossing
              is an opacity fade between two layers that are already painted. The
              hidden one keeps its editors, its drafts and its scroll position, so
              stepping back is instantaneous rather than another cold load. */}
          {(page === "workspace" || page === "challenge") && (
            <div className="relative h-full">
              {detail && (
                <Surface active={page === "workspace"}>
                  {/* Session identity and workspace mode both define the mounted
                      surface, so both are in the key: this covers
                      challenge-to-challenge navigation within a session as well as
                      mode changes. The blur cross-dissolve is deliberate here and
                      is not the same crossing as stepping between a live challenge
                      and a past one — that one is two surfaces of the same pane and
                      fades plainly, this one is arriving somewhere else. */}
                  <AnimatePresence initial={false} mode="wait">
                    <motion.div
                      key={`${detail.summary.id}:${sessionMode(detail)}`}
                      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                      className="h-full"
                      exit={{ opacity: 0, scale: 0.985, filter: "blur(8px)" }}
                      initial={{ opacity: 0, scale: 1.01, filter: "blur(8px)" }}
                      transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
                    >
                      {detail.question ? (
                        <Workspace
                          api={api}
                          concepts={conceptContext}
                          dark={dark}
                          detail={detail}
                          onAbandon={abandon}
                          nav={nav}
                          onError={setError}
                          onExpandSidebar={expandSidebar}
                          onOpenSettings={() => navigate("settings")}
                          onRefresh={() => openSession(detail.summary.id)}
                          question={detail.question}
                          run={runs[detail.summary.id] ?? null}
                          trail={trailFor(detail.summary.id)}
                        />
                      ) : sessionMode(detail) === "chat" ? (
                        <ChatView
                          api={api}
                          detail={detail}
                          nav={nav}
                          onError={setError}
                          onExpandSidebar={expandSidebar}
                          onOpenSettings={() => navigate("settings")}
                          onRefresh={() => openSession(detail.summary.id)}
                          run={runs[detail.summary.id] ?? null}
                        />
                      ) : (
                        <PlanningView
                          api={api}
                          detail={detail}
                          nav={nav}
                          onError={setError}
                          onExpandSidebar={expandSidebar}
                          onOpenSettings={() => navigate("settings")}
                          onRefresh={() => openSession(detail.summary.id)}
                          run={runs[detail.summary.id] ?? null}
                        />
                      )}
                    </motion.div>
                  </AnimatePresence>
                </Surface>
              )}

              {challengeId && (
                <Surface active={page === "challenge"}>
                  <ChallengePage
                    api={api}
                    challengeId={challengeId}
                    dark={dark}
                    nav={nav}
                    onError={setError}
                    onExpandSidebar={expandSidebar}
                    onOpenSession={(sessionId) => void openSession(sessionId).catch((cause) => setError(message(cause)))}
                    seed={challengeSeed}
                    trail={trailFor(data.challenges.find((challenge) => challenge.id === challengeId)?.sessionId)}
                  />
                </Surface>
              )}

              {page === "workspace" && !detail && <WorkspaceSkeleton />}
            </div>
          )}
        </div>
      </main>

      <SearchPalette
        challenges={data.challenges}
        concepts={data.concepts}
        onNewSession={() => navigate("tracks")}
        onOpenChallenge={openChallenge}
        onOpenChange={setPalette}
        onOpenConcept={setConcept}
        onOpenSession={open}
        onPage={navigate}
        open={palette}
        sessions={data.sessions.filter((session) => session.context !== "baseline")}
      />

      <ConceptSheet
        api={api}
        onOpenChange={(next) => { if (!next) setConcept(null); }}
        onOpenSession={(sessionId) => { setConcept(null); void openSession(sessionId).catch((cause) => setError(message(cause))); }}
        onPractise={(conceptSlug) => practise({ conceptSlug })}
        slug={concept}
        summaries={conceptSummaries}
      />
    </div>
  );
}

/**
 * Which mode the session is in. A paused session with no live question is one
 * the learner walked away from, which is general chat rather than planning.
 */
function sessionMode(detail: SessionDetail): "challenge" | "chat" | "planning" {
  if (detail.question) return "challenge";
  if (detail.summary.status === "paused" || detail.summary.status === "completed") return "chat";
  return "planning";
}

/** The first thing the app shows, while the local store is being read.
 *
 *  The mark rather than the word: the dot grid is the thing people recognise
 *  from the dock icon they just clicked, and — unlike a wordmark — it can move,
 *  so the screen says "starting" without a line of text saying it.
 *
 *  Quiet on purpose. This is a screen nobody chose to look at, and on a fast
 *  start it is gone before it is read, so it sits in the muted tone at a size
 *  that reads as a mark rather than as a banner. `sweep` over `wave` for the
 *  same reason: one brief pass with a gap behind it, instead of a continuous
 *  swell that would claim the app is busier than it is. */
function BootShell() {
  return (
    <div className="app-drag app-pane grid h-full place-items-center">
      {/* The mark carries the status role and the name — it is the only thing on
          the screen, and the wordmark it replaced was what used to announce it. */}
      <SparDots className="boot-mark text-muted-foreground" label="Starting Spar" pattern="sweep" size={56} />
    </div>
  );
}

/** The account arriving from the cloud. Shown while the pull runs, which is the
 *  first thing a new machine does after a sign-in and can take a moment on an
 *  account with real history behind it. */
function RestoringShell() {
  return (
    <div aria-busy="true" className="app-drag app-pane grid h-full place-items-center" role="status">
      <div className="flex flex-col items-center gap-3">
        <SparWordmark className="text-[2.5rem] leading-none text-foreground" />
        <p className="flex items-center gap-2 text-ui text-muted-foreground">
          <SparDots pattern="wave" size={16} />
          Bringing your sessions back…
        </p>
      </div>
    </div>
  );
}

/** Signed in, nothing local, and the server unreachable.
 *
 *  This screen exists so that the app never guesses. The device cannot tell an
 *  account that has been onboarded from one that has not without asking the
 *  server, and guessing "not onboarded" would walk an existing learner through
 *  intake again and then overwrite the real profile with the answers. Saying so
 *  and offering the retry is the honest move. */
function RestoreFailed({ onRetry, busy }: { onRetry(): void; busy: boolean }) {
  return (
    <div className="app-drag app-pane grid h-full place-items-center px-8">
      <div className="app-no-drag max-w-[26rem] text-center">
        <SparWordmark className="text-[2.25rem] leading-none text-foreground" />
        <p className="mt-4 text-content text-foreground">Spar cannot reach its server.</p>
        <p className="mt-1.5 text-ui leading-[1.65] text-muted-foreground">
          Your sessions and your profile live on your account, and this device has not got them yet. Reconnect and try again — nothing has been lost.
        </p>
        <Button className="mt-4 h-10 w-full text-[0.8125rem]" disabled={busy} onClick={onRetry} size="lg" type="button">
          {busy ? "Trying again…" : "Try again"}
        </Button>
      </div>
    </div>
  );
}

/**
 * One of the two challenge surfaces, holding its place while the other is shown.
 *
 * Both layers fill the pane and only their opacity moves, so the crossing is a
 * dissolve between two things that are already laid out — nothing reflows, and
 * neither page has to be rebuilt to come back. The hidden layer is taken out of
 * the pointer and accessibility trees rather than hidden with `display`, which
 * would throw away exactly the Monaco models and scroll offsets this exists to
 * keep warm.
 */
function Surface({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <motion.div
      animate={{ opacity: active ? 1 : 0 }}
      aria-hidden={!active}
      className={cn("absolute inset-0", active ? "z-10" : "pointer-events-none z-0")}
      initial={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex items-center gap-2 text-ui text-muted-foreground">
        <SparDots pattern="sweep" size={18} label="Opening session" />
        Opening session…
      </div>
    </div>
  );
}

function FatalError({ error }: { error: string }) {
  return (
    <div className="app-drag app-pane grid h-full place-items-center px-8">
      <div className="max-w-[32rem] rounded-xl border border-destructive/30 bg-card p-4 shadow-[var(--app-shadow-card)]">
        <p className="flex items-center gap-2 text-content font-semibold text-destructive">
          <AlertCircle className="size-4" />
          Spar could not start
        </p>
        <p className="mt-1.5 text-ui leading-[1.65] text-muted-foreground">{error}</p>
      </div>
    </div>
  );
}
