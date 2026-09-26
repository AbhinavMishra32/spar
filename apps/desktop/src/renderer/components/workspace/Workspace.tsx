import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { ChevronDown, FileCode2, Flag, FolderTree, Languages, Lightbulb, Loader2, PanelBottom, RotateCcw, WrapText } from "lucide-react";
import type { ActiveQuestion, AttemptEvent, Language, RatingPoint, SessionDetail } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { runEvidence } from "../../../shared/testReport";
import { sourceRunOutput } from "../../../shared/sourceOutput";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { fileName, languageFor, message } from "@/lib/format";
import { EDITOR_OPTIONS, EDITOR_THEME_DARK, EDITOR_THEME_LIGHT, editorFontOptions, intellisenseOptions } from "@/lib/monaco-theme";
import { useCodeFont } from "@/lib/code-font";
import { useIntellisense } from "@/hooks/use-intellisense";
import { splitSolutionScaffold, withSolutionBody } from "../../../shared/solutionScaffold";
import { SETTLE_MS, useAnimatedResultPanel } from "../../hooks/use-animated-result-panel";
import { Toolbar } from "../shell/Toolbar";
import { ChallengeStepper, type ChallengeTrail } from "./ChallengeStepper";
import { FileTab } from "../common/FileTab";
import { FileGlyph } from "../common/LanguageGlyph";
import { LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { declaredCases, sourcedCases } from "@/lib/testCases";
import { knownSuiteSize } from "@/lib/suiteSize";
import { preferredEngine, rememberEngine, type TestEngine } from "./RunControls";
import { ChallengeActions } from "./ChallengeActions";
import type { AgentRun } from "../agent/agentRun";
import { AgentPanel } from "./AgentPanel";
import { useEditMessage } from "@/hooks/use-edit-message";
import type { ConceptContext } from "../concepts/ConceptChip";
import { PaneHandle } from "./PaneHandle";
import { FileTree } from "./FileTree";
import { FloatingFileTree } from "./FloatingFileTree";
import { introSeen, markIntroSeen } from "@/lib/introSeen";
import { ChallengeIntro } from "./ChallengeIntro";
import { ResultPanel, type ResultTab, type RunOutcome, type RunSuite } from "./ResultPanel";
import type { ComplexityCheckpointState } from "./ComplexityCheckpoint";
import { expandMentions } from "../agent/Mentions";

/** Named here rather than derived, so the buttons say "LeetCode" instead of
 *  "leetcode" and a second source is one line rather than a search. */
const SOURCE_NAME: Record<"leetcode" | "codeforces", string> = { leetcode: "LeetCode", codeforces: "Codeforces" };

export function Workspace({
  detail,
  concepts,
  learnerRating,
  question,
  api,
  run,
  dark,
  onRefresh,
  onError,
  nav,
  onExpandSidebar,
  onOpenSettings,
  onAbandon,
  trail,
  context = "training",
}: {
  detail: SessionDetail;
  /** What the problem's concept chips need to preview and open. */
  concepts?: ConceptContext | undefined;
  /** The learner's rating, for pitching the problem against them. */
  learnerRating?: RatingPoint | null | undefined;
  question: ActiveQuestion;
  api: SparApi | undefined;
  run: AgentRun | null;
  dark: boolean;
  onRefresh(): Promise<void>;
  onError(value: string): void;
  /** The window's back and forward, for the toolbar to draw while the sidebar is hidden. */
  nav?: { canBack: boolean; canForward: boolean; onBack(): void; onForward(): void } | undefined;
  onExpandSidebar?: (() => void) | undefined;
  onOpenSettings?: (() => void) | undefined;
  onAbandon(reason: string): Promise<void>;
  /** The session's own challenges, for stepping back into the ones already
   *  solved. Absent for a session with only one. */
  trail?: ChallengeTrail | undefined;
  context?: "training" | "baseline";
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
  const [wordWrap, setWordWrap] = useState(false);
  const [intellisense, toggleIntellisense] = useIntellisense();
  const [codeFont] = useCodeFont();
  // One rim sweep when a run lands, so finishing is felt without leaving a
  // second animation running against the busy state forever.
  const [settled, setSettled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /* Which suite the output in the terminal came from. Held past the end of the
     run, because the result panel needs it while it is *showing* that output —
     see its `hiddenRun` prop. */
  const [suite, setSuite] = useState<RunSuite>("visible");
  const [sending, setSending] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<Array<{id:string;body:string;createdAt:number}>>([]);
  const [outcome, setOutcome] = useState<RunOutcome>(null);
  const [resultTab, setResultTab] = useState<ResultTab>("testcase");
  const [draft, setDraft] = useState("");
  const [treeOpen, setTreeOpen] = useState(false);
  const [givingUp, setGivingUp] = useState(false);
  const [giveUpOpen, setGiveUpOpen] = useState(false);
  const [giveUpReason, setGiveUpReason] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [engine, setEngine] = useState<TestEngine>(() => preferredEngine(question.source));
  useEffect(() => setEngine(preferredEngine(question.source)), [question.id]);
  const [languageTarget, setLanguageTarget] = useState<Language | null>(null);
  const [switchingLanguage, setSwitchingLanguage] = useState(false);
  const [complexityCheckpoint, setComplexityCheckpoint] = useState<ComplexityCheckpointState | null>(null);
  /* A checkpoint the submission has earned but the panel has not finished
     announcing. The dots wave, the verdict fades up, and only then does the card
     slide in: raised at the moment the result lands, it arrived over the top of
     the answer the learner was still reading. Held here rather than timed inside
     the card, because the panel is the thing that knows when it is done. */
  const [pendingComplexity, setPendingComplexity] = useState<ComplexityCheckpointState | null>(null);
  /* A challenge announces itself once, the first time this attempt is ever
     seen — not once per mount. Coming back to a problem you are part-way
     through is not the arrival of a new problem, so it gets no reveal. */
  const [introFor, setIntroFor] = useState<string | null>(() => (introSeen(question.attemptId) ? null : question.attemptId));

  /* A submission runs tests too — it is the same work over a wider suite — so it
     lights the rim the same way. Reading only `running` here left the longest
     wait in the app with no sign of life on the panes at all. */
  const busy = running || submitting;

  const resultPanel = useAnimatedResultPanel();
  const sendingRef = useRef(false);
  const visibleRunId = useRef<string | null>(null);
  const terminalRef = useRef("");
  const readOnly = Boolean(question.files.find((file) => file.path === activeFile)?.readOnly);
  const scaffold = useMemo(
    () => question.source?.source === "leetcode" ? splitSolutionScaffold(content) : null,
    [content, question.source?.source],
  );
  /* Only a submission that passes everything completes the attempt, so this is
     true exactly when the challenge is solved. A failed submission leaves the
     attempt open to be submitted again, which is what makes solving it the
     point; the two ways out are passing and giving up. Submitting a completed
     attempt used to come back as "Active attempt not found", because the store
     only bundles an active one. */
  const graded = Boolean(question.attemptCompletedAt);
  /* What each action runs, as numbers the buttons can carry: the examples on
     disk (or published with the problem), and the hidden cases once anything has
     measured them. */
  const exampleCount = useMemo(
    () => (question.source?.cases.length ? sourcedCases(question.source) : declaredCases(testFiles, question.visibleTestFiles)).cases.length,
    [question.source, question.visibleTestFiles, testFiles],
  );
  const hiddenCount = question.source?.remoteJudge
    ? knownSuiteSize(question.id, true)
    : question.hiddenTestCount;
  const agentBusy = sending || run?.status === "streaming";
  /* Settled once graded; held while anything is running or the agent is
     already mid-reply to a conversion it was asked for. */
  const attemptLocked = running || submitting || givingUp || resetting || graded || Boolean(complexityCheckpoint);
  const languageLocked = busy || graded || switchingLanguage || (!question.source && agentBusy);
  const { undoable, edit } = useEditMessage(detail, run?.status === "streaming", onRefresh, onError);

  /* Tell the main process which file the learner is in, so the checkpoint it
     writes can reopen the session on the file they left rather than on the first
     one alphabetically. Pane geometry is not reported yet — the panels own their
     own sizes and a ratio written into a field named for a height would be a
     worse record than the documented default. */
  useEffect(() => {
    if (!api || !activeFile) return;
    void api.saveWorkspaceState({
      sessionId: detail.summary.id,
      openFiles: solutionFiles.map((file) => file.path),
      activeFile,
      layout: { sidebarWidth: 240, editorRatio: 0.6, bottomPanelHeight: 220, agentPanelOpen: true },
      visibleTestRunIds: [],
      terminalRecipe: [],
    }).catch(() => undefined);
  }, [activeFile, api, detail.summary.id, solutionFiles.map((file) => file.path).join("\0")]);

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
    setIntroFor(introSeen(question.attemptId) ? null : question.attemptId);
    setOutcome(null);
    setTerminal("");
    terminalRef.current="";
    visibleRunId.current=null;
    setComplexityCheckpoint(null);
    setPendingComplexity(null);
    // Reloading on a new question keeps the editor from showing the previous challenge.
  }, [question.attemptId]);

  useEffect(()=>{
    if(!api||question.attemptCompletedAt)return;
    let cancelled=false;
    void api.attemptComplexityStatus({sessionId:detail.summary.id,attemptId:question.attemptId}).then((saved)=>{
      if(cancelled||!saved)return;
      setComplexityCheckpoint({phase:saved.review?"reviewed":"answering",time:saved.time,space:saved.space,review:saved.review,verdict:saved.verdict});
    }).catch(()=>undefined);
    return()=>{cancelled=true;};
  },[api,detail.summary.id,question.attemptCompletedAt,question.attemptId]);

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
        void api.appendAttemptEvent({id:crypto.randomUUID(),attemptId:question.attemptId,type:"test_run",occurredAt:new Date().toISOString(),payload:{scope:"visible",exitCode:event.exitCode??-1,passed:event.exitCode===0,...runEvidence(terminalRef.current)},source:"runner",schemaVersion:1}).then(()=>onRefresh()).catch((error)=>onError(message(error)));
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
      setSuite("visible");
      setOutcome(null);
      setResultTab("result");
      resultPanel.expand();
      terminalRef.current="$ run visible tests\n";
      setTerminal(terminalRef.current);
      await save();
      await append("command_executed", { command: "test", language: question.language });
      /* No timeout named here: the main process sets it from the language, because
         a C++ run is a compile first and the window has no idea how long that is. */
      const request=await api.run({ sessionId: detail.summary.id, language: question.language, command: "test" });
      visibleRunId.current=request.id;
    } catch (error) {
      setRunning(false);
      visibleRunId.current=null;
      onError(message(error));
    }
  };

  /**
   * Running the open challenge at its own source.
   *
   * Offered only for a sourced challenge with a judge behind it, and separate
   * from Run for a reason worth stating: Run is instant, free and local, and this
   * one crosses the network to somebody else's queue. Keeping them as two buttons
   * means the learner always knows which one they pressed — and it is the only
   * way to try a problem whose shape Spar cannot build a local harness for.
   */
  const runAtSource = async () => {
    if (!api || !question.source || running || submitting) return;
    try {
      setRunning(true);
      setSuite("source");
      setOutcome(null);
      setResultTab("result");
      resultPanel.expand();
      await save();
      terminalRef.current = `$ run on ${SOURCE_NAME[question.source.source]}\n`;
      setTerminal(terminalRef.current);
      const report = await api.runAtSource({ sessionId: detail.summary.id, attemptId: question.attemptId });
      /* The judge's per-case answers, written as TAP — the same notation a local
         run produces, so the panel draws them through the same case list instead
         of dropping to raw output. The writer lives in `shared/sourceOutput` with
         a test that reads its output back through the panel's own parser. */
      terminalRef.current = `${terminalRef.current}${sourceRunOutput(report, SOURCE_NAME[question.source.source])}`;
      setTerminal(terminalRef.current);
      /* An errored run is the source failing, not the learner: it is reported and
         deliberately not shown as a verdict. */
      setOutcome(report.outcome === "errored" ? null : { kind: report.outcome, summary: report.message });
    } catch (error) {
      onError(message(error));
    } finally {
      setRunning(false);
    }
  };

  const submit = async () => {
    if (!api || running || submitting || question.attemptCompletedAt) return;
    try {
      setSubmitting(true);
      setSuite("hidden");
      setOutcome(null);
      setResultTab("result");
      resultPanel.expand();
      await save();
      // The submission replaces the visible run rather than appending to it: two
      // TAP documents in one buffer read as one confused report.
      terminalRef.current="$ submit visible + hidden tests\n";
      setTerminal(terminalRef.current);
      const result = await api.submitAttempt({ sessionId: detail.summary.id, attemptId: question.attemptId });
      terminalRef.current=`${terminalRef.current}${result.output}${result.output.endsWith("\n")?"":"\n"}${result.summary}\n`;
      setTerminal(terminalRef.current);
      setOutcome({ kind: result.outcome, summary: result.summary });
      if(result.outcome==="passed"&&result.requiresComplexity){
        setPendingComplexity({phase:"answering",time:"",space:"",review:""});
      }
      await onRefresh();
    } catch (error) {
      onError(message(error));
    } finally {
      setSubmitting(false);
    }
  };

  const reviewComplexity=async()=>{
    if(!api||!complexityCheckpoint||complexityCheckpoint.phase!=="answering")return;
    setComplexityCheckpoint({...complexityCheckpoint,phase:"reviewing"});
    try{
      const result=await api.reviewAttemptComplexity({sessionId:detail.summary.id,attemptId:question.attemptId,timeComplexity:complexityCheckpoint.time,spaceComplexity:complexityCheckpoint.space});
      setComplexityCheckpoint((current)=>current?{...current,phase:"reviewed",review:result.review,verdict:result.verdict}:current);
    }catch(error){
      setComplexityCheckpoint((current)=>current?{...current,phase:"answering"}:current);
      onError(message(error));
    }
  };

  const acknowledgeComplexity=async()=>{
    if(!api||!complexityCheckpoint||complexityCheckpoint.phase!=="reviewed")return;
    setComplexityCheckpoint({...complexityCheckpoint,phase:"acknowledging"});
    try{
      await api.acknowledgeAttemptComplexity({sessionId:detail.summary.id,attemptId:question.attemptId});
      setComplexityCheckpoint(null);
      await onRefresh();
    }catch(error){
      setComplexityCheckpoint((current)=>current?{...current,phase:"reviewed"}:current);
      onError(message(error));
    }
  };

  const send = async (answer?: string, contextQuestionId?: string) => {
    const raw = (answer ?? draft).trim();
    /* The tags in the field are words; what goes out is what they stand for. The
       optimistic bubble gets the expansion too, so the reference the learner
       just picked arrives in the transcript as a reference rather than as the
       words it was standing in for. */
    const body = expandMentions(raw);
    /* A running turn no longer refuses the message: it steers it. The guard
       that remains is against two sends racing each other, not against the
       agent being busy — being busy is exactly when a correction matters. */
    if (!body || !api || sendingRef.current) return;
    const optimistic={id:crypto.randomUUID(),body,createdAt:Date.now()};
    setOptimisticMessages((current)=>[...current,optimistic]);
    sendingRef.current=true;
    setSending(true);
    setDraft("");
    try {
      await api.sendAgentMessage({ sessionId: detail.summary.id, message: body, ...(contextQuestionId ? { contextQuestionId } : {}) });
      await onRefresh();
    } catch (error) {
      setDraft((current)=>current||raw);
      onError(message(error));
    } finally {
      setOptimisticMessages((current)=>current.filter((item)=>item.id!==optimistic.id));
      sendingRef.current=false;
      setSending(false);
    }
  };

  const answerQuestion = async (answer: string) => {
    const body = answer.trim();
    if (!body || !api || sendingRef.current) return;
    const optimistic={id:crypto.randomUUID(),body,createdAt:Date.now()};
    setOptimisticMessages((current)=>[...current,optimistic]);
    sendingRef.current = true;
    setSending(true);
    try {
      await api.answerAgentQuestion({ sessionId: detail.summary.id, answer: body });
      await onRefresh();
    } catch (error) {
      onError(message(error));
    } finally {
      setOptimisticMessages((current)=>current.filter((item)=>item.id!==optimistic.id));
      sendingRef.current = false;
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

  const resetAttempt = async () => {
    if (!api || resetting) return;
    setResetting(true);
    try {
      await api.resetAttempt({ sessionId: detail.summary.id, attemptId: question.attemptId });
      setTerminal("");
      terminalRef.current = "";
      setOutcome(null);
      resultPanel.collapse();
      await onRefresh();
      setResetOpen(false);
    } catch (error) {
      onError(message(error));
    } finally {
      setResetting(false);
    }
  };

  /* Test runs the examples wherever the learner chose to run them; the engine
     is a setting on the one action, not a second action. */
  const testExamples = () => (engine === "source" && question.source?.scratchRun ? runAtSource() : runTests());

  /**
   * Changing the challenge's language.
   *
   * A sourced problem has a starter in each language its source publishes, so it
   * is re-mounted in place — after a confirmation, because that is a fresh file
   * and a fresh attempt. A problem Spar wrote has no other-language version
   * until one is written, so the agent is asked to convert it.
   */
  const chooseLanguage = (next: Language) => {
    if (next === question.language) return;
    if (question.source) {
      setLanguageTarget(next);
      return;
    }
    void send(`Switch this challenge to ${LANGUAGE_LABEL[next]}. Convert the current challenge as it is — same problem, same cases, same difficulty — with ${LANGUAGE_LABEL[next]} starter and tests, replacing the ${LANGUAGE_LABEL[question.language]} version.`);
  };
  const switchLanguage = async () => {
    if (!api || !languageTarget) return;
    try {
      setSwitchingLanguage(true);
      await save();
      await api.switchSourceLanguage({ sessionId: detail.summary.id, attemptId: question.attemptId, language: languageTarget });
      setLanguageTarget(null);
      await onRefresh();
    } catch (error) {
      onError(message(error));
    } finally {
      setSwitchingLanguage(false);
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if(complexityCheckpoint)return;
      if (event.key === "Enter") {
        event.preventDefault();
        void (event.shiftKey ? submit() : testExamples());
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    addEventListener("keydown", listener);
    return () => removeEventListener("keydown", listener);
  });

  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      setSettled(true);
      /* Held for exactly as long as the sweep takes. Dropping it early is what
         used to cut the light off part-way round the pane. */
      const timer = setTimeout(() => setSettled(false), SETTLE_MS);
      wasBusy.current = busy;
      return () => clearTimeout(timer);
    }
    wasBusy.current = busy;
    return undefined;
  }, [busy]);

  return (
    <div className="work-canvas relative flex h-full min-h-0 flex-col">
      <ChallengeIntro
        onDone={() => { markIntroSeen(question.attemptId); setIntroFor(null); }}
        question={introFor === question.attemptId ? question : null}
      />

      <Dialog onOpenChange={(open) => { if (!open && !givingUp) setGiveUpOpen(false); }} open={giveUpOpen}>
        <DialogContent className="sm:max-w-[24rem]" showCloseButton={!givingUp}>
          <DialogHeader>
            <DialogTitle>Give up on this challenge?</DialogTitle>
            <DialogDescription>
              {context === "baseline"
                ? "This probe ends here. What you tried remains calibration evidence so Spar can choose a cleaner diagnostic next."
                : "It ends here and the session returns to chat. What you tried is kept as evidence, so the agent can pick something better next."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            className="resize-none"
            disabled={givingUp}
            onChange={(event) => setGiveUpReason(event.target.value)}
            placeholder="Optional — what made you stop?"
            value={giveUpReason}
          />
          <DialogFooter>
            <Button disabled={givingUp} onClick={() => setGiveUpOpen(false)} variant="secondary">Keep going</Button>
            <Button disabled={givingUp} onClick={() => void giveUp()} variant="destructive">
              {givingUp ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Flag data-icon="inline-start" />}
              Give up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => { if (!open && !resetting) setResetOpen(false); }} open={resetOpen}>
        <DialogContent className="sm:max-w-[24rem]" showCloseButton={!resetting}>
          <DialogHeader>
            <DialogTitle>Reset this attempt?</DialogTitle>
            <DialogDescription>
              The timer starts over and the agent will only see activity recorded after the reset. Your current files stay exactly as they are.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={resetting} onClick={() => setResetOpen(false)} variant="secondary">Cancel</Button>
            <Button disabled={resetting} onClick={() => void resetAttempt()}>
              {resetting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
              Reset attempt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => { if (!open && !switchingLanguage) setLanguageTarget(null); }} open={languageTarget !== null}>
        <DialogContent className="sm:max-w-[24rem]" showCloseButton={!switchingLanguage}>
          <DialogHeader>
            <DialogTitle>Switch to {languageTarget ? LANGUAGE_LABEL[languageTarget] : ""}?</DialogTitle>
            <DialogDescription>
              You start from {question.source ? (question.source.source === "leetcode" ? "LeetCode" : "Codeforces") : "the source"}&apos;s {languageTarget ? LANGUAGE_LABEL[languageTarget] : ""} starter with a fresh timer. Your {LANGUAGE_LABEL[question.language]} code stays in this attempt&apos;s history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={switchingLanguage} onClick={() => setLanguageTarget(null)} variant="secondary">Keep {LANGUAGE_LABEL[question.language]}</Button>
            <Button disabled={switchingLanguage} onClick={() => void switchLanguage()}>
              {switchingLanguage ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Languages data-icon="inline-start" />}
              Switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Toolbar
        actions={
          <>
            <ChallengeActions
              attemptLocked={attemptLocked}
              completedAt={question.attemptCompletedAt}
              language={question.language}
              languageLocked={languageLocked}
              onGiveUp={() => setGiveUpOpen(true)}
              loadLanguages={api && question.source ? () => api.sourceLanguages({ source: question.source!.source, slug: question.source!.slug }) : undefined}
              onLanguage={chooseLanguage}
              onRestartTimer={() => setResetOpen(true)}
              run={{
                disabled: Boolean(complexityCheckpoint) || switchingLanguage,
                engine,
                exampleCount,
                finalizing: Boolean(complexityCheckpoint),
                graded,
                hiddenCount,
                onEngine: (next) => { setEngine(next); rememberEngine(question.source, next); },
                onSubmit: () => void submit(),
                onTest: () => void testExamples(),
                running,
                submitting,
              }}
              source={question.source}
              startedAt={question.attemptStartedAt}
            />
          </>
        }
        nav={nav}
        onExpandSidebar={onExpandSidebar}
        /* Baseline keeps a subtitle because "Adaptive calibration" is the only
           thing on that toolbar saying what the run is for. A challenge does not:
           the session's own name went here, and a session is named by the sentence
           you typed to start it — "Wanna get better in sliding window python for
           interview. start from basics an…" — which is a paragraph wearing a
           label's clothes. It truncated to nothing useful, and everything it was
           standing in for is already on screen: the stepper says which challenge,
           the panel header says which problem. */
        {...(context === "baseline" ? { subtitle: `Adaptive calibration · ${question.abilityTitle}` } : {})}
        /* The stepper stands in for the title once there is more than one
           challenge to step through: it says the same thing — which challenge of
           how many — and is the way back to the rest of them. */
        title={context === "baseline"
          ? `Baseline probe ${question.ordinal}`
          : trail && trail.stops.length > 1
            ? <ChallengeStepper currentId={question.id} trail={trail} />
            : `Challenge ${question.ordinal}`}
      />

      {/* The conversation is the surface; the working panes are sheets inset into
          it, the way a browser window insets content into its own chrome. The
          gutter is what says so — the panes carry no outer border of their own. */}
      {/* Shared with the practice page, which is the same pane showing a challenge
          you are no longer on. See the note there. */}
      <PanelGroup autoSaveId="spar-challenge-pane" className="min-h-0 flex-1" direction="horizontal">
        <Panel defaultSize={44} minSize={32} order={1}>
          <AgentPanel
            answering={sending}
            concepts={concepts}
            learnerRating={learnerRating}
            complexityCheckpoint={complexityCheckpoint}
            detail={detail}
            draft={draft}
            onDraft={setDraft}
            onComplexityAcknowledge={()=>void acknowledgeComplexity()}
            onComplexityChange={(next)=>setComplexityCheckpoint((current)=>current?{...current,...next}:current)}
            onComplexityReview={()=>void reviewComplexity()}
            onOpenExternal={(url) => void api?.openExternal(url)}
            onOpenSettings={onOpenSettings}
            optimisticMessages={optimisticMessages}
            onSend={(contextQuestionId) => void send(undefined, contextQuestionId)}
            onAnswer={(answer) => void answerQuestion(answer)}
            onEditMessage={edit}
            undoable={undoable}
            question={question}
            run={run}
            testFiles={testFiles}
            trail={trail}
          />
        </Panel>

        <PaneHandle />

        {/* Right: write the solution, then run it against the cases. */}
        <Panel minSize={30} order={2}>
          <PanelGroup className="py-2 pr-2" direction="vertical">
            <Panel minSize={20} order={1}>
              {/* Deliberately no busy rim. The editor is where the learner is
                  looking and typing, and a breathing edge around the thing you
                  are reading is the one place the signal turns into a
                  distraction. The run is reported on the panel that reports
                  runs. */}
              <div className="work-blob flex h-full min-h-0 bg-[var(--color-background-editor)]">
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
                        <FileTab
                          key={file.path}
                          path={file.path}
                          active={activeFile === file.path}
                          dirty={dirty}
                          onClick={() => void load(file.path)}
                        />
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
                        aria-label="IntelliSense"
                        aria-pressed={intellisense}
                        className={cn("grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground", intellisense && "bg-accent text-foreground")}
                        onClick={toggleIntellisense}
                        title={intellisense ? "Turn off suggestions and hints" : "Turn on suggestions and hints"}
                        type="button"
                      >
                        <Lightbulb className="size-3.5" />
                      </button>
                      <button
                        aria-label="Word wrap"
                        aria-pressed={wordWrap}
                        className={cn("grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground", wordWrap && "bg-accent text-foreground")}
                        onClick={() => setWordWrap((value) => !value)}
                        title={wordWrap ? "Disable word wrap" : "Enable word wrap"}
                        type="button"
                      >
                        <WrapText className="size-3.5" />
                      </button>
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
                      language={languageFor(activeFile)}
                      onChange={(value) => {
                        setContent(scaffold ? withSolutionBody(scaffold, value ?? "") : value ?? "");
                        setDirty(true);
                      }}
                      options={{ ...EDITOR_OPTIONS, ...intellisenseOptions(intellisense), ...editorFontOptions(codeFont), wordWrap: wordWrap ? "on" : "off", readOnly }}
                      theme={dark ? EDITOR_THEME_DARK : EDITOR_THEME_LIGHT}
                      value={scaffold?.body ?? content}
                    />
                  </div>
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
                  "work-blob h-full transition-[translate,opacity] duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
                  resultPanel.open ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
                )}
                data-busy={busy || undefined}
                data-settled={settled || undefined}
              >
                <ResultPanel
                  events={detail.events}
                  onClearTerminal={() => {terminalRef.current="";setTerminal("");}}
                  onCollapse={resultPanel.collapse}
                  onTab={setResultTab}
                  attempt={{
                    title: question.title,
                    language: question.language,
                    startedAt: question.attemptStartedAt,
                    completedAt: question.attemptCompletedAt,
                  }}
                  busyLabel={submitting ? "Running the visible and hidden cases…" : undefined}
                  outcome={outcome}
                  question={question}
                  running={running || submitting}
                  suite={suite}
                  tab={resultTab}
                  terminal={terminal}
                  testFiles={testFiles}
                  onVerdictSettled={(settled)=>{
                    if(!settled||!pendingComplexity)return;
                    setComplexityCheckpoint(pendingComplexity);
                    setPendingComplexity(null);
                  }}
                />
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>
    </div>
  );
}
