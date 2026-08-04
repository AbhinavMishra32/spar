import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { SessionDetail, SessionSummary } from "@spar/domain";
import type { BootstrapData, SparApi, ThemePreference } from "../shared/api";
import { cn } from "@/lib/utils";
import { message } from "@/lib/format";
import { Sidebar, type Page, type SessionActions } from "./components/shell/Sidebar";
import { SparWordmark } from "./components/common/SparWordmark";
import { Toolbar } from "./components/shell/Toolbar";
import { CommandPalette } from "./components/common/CommandPalette";
import { HomePage } from "./components/pages/HomePage";
import { SessionsPage } from "./components/pages/SessionsPage";
import { SettingsPage } from "./components/pages/SettingsPage";
import { AbilityPage } from "./components/pages/AbilityPage";
import { ChallengesPage } from "./components/pages/ChallengesPage";
import { ConceptSheet } from "./components/concepts/ConceptSheet";
import { ChallengePage } from "./components/pages/ChallengePage";
import { AuthPage } from "./components/pages/AuthPage";
import { OnboardingPage } from "./components/pages/OnboardingPage";
import { Workspace } from "./components/workspace/Workspace";
import { PlanningView } from "./components/workspace/PlanningView";
import { ChatView } from "./components/workspace/ChatView";
import { reduceRun, type AgentRun } from "./components/agent/agentRun";
import { useSidebarWidth } from "./hooks/use-sidebar-width";
import { SparDots } from "@/components/common/SparDots";

const api: SparApi | undefined = window.spar;

/** Pages the shell puts a plain toolbar over. "workspace" and "challenge" draw
 *  their own, because both carry a back button and their own actions. */
const PAGE_TITLE: Record<Exclude<Page, "workspace" | "challenge">, string> = {
  home: "Home",
  sessions: "Sessions",
  ability: "Abilities",
  challenges: "Challenges",
  settings: "Settings",
};

