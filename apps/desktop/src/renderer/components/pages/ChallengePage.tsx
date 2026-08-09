import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Panel, PanelGroup } from "react-resizable-panels";
import {
  ArrowRight,
  CheckCircle2,
  CornerDownRight,
  FileCode2,
  FlaskConical,
  Loader2,
  PanelBottom,
  Play,
  RotateCcw,
  ShieldCheck,
  Target,
  XCircle,
} from "lucide-react";
import type { ChallengeDetail } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { fileName, message, relativeTime, shortTime } from "@/lib/format";
import { EDITOR_THEME_DARK, EDITOR_THEME_LIGHT } from "@/lib/monaco-theme";
import { splitSolutionScaffold, withSolutionBody } from "../../../shared/solutionScaffold";
import { useAnimatedResultPanel } from "../../hooks/use-animated-result-panel";
import { Toolbar } from "../shell/Toolbar";
import { FileGlyph, LanguageGlyph, LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { ChallengeEmblem } from "../workspace/ChallengeEmblem";
import { DifficultyPill } from "../workspace/Difficulty";
import { PaneHandle } from "../workspace/PaneHandle";
import { ProblemStatement } from "../workspace/ProblemStatement";
import { ResultPanel, type ResultTab, type RunOutcome } from "../workspace/ResultPanel";
import { SparDots } from "@/components/common/SparDots";

/**
 * One challenge, on its own, away from the session that produced it.
 *
 * The distinction this page has to keep making is that practising here is not an
 * attempt. There is no agent, no submission, and nothing written to the learner's
 * evidence — the files live in a per-challenge sandbox that can be thrown away
 * and re-seeded. Everything the page says about running and checking is phrased
 * to keep that clear, because a page that looks exactly like the workspace and
 * quietly counts for nothing would be worse than not having it.
 */

const ACTION_PHRASE: Record<NonNullable<ChallengeDetail["action"]>, string> = {
  diagnose: "to find out where you actually are",
  teach: "to introduce something new",
  practise: "to get reps on it",
  transfer: "to see if it holds in a new shape",
  advance: "to push past where you were",
  retain: "to check it stuck",
};

/** What shape of work the challenge is, in the learner's words rather than the
 *  compiler's enum. */
const KIND_LABEL: Record<ChallengeDetail["kind"], string> = {
  function: "Write a function",
  module: "Build a module",
  repair: "Fix what is broken",
  extension: "Extend what is there",
  repository: "Work across a repo",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <p className="mb-2 text-ui-sm font-medium tracking-[0.06em] text-muted-foreground/70">{title}</p>
      {children}
    </section>
  );
}

/** The verdict from a run or a check, said the way the workspace says it. */
function Verdict({ outcome }: { outcome: NonNullable<RunOutcome> }) {
  const passed = outcome.kind === "passed";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-ui font-medium",
        passed ? "bg-[var(--success)]/12 text-[var(--success)]" : "bg-destructive/12 text-destructive",
      )}
    >
      {passed ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
      {passed ? "All tests passed" : "Some tests failed"}
    </span>
  );
}

