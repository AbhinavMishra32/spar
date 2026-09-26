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
  XCircle,
  Lightbulb,
  WrapText,
  Check,
  Clock,
  Flag,
  Layers,
} from "lucide-react";
import type { ChallengeDetail, RatingPoint, ReviewCardDetail, ReviewOverview } from "@spar/domain";
import type { ReviewFiled, SparApi } from "../../../shared/api";
import { CardNotes, MemoryLine, ReviewTimeline } from "../review/InsightCard";
import { RATING_LABEL, dueLabel } from "../review/schedule";
import { cn } from "@/lib/utils";
import { fileName, message, relativeTime } from "@/lib/format";
import { EDITOR_OPTIONS, EDITOR_THEME_DARK, EDITOR_THEME_LIGHT, editorFontOptions, intellisenseOptions } from "@/lib/monaco-theme";
import { useCodeFont } from "@/lib/code-font";
import { useIntellisense } from "@/hooks/use-intellisense";
import { splitSolutionScaffold, withSolutionBody } from "../../../shared/solutionScaffold";
import { SETTLE_MS, useAnimatedResultPanel } from "../../hooks/use-animated-result-panel";
import { Toolbar } from "../shell/Toolbar";
import { FileGlyph } from "../common/LanguageGlyph";
import { ChallengeBrief } from "../workspace/ChallengeBrief";
import { ChallengeHistory } from "../workspace/ChallengeHistory";
import { ChallengeRoll } from "../workspace/ChallengeRoll";
import { ChallengeStepper, type ChallengeTrail } from "../workspace/ChallengeStepper";
import type { ConceptContext } from "../concepts/ConceptChip";
import { ChallengeRatingBadge } from "../workspace/ChallengeCalibration";
import { PaneHandle } from "../workspace/PaneHandle";
import { ResultPanel, type ResultTab, type RunOutcome, type RunSuite } from "../workspace/ResultPanel";
import { ChallengeSubmissions } from "./ChallengeSubmissions";
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
  api,
  concepts,
  detail,
  focusSubmissionId,
  learnerRating,
  onOpenExternal,
  onOpenSession,
  reviewing,
  reviewVersion,
}: {
  api: SparApi | undefined;
  /** Solving this again as a review: everything that would give the answer away
   *  — the insight, past submissions, the run log — is held back. */
  reviewing: boolean;
  /** Bumped when a review of this card is filed, so the panel re-reads. */
  reviewVersion: number;
  /** What the concept chips need to preview and open. */
  concepts?: ConceptContext | undefined;
  detail: ChallengeDetail;
  /** A submission to open unfolded, when the page was reached by following a
   *  reference to one. */
  focusSubmissionId?: string | null | undefined;
  /** The learner's rating, for pitching this problem against them. */
  learnerRating?: RatingPoint | null | undefined;
  /** Opens the problem at its source in the real browser. */
  onOpenExternal?: ((url: string) => void) | undefined;
  onOpenSession(): void;
}) {
  const { summary } = detail;
  const scroller = useRef<HTMLDivElement>(null);
  const [insight, setInsight] = useState<ReviewCardDetail | null>(null);
  useEffect(() => {
    if (!api || typeof api.reviewForChallenge !== "function") return;
    let cancelled = false;
    setInsight(null);
    void api.reviewForChallenge(summary.id).then((value) => { if (!cancelled) setInsight(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [api, summary.id, reviewVersion]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The workspace's identity bar, on this page too. It used to have none —
          the ordinal and the difficulty were set into the body as a "CHALLENGE 4"
          eyebrow and a pill in a meta row, so the two views began differently even
          once their headers matched. There is no Problem/Chat switch here because
          there is no agent to switch to; what the workspace spends on that, this
          page spends on saying what shape of work it is and when it was set. */}
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <span className="shrink-0 font-mono text-ui-sm tabular-nums text-muted-foreground/70">#{summary.ordinal}</span>
        <span className="min-w-0 flex-1 truncate text-ui font-medium">{summary.title}</span>
        <span className="shrink-0 text-ui-sm text-muted-foreground">{KIND_LABEL[detail.kind]}</span>
        <span className="shrink-0 text-ui-sm text-muted-foreground/50">·</span>
        <span className="shrink-0 text-ui-sm text-muted-foreground">{relativeTime(summary.createdAt)}</span>
        <ChallengeRatingBadge
          conceptContext={concepts}
          concepts={summary.concepts}
          difficulty={summary.difficulty}
          learnerRating={learnerRating}
          source={detail.source}
        />
      </div>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto" ref={scroller}>
      {/* The same column `ProblemView` sets, to the pixel. This page had
          px-8/pt-8/pb-16 over a 62rem measure against that view's px-5/pt-5/pb-10
          over 46rem — a third more gutter, a bottom margin half again as deep, and
          a wider line — which is why stepping between a live challenge and a past
          one read as landing in a different, roomier product. The wider measure was
          justified as "this is a full window", but it never was: the brief lives in
          a 44% panel with the editor beside it, exactly as it does in the
          workspace. */}
      <ChallengeRoll
        className="mx-auto w-full max-w-[46rem] px-5 pb-10 pt-5"
        ordinal={summary.ordinal}
        scroller={scroller}
        stopId={summary.id}
      >
        <ChallengeBrief
          brief={{
            ...summary,
            abilityTitle: detail.abilityTitle,
            statement: detail.statement,
            source: detail.source,
          }}
          conceptContext={concepts}
          {...(onOpenExternal ? { onOpenExternal } : {})}
        >
        {/* Where it came from. A challenge only makes sense as an answer to a
            session's goal, so the session is a way back rather than a label. It
            sits after the statement, not before it: the workspace goes title →
            concepts → problem with nothing in between, and a card wedged into that
            run was the last thing making these two read as different pages. */}
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

        {(summary.replacesQuestionTitle || summary.replacedByQuestionTitle) && (
          <Section title="LINEAGE">
            <div className="flex flex-col gap-1.5">
              {summary.replacesQuestionTitle && (
                <p className="flex items-start gap-2 text-ui text-muted-foreground">
                  <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" />
                  <span>
                    Set in place of <span className="font-medium text-foreground">{summary.replacesQuestionTitle}</span>
                  </span>
                </p>
              )}
              {summary.replacedByQuestionTitle && (
                <p className="flex items-start gap-2 text-ui text-muted-foreground">
                  <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" />
                  <span>
                    Swapped out for <span className="font-medium text-foreground">{summary.replacedByQuestionTitle}</span>
                  </span>
                </p>
              )}
            </div>
          </Section>
        )}

        {/* Before the timeline, because it answers the question the timeline
            only contains. Coming back to a challenge, "what did I send, and what
            did it fail on" is the whole of what is being asked; the log of saves
            and runs is the long version, for when the short one is not enough. */}
        {reviewing ? (
          <p className="mt-6 flex items-start gap-2 rounded-lg border border-border bg-[var(--color-background-elevated-secondary)] px-3 py-2 text-ui leading-[1.6] text-muted-foreground">
            <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" />
            Your past submissions, the run log and what made it click are hidden until this review is filed — the point is to
            find the idea again, not to read it.
          </p>
        ) : (
          <>
            {/* What the agent took from the solve, and every time it has come
                back since. Above the submissions: the code is how it was solved
                once, this is what is meant to stay. */}
            {insight && (
              <Section title="WHAT YOU LEARNED">
                <div className="rounded-xl border border-border bg-card px-3.5 py-3">
                  <MemoryLine card={insight.card} className="mb-2" />
                  <CardNotes card={insight.card} />
                  {insight.logs.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-1 text-ui-sm font-medium tracking-[0.04em] text-muted-foreground/75">Review history</p>
                      <ReviewTimeline logs={insight.logs} />
                    </div>
                  )}
                </div>
              </Section>
            )}

            <Section title="SUBMISSIONS">
              <ChallengeSubmissions api={api} challengeId={summary.id} focusId={focusSubmissionId} />
            </Section>

            {detail.timeline.length > 0 && (
              <Section title="WHAT HAPPENED">
                <ChallengeHistory entries={detail.timeline} />
              </Section>
            )}
          </>
        )}

        <p className="mt-8 flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-ui-sm leading-[1.6] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
          {reviewing
            ? "This is a review, not an attempt. Passing the full check files it — first check and quick is Easy, several checks or a long time is Hard. Your abilities and the session are untouched."
            : "This is a practice copy. Running and checking here proves nothing to Spar — no attempt is recorded, your abilities do not move, and the session this came from is untouched."}
        </p>
        </ChallengeBrief>
      </ChallengeRoll>
      </div>
    </div>
  );
}

export function ChallengePage({
  api,
  challengeId,
  concepts,
  dark,
  focusSubmissionId,
  learnerRating,
  nav,
  onError,
  onExpandSidebar,
  onOpenSession,
  onReviewFiled,
  onReviewEnd,
  review,
  seed,
  trail,
}: {
  api: SparApi | undefined;
  challengeId: string;
  /** Set when this challenge was opened to be solved again as a spaced review. */
  review?: { cardId: string; promptId?: string | undefined } | null | undefined;
  onReviewFiled?: ((overview: ReviewOverview) => void) | undefined;
  /** Leave review mode, back to the queue — or to this card's flashcard, when
   *  the learner chose not to solve it after all. */
  onReviewEnd?: ((options?: { flashcard?: boolean }) => void) | undefined;
  /** What the concept chips need to preview and open. */
  concepts?: ConceptContext | undefined;
  dark: boolean;
  /** A submission to open unfolded and scroll to, when the page was reached by
   *  following a reference to one from the transcript. */
  focusSubmissionId?: string | null | undefined;
  /** The learner's rating, for pitching this problem against them. */
  learnerRating?: RatingPoint | null | undefined;
  /** The window's back and forward, for the toolbar to draw while the sidebar is hidden. */
  nav?: { canBack: boolean; canForward: boolean; onBack(): void; onForward(): void } | undefined;
  onError(value: string): void;
  onExpandSidebar?: (() => void) | undefined;
  onOpenSession(sessionId: string): void;
  /** The challenge, already read, when the caller had it before it navigated
   *  here. Opening used to mean mounting this page empty and then reading from
   *  disk, so every arrival began on "Opening challenge…" — a full-height spinner
   *  where a layout was about to be. With the read done first there is nothing to
   *  wait for and the page's first frame is the challenge. */
  seed?: ChallengeDetail | null | undefined;
  /** The session this challenge came from, as a series to step through. Absent
   *  when its session produced only this one. */
  trail?: ChallengeTrail | undefined;
}) {
  /* Only ever a first frame. Every later change of challenge goes through
     `adopt`, and a seed for a different challenge than the one asked for is
     ignored rather than shown. */
  const planted = seed && seed.summary.id === challengeId ? seed : null;
  const [detail, setDetail] = useState<ChallengeDetail | null>(planted);
  const [missing, setMissing] = useState(false);
  const [activePath, setActivePath] = useState(
    () => planted?.files.find((file) => !file.readOnly)?.path ?? planted?.files[0]?.path ?? "",
  );
  const [drafts, setDrafts] = useState<Record<string, string>>(
    () => Object.fromEntries((planted?.files ?? []).map((file) => [file.path, file.content])),
  );
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [terminal, setTerminal] = useState("");
  const [running, setRunning] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [intellisense, toggleIntellisense] = useIntellisense();
  const [codeFont] = useCodeFont();
  const [checking, setChecking] = useState(false);
  /* Which suite produced what the result panel is showing — held past the end of
     the run, because the panel needs it while it is showing that output. */
  const [suite, setSuite] = useState<RunSuite>("visible");
  const [resetting, setResetting] = useState(false);
  const [settled, setSettled] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome>(null);
  const [resultTab, setResultTab] = useState<ResultTab>("testcase");
  /* A re-solve review in progress: when the blank copy opened, how many full
     checks it has taken, and what was filed when it ended. */
  const [reviewRun, setReviewRun] = useState<{ key: string; startedAt: number; checks: number; filed: ReviewFiled | null; filing: boolean } | null>(null);
  const [reviewVersion, setReviewVersion] = useState(0);
  const reviewing = Boolean(review && reviewRun && !reviewRun.filed);

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
    /* The previous challenge stays on screen until the next one has arrived, and
       this is what makes stepping a transition instead of a flash. Blanking it
       here put the whole page through "Opening challenge…" between every step —
       a full-height spinner in place of a layout that was about to look almost
       identical — and it also defeated `ChallengeRoll`, which can only animate
       between two challenges and never saw a pair because null came between them.

       Nothing is shown stale: `adopt` replaces the detail in one go, so the page
       is always a consistent view of one challenge. The spinner below is now what
       it should always have been — the first-open state, when there is genuinely
       nothing to show yet. */
    setMissing(false);
    setTerminal("");
    terminalRef.current = "";
    setOutcome(null);
    if (seed && seed.summary.id === challengeId) {
      adopt(seed);
      return;
    }
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
  }, [api, challengeId, adopt, onError, seed]);

  const terminalFlush = useRef(0);
  const scheduleTerminalFlush = useCallback(() => {
    if (terminalFlush.current) return;
    terminalFlush.current = requestAnimationFrame(() => {
      terminalFlush.current = 0;
      setTerminal(terminalRef.current);
    });
  }, []);
  useEffect(() => () => { if (terminalFlush.current) cancelAnimationFrame(terminalFlush.current); }, []);

  useEffect(() => {
    if (!api) return;
    return api.onRunnerEvent((event) => {
      if (event.id !== visibleRunId.current) return;
      /* Bounded, and flushed a frame at a time. A generated sweep prints a line
         per case and a runaway loop prints without stopping; appending each
         chunk to an ever-growing string and setting state on every one of them
         is how a test run turned into gigabytes of churn. The tail is what is
         kept — the end of a log is the part that says what happened. */
      terminalRef.current = clampTail(terminalRef.current + event.data);
      scheduleTerminalFlush();
      if (event.stream === "exit") {
        setTerminal(terminalRef.current);
        setRunning(false);
        visibleRunId.current = null;
        setOutcome({
          kind: event.exitCode === 0 ? "passed" : "failed",
          summary: event.exitCode === 0 ? "The visible cases passed." : "One or more visible cases failed.",
        });
      }
    });
  }, [api, scheduleTerminalFlush]);

  // One rim sweep when a run lands, matching the workspace's own settle.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      setSettled(true);
      /* Held for exactly as long as the sweep takes; anything shorter cuts the
         light off part-way round the pane. */
      const timer = setTimeout(() => setSettled(false), SETTLE_MS);
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
      setSuite("visible");
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
      setSuite("hidden");
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
      if (reviewing && reviewRun) {
        const checks = reviewRun.checks + 1;
        if (result.outcome === "passed") void fileReview(true, checks);
        else setReviewRun((current) => (current ? { ...current, checks } : current));
      }
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

  /* Entering review mode throws the practice edits away first, so the review
     starts from the same blank files the challenge did, and starts the clock. */
  const reviewKey = review && detail?.summary.id === challengeId ? `${challengeId}:${review.cardId}:${review.promptId ?? ""}` : null;
  useEffect(() => {
    if (!reviewKey || !api) {
      if (!reviewKey) setReviewRun(null);
      return;
    }
    if (reviewRun?.key === reviewKey) return;
    setReviewRun({ key: reviewKey, startedAt: Date.now(), checks: 0, filed: null, filing: false });
    void api.resetChallenge({ challengeId }).then((next) => {
      if (next) adopt(next);
      setOutcome(null);
      terminalRef.current = "";
      setTerminal("");
    }).catch((error) => onError(message(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewKey]);

  const fileReview = async (passed: boolean, checks: number) => {
    if (!api || !review || !reviewRun || reviewRun.filed || reviewRun.filing) return;
    setReviewRun({ ...reviewRun, checks, filing: true });
    try {
      const filed = await api.resolveReview({ cardId: review.cardId, ...(review.promptId ? { promptId: review.promptId } : {}), passed, checks, elapsedMs: Date.now() - reviewRun.startedAt });
      setReviewRun((current) => (current ? { ...current, checks, filed, filing: false } : current));
      setReviewVersion((value) => value + 1);
      onReviewFiled?.(filed.overview);
    } catch (error) {
      setReviewRun((current) => (current ? { ...current, filing: false } : current));
      onError(message(error));
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

  const mountedEditor = useRef<Parameters<OnMount>[0] | null>(null);
  const mount: OnMount = (editor, monaco) => {
    mountedEditor.current = editor;
    editors.current = monaco;
  };
  const editors = useRef<Parameters<OnMount>[1] | null>(null);

  /**
   * Models belonging to challenges that are no longer open, disposed.
   *
   * Monaco keeps a model per file path for as long as the page lives, and the
   * editor component deliberately does not throw them away when `path` changes —
   * that is what preserves scroll position and undo history when you switch
   * files. It also means every challenge ever opened in this session is still
   * held in full, and for JavaScript and TypeScript the language worker holds
   * its own analysed copy of each one, which is the expensive half.
   *
   * Nothing outside this challenge's files needs to survive, so nothing does.
   */
  useEffect(() => {
    const monaco = editors.current;
    if (!monaco || !detail) return;
    const namespace = `practice/${challengeId}/`;
    const live = new Set(detail.files.map((file) => `${namespace}${file.path.replace(/^\/+/, "")}`));
    const attached = mountedEditor.current?.getModel();
    for (const model of monaco.editor.getModels()) {
      const path = model.uri.path.replace(/^\/+/, "");
      /* Only this page's practice models belong to this cleanup. The workspace
         and other Monaco surfaces keep their own models, and the editor's
         currently attached model must survive until @monaco-editor/react has
         switched it — its controlled-value effect reads that model immediately
         afterwards. */
      if (path.startsWith("practice/") && !live.has(path) && model !== attached) model.dispose();
    }
  }, [challengeId, detail]);
  const activeFile = detail?.files.find((file) => file.path === activePath);
  const scaffold = useMemo(
    () => detail?.source?.source === "leetcode" ? splitSolutionScaffold(drafts[activePath] ?? "") : null,
    [activePath, detail?.source?.source, drafts],
  );
  const edited = Object.values(dirty).some(Boolean) || Boolean(detail?.practiceEdited);

  if (missing) {
    return (
      <div className="flex h-full flex-col">
        <Toolbar nav={nav} onExpandSidebar={onExpandSidebar} title="Challenge" />
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
        <Toolbar nav={nav} onExpandSidebar={onExpandSidebar} title="Challenge" />
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
            {review && reviewRun && (
              <ReviewActions
                checks={reviewRun.checks}
                filed={reviewRun.filed}
                filing={reviewRun.filing}
                onDone={() => onReviewEnd?.()}
                onFlashcard={() => onReviewEnd?.({ flashcard: true })}
                onGiveUp={() => void fileReview(false, reviewRun.checks)}
              />
            )}
            {!reviewing && <button
              className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-ui text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
              disabled={busy || !edited}
              onClick={() => void reset()}
              title="Throw away your practice edits and start from the generated files"
              type="button"
            >
              {resetting ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
              Reset
            </button>}
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
              disabled={busy || (detail.hiddenTestCount === 0 && !reviewing)}
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
        /* What the review page knows and the panes below do not say: how many
           goes it took. Only once it took more than one — "1 attempt" over a
           challenge is a fact about nothing. */
        {...(detail.summary.attemptCount > 1 ? { facts: [{ value: `${detail.summary.attemptCount}`, label: "attempts" }] } : {})}
        nav={nav}
        onExpandSidebar={onExpandSidebar}
        /* No subtitle. The workspace dropped its grey session line from this row,
           and the session is named in full on the card under the statement — a
           second, quieter copy of it here is the kind of difference that makes two
           views of one challenge read as two pages. */
        title={review && reviewRun
          ? <ReviewTitle checks={reviewRun.checks} filed={reviewRun.filed} startedAt={reviewRun.startedAt} />
          : trail && trail.stops.length > 1
          ? <ChallengeStepper currentId={detail.summary.id} trail={trail} />
          : `Challenge ${detail.summary.ordinal}`}
      />

      {/* One saved layout with the workspace, and the workspace's constraints to
          the number. These were a group of their own — "spar-challenge", minSize
          30 against the workspace's 32 — so the two surfaces persisted two
          different splits and the brief column changed width under you every time
          a step crossed between them. It is one pane showing one challenge, so it
          is one layout: drag the divider on either surface and the other is
          already where you left it. The id is new on both sides so that neither
          old entry decides the split; what they open at is the workspace's 44. */}
      <PanelGroup autoSaveId="spar-challenge-pane" className="min-h-0 flex-1" direction="horizontal">
        <Panel defaultSize={44} minSize={32} order={1}>
          <Brief
            api={api}
            concepts={concepts}
            detail={detail}
            focusSubmissionId={focusSubmissionId}
            learnerRating={learnerRating}
            onOpenExternal={(url) => void api?.openExternal(url)}
            onOpenSession={() => onOpenSession(detail.summary.sessionId)}
            reviewing={reviewing}
            reviewVersion={reviewVersion}
          />
        </Panel>

        <PaneHandle />

        <Panel minSize={30} order={2}>
          <PanelGroup className="py-2 pr-2" direction="vertical">
            <Panel minSize={20} order={1}>
              {/* No busy rim here: the editor is where the learner is looking
                  and typing, and a breathing edge around that is the one place
                  the signal becomes a distraction. The run is reported on the
                  panel that reports runs. */}
              <div className="work-blob flex h-full min-h-0 flex-col bg-[var(--color-background-editor)]">
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
                    options={{ ...EDITOR_OPTIONS, ...intellisenseOptions(intellisense), ...editorFontOptions(codeFont), wordWrap: wordWrap ? "on" : "off", readOnly: Boolean(activeFile?.readOnly) }}
                    /* Namespaced, and never empty. `@monaco-editor/react` keys
                       models by this path and disposes the one it is leaving when
                       it changes — and the workspace's editor passes no path at
                       all, which is the model at "". Before the detail lands here
                       `activePath` is also "", so the two editors shared one model
                       and this page threw the workspace's away the moment it read
                       its first file: the live challenge was left with an empty
                       editor. These are a throwaway practice copy's files, so they
                       are addressed as such. */
                    path={`practice/${challengeId}/${activePath}`}
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
                  "work-blob h-full transition-[translate,opacity] duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
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
                  question={{ id: detail.summary.id, visibleTestFiles, hiddenTestCount: detail.hiddenTestCount, source: detail.source }}
                  running={running || checking}
                  suite={suite}
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

/**
 * A review in progress, as the toolbar's title: the clock and the checks spent,
 * where the challenge's name and stepper would be. It sits in the row the page
 * already has instead of a second strip under it — a review is a mode of this
 * page, not something laid over it. Once filed, what it was filed as.
 */
function ReviewTitle({ startedAt, checks, filed }: { startedAt: number; checks: number; filed: ReviewFiled | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (filed) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [filed]);
  if (filed) {
    const rating = filed.log.rating as 1 | 2 | 3 | 4;
    const next = `Next review ${dueLabel(filed.card.dueAt).toLowerCase()}`;
    return (
      <span className="flex min-w-0 items-center gap-2" title={`${filed.log.feedback ?? ""} ${next}.`.trim()}>
        <Check className="size-3.5 shrink-0 text-[var(--success)]" />
        <span className="shrink-0">Filed as {RATING_LABEL[rating]}</span>
        <span className="truncate text-ui font-normal text-muted-foreground">{next}</span>
      </span>
    );
  }
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <span className="flex min-w-0 items-center gap-2" title="Solve it from a blank file. Passing “Check all” files the review.">
      <Clock className="size-3.5 shrink-0 text-[var(--warning)]" />
      <span className="shrink-0">Review</span>
      <span className="shrink-0 text-ui font-normal tabular-nums text-muted-foreground">
        {clock} · {checks} check{checks === 1 ? "" : "s"}
      </span>
    </span>
  );
}

/** The review's own controls, ahead of Run and Check all. */
function ReviewActions({ checks, filed, filing, onGiveUp, onDone, onFlashcard }: { checks: number; filed: ReviewFiled | null; filing: boolean; onGiveUp(): void; onDone(): void; onFlashcard(): void }) {
  const quiet = "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-ui text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-45";
  if (filed) {
    return (
      <button className="inline-flex h-6 items-center gap-1.5 rounded-md bg-foreground px-2 text-ui font-medium text-background transition-opacity hover:opacity-90" onClick={onDone} type="button">
        Back to reviews <ArrowRight className="size-3" />
      </button>
    );
  }
  return (
    <>
      {/* Not solving it after all is not giving up: nothing is filed, and the
          card is answered instead. Only before a check, while that is still true. */}
      {checks === 0 && (
        <button className={quiet} disabled={filing} onClick={onFlashcard} title="Leave without filing and answer this card's question instead" type="button">
          <Layers className="size-3" /> Answer the card instead
        </button>
      )}
      <button className={quiet} disabled={filing} onClick={onGiveUp} title="File this review as Again — it comes back tomorrow" type="button">
        {filing ? <Loader2 className="size-3 animate-spin" /> : <Flag className="size-3" />} Give up
      </button>
      <span className="mx-1 h-4 w-px bg-border" />
    </>
  );
}

/** How much of a run's output is worth keeping in memory. Past this the head is
 *  dropped: a log's tail is the part that says what happened, and no one reads
 *  the first megabyte of a runaway loop. */
const MAX_TERMINAL = 200_000;

function clampTail(text: string): string {
  return text.length <= MAX_TERMINAL ? text : `…earlier output dropped.\n${text.slice(-MAX_TERMINAL)}`;
}
