import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, History, Loader2, Map, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { SessionDetail, SessionSummary } from "@spar/domain";
import type { AgentStreamEvent, BootstrapData, SparApi, ThemePreference } from "../shared/api";
import { cn } from "@/lib/utils";
import { clockTime, message } from "@/lib/format";
import { Sidebar, type Page } from "./components/shell/Sidebar";
import { SparWordmark } from "./components/common/SparWordmark";
import { Toolbar } from "./components/shell/Toolbar";
import { CommandPalette } from "./components/common/CommandPalette";
import { EmptyState } from "./components/common/EmptyState";
import { HomePage } from "./components/pages/HomePage";
import { SessionsPage } from "./components/pages/SessionsPage";
import { SettingsPage } from "./components/pages/SettingsPage";
import { AuthPage } from "./components/pages/AuthPage";
import { Workspace } from "./components/workspace/Workspace";
import { PlanningView } from "./components/workspace/PlanningView";
import { ChatView } from "./components/workspace/ChatView";
import type { RuntimeLog } from "./components/agent/RuntimeConsole";
import { reduceRun, type AgentRun } from "./components/agent/agentRun";

const api: SparApi | undefined = window.spar;

const PAGE_TITLE: Record<Exclude<Page, "workspace">, string> = {
  home: "Home",
  sessions: "Sessions",
  ability: "Ability map",
  history: "History",
  settings: "Settings",
};