function Brief({
  detail,
  onOpenSession,
}: {
  detail: ChallengeDetail;
  onOpenSession(): void;
}) {
  const { summary } = detail;

  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[62rem] px-8 pb-16 pt-8">
        <div className="flex items-start gap-4">
          <ChallengeEmblem question={summary} size={64} />
          <div className="min-w-0 flex-1">
            <p className="text-ui-sm font-medium tracking-[0.18em] text-muted-foreground/70">
              CHALLENGE {summary.ordinal}
            </p>
            <h1 className="mt-1 text-[1.3rem] font-semibold leading-[1.2] tracking-[-0.03em]">{summary.title}</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <DifficultyPill difficulty={summary.difficulty} />
              <span
                className="grid size-5 place-items-center rounded-md bg-[var(--color-background-elevated-secondary)] text-foreground/70"
                title={LANGUAGE_LABEL[summary.language]}
              >
                <LanguageGlyph className="size-3" language={summary.language} />
              </span>
              <span className="text-ui-sm text-muted-foreground">{KIND_LABEL[detail.kind]}</span>
              <span className="text-ui-sm text-muted-foreground/50">·</span>
              <span className="text-ui-sm text-muted-foreground">{relativeTime(summary.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Where it came from. A challenge only makes sense as an answer to a
            session's goal, so the session is a way back rather than a label. */}
        <button
          className="group mt-5 flex w-full items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-accent/30"
          onClick={onOpenSession}
          type="button"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-ui font-medium">{summary.sessionTitle}</p>
            <p className="mt-0.5 line-clamp-2 text-ui-sm leading-[1.55] text-muted-foreground">{detail.sessionGoal}</p>
          </div>
          <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground/70" />
        </button>

        {detail.abilityTitle && (
          <Section title="WHY THIS WAS SET">
            <div className="rounded-xl border border-border bg-[var(--color-background-elevated-secondary)] px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-ui font-medium">
                <Target className="size-3.5 text-muted-foreground" />
                {detail.abilityTitle}
                {detail.action && (
                  <span className="font-normal text-muted-foreground">— {ACTION_PHRASE[detail.action]}</span>
                )}
              </p>
              {detail.specificGap && (
                <p className="mt-1.5 text-ui leading-[1.6] text-muted-foreground">{detail.specificGap}</p>
              )}
              {detail.desiredEvidence && (
                <p className="mt-1.5 text-ui leading-[1.6] text-muted-foreground">
                  <span className="text-muted-foreground/70">Looking for: </span>
                  {detail.desiredEvidence}
                </p>
              )}
            </div>
          </Section>
        )}

        {summary.concepts.length > 0 && (
          <Section title="CONCEPTS">
            <div className="flex flex-wrap gap-1.5">
              {summary.concepts.map((concept) => (
                <span
                  key={concept.slug}
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-ui-sm",
                    concept.role === "primary"
                      ? "bg-[var(--color-background-elevated-secondary)] text-foreground/80"
                      : "border border-border text-muted-foreground",
                  )}
                  title={concept.parentTitle ? `${concept.parentTitle} › ${concept.title}` : concept.title}
                >
                  {concept.title}
                </span>
              ))}
            </div>
          </Section>
        )}

        <Section title="THE PROBLEM">
          <ProblemStatement source={detail.statement} />
        </Section>

        {(summary.replacesQuestionTitle || summary.replacedByQuestionTitle) && (
          <Section title="LINEAGE">
            <div className="flex flex-col gap-1.5">
              {summary.replacesQuestionTitle && (
                <p className="flex items-start gap-2 text-ui text-muted-foreground">
                  <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" />
                  <span>
                    Set in place of <span className="font-medium text-foreground/80">{summary.replacesQuestionTitle}</span>
                  </span>
                </p>
              )}
              {summary.replacedByQuestionTitle && (
                <p className="flex items-start gap-2 text-ui text-muted-foreground">
                  <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" />
                  <span>
                    Swapped out for <span className="font-medium text-foreground/80">{summary.replacedByQuestionTitle}</span>
                  </span>
                </p>
              )}
            </div>
          </Section>
        )}

        {detail.timeline.length > 0 && (
          <Section title="WHAT HAPPENED">
            <ol className="relative flex flex-col gap-2 pl-4">
              {/* One rail behind the whole list rather than a connector per row:
                  the rail is continuous, so the events read as one history even
                  where they came from two different attempts. */}
              <span className="absolute inset-y-1 left-[3px] w-px bg-border" />
              {detail.timeline.map((entry) => (
                <li key={entry.id} className="relative flex items-baseline gap-2">
                  <span className="absolute -left-4 top-[0.4em] size-[7px] rounded-full border border-border bg-card" />
                  <span className="min-w-0 flex-1 text-ui leading-[1.55] text-foreground/80">{entry.detail}</span>
                  <span className="shrink-0 text-ui-sm tabular-nums text-muted-foreground/60">
                    {shortTime(entry.occurredAt)}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        )}

        <p className="mt-8 flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-ui-sm leading-[1.6] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
          This is a practice copy. Running and checking here proves nothing to Spar — no attempt is recorded, your
          abilities do not move, and the session this came from is untouched.
        </p>
      </div>
    </div>
  );
}

export function ChallengePage({
  api,
  challengeId,
  dark,
  onBack,
  onError,
  onExpandSidebar,
  onOpenSession,
}: {
  api: SparApi | undefined;
  challengeId: string;
  dark: boolean;
  onBack(): void;
  onError(value: string): void;
  onExpandSidebar?: (() => void) | undefined;
  onOpenSession(sessionId: string): void;
}) {
  const [detail, setDetail] = useState<ChallengeDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [activePath, setActivePath] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [terminal, setTerminal] = useState("");
  const [running, setRunning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [settled, setSettled] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome>(null);
  const [resultTab, setResultTab] = useState<ResultTab>("testcase");

  const resultPanel = useAnimatedResultPanel();
  const visibleRunId = useRef<string | null>(null);
  const terminalRef = useRef("");

  const solutionFiles = useMemo(() => detail?.files.filter((file) => !file.readOnly) ?? [], [detail]);
  const testFiles = useMemo(
    () => Object.fromEntries((detail?.files ?? []).filter((file) => file.role === "test").map((file) => [file.path, file.content])),
    [detail],
  );
  const visibleTestFiles = useMemo(() => Object.keys(testFiles), [testFiles]);
  const busy = running || checking || resetting;

  /* One place that takes a freshly read detail and makes it the page's state, so
     the first load and a reset land in exactly the same shape. */
  const adopt = useCallback((next: ChallengeDetail, keepPath?: string) => {
    setDetail(next);
    setDrafts(Object.fromEntries(next.files.map((file) => [file.path, file.content])));
    setDirty({});
    const editable = next.files.filter((file) => !file.readOnly);
    const wanted = keepPath && editable.some((file) => file.path === keepPath) ? keepPath : editable[0]?.path ?? next.files[0]?.path ?? "";
    setActivePath(wanted);
  }, []);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setDetail(null);
    setMissing(false);
    setTerminal("");
    terminalRef.current = "";
    setOutcome(null);
    void api
      .readChallenge(challengeId)
      .then((next) => {
        if (cancelled) return;
        if (!next) {
          setMissing(true);
          return;
        }
        adopt(next);
      })
      .catch((error) => {
        if (!cancelled) onError(message(error));
      });
    return () => {
      cancelled = true;
    };
  }, [api, challengeId, adopt, onError]);

  useEffect(() => {
    if (!api) return;
    return api.onRunnerEvent((event) => {
      if (event.id !== visibleRunId.current) return;
      terminalRef.current += event.data;
      setTerminal(terminalRef.current);
      if (event.stream === "exit") {
        setRunning(false);
        visibleRunId.current = null;
        setOutcome({
          kind: event.exitCode === 0 ? "passed" : "failed",
          summary: event.exitCode === 0 ? "The visible cases passed." : "One or more visible cases failed.",
        });
      }
    });
  }, [api]);

  // One rim sweep when a run lands, matching the workspace's own settle.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      setSettled(true);
      const timer = setTimeout(() => setSettled(false), 900);
      wasBusy.current = busy;
      return () => clearTimeout(timer);
    }
    wasBusy.current = busy;
    return undefined;
  }, [busy]);

  const save = useCallback(async () => {
    if (!api || !detail) return;
    const pending = Object.keys(dirty).filter((path) => dirty[path]);
    for (const path of pending) {
      await api.writeChallengeFile({ challengeId, path, content: drafts[path] ?? "" });
    }
    if (pending.length) setDirty({});
  }, [api, challengeId, detail, dirty, drafts]);

  const run = async () => {
    if (!api || busy) return;
    try {
      setRunning(true);
      setOutcome(null);
      setResultTab("result");
      resultPanel.expand();
      terminalRef.current = "$ run visible tests\n";
      setTerminal(terminalRef.current);
      await save();
      const request = await api.runChallenge({ challengeId });
      visibleRunId.current = request.id;
    } catch (error) {
      setRunning(false);
      visibleRunId.current = null;
      onError(message(error));
    }
  };

  const check = async () => {
    if (!api || busy) return;
    try {
      setChecking(true);
      setOutcome(null);
      setResultTab("result");
      resultPanel.expand();
      await save();
      // The check replaces the visible run rather than appending to it: two TAP
      // documents in one buffer read as one confused report.
      terminalRef.current = "$ check visible + hidden tests\n";
      setTerminal(terminalRef.current);
      const result = await api.checkChallenge({ challengeId });
      terminalRef.current = `${terminalRef.current}${result.output}${result.output.endsWith("\n") ? "" : "\n"}${result.summary}\n`;
      setTerminal(terminalRef.current);
      setOutcome({ kind: result.outcome, summary: result.summary });
    } catch (error) {
      onError(message(error));
    } finally {
      setChecking(false);
    }
  };

  const reset = async () => {
    if (!api || busy) return;
    try {
      setResetting(true);
      const next = await api.resetChallenge({ challengeId });
      if (next) adopt(next, activePath);
      setOutcome(null);
      terminalRef.current = "";
      setTerminal("");
    } catch (error) {
      onError(message(error));
    } finally {
      setResetting(false);
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        void (event.shiftKey ? check() : run());
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save().catch((error) => onError(message(error)));
      }
    };
    addEventListener("keydown", listener);
    return () => removeEventListener("keydown", listener);
  });

  const mount: OnMount = (editor) => editor.updateOptions({ fontLigatures: true });
  const activeFile = detail?.files.find((file) => file.path === activePath);
  const scaffold = useMemo(
    () => detail?.source?.source === "leetcode" ? splitSolutionScaffold(drafts[activePath] ?? "") : null,
    [activePath, detail?.source?.source, drafts],
  );
  const edited = Object.values(dirty).some(Boolean) || Boolean(detail?.practiceEdited);

  if (missing) {
    return (
      <div className="flex h-full flex-col">
        <Toolbar onBack={onBack} onExpandSidebar={onExpandSidebar} title="Challenge" />
        <div className="grid flex-1 place-items-center px-8 text-center">
          <div>
            <p className="text-content font-medium">That challenge is gone</p>
            <p className="mt-1 text-ui text-muted-foreground">
              Deleting a session deletes the challenges it produced, along with their practice copies.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col">
        <Toolbar onBack={onBack} onExpandSidebar={onExpandSidebar} title="Challenge" />
        <div className="grid flex-1 place-items-center">
          <div className="flex items-center gap-2 text-ui text-muted-foreground">
            <SparDots pattern="sweep" size={18} label="Opening challenge" />
            Opening challenge…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="work-canvas relative flex h-full min-h-0 flex-col">
      <Toolbar
        actions={
          <>
            {outcome && <Verdict outcome={outcome} />}
            <button
              className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-ui text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
              disabled={busy || !edited}
              onClick={() => void reset()}
              title="Throw away your practice edits and start from the generated files"
              type="button"
            >
              {resetting ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
              Reset
            </button>
            <button
              className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border px-2 text-ui transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-45"
              disabled={busy}
              onClick={() => void run()}
              type="button"
            >
              {running ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
              Run
              <kbd className="font-sans text-ui-sm text-muted-foreground/70">⌘↵</kbd>
            </button>
            <button
              className="inline-flex h-6 items-center gap-1.5 rounded-md bg-[var(--color-background-elevated-secondary)] px-2 text-ui font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-45"
              disabled={busy || detail.hiddenTestCount === 0}
              onClick={() => void check()}
              title={
                detail.hiddenTestCount
                  ? `Run the ${detail.hiddenTestCount} hidden case${detail.hiddenTestCount === 1 ? "" : "s"} as well — for your own information only`
                  : "This challenge has no hidden cases"
              }
              type="button"
            >
              {checking ? <Loader2 className="size-3 animate-spin" /> : <FlaskConical className="size-3" />}
              {checking ? "Checking…" : "Check all"}
            </button>
          </>
        }
        onBack={onBack}
        onExpandSidebar={onExpandSidebar}
        subtitle={detail.summary.sessionTitle}
        title={`Challenge ${detail.summary.ordinal}`}
      />

      <PanelGroup autoSaveId="spar-challenge" className="min-h-0 flex-1" direction="horizontal">
        <Panel defaultSize={44} minSize={30} order={1}>
          <Brief detail={detail} onOpenSession={() => onOpenSession(detail.summary.sessionId)} />
        </Panel>

        <PaneHandle />

        <Panel minSize={30} order={2}>
          <PanelGroup className="py-2 pr-2" direction="vertical">
            <Panel minSize={20} order={1}>
              <div
                className="work-blob flex h-full min-h-0 flex-col bg-[var(--color-background-editor)]"
                data-busy={busy || undefined}
                data-settled={settled || undefined}
              >
                <div className="hairline-b flex h-8 shrink-0 items-center gap-1 px-1.5">
                  {solutionFiles.map((file) => (
                    <button
                      key={file.path}
                      className={cn(
                        "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-ui transition-colors",
                        activePath === file.path ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setActivePath(file.path)}
                      title={file.path}
                      type="button"
                    >
                      <FileGlyph className="shrink-0 opacity-80" fallback={FileCode2} path={file.path} />
                      {fileName(file.path)}
                      {dirty[file.path] && <span className="size-1.5 rounded-full bg-foreground/50" />}
                    </button>
                  ))}
                  <div className="ml-auto flex items-center gap-1 pr-1">
                    <span className="mr-1 text-ui-sm text-muted-foreground/60">⌘S</span>
                    <button
                      className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      onClick={resultPanel.toggle}
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
                    language={activeFile?.language ?? "plaintext"}
                    onChange={(value) => {
                      if (!activePath) return;
                      setDrafts((current) => ({
                        ...current,
                        [activePath]: scaffold ? withSolutionBody(scaffold, value ?? "") : value ?? "",
                      }));
                      setDirty((current) => ({ ...current, [activePath]: true }));
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
                      readOnly: Boolean(activeFile?.readOnly),
                      scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
                    }}
                    path={activePath}
                    theme={dark ? EDITOR_THEME_DARK : EDITOR_THEME_LIGHT}
                    value={scaffold?.body ?? drafts[activePath] ?? ""}
                  />
                </div>
              </div>
            </Panel>

            <PaneHandle direction="vertical" />

            <Panel
              ref={resultPanel.panel}
              className={cn(resultPanel.moving && "transition-[flex-grow] duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none")}
              collapsible
              collapsedSize={0}
              defaultSize={34}
              minSize={14}
              onCollapse={resultPanel.markCollapsed}
              onExpand={resultPanel.markExpanded}
              order={2}
            >
              <div
                className={cn(
                  "work-blob h-full [--shimmer-phase:-1.7s] transition-[translate,opacity] duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
                  resultPanel.open ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
                )}
                data-busy={busy || undefined}
                data-settled={settled || undefined}
              >
                <ResultPanel
                  onClearTerminal={() => {
                    terminalRef.current = "";
                    setTerminal("");
                  }}
                  onCollapse={resultPanel.collapse}
                  onTab={setResultTab}
                  busyLabel={checking ? "Running the visible and hidden cases…" : undefined}
                  outcome={outcome}
                  question={{ visibleTestFiles, source: detail.source }}
                  running={running || checking}
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
