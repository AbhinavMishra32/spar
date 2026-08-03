import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Panel, PanelGroup, type ImperativePanelHandle } from "react-resizable-panels";
import { FileCode2, Flag, FolderTree, Loader2, PanelBottom, Play, RotateCcw, Send } from "lucide-react";
import type { ActiveQuestion, AttemptEvent, SessionDetail } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { fileName, languageFor, message } from "@/lib/format";
import { EDITOR_THEME_DARK, EDITOR_THEME_LIGHT } from "@/lib/monaco-theme";
import { Toolbar } from "../shell/Toolbar";
import { FileGlyph } from "../common/LanguageGlyph";
import type { AgentRun } from "../agent/agentRun";
import { AgentPanel } from "./AgentPanel";
import { PaneHandle } from "./PaneHandle";
import { FileTree } from "./FileTree";
import { FloatingFileTree } from "./FloatingFileTree";
import { ChallengeIntro } from "./ChallengeIntro";
import { ResultPanel, type ResultTab, type RunOutcome } from "./ResultPanel";

export function Workspace({
  detail,
  question,
  api,
  run,
  dark,
  onRefresh,
  onError,
  onBack,
  onExpandSidebar,
  onOpenSettings,
  onAbandon,
}: {
  detail: SessionDetail;
  question: ActiveQuestion;
  api: SparApi | undefined;
  run: AgentRun | null;
  dark: boolean;
  onRefresh(): Promise<void>;
  onError(value: string): void;
  onBack(): void;
  onExpandSidebar?: (() => void) | undefined;
  onOpenSettings?: (() => void) | undefined;
  onAbandon(reason: string): Promise<void>;
}) {
  // Editable files are what the learner switches between; read-only test files
  // belong in the Testcase panel rather than competing for editor tabs.
  const editable = question.files.filter((file) => !file.readOnly);
  const solutionFiles = editable.length ? editable : question.files;
  const multiFile = solutionFiles.length > 1;
  // Two flat files only need tabs. Nested paths are what actually justify a tree.
  const nested = solutionFiles.some((file) => file.path.split("/").length > 2);
  const showTree = multiFile && (nested || solutionFiles.length > 3);

  const [activeFile, setActiveFile] = useState(solutionFiles[0]?.path ?? "");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [testFiles, setTestFiles] = useState<Record<string, string>>({});
  const [terminal, setTerminal] = useState("");
  const [running, setRunning] = useState(false);
  // One rim sweep when a run lands, so finishing is felt without leaving a
  // second animation running against the busy state forever.
  const [settled, setSettled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome>(null);
  const [resultTab, setResultTab] = useState<ResultTab>("testcase");
  const [draft, setDraft] = useState("");
  const [treeOpen, setTreeOpen] = useState(false);
  const [givingUp, setGivingUp] = useState(false);
  const [giveUpOpen, setGiveUpOpen] = useState(false);
  const [giveUpReason, setGiveUpReason] = useState("");
  // A challenge announces itself once, when its attempt is first seen.
  const [introFor, setIntroFor] = useState<string | null>(question.attemptId);

  const dock = useRef<ImperativePanelHandle>(null);
  const sendingRef = useRef(false);
  const visibleRunId = useRef<string | null>(null);
  const terminalRef = useRef("");
  const readOnly = Boolean(question.files.find((file) => file.path === activeFile)?.readOnly);
  const agentBusy = sending || run?.status === "streaming";

  const load = useCallback(
    async (path: string) => {
      if (!api || !path) return;
      setActiveFile(path);
      setContent(await api.readWorkspaceFile({ sessionId: detail.summary.id, path }));
      setDirty(false);
    },
    [api, detail.summary.id],
  );

  useEffect(() => {
    void load(solutionFiles[0]?.path ?? "").catch((error) => onError(message(error)));
    setIntroFor(question.attemptId);
    setOutcome(null);
    setTerminal("");
    terminalRef.current="";
    visibleRunId.current=null;
    // Reloading on a new question keeps the editor from showing the previous challenge.
  }, [question.attemptId]);

  // The visible tests are the challenge's contract, so they are fetched up front
  // rather than only once the learner opens the tab.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void Promise.all(
      question.visibleTestFiles.map(async (path) => {
        const body = await api.readWorkspaceFile({ sessionId: detail.summary.id, path }).catch(() => "");
        return [path, body] as const;
      }),
    ).then((entries) => {
      if (!cancelled) setTestFiles(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [api, detail.summary.id, question.attemptId]);

  useEffect(() => {
    if (!api) return;
    return api.onRunnerEvent((event) => {
      if (event.id !== visibleRunId.current) return;
      terminalRef.current += event.data;
      setTerminal(terminalRef.current);
      if (event.stream === "exit") {
        setRunning(false);
        visibleRunId.current=null;
        void api.appendAttemptEvent({id:crypto.randomUUID(),attemptId:question.attemptId,type:"test_run",occurredAt:new Date().toISOString(),payload:{scope:"visible",exitCode:event.exitCode??-1,passed:event.exitCode===0,summary:terminalRef.current.trim().slice(-12000)},source:"runner",schemaVersion:1}).then(()=>onRefresh()).catch((error)=>onError(message(error)));
      }
    });
  }, [api,onError,onRefresh,question.attemptId]);

  const append = async (type: AttemptEvent["type"], payload: Record<string, unknown>) => {
    if (!api) return;
    await api.appendAttemptEvent({
      id: crypto.randomUUID(),
      attemptId: question.attemptId,
      type,
      occurredAt: new Date().toISOString(),
      payload,
      source: "learner",
      schemaVersion: 1,
    });
  };

  const save = async () => {
    if (!api || !activeFile || readOnly) return;
    await api.writeWorkspaceFile({ sessionId: detail.summary.id, path: activeFile, content });
    await append("file_changed", { path: activeFile, bytes: content.length });
    setDirty(false);
  };

  const runTests = async () => {
    if (!api || running || submitting) return;
    try {
      setRunning(true);
      setOutcome(null);
      setResultTab("result");
      dock.current?.expand();
      terminalRef.current="$ run visible tests\n";
      setTerminal(terminalRef.current);
      await save();
      await append("command_executed", { command: "test", language: question.language });
      const request=await api.run({ sessionId: detail.summary.id, language: question.language, command: "test", timeoutMs: 8_000 });
      visibleRunId.current=request.id;
    } catch (error) {
      setRunning(false);
      visibleRunId.current=null;
      onError(message(error));
    }
  };

  const submit = async () => {
    if (!api || running || submitting) return;
    try {
      setSubmitting(true);
      setOutcome(null);
      setResultTab("result");
      dock.current?.expand();
      await save();
      // The submission replaces the visible run rather than appending to it: two
      // TAP documents in one buffer read as one confused report.
      terminalRef.current="$ submit visible + hidden tests\n";
      setTerminal(terminalRef.current);
      const result = await api.submitAttempt({ sessionId: detail.summary.id, attemptId: question.attemptId });
      terminalRef.current=`${terminalRef.current}${result.output}${result.output.endsWith("\n")?"":"\n"}${result.summary}\n`;
      setTerminal(terminalRef.current);
      setOutcome({ kind: result.outcome, summary: result.summary });
      await onRefresh();
    } catch (error) {
      onError(message(error));
    } finally {
      setSubmitting(false);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !api || sendingRef.current || run?.status === "streaming") return;
    sendingRef.current=true;
    setSending(true);
    setDraft("");
    try {
      await api.sendAgentMessage({ sessionId: detail.summary.id, message: body });
      await onRefresh();
    } catch (error) {
      onError(message(error));
    } finally {
      sendingRef.current=false;
      setSending(false);
    }
  };

  const giveUp = async () => {
    setGivingUp(true);
    try {
      await onAbandon(giveUpReason.trim());
    } catch (error) {
      onError(message(error));
    } finally {
      setGivingUp(false);
      setGiveUpOpen(false);
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        void (event.shiftKey ? submit() : runTests());
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    addEventListener("keydown", listener);
    return () => removeEventListener("keydown", listener);
  });

  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      setSettled(true);
      const timer = setTimeout(() => setSettled(false), 900);
      wasRunning.current = running;
      return () => clearTimeout(timer);
    }
    wasRunning.current = running;
    return undefined;
  }, [running]);

  const mount: OnMount = (editor) => editor.updateOptions({ fontLigatures: true });

  return (
    <div className="work-canvas relative flex h-full min-h-0 flex-col">
      <ChallengeIntro onDone={() => setIntroFor(null)} question={introFor === question.attemptId ? question : null} />

      {giveUpOpen && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-[var(--app-window-fill)]/70 backdrop-blur-sm">
          <div className="floating-surface w-[24rem] p-4">
            <p className="text-content font-semibold">Give up on this challenge?</p>
            <p className="mt-1 text-ui leading-[1.6] text-muted-foreground">
              It ends here and the session returns to chat. What you tried is kept as evidence, so the agent can pick
              something better next.
            </p>
            <textarea
              autoFocus
              className="app-scroll mt-3 block h-16 w-full resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-ui outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-[var(--border-strong)]"
              onChange={(event) => setGiveUpReason(event.target.value)}
              placeholder="Optional — what made you stop?"
              value={giveUpReason}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="h-7 rounded-md px-2.5 text-ui text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                disabled={givingUp}
                onClick={() => setGiveUpOpen(false)}
                type="button"
              >
                Keep going
              </button>
              <button
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-destructive/15 px-2.5 text-ui font-medium text-destructive transition-colors hover:bg-destructive/25 disabled:pointer-events-none disabled:opacity-45"
                disabled={givingUp}
                onClick={() => void giveUp()}
                type="button"
              >
                {givingUp ? <Loader2 className="size-3 animate-spin" /> : <Flag className="size-3" />}
                Give up
              </button>
            </div>
          </div>
        </div>
      )}

      <Toolbar
        actions={
          <>
            <button
              className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-ui text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
              disabled={running || submitting || givingUp}
              onClick={() => setGiveUpOpen(true)}
              title="End this challenge and go back to chat"
              type="button"
            >
              <Flag className="size-3" />
              Give up
            </button>
            <button
              className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border px-2 text-ui transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-45"
              disabled={running || submitting}
              onClick={() => void runTests()}
              type="button"
            >
              {running ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
              Run
              <kbd className="font-sans text-ui-sm text-muted-foreground/70">⌘↵</kbd>
            </button>
            <button
              /* The default button, not a green one. `--success` is a muted green
                 in light mode and a *light* one in dark, so hard-coded white text
                 sat at roughly 1.4:1 against it after dark — and green here was
                 claiming an outcome the submission has not had yet. Primary is
                 the strongest emphasis this palette has, it inverts correctly with
                 the theme, and it is what the rest of the app already uses for the
                 one action a surface is about. */
              className="inline-flex h-6 items-center gap-1.5 rounded-md bg-primary px-2 text-ui font-medium text-primary-foreground shadow-[var(--app-shadow-card)] transition-colors hover:bg-primary/85 active:translate-y-px disabled:pointer-events-none disabled:opacity-45"
              disabled={running || submitting}
              onClick={() => void submit()}
              type="button"
            >
              {submitting ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
              {submitting ? "Judging…" : "Submit"}
            </button>
          </>
        }
        onBack={onBack}
        onExpandSidebar={onExpandSidebar}
        subtitle={detail.summary.title}
        title={`Challenge ${question.ordinal}`}
      />

      {/* The conversation is the surface; the working panes are sheets inset into
          it, the way a browser window insets content into its own chrome. The
          gutter is what says so — the panes carry no outer border of their own. */}
      <PanelGroup autoSaveId="spar-problem" className="min-h-0 flex-1" direction="horizontal">
        <Panel defaultSize={44} minSize={32} order={1}>
          <AgentPanel
            detail={detail}
            draft={draft}
            onDraft={setDraft}
            onOpenSettings={onOpenSettings}
            onSend={() => void send()}
            question={question}
            run={run}
            testFiles={testFiles}
          />
        </Panel>

        <PaneHandle />

        {/* Right: write the solution, then run it against the cases. */}
        <Panel minSize={30} order={2}>
          <PanelGroup className="py-2 pr-2" direction="vertical">
            <Panel minSize={20} order={1}>
              <div
                className="work-blob flex h-full min-h-0 bg-[var(--color-background-editor)]"
                data-busy={running || undefined}
                data-settled={settled || undefined}
              >
                {showTree && (
                  <div className="hairline-r flex w-44 shrink-0 flex-col bg-[var(--color-background-surface-under)]">
                    <div className="flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-ui-sm font-medium tracking-[0.06em] text-muted-foreground/70">
                      <FolderTree className="size-3.5" />
                      FILES
                    </div>
                    <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
                      <FileTree activePath={activeFile} files={question.files} onSelect={(path) => void load(path)} />
                    </div>
                  </div>
                )}

                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="hairline-b relative flex h-8 shrink-0 items-center gap-1 px-1.5">
                    {/* Docking the rail already lists every file, so the floating
                        browser only appears when the rail is not there. */}
                    {!showTree && (
                      <>
                        <button
                          className={cn(
                            "grid size-6 shrink-0 place-items-center rounded-md transition-colors",
                            treeOpen ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                          onClick={() => setTreeOpen((value) => !value)}
                          title="Browse files"
                          type="button"
                        >
                          <FolderTree className="size-3.5" />
                        </button>
                        <FloatingFileTree
                          activePath={activeFile}
                          files={question.files}
                          onClose={() => setTreeOpen(false)}
                          onSelect={(path) => void load(path)}
                          open={treeOpen}
                        />
                        <span className="mx-0.5 h-3.5 w-px shrink-0 bg-border" />
                      </>
                    )}
                    {multiFile && !showTree ? (
                      solutionFiles.map((file) => (
                        <button
                          key={file.path}
                          className={cn(
                            "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-ui transition-colors",
                            activeFile === file.path ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => void load(file.path)}
                          title={file.path}
                          type="button"
                        >
                          <FileGlyph className="shrink-0 opacity-80" fallback={FileCode2} path={file.path} />
                          {fileName(file.path)}
                          {activeFile === file.path && dirty && <span className="size-1.5 rounded-full bg-foreground/50" />}
                        </button>
                      ))
                    ) : (
                      <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-accent px-2 text-ui">
                        <FileGlyph className="text-muted-foreground" fallback={FileCode2} path={activeFile} />
                        {fileName(activeFile) || "No file"}
                        {dirty && <span className="size-1.5 rounded-full bg-foreground/50" />}
                      </span>
                    )}
                    {readOnly && <span className="text-ui-sm text-muted-foreground">read only</span>}
                    <div className="ml-auto flex items-center gap-1 pr-1">
                      <span className="mr-1 text-ui-sm text-muted-foreground/60">⌘S</span>
                      <button
                        className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        onClick={() => void load(activeFile)}
                        title="Revert to the saved file"
                        type="button"
                      >
                        <RotateCcw className="size-3.5" />
                      </button>
                      <button
                        className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        onClick={() => (dock.current?.isCollapsed() ? dock.current?.expand() : dock.current?.collapse())}
                        title="Toggle the result panel"
                        type="button"
                      >
                        <PanelBottom className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1">
                    <Editor
                      height="100%"
                      language={languageFor(activeFile)}
                      onChange={(value) => {
                        setContent(value ?? "");
                        setDirty(true);
                      }}
                      onMount={mount}
                      options={{
                        fontSize: 12.5,
                        lineHeight: 1.65,
                        fontFamily: "SF Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
                        minimap: { enabled: false },
                        padding: { top: 12, bottom: 12 },
                        scrollBeyondLastLine: false,
                        renderLineHighlight: "line",
                        smoothScrolling: true,
                        cursorBlinking: "smooth",
                        readOnly,
                        scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
                      }}
                      theme={dark ? EDITOR_THEME_DARK : EDITOR_THEME_LIGHT}
                      value={content}
                    />
                  </div>
                </div>
              </div>
            </Panel>

            <PaneHandle direction="vertical" />

            <Panel ref={dock} collapsible collapsedSize={0} defaultSize={34} minSize={14} order={2}>
              <div
                className="work-blob h-full [--shimmer-phase:-1.7s]"
                data-busy={running || undefined}
                data-settled={settled || undefined}
              >
                <ResultPanel
                  events={detail.events}
                  onClearTerminal={() => {terminalRef.current="";setTerminal("");}}
                  onCollapse={() => dock.current?.collapse()}
                  onTab={setResultTab}
                  busyLabel={submitting ? "Running the visible and hidden cases…" : undefined}
                  outcome={outcome}
                  question={question}
                  running={running || submitting}
                  tab={resultTab}
                  terminal={terminal}
                  testFiles={testFiles}
                />
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>
    </div>
  );
}