export function App() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>("home");
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [opening, setOpening] = useState(false);
  const [logs, setLogs] = useState<RuntimeLog[]>([]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [palette, setPalette] = useState(false);
  const [sidebar, setSidebar] = useState(() => localStorage.getItem("spar.sidebar") !== "hidden");
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const detailRef = useRef<SessionDetail | null>(null);
  detailRef.current = detail;

  const refresh = useCallback(async () => {
    if (!api) throw new Error("Spar must run inside its Electron desktop shell.");
    const next = await api.bootstrap();
    setData(next);
    return next;
  }, []);

  const openSession = useCallback(async (id: string) => {
    if (!api) return;
    setPage("workspace");
    setOpening(true);
    try {
      const next = await api.openSession(id);
      if (!next) throw new Error("That session no longer exists.");
      setDetail(next);
    } finally {
      setOpening(false);
    }
  }, []);

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
    const append = (entry: Omit<RuntimeLog, "id" | "at">) =>
      setLogs((current) => [...current, { ...entry, id: crypto.randomUUID(), at: clockTime() }].slice(-400));

    const offAgent = api.onAgentEvent((event) => {
      append(agentLog(event));
      setRun((current) => reduceRun(current, event));
      // Agent failures are already rendered at the exact point in the live
      // transcript. Duplicating them as a global toast obscures the trace and
      // makes one failure look like two independent problems.
      if (event.type === "done") {
        const id = detailRef.current?.summary.id;
        if (id) void openSession(id).catch((cause) => setError(message(cause)));
        void refresh().catch(() => undefined);
      }
    });

    const offRunner = api.onRunnerEvent((event) =>
      append({
        prefix: event.id.includes("validation") ? "VALIDATOR" : "RUNNER",
        message: `${event.stream} ${event.data.trim() || `exit ${event.exitCode ?? ""}`}`,
        tone: event.stream === "stderr" ? "error" : event.stream === "exit" && event.exitCode === 0 ? "success" : "muted",
      }),
    );

    return () => {
      offAgent();
      offRunner();
    };
  }, [openSession, refresh]);

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
  if (!data.account) return <AuthPage api={api} error={error} onError={setError} />;

  const navigate = (next: Page) => {
    setPage(next);
    if (next !== "workspace") setDetail(null);
  };

  const open = (session: SessionSummary) => void openSession(session.id).catch((cause) => setError(message(cause)));

  const abandon = async (reason: string) => {
    if (!api || !detail?.question) return;
    await api.abandonAttempt({
      sessionId: detail.summary.id,
      attemptId: detail.question.attemptId,
      reason,
    });
    setRun(null);
    await openSession(detail.summary.id);
    await refresh();
  };

  const start = async (goal: string) => {
    if (!api) return;
    setError(null);
    setRun(null);
    try {
      const result = await api.createSession({ goal });
      await refresh();
      await openSession(result.sessionId);
    } catch (cause) {
      setError(message(cause));
    }
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

  return (
    <div className="flex h-full">
      {/* Width, not display, so the vibrant layer never repaints while animating. */}
      <div
        className={cn(
          "shrink-0 overflow-hidden transition-[width] duration-200 ease-out",
          sidebar ? "w-[228px]" : "w-0",
        )}
      >
        <Sidebar
          account={data.account}
          activeSessionId={detail?.summary.id}
          onCollapse={toggleSidebar}
          onCommandPalette={() => setPalette(true)}
          onNewSession={() => navigate("home")}
          onOpenSession={open}
          onPage={navigate}
          page={page}
          sessions={data.sessions}
          syncState={data.syncState}
        />
      </div>

      {/* The pane's leading corners round away from the sidebar so the translucent
          material wraps around it and the two read as one continuous surface —
          but only while the sidebar is there to wrap it. Collapsed, the pane owns
          the window edge and has to meet it square. */}
      <main className={cn("app-opaque relative flex min-w-0 flex-1 flex-col", sidebar && "app-content-pane")}>
        {page !== "workspace" && (
          <Toolbar onExpandSidebar={expandSidebar} title={PAGE_TITLE[page as Exclude<Page, "workspace">]} />
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
          {page === "home" && <HomePage busy={opening} data={data} onOpen={open} onOpenSettings={() => navigate("settings")} onStart={(goal) => void start(goal)} />}
          {page === "sessions" && <SessionsPage onOpen={open} sessions={data.sessions} />}
          {page === "ability" && (
            <PagePad>
              <EmptyState
                description="Ability documents appear here only after evaluated attempts produce evidence. Nothing is inferred from a goal alone."
                icon={Map}
                title="No ability evidence yet"
              />
            </PagePad>
          )}
          {page === "history" && (
            <PagePad>
              <EmptyState
                description="Completed and paused attempts appear here with their immutable event trace."
                icon={History}
                title="No evaluated attempts yet"
              />
            </PagePad>
          )}
          {page === "settings" && <SettingsPage api={api} onThemeChange={changeTheme} theme={data.theme} />}
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
                      logs={logs}
                      onAbandon={abandon}
                      onBack={() => navigate("home")}
                      onError={setError}
                      onExpandSidebar={expandSidebar}
                      onOpenSettings={() => navigate("settings")}
                      onRefresh={() => openSession(detail.summary.id)}
                      question={detail.question}
                      run={run}
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
                      run={run}
                    />
                  ) : (
                    <PlanningView
                      api={api}
                      detail={detail}
                      logs={logs}
                      onBack={() => navigate("home")}
                      onError={setError}
                      onExpandSidebar={expandSidebar}
                      onRefresh={() => openSession(detail.summary.id)}
                      run={run}
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

function PagePad({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[52rem] px-6 py-10">{children}</div>
    </div>
  );
}

function BootShell() {
  return (
    <div className="app-drag app-opaque grid h-full place-items-center">
      <div className="flex flex-col items-center gap-3">
        <span className="grid size-9 place-items-center rounded-[10px] bg-primary text-primary-foreground">
          <Sparkles className="size-4" />
        </span>
        <span className="thinking-shimmer text-ui font-medium">Starting <SparWordmark />…</span>
      </div>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex items-center gap-2 text-ui text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Opening session…
      </div>
    </div>
  );
}

function FatalError({ error }: { error: string }) {
  return (
    <div className="app-drag app-opaque grid h-full place-items-center px-8">
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

function agentLog(event: AgentStreamEvent): Omit<RuntimeLog, "id" | "at"> {
  if (event.type === "tool") {
    return {
      prefix: "TOOL",
      message: `${event.tool ?? "unknown"} ${event.detail ?? ""}`.trim(),
      tone: event.detail?.startsWith("error") ? "error" : event.detail?.startsWith("done") ? "success" : "muted",
    };
  }
  if (event.type === "error") return { prefix: "TRAINING", message: event.text ?? "Agent turn failed", tone: "error" };
  if (event.type === "done") return { prefix: "TRAINING", message: "turn completed; durable state committed", tone: "success" };
  if (event.type === "text") return { prefix: "TRAINING", message: event.text?.trim() || "streaming response", tone: "muted" };
  return { prefix: "TRAINING", message: event.detail ?? "working", tone: "muted" };
}
