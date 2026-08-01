import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from "react-resizable-panels";
import { FileCode2, FolderTree, Loader2, PanelBottom, Play, RotateCcw, Send } from "lucide-react";
import type { ActiveQuestion, AttemptEvent, SessionDetail } from "@pracai/domain";
import type { PracticeApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { fileName, languageFor, message } from "@/lib/format";
import { EDITOR_THEME_DARK, EDITOR_THEME_LIGHT } from "@/lib/monaco-theme";
import { Toolbar } from "../shell/Toolbar";
import type { RuntimeLog } from "../agent/RuntimeConsole";
import type { AgentRun } from "../agent/agentRun";
import { AgentPanel } from "./AgentPanel";
import { FileTree } from "./FileTree";
import { FloatingFileTree } from "./FloatingFileTree";
import { ResultPanel, type ResultTab, type RunOutcome } from "./ResultPanel";

function Handle({ direction = "horizontal" }: { direction?: "horizontal" | "vertical" }) {
  return (
    <PanelResizeHandle
      className={cn(
        "shrink-0 bg-border transition-colors data-[resize-handle-state=drag]:bg-[var(--border-strong)] hover:bg-[var(--border-strong)]",
        direction === "horizontal" ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
      )}
    />
  );
}

export function Workspace({
  detail,
  question,
  api,
  logs,
  run,
  dark,
  onRefresh,
  onError,
  onBack,
  onExpandSidebar,
}: {
  detail: SessionDetail;
  question: ActiveQuestion;
  api: PracticeApi | undefined;
  logs: RuntimeLog[];
  run: AgentRun | null;
  dark: boolean;
  onRefresh(): Promise<void>;
  onError(value: string): void;
  onBack(): void;
  onExpandSidebar?: (() => void) | undefined;
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
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome>(null);
  const [resultTab, setResultTab] = useState<ResultTab>("testcase");
  const [draft, setDraft] = useState("");
  const [remark, setRemark] = useState("");
  const [treeOpen, setTreeOpen] = useState(false);

  const dock = useRef<ImperativePanelHandle>(null);
  const readOnly = Boolean(question.files.find((file) => file.path === activeFile)?.readOnly);
  const agentBusy = run?.status === "streaming";

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
      setTerminal((value) => value + event.data);
      if (event.stream === "exit") setRunning(false);
    });
  }, [api]);

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
      setTerminal("$ run visible tests\n");
      await save();
      await append("command_executed", { command: "test", language: question.language });
      await api.run({ sessionId: detail.summary.id, language: question.language, command: "test", timeoutMs: 8_000 });
    } catch (error) {
      setRunning(false);
      onError(message(error));
    }
  };

  const submit = async () => {
    if (!api || running || submitting) return;
    try {
      setSubmitting(true);
      setResultTab("result");
      dock.current?.expand();
      await save();
      setTerminal((value) => `${value}\n$ submit visible + hidden tests\n`);
      const result = await api.submitAttempt({ sessionId: detail.summary.id, attemptId: question.attemptId });
      setTerminal((value) => `${value}\n${result.summary}\n`);
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
    if (!body || !api) return;
    setDraft("");
    try {
      await api.sendAgentMessage({ sessionId: detail.summary.id, message: body });
      await onRefresh();
    } catch (error) {
      onError(message(error));
    }
  };

  const attachRemark = async () => {
    const body = remark.trim();
    if (!body) return;
    try {
      await append("learner_remark", { body });
      setRemark("");
      await onRefresh();
    } catch (error) {
      onError(message(error));
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

  const mount: OnMount = (editor) => editor.updateOptions({ fontLigatures: true });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar
        actions={
          <>
            {agentBusy && (
              <span className="mr-1 inline-flex items-center gap-1.5 text-ui-sm text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Agent working
              </span>
            )}
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
              className="inline-flex h-6 items-center gap-1.5 rounded-md bg-[var(--success)] px-2 text-ui font-medium text-white transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-45"
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

      <PanelGroup autoSaveId="practice-problem" className="min-h-0 flex-1" direction="horizontal">
        {/* Left: the challenge and the agent that set it, as one live stream. */}
        <Panel defaultSize={44} minSize={26} order={1}>
          <AgentPanel
            detail={detail}
            draft={draft}
            onAttachRemark={() => void attachRemark()}
            onDraft={setDraft}
            onRemark={setRemark}
            onSend={() => void send()}
            question={question}
            remark={remark}
            run={run}
          />
        </Panel>

        <Handle />

        {/* Right: write the solution, then run it against the cases. */}
        <Panel minSize={30} order={2}>
          <PanelGroup direction="vertical">
            <Panel minSize={20} order={1}>
              <div className="flex h-full min-h-0 bg-[var(--color-background-editor)]">
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
                          {fileName(file.path)}
                          {activeFile === file.path && dirty && <span className="size-1.5 rounded-full bg-foreground/50" />}
                        </button>
                      ))
                    ) : (
                      <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-accent px-2 text-ui">
                        <FileCode2 className="size-3.5 text-muted-foreground" />
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

            <Handle direction="vertical" />

            <Panel ref={dock} collapsible collapsedSize={0} defaultSize={34} minSize={14} order={2}>
              <ResultPanel
                events={detail.events}
                logs={logs}
                onClearTerminal={() => setTerminal("")}
                onCollapse={() => dock.current?.collapse()}
                onTab={setResultTab}
                outcome={outcome}
                question={question}
                running={running}
                tab={resultTab}
                terminal={terminal}
                testFiles={testFiles}
              />
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>
    </div>
  );
}