export function App() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>("home");
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  /* Which challenge the standalone page is showing. Held here rather than inside
     the challenges list so navigating away and back does not silently keep a
     challenge mounted behind the list. */
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  /* Every agent turn in flight, by the session it belongs to — not just the one
     the workspace is showing. A turn is started from a session and then survives
     the learner navigating away from it, so the dashboard and the sessions list
     can both keep reporting live work on cards for sessions nobody has open. */
  const [runs, setRuns] = useState<Record<string, AgentRun>>({});
  const [palette, setPalette] = useState(false);
  /* One concept sheet for the whole app rather than one per list. A chip appears
     in challenge history, on an ability, and inside the sheet itself, and every
     one of them has to open the same surface — nesting a second dialog inside the
     first is how you end up unable to get back out of it. */
  const [concept, setConcept] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(() => localStorage.getItem("spar.sidebar") !== "hidden");
  const { width: sidebarWidth, dragging, handleProps: sidebarHandle } = useSidebarWidth();
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
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

  const openSession = useCallback(async (id: string) => {
    if (!api) return;
    setPage("workspace");
    setOpening(true);
    try {
      const next = await api.openSession(id);
      if (!next) throw new Error("That session no longer exists.");
      setDetail(next);
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

  /* Starting a session is reachable before the shell exists: the last step of
     onboarding opens the sparring session the learner picked, so this has to be
     declared above the early returns rather than beside the other page actions. */
  const start = useCallback(async (goal: string) => {
    if (!api) return;
    setError(null);
    try {
      const result = await api.createSession({ goal });
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
    await refresh();
  }, [refresh]);

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

  useEffect(() => {
    if (!api) return;
    const offAgent = api.onAgentEvent((event) => {
      /* The main process stamps the session on every event. The fallback is for
         a turn that somehow arrives unattributed: routing it to the open session
         is what this did before runs were held per session, and it keeps the
         workspace transcript working rather than silently dropping the stream. */
      const sessionId = event.sessionId ?? detailRef.current?.summary.id;
      if (!sessionId) return;

      if (event.type === "done") {
        // The summaries every card is drawn from are re-read whichever session
        // finished; only the open one needs its detail re-opened.
        if (detailRef.current?.summary.id === sessionId) {
          void openSession(sessionId).catch((cause) => setError(message(cause))).finally(() => clearRun(sessionId, event.runId));
        } else clearRun(sessionId, event.runId);
        void refresh().catch(() => undefined);
        return;
      }

      setRuns((current) => {
        const next = reduceRun(current[sessionId] ?? null, event);
        return next ? { ...current, [sessionId]: next } : current;
      });
    });

    return () => {
      offAgent();
    };
  }, [clearRun, openSession, refresh]);

  // A planning session has no challenge to show yet, so poll until one exists.
  useEffect(() => {
    if (!detail || detail.question || detail.pendingLearnerQuestion || detail.summary.status !== "planning") return;
    const timer = setInterval(() => void openSession(detail.summary.id).catch(() => undefined), 1_800);
    return () => clearInterval(timer);
  }, [detail, openSession]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        setPage("home");
        setDetail(null);
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
      if (command === "settings") {
        setPage("settings");
        setDetail(null);
      }
      if (command === "new-session") {
        setPage("home");
        setDetail(null);
      }
    });
  }, []);

  // Sync progress is pushed from the main process rather than polled at bootstrap.
  useEffect(() => {
    if (!api) return;
    return api.onSyncState((syncState) => setData((current) => (current ? { ...current, syncState } : current)));
  }, []);

  if (error && !data) return <FatalError error={error} />;
  if (!data) return <BootShell />;
  if (!data.account) return <AuthPage api={api} error={error} serverConfigured={data.serverConfigured} onAuthenticated={signedIn} onError={setError} />;
  /* Onboarding is a gate, not a page: until the profile exists the agent has no
     language, no stated weakness, and probably no provider, so there is nothing
     useful behind it. */
  if (!data.profile) {
    return (
      <OnboardingPage
        api={api}
        displayName={data.account.displayName}
        onDone={async (profile) => { setData((current) => (current ? { ...current, profile } : current)); await refresh(); }}
        onStartSession={start}
      />
    );
  }

  const navigate = (next: Page) => {
    setPage(next);
    if (next !== "workspace") setDetail(null);
    if (next !== "challenge") setChallengeId(null);
  };

  /* The sheet's header renders from this before its own read lands, so a chip
     opens instantly wherever it was clicked. */
  const conceptSummaries = new Map(data.concepts.map((entry) => [entry.slug, entry]));

  const open = (session: SessionSummary) => void openSession(session.id).catch((cause) => setError(message(cause)));
  const openChallenge = (id: string) => {
    setChallengeId(id);
    setPage("challenge");
    setDetail(null);
  };

  /* Practice is a real session, so it lands where a new session lands: the sheet
     closes, the workspace opens, and the agent's first turn is already running by
     the time it does. Anything less would make an ability page a set of links. */
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
      if (detailRef.current?.summary.id === session.id) {
        setDetail(null);
        setPage("home");
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
    clearRun(detail.summary.id);
    await openSession(detail.summary.id);
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
    setError(null);
    await refresh();
  };

  return (
    <div className="app-vibrant relative flex h-full">
      {/* Width, not display, so the vibrant layer never repaints while animating.
          The transition is dropped mid-drag, or the edge lags the cursor. */}
      <div
        className={cn("shrink-0 overflow-hidden", !dragging && "transition-[width] duration-200 ease-out")}
        style={{ width: sidebar ? sidebarWidth : 0 }}
      >
        <Sidebar
          // The name the learner gave onboarding, not the one derived from their email.
          account={{ ...data.account, displayName: data.profile.name || data.account.displayName }}
          activeSessionId={detail?.summary.id}
          onCollapse={toggleSidebar}
          onCommandPalette={() => setPalette(true)}
          onNewSession={() => navigate("home")}
          onOpenSession={open}
          onPage={navigate}
          page={page}
          sessionActions={sessionActions}
          sessions={data.sessions}
          syncState={data.syncState}
        />
      </div>

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

      <main className={cn("app-pane relative flex min-w-0 flex-1 flex-col", sidebar && "app-content-pane")}>
        {page !== "workspace" && page !== "challenge" && (
          <Toolbar onExpandSidebar={expandSidebar} title={PAGE_TITLE[page as Exclude<Page, "workspace" | "challenge">]} />
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
          {page === "home" && <HomePage api={api} busy={opening} data={data} onOpen={open} onOpenSettings={() => navigate("settings")} onStart={(goal) => void start(goal)} onViewAll={() => navigate("sessions")} runs={runs} />}
          {page === "sessions" && <SessionsPage api={api} challenges={data.challenges} onOpen={open} runs={runs} sessions={data.sessions} />}
          {page === "ability" && (
            <AbilityPage
              abilities={data.abilities}
              api={api}
              challenges={data.challenges}
              concepts={data.concepts}
              onOpenConcept={setConcept}
              onOpenSession={(sessionId) => void openSession(sessionId).catch((cause) => setError(message(cause)))}
              onPractise={practise}
            />
          )}
          {page === "challenges" && (
            <ChallengesPage
              api={api}
              challenges={data.challenges}
              concepts={data.concepts}
              onOpen={(challenge) => openChallenge(challenge.id)}
              onOpenConcept={setConcept}
            />
          )}
          {page === "challenge" && challengeId && (
            <ChallengePage
              api={api}
              challengeId={challengeId}
              dark={dark}
              onBack={() => navigate("challenges")}
              onError={setError}
              onExpandSidebar={expandSidebar}
              onOpenSession={(sessionId) => void openSession(sessionId).catch((cause) => setError(message(cause)))}
            />
          )}
          {page === "settings" && (
            <SettingsPage
              api={api}
              language={data.profile.language}
              onLanguageChange={(next) => setData((current) => (current?.profile ? { ...current, profile: { ...current.profile, language: next } } : current))}
              onSignedOut={signedOut}
              onThemeChange={changeTheme}
              theme={data.theme}
            />
          )}
          {page === "workspace" &&
            (detail ? (
              /* Session identity and workspace mode both define the mounted
                 surface. Including both keeps the same blur cross-dissolve for
                 challenge-to-challenge session navigation as well as mode changes. */
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
                      dark={dark}
                      detail={detail}
                      onAbandon={abandon}
                      onBack={() => navigate("home")}
                      onError={setError}
                      onExpandSidebar={expandSidebar}
                      onOpenSettings={() => navigate("settings")}
                      onRefresh={() => openSession(detail.summary.id)}
                      question={detail.question}
                      run={runs[detail.summary.id] ?? null}
                    />
                  ) : sessionMode(detail) === "chat" ? (
                    <ChatView
                      api={api}
                      detail={detail}
                      onBack={() => navigate("home")}
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
                      onBack={() => navigate("home")}
                      onError={setError}
                      onExpandSidebar={expandSidebar}
                      onOpenSettings={() => navigate("settings")}
                      onRefresh={() => openSession(detail.summary.id)}
                      run={runs[detail.summary.id] ?? null}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            ) : (
              <WorkspaceSkeleton />
            ))}
        </div>
      </main>

      <CommandPalette
        onNewSession={() => navigate("home")}
        onOpenChange={setPalette}
        onOpenSession={open}
        onPage={navigate}
        open={palette}
        sessions={data.sessions}
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

function BootShell() {
  return (
    <div aria-busy="true" className="app-drag app-pane grid h-full place-items-center" role="status">
      <SparWordmark className="boot-wordmark text-[3.5rem] leading-none" />
    </div>
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
