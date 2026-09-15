import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleSlash,
  MinusCircle,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import type { ActiveQuestion, SessionDetail } from "@spar/domain";
import { cn } from "@/lib/utils";
import { fileName } from "@/lib/format";
import { declaredCases, sourcedCases, type DeclaredCase } from "@/lib/testCases";
import { knownSuiteSize, rememberSuiteSize } from "@/lib/suiteSize";
import { SparDots } from "@/components/common/SparDots";
import { blankCases, CaseDots, type CaseDot } from "./CaseDots";
import { EMPTY_REPORT, headline, parseTestOutput, stoppedAtFailure, type CaseStatus, type TestCaseResult, type TestReport } from "../../../shared/testReport";
import { AttemptsPanel } from "./AttemptsPanel";

export type ResultTab = "testcase" | "result" | "attempts";
export type RunOutcome = { kind: "passed" | "failed"; summary: string } | null;

/** Which suite a run exercised: the examples on disk, the hidden sweep behind a
 *  submission, or a judge at the problem's source. */
export type RunSuite = "visible" | "hidden" | "source";

/** How long the verdict copy takes to fade up once the grid has settled — the
 *  `duration-700` on the rail below. Kept beside the class it mirrors: if that
 *  duration changes, this is the other half of the pair. */
const VERDICT_FADE_MS = 700;

function Tab({ active, label, badge, onClick }: { active: boolean; label: string; badge?: React.ReactNode; onClick(): void }) {
  return (
    <button
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-ui transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
      {badge}
    </button>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-[var(--color-background-elevated-secondary)] px-1.5 text-ui-sm tabular-nums">{children}</span>
  );
}

function StatusMark({ status, className }: { status: CaseStatus; className?: string }) {
  if (status === "passed") return <Check className={cn("size-3 text-[var(--success)]", className)} />;
  if (status === "failed") return <X className={cn("size-3 text-destructive", className)} />;
  return <MinusCircle className={cn("size-3 text-muted-foreground/60", className)} />;
}

/**
 * The verdict, sized to the column under the dot grid rather than to a headline.
 *
 * Two words on two lines is not a compromise here — the rail is read top to
 * bottom as one thing (this suite, this verdict, this count), and the dots
 * directly above it already carry the colour, so the word is confirming what the
 * grid has said rather than announcing it.
 */
function VerdictRail({
  report,
  failedAt,
  suiteSize,
}: {
  report: TestReport;
  /** The case a fail-fast submission stopped on, or 0 if it ran to the end. */
  failedAt: number;
  suiteSize: number;
}) {
  const total = report.passed + report.failed + report.skipped || report.cases.length;
  return (
    <div className="mt-2.5">
      <p
        className={cn(
          "text-content font-semibold leading-[1.15] tracking-tight",
          report.failed ? "text-destructive" : "text-[var(--success)]",
        )}
      >
        {report.failed ? "Wrong Answer" : "Accepted"}
      </p>
      {failedAt ? (
        /* A stopped run has no pass rate to report — "2/3 passed" out of a suite
           of thirty-five is a true sentence that means something false. What it
           has instead is a position, which is the more useful number anyway: how
           far the submission got before it broke. */
        <p className="mt-1 text-ui-sm tabular-nums text-muted-foreground">
          {suiteSize > report.cases.length ? `failed on case ${failedAt} of ${suiteSize}` : `failed on case ${failedAt}`}
        </p>
      ) : (
        <p className="mt-1 text-ui-sm tabular-nums text-muted-foreground">
          {/* Counted from the totals, not from the rows on screen. A submission
              judged at the source reports 9 of 212 while naming only the one case
              it rejected, and "9/1 passed" is not a thing that can be true. */}
          {report.passed}/{total} passed
        </p>
      )}
      {!failedAt && (report.skipped > 0 || report.durationMs !== undefined) && (
        <p className="text-ui-sm tabular-nums text-muted-foreground/60">
          {[report.skipped ? `${report.skipped} skipped` : "", report.durationMs !== undefined ? `${report.durationMs.toFixed(0)} ms` : ""]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

/**
 * What the evidence column says when there is no evidence to show.
 *
 * A clean run selects no case, because there is no failure to be looking at —
 * so this column, which exists to hold the input and the two values a failure is
 * judged on, has nothing in it. Leaving it blank read as the panel having
 * stopped halfway. This is the other true thing it can say at that moment, and
 * saying it plainly is most of the reward: the whole suite, not the three cases
 * that happened to be visible.
 */
function Cleared({ report, submitted }: { report: TestReport; submitted: boolean }) {
  const total = report.passed + report.failed + report.skipped || report.cases.length;
  return (
    <div>
      <p className="text-content font-semibold leading-[1.15] tracking-tight">
        {submitted ? "Solved." : "All clear."}
      </p>
      <p className="mt-1.5 text-ui-sm leading-[1.55] text-muted-foreground">
        {submitted
          ? `Every one of the ${total} hidden cases passed${report.durationMs !== undefined ? ` in ${report.durationMs.toFixed(0)} ms` : ""}.`
          : `${total === 1 ? "The one visible case" : `All ${total} visible cases`} passed. Submit when you are ready.`}
      </p>
    </div>
  );
}

/** The case rail: the suite as a dot grid, inset to the panel's own gutter. */
function CaseRail({
  cases,
  activeId,
  onSelect,
}: {
  cases: Array<{ id: string; ordinal: number; status?: CaseStatus }>;
  activeId?: string | undefined;
  onSelect(id: string): void;
}) {
  return (
    <div className="shrink-0 px-2.5 py-2">
      <CaseDots activeId={activeId} cases={cases} onSelect={onSelect} />
    </div>
  );
}

/** A labelled value block — the expected/actual pair a failure is judged on. */
function ValueBlock({ label, value, tone }: { label: string; value: string; tone?: "expected" | "actual" }) {
  return (
    /* Hugging its value, not filling the row. A boolean assertion is the most
       common failure in the app and `false` in a pane four hundred pixels wide
       reads as a mostly-empty box with a word lost at one end — the pane grows
       to whatever it is holding and stops. */
    <div className="min-w-0 max-w-full">
      <p
        className={cn(
          "mb-1 text-ui-sm font-medium",
          tone === "actual" ? "text-destructive" : tone === "expected" ? "text-[var(--success)]" : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <pre
        className={cn(
          "app-scroll w-fit min-w-[6rem] max-w-full overflow-x-auto rounded-lg border px-2 py-1.5 font-mono text-ui-sm leading-[1.6]",
          tone === "actual"
            ? "border-destructive/25 bg-destructive/8 text-foreground/90"
            : tone === "expected"
              ? "border-[var(--success)]/25 bg-[var(--success)]/8 text-foreground/90"
              : "border-border bg-[var(--color-background-elevated-secondary)] text-foreground/85",
        )}
      >
        {value}
      </pre>
    </div>
  );
}

/**
 * The suite mid-run: one entry per case, with a verdict on the ones that have
 * reported and none on the ones still to come.
 *
 * The declared count is the grid's size wherever it is known, so the block is
 * the right shape from the first frame rather than growing a dot at a time. A
 * hidden suite has no declared count, and there the grid is exactly what has
 * come back so far — it grows, which is honest: nothing yet knows how many cases
 * there are.
 */
export function liveCases(terminal: string, declaredCount: number): CaseDot[] {
  const reported = parseTestOutput(terminal).cases;
  const total = Math.max(declaredCount, reported.length);
  return Array.from({ length: total }, (_, index) => {
    const result = reported.find((item) => item.ordinal === index + 1);
    return {
      id: result?.id ?? `pending-${index}`,
      ordinal: index + 1,
      ...(result ? { status: result.status } : {}),
    };
  });
}

/**
 * Which case the panel opens under the grid, if any.
 *
 * A failure opens itself: it is the only thing the learner is looking for, and
 * making them hunt for the one red dot among forty is the whole reason the grid
 * exists. A run with no failures opens nothing. That is not a missing feature —
 * every dot is green and the line above says 40/40, so a case detail there can
 * only restate the verdict, and what it actually did was end a clean submission
 * on "this case passed, but the test did not declare its input and expected
 * value." Clicking a dot still opens whichever case you asked for.
 */
export function caseToShow(cases: TestCaseResult[], selectedId: string): TestCaseResult | undefined {
  return cases.find((item) => item.id === selectedId) ?? cases.find((item) => item.status === "failed");
}

/** The full grid for one run. A fail-fast result contains only the prefix that
 * actually ran; the remaining positions stay present without a status so
 * `CaseDots` renders them as grey, unvisited cases. */
export function casesForGrid(report: TestReport, running: boolean, stopped: boolean, suiteSize: number): CaseDot[] {
  if (running) return blankCases(suiteSize);
  if (!stopped || suiteSize <= report.cases.length) return report.cases;
  return [...report.cases, ...blankCases(suiteSize, report.cases.length)];
}

export function ResultPanel({
  question,
  tab,
  onTab,
  testFiles,
  terminal,
  running,
  suite,
  busyLabel,
  outcome,
  events,
  attempt,
  onClearTerminal,
  onCollapse,
  onVerdictSettled,
}: {
  /* Only the visible test files are read here, and a challenge re-opened from
     history has those without having a live attempt behind it. Narrowed to what
     is used so the practice page can mount this panel without inventing an
     attempt id it has no business holding. `source` comes with it because a
     sourced problem publishes its cases and they are the cases — the generated
     test file is downstream of them. */
  /* `id` is what the remembered suite sizes are keyed by — see `suiteSize`. */
  question: Pick<ActiveQuestion, "id" | "visibleTestFiles" | "hiddenTestCount"> & Partial<Pick<ActiveQuestion, "source">>;
  tab: ResultTab;
  onTab(tab: ResultTab): void;
  testFiles: Record<string, string>;
  terminal: string;
  running: boolean;
  /** Which suite the output in the panel came from — the run in flight, or the
   *  last one to finish. It decides which suite's size the loader draws at and
   *  which one this run's count is remembered as; the examples and the hidden
   *  sweep are different grids, and a judge at the source is a third thing whose
   *  count belongs to neither and is never written down. Owned by the caller,
   *  because only the caller still knows once the run is over. */
  suite: RunSuite;
  /** What is in flight — a submission runs the hidden suite too, so saying
      "visible cases" through that wait would be a lie. */
  busyLabel?: string | undefined;
  outcome: RunOutcome;
  /** Omitted where there is no attempt to show — the tab goes with it. */
  events?: SessionDetail["events"];
  /** What the attempt is of, and when its clock started, so the replay names the
   *  challenge and times itself the same way the toolbar does. */
  attempt?: { title?: string; language?: string; startedAt?: string; completedAt?: string | null };
  onClearTerminal(): void;
  onCollapse(): void;
  /** Fires when the grid has finished its wave and the verdict copy has faded
   *  in — the moment the panel has said the result. Anything outside the panel
   *  that wants to land *after* the answer rather than on top of it waits for
   *  this instead of timing the same animation a second time. */
  onVerdictSettled?: ((settled: boolean) => void) | undefined;
}) {
  /* A sourced problem's cases travel on the challenge, already structured. The
     file parser is for challenges written as `test(…)` blocks — every generated
     one, and no sourced one — so reading a mounted C++ problem through it showed
     the learner a dump of a .cpp file where its published cases should have been. */
  const declared = useMemo(
    () => (question.source?.cases.length
      ? sourcedCases(question.source)
      : declaredCases(testFiles, question.visibleTestFiles)),
    [question.source, testFiles, question.visibleTestFiles],
  );
  const report = useMemo(
    () => reportForRun(terminal, running, outcome, declared),
    [declared, outcome, running, terminal],
  );
  /* The suite as it stands, mid-run. The runner streams a line per case, so the
     verdicts already in the buffer are real verdicts — the grid fills in as they
     arrive rather than staying blank until the process exits. */
  const live = useMemo(
    () => (running ? liveCases(terminal, declared.cases.length) : null),
    [declared.cases.length, running, terminal],
  );

  const [selectedDeclared, setSelectedDeclared] = useState("");
  const [selectedResult, setSelectedResult] = useState("");
  /* The dots own the animation clock. Result copy waits for their settled
     callback instead of guessing the same duration with a second timer. */
  const [verdictSettled, setVerdictSettled] = useState(false);
  /* Null until the learner touches it, so the default can depend on the run: a
     graded run says everything in its cases and the log is noise, while an
     ungraded one keeps the reason it did not run in the output itself — which is
     the one thing they need and must not be a click away. */
  const [rawOpen, setRawOpen] = useState<boolean | null>(null);
  const rawEnd = useRef<HTMLDivElement>(null);

  const activeDeclared = declared.cases.find((item) => item.id === selectedDeclared) ?? declared.cases[0];
  const activeResult = caseToShow(report.cases, selectedResult);
  /* Protocol results and source declarations have independent ids. Ordinal is
     their stable join key; name is a fallback for source judges that report a
     sparse subset and preserve the published case name instead. */
  const declaredForResult = activeResult
    ? declared.cases.find((item) => item.ordinal === activeResult.ordinal)
      ?? declared.cases.find((item) => item.name === activeResult.name)
    : undefined;

  const rawShown = rawOpen ?? !report.parsed;
  /* A run that came back with per-case verdicts — the only shape the panel can
     draw a grid for, and so the only one that gets the rail layout. */
  const graded = report.parsed && report.cases.length > 0;

  /* Which suite this is comes from the caller that started the run and remains
     stable after it finishes. The remembered count is compatibility for old
     challenges whose validation report did not carry measured case totals. It
     is read only at run edges because the terminal streams many renders. */
  const hiddenRun = suite === "hidden";
  const remembered = useMemo(
    () => ({ hidden: knownSuiteSize(question.id, true), visible: knownSuiteSize(question.id, false) }),
    [question.id, running, suite],
  );
  /* Written only by a finished run that reached the end of its suite.

     Both halves of that matter and both were bugs. A submission cut short at
     case three is not a three-case suite, and writing it down would teach the
     panel a number that gets smaller every time the learner fails earlier. And a
     run still in flight is not a suite of any size yet — mid-run this fired on
     every chunk of streamed output, so the count of however many cases had
     reported so far was written down as the whole suite, and the next
     submission drew a grid the size of a partial result. */
  useEffect(() => {
    /* A judge at the source reports whatever it reports — one synthetic case for
       a whole hidden suite, or two hundred for a problem with two hundred — and
       it is a count of neither of this challenge's own suites. Not written. */
    if (suite !== "source" && !running && graded && !stoppedAtFailure(terminal)) {
      rememberSuiteSize(question.id, hiddenRun, report.cases.length);
    }
  }, [graded, hiddenRun, question.id, report.cases.length, running, suite, terminal]);
  /* A local submission executes the visible contract and the private cases in
     one fail-fast process. The compiler measured the private half before the
     challenge was published; adding the declared visible half gives the exact
     grid the runner is walking, even when it stops on case one. Persisted
     challenges from before measured counts fall back to a completed run. */
  const measuredSubmissionSize = question.hiddenTestCount > 0
    ? declared.cases.length + question.hiddenTestCount
    : 0;
  const suiteSize = hiddenRun
    ? measuredSubmissionSize || remembered.hidden
    : declared.cases.length || remembered.visible;
  /* The same element either way, so the wave is not restarted by the results it
     was waiting for. While it runs the dots carry no verdicts — see `CaseDots`;
     when it stops they are the verdicts themselves. */
  /* A submission stops at its first failing case, so the cases past it have no
     verdict because they were never reached. Drawn, and drawn grey: the suite's
     shape is the learner's own bearing on how far they got, and a grid that
     shrank to the three cases that ran would hide that this was case three of
     thirty-five. The suite size was measured by the trusted reference run during
     validation, so these positions are evidence-backed rather than guessed. */
  const stopped = graded && stoppedAtFailure(terminal);
  const gridCases = useMemo(
    () => casesForGrid(report, running, stopped, suiteSize),
    [report, running, stopped, suiteSize],
  );
  /* Where it stopped, for the rail to say. */
  const failedAt = stopped ? report.cases.find((item) => item.status === "failed")?.ordinal ?? 0 : 0;
  const railed = running ? suiteSize > 0 : graded;

  /* A whole clean suite — which is the grid's cue to throw itself, and this
     column's cue to say so. Not merely "no failures": a fail-fast run that
     stopped has no failures among the cases that ran either, and it has not been
     solved. */
  const cleared = graded && report.failed === 0 && report.passed > 0 && !stopped;

  useEffect(() => {
    setSelectedResult("");
    setRawOpen(null);
    if (!terminal) setVerdictSettled(false);
  }, [terminal === ""]);

  /* Read through a ref so a caller that hands down a fresh callback each render
     does not restart the hold. The grid settles, the verdict copy takes its
     fade, and only then is the result considered said. */
  const announce = useRef(onVerdictSettled);
  announce.current = onVerdictSettled;
  useEffect(() => {
    if (!verdictSettled || running) {
      announce.current?.(false);
      return;
    }
    const timer = window.setTimeout(() => announce.current?.(true), VERDICT_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [running, verdictSettled]);

  useEffect(() => {
    if (rawShown) rawEnd.current?.scrollIntoView({ block: "end" });
  }, [terminal, rawShown]);

  return (
    <div className="flex h-full flex-col bg-[var(--color-background-surface-under)]">
      <div className="hairline-b flex h-8 shrink-0 items-center gap-1 px-2">
        <Tab
          active={tab === "testcase"}
          badge={declared.parsed ? <Count>{declared.cases.length}</Count> : undefined}
          label="Testcase"
          onClick={() => onTab("testcase")}
        />
        <Tab
          active={tab === "result"}
          badge={
            running ? (
              /* Mid-run the tab counts what has reported, so the progress is
                 readable with the panel collapsed. Until the first case comes
                 back there is nothing to count and the mark stands in. */
              live?.some((item) => item.status) ? (
                <span className="rounded-full bg-[var(--color-background-elevated-secondary)] px-1.5 text-ui-sm tabular-nums text-muted-foreground">
                  {live.filter((item) => item.status).length}/{live.length}
                </span>
              ) : (
                <SparDots pattern="wave" size={14} />
              )
            ) : report.parsed && verdictSettled ? (
              <span
                className={cn(
                  "rounded-full px-1.5 text-ui-sm tabular-nums",
                  report.failed ? "bg-destructive/15 text-destructive" : "bg-[var(--success)]/15 text-[var(--success)]",
                )}
              >
                {report.passed}/{suiteSize || report.cases.length}
              </span>
            ) : undefined
          }
          label="Test Result"
          onClick={() => onTab("result")}
        />
        {events && (
          <Tab
            active={tab === "attempts"}
            badge={events.length > 0 ? <Count>{events.length}</Count> : undefined}
            label="Attempt"
            onClick={() => onTab("attempts")}
          />
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {tab === "result" && terminal && (
            <button
              className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={onClearTerminal}
              title="Clear"
              type="button"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
          <button
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onCollapse}
            title="Hide panel"
            type="button"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      </div>

      {/* ---- Testcase: the contract, before you run anything --------------- */}
      {tab === "testcase" &&
        /* Cases first, wherever they came from. A sourced problem publishes them
           even when it exposes no local test file at all, and saying "no visible
           cases" over a problem whose examples are printed on its own page is
           false. */
        (declared.parsed && activeDeclared ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <CaseRail cases={declared.cases} activeId={activeDeclared.id} onSelect={setSelectedDeclared} />
            <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              <DeclaredDetail item={activeDeclared} source={question.source ?? null} />
            </div>
          </div>
        ) : question.visibleTestFiles.length === 0 ? (
          <div className="flex flex-1 items-center gap-2 px-3 py-3 text-ui text-muted-foreground">
            <CircleSlash className="size-3.5 shrink-0" />
            This challenge exposes no visible cases — submitting runs the hidden suite.
          </div>
        ) : (
          <div className="app-scroll min-h-0 flex-1 overflow-auto px-3 py-2">
            <p className="mb-1.5 font-mono text-ui-sm text-muted-foreground/70">
              {fileName(question.visibleTestFiles[0] ?? "")}
            </p>
            <pre className="whitespace-pre-wrap break-words font-mono text-ui-sm leading-[1.65] text-foreground/85">
              {testFiles[question.visibleTestFiles[0] ?? ""] ?? "Loading cases…"}
            </pre>
          </div>
        ))}

      {/* ---- Test Result: per-case verdicts -------------------------------- */}
      {tab === "result" && (
        <div className="flex min-h-0 flex-1 flex-col">
          {!running && !terminal ? (
            <div className="flex flex-1 items-center gap-2 px-3 py-3 text-ui text-muted-foreground/70">
              <Terminal className="size-3.5 shrink-0" />
              Run the visible cases, or submit to also run the hidden suite.
            </div>
          ) : (
            <>
              {/* The verdict band, for the runs that have no grid to hang it on.
                  A graded run puts the same words in the rail beside its dots
                  instead — see `VerdictRail`. */}
              {!running && !graded && (
                <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
                  {outcome && (
                    <span
                      className={cn(
                        "text-content font-semibold",
                        outcome.kind === "passed" ? "text-[var(--success)]" : "text-destructive",
                      )}
                    >
                      {outcome.kind === "passed" ? "Accepted" : "Wrong Answer"}
                    </span>
                  )}
                </div>
              )}

              {railed ? (
                /* Verdict left, evidence right — and the same two columns while
                   the suite is still running, which is the point.

                   This used to be two layouts: a grid with a busy line under it
                   during the run, and then a different grid in a rail once the
                   results came back. Two layouts meant two `CaseDots`, and the
                   second one mounted knowing nothing about the first — so the
                   wave the learner had been watching was thrown away at the exact
                   moment it had something to say, and a fresh one started up to
                   play its introduction over results that were already in. One
                   grid, mounted once, is what lets the run and the animation be
                   the same event: it is the same dots throughout, and `running`
                   going false is the verdict arriving rather than a new component
                   being born.

                   Stacked rather than columned, this panel also spent its whole
                   default height before it said anything: a verdict line, then a
                   square of dots, then the case name, then an Input block — and
                   the two values the learner actually came for were below the
                   fold. None of that top matter is long, it is just *tall*, and
                   it is all narrow: a dot grid is a square about seven characters
                   wide and "Wrong Answer" is two words. So it goes in a column of
                   its own and the evidence starts at the top of the panel.

                   It wraps rather than breaking at a width: on a panel too narrow
                   for both columns the detail drops under the rail, which is the
                   old stacked layout, arrived at by the layout noticing rather
                   than by a number someone guessed. */
                <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2.5">
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                    {/* Sized by the grid, floored so the verdict has a line to
                        sit on: a three-case suite is three dots wide and "Wrong
                        Answer" is not. */}
                    <div className="w-fit min-w-28 max-w-[10rem] shrink-0">
                      <CaseDots
                        activeId={activeResult?.id}
                        cases={gridCases}
                        celebrate={cleared}
                        onSettled={setVerdictSettled}
                        onSelect={running ? undefined : setSelectedResult}
                        running={running}
                      />
                      {running || !verdictSettled ? (
                        <p className="mt-2.5 text-content font-semibold leading-[1.15] tracking-tight text-muted-foreground">
                          {running ? "Testing" : "Checking results…"}
                        </p>
                      ) : (
                        <div className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-700 ease-out motion-reduce:animate-none">
                          <VerdictRail failedAt={failedAt} report={report} suiteSize={suiteSize} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-[19rem] flex-1">
                      {running ? (
                        <p className="flex items-center gap-2 text-ui text-muted-foreground">
                          {busyLabel ?? "Running the visible cases…"}
                          {live && live.some((item) => item.status) && (
                            <span className="tabular-nums text-muted-foreground/70">
                              {live.filter((item) => item.status).length}/{live.length}
                            </span>
                          )}
                        </p>
                      ) : verdictSettled ? (
                        /* Reveal the verdict and its evidence together once the
                           dots have completed their animation. */
                        <div className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-700 ease-out motion-reduce:animate-none">
                          {cleared && !activeResult && <Cleared report={report} submitted={hiddenRun} />}
                          {activeResult && <CaseDetail declared={declaredForResult} result={activeResult} />}
                          <OtherFailures activeId={activeResult?.id} cases={report.cases} declared={declared.cases} onSelect={setSelectedResult} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {!running && verdictSettled && (
                    <div className="animate-in fade-in-0 fill-mode-both duration-700 ease-out motion-reduce:animate-none">
                      <RawOutput open={rawShown} onToggle={() => setRawOpen(!rawShown)} terminal={terminal} endRef={rawEnd} />
                    </div>
                  )}
                </div>
              ) : running ? (
                /* A suite whose size nothing has ever told us — a first
                   submission against a hidden harness. There is no grid to draw
                   and none is invented: twenty-five dots that become thirty-five
                   is a lie told for a second and then corrected. */
                <div className="flex flex-1 items-center gap-2 px-3 py-3 text-ui text-muted-foreground">
                  <SparDots className="shrink-0" size={14} />
                  {busyLabel ?? "Running the visible cases…"}
                </div>
              ) : declared.parsed && activeDeclared ? (
                /* Nothing was graded — a compile error, a killed run, a judge that
                   refused the request. The cases are still known, so they are still
                   drawn: the panel says which case it is showing and that it did not
                   run, rather than replacing the whole contract with a log. */
                <>
                  <CaseRail cases={declared.cases} activeId={activeDeclared.id} onSelect={setSelectedDeclared} />
                  <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                    <p className="mb-2 flex items-start gap-1.5 text-ui-sm leading-[1.55] text-muted-foreground/80">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      {ungradedReason(terminal, true)}
                    </p>
                    <DeclaredDetail item={activeDeclared} source={question.source ?? null} />
                    <RawOutput open={rawShown} onToggle={() => setRawOpen(!rawShown)} terminal={terminal} endRef={rawEnd} />
                  </div>
                </>
              ) : (
                // No cases anywhere: nothing was graded and nothing is known to draw.
                <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2">
                  <p className="mb-1.5 flex items-center gap-1.5 text-ui-sm text-muted-foreground/70">
                    <AlertTriangle className="size-3" />
                    {ungradedReason(terminal, false)}
                  </p>
                  <pre className="whitespace-pre-wrap break-words font-mono text-ui-sm leading-[1.65] text-foreground/85">
                    {terminal}
                  </pre>
                  <div ref={rawEnd} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "attempts" && events && (
        <div className="min-h-0 flex-1">
          <AttemptsPanel events={events} {...attempt} />
        </div>
      )}
    </div>
  );
}

/**
 * Compatibility for challenges already persisted with silent assertion tests.
 * Exit zero is suite-level proof that every assertion reached by that process
 * passed. When the test source also declares the cases, joining those two facts
 * is truthful and gives old workspaces the same structured success UI as newly
 * generated harnesses. We never synthesize failures: a non-zero process does
 * not tell us which assertion failed, so inventing a per-case verdict there
 * would be false precision.
 */
export function reportForRun(
  output: string,
  running: boolean,
  outcome: RunOutcome,
  declared: ReturnType<typeof declaredCases>,
): TestReport {
  if (running) return EMPTY_REPORT;
  const parsed = parseTestOutput(output);
  if (parsed.parsed || outcome?.kind !== "passed" || !declared.parsed) return parsed;
  const cases: TestCaseResult[] = declared.cases.map((item) => ({
    id: `declared-${item.id}`,
    ordinal: item.ordinal,
    name: item.name,
    status: "passed",
  }));
  return { parsed: true, cases, passed: cases.length, failed: 0, skipped: 0 };
}

/**
 * Why a run produced no verdicts, in the learner's terms.
 *
 * Three different things end up here and they mean different things to whoever
 * is reading: a run that was killed never reached the cases, a build that failed
 * never produced a program, and a judge that refused the request never ran
 * anything at all. "No structured cases" covered all three and told them apart
 * for none of them, which sends you looking at your own code for a fault that is
 * not there.
 */
export function ungradedReason(output: string, hasCases: boolean): string {
  const stopped = stoppedAt(output);
  if (stopped) return `The run was stopped at ${stopped}, so nothing was graded — this is the output up to that point, not a verdict on your code.`;
  if (/\b(?:[A-Za-z]+Error|error):/i.test(output)) return "The run never reached the cases — it failed before they could be checked. The output says why.";
  return hasCases
    ? "No verdicts came back from this run, so these cases are shown as they stand — what was going to be checked, not what was."
    : "No case results came back from this run — showing its raw output.";
}

/** The time limit a run was killed at, when it was killed, as the runner writes it. */
function stoppedAt(output: string): string {
  const match = /Process stopped after (\d+)ms/.exec(output);
  const ms = Number(match?.[1]);
  if (!Number.isFinite(ms)) return "";
  return ms >= 1_000 ? `${Math.round(ms / 1_000)}s` : `${ms}ms`;
}

/**
 * A case as it was written, before anything ran it: the call and the answer it
 * is expected to give. Shown on the Testcase tab always, and on Test Result
 * whenever a run came back with no verdicts to put against it.
 */
function DeclaredDetail({ item, source }: { item: DeclaredCase; source: ActiveQuestion["source"] | null }) {
  return (
    <>
      <p className="text-content font-medium">{item.name}</p>
      <p className="mt-0.5 font-mono text-ui-sm text-muted-foreground/70">
        {/* A sourced case has no file behind it — it is published with the problem
            — so it is attributed to where it actually came from. */}
        {item.file ? fileName(item.file) : source ? `published with ${source.displayId}` : ""}
      </p>
      {item.assertions.length ? (
        <div className="mt-2.5 space-y-2.5">
          {item.assertions.map((assertion, index) => (
            <div className="grid grid-cols-2 gap-2" key={index}>
              <ValueBlock label="Call" value={assertion.call} />
              <ValueBlock label={assertion.method === "throws" ? "Throws" : "Expected"} value={assertion.expected || "—"} />
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-ui text-muted-foreground">
          This case asserts through a helper, so its inputs are not shown inline. Open the test file in the editor to read it
          in full.
        </p>
      )}
    </>
  );
}

export type CaseValue = { input: string; output?: string; expected: string };

/** Joins what the test declared with what the runner observed. A successful
 * equality proves actual === expected, so using the expected value as Output is
 * not a guess. A failure only uses the runner's actual value; if an old harness
 * did not report it, the UI says so rather than manufacturing one. */
/**
 * A case's name, split into what it checks and what it checks it on.
 *
 * Generated suites name a case by its intent and its arguments at once —
 * `repeated shrinking is required: target=6, values=[1, 1, 1, 1, 4]` — which is
 * a good name for a test runner's log and a bad heading for a panel. It put the
 * input in the one place the learner cannot read it as an input: inline, in
 * prose, in the title, while the two blocks underneath were labelled Output and
 * Expected. Three values, one of them disguised as a sentence.
 *
 * Split, the heading says what the case is about and the input takes its place
 * beside the answers it produced. This is also the only way a hidden case's
 * input can be shown at all: the suite is not on the learner's disk, so unless
 * the runner reported the input in its diagnostics the case's own name is the
 * only record of what it ran.
 *
 * Conservative on purpose. The tail is only treated as arguments when it looks
 * like arguments — an `=`, a bracket, a paren — so a case called `handles an
 * empty list: nothing to do` keeps its whole name.
 */
const NAMED_INPUT = /^(.*?):\s*([^:]+)$/;

export function caseLabel(name: string): { label: string; input: string } {
  const whole = name.trim();
  const match = NAMED_INPUT.exec(whole);
  const tail = match?.[2]?.trim() ?? "";
  const head = match?.[1]?.trim() ?? "";
  if (!head || !tail || !/[=[(]/.test(tail)) return { label: whole, input: "" };
  return { label: head, input: tail };
}

export function caseValues(result: TestCaseResult, declared?: DeclaredCase): CaseValue[] {
  const assertions = declared?.assertions ?? [];
  if (!assertions.length && (result.failure?.expected !== undefined || result.failure?.actual !== undefined)) {
    /* A hidden case has no declared source to read its call out of — the file is
       not on the learner's disk — so the input it reports is the only thing that
       can fill this column. Without it the panel says a hidden case failed and
       refuses to say on what, which is the one piece of information that makes
       the failure actionable. */
    return [{ input: result.failure.input || caseLabel(result.name).input || "—", expected: result.failure.expected ?? "—", ...(result.failure.actual === undefined ? {} : { output: result.failure.actual }) }];
  }
  return assertions.map((assertion, index) => ({
    input: (index === 0 ? result.failure?.input : undefined) || assertion.call || "—",
    expected: index === 0 ? (result.failure?.expected ?? assertion.expected) || "—" : assertion.expected || "—",
    ...(index === 0 && result.failure?.actual !== undefined
      ? { output: result.failure.actual }
      : result.status === "passed"
        ? { output: assertion.expected || "—" }
        : {}),
  }));
}

/**
 * The case's input, at the weight it deserves.
 *
 * Three shapes, and the value picks its own: an input nothing reported is not
 * drawn at all (an empty pane labelled "Input" holding an em dash is a row of
 * height spent saying nothing); a short one is a single monospace line under the
 * case name, read as part of the heading; a long or multi-line one gets the full
 * block, because that is the case where the input is the thing you are studying.
 */
function InputLine({ label, value }: { label: string; value: string }) {
  const empty = !value || value.trim() === "" || value.trim() === "—";
  if (empty) return null;
  if (value.length > 96 || value.includes("\n"))
    return <ValueBlock label={label} value={value} />;
  return (
    <p className="flex min-w-0 items-baseline gap-1.5 text-ui-sm">
      <span className="shrink-0 text-muted-foreground/60">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-foreground/75">
        {value}
      </span>
    </p>
  );
}

function CaseDetail({ result, declared }: { result: TestCaseResult; declared: DeclaredCase | undefined }) {
  const failure = result.failure;
  const message = headline(failure?.message);
  const { label, input: named } = caseLabel(result.name);
  const values = caseValues(result, declared);
  /* A passing hidden case reports nothing but its name, and the name still
     carries what it ran on — worth showing on its own rather than leaving the
     pane blank under the heading. */
  const shown = values.length === 0 && named ? [{ input: named, expected: "" }] : values;

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <StatusMark className="shrink-0 translate-y-0.5" status={result.status} />
        <p className="min-w-0 flex-1 text-content font-medium leading-[1.35]">{label}</p>
        {result.durationMs !== undefined && (
          <span className="shrink-0 text-ui-sm tabular-nums text-muted-foreground/70">{result.durationMs.toFixed(1)} ms</span>
        )}
      </div>

      {shown.length > 0 && (
        <div className="mt-2.5 space-y-3">
          {shown.map((value, index) => (
            <div className="space-y-2" key={index}>
              {/* Input, then what it produced against what it owed — the order
                  the learner reads a failure in, and the order every judge they
                  have ever used states one in. The input used to be a thin line
                  above the pair, on the theory that it is the given rather than a
                  result; but a given they cannot see is the reason a failure is
                  unreadable, and three labelled blocks is the shape this is
                  supposed to have. */}
              <ValueBlock label={shown.length > 1 ? `Input ${index + 1}` : "Input"} value={value.input} />
              {(value.output !== undefined || (value.expected && value.expected !== "—")) && (
                <div className="flex flex-wrap gap-x-3 gap-y-2">
                  {value.output !== undefined && (
                    <ValueBlock
                      label="Output"
                      value={value.output}
                      {...(result.status === "failed" ? { tone: "actual" as const } : {})}
                    />
                  )}
                  {value.expected && value.expected !== "—" && (
                    <ValueBlock label="Expected" tone="expected" value={value.expected} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {result.status === "skipped" && <p className="mt-1.5 text-ui text-muted-foreground">This case was skipped.</p>}

      {failure && (
        <>
          {message && <p className="mt-2 text-ui leading-[1.6] text-foreground/85">{message}</p>}
          {shown.length === 0 && (failure.expected !== undefined || failure.actual !== undefined) && (
            <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-2">
              <ValueBlock label="Output" tone="actual" value={failure.actual ?? "—"} />
              <ValueBlock label="Expected" tone="expected" value={failure.expected ?? "—"} />
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-sm text-muted-foreground/70">
            {failure.operator && <span className="font-mono">{failure.operator}</span>}
            {failure.location && <span className="font-mono">{failure.location}</span>}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The cases the panel is not currently showing: what each one checks, and what
 * it checks it on.
 *
 * The grid answers "how many, and where" and the detail answers "what happened
 * to this one" — between them nothing answers "what are the other six", which is
 * the question you actually have when seven dots are red. Six red dots are six
 * identical marks; six names are a pattern, and the pattern is usually the bug:
 * every failing case is an empty input, or every one of them is negative. The
 * inputs are on the rows for that reason — the pattern is usually in them, and
 * reading it should not cost six clicks.
 *
 * When nothing failed it lists the whole suite instead. A clean run is the one
 * result the panel used to have nothing to show for — the dots went green and
 * the column beside them stayed empty, which is a strange way to treat the only
 * outcome worth reading in full. The names are also the only place the hidden
 * suite is ever visible: forty-nine dots say a number, and forty-nine cases say
 * what was actually checked.
 *
 * It sits under the detail rather than beside it because it is also what the
 * panel's spare height is for. A short failure — `false` where `true` was wanted
 * — used to leave two thirds of the panel blank; now that space is the rest of
 * the evidence, and a suite with one failure still ends where its detail ends.
 */
function OtherFailures({
  cases,
  declared,
  activeId,
  onSelect,
}: {
  cases: TestCaseResult[];
  /** The visible suite as parsed from disk, for the inputs it declares — an
   *  example case names its intent only, and its call is in the file. */
  declared: DeclaredCase[];
  activeId: string | undefined;
  onSelect(id: string): void;
}) {
  const broken = cases.some((item) => item.status === "failed");
  const rest = cases.filter((item) => (broken ? item.status === "failed" : true) && item.id !== activeId);
  if (rest.length === 0) return null;
  return (
    <div className="mt-5">
      <p className="text-ui-sm font-medium uppercase tracking-[0.06em] text-muted-foreground/50">
        {broken
          ? `${rest.length} more ${rest.length === 1 ? "failure" : "failures"}`
          : `${rest.length} ${rest.length === 1 ? "case" : "cases"}`}
      </p>
      <div className="mt-1 -mx-1.5">
        {rest.map((item) => {
          const { label, input } = caseLabel(item.name);
          const call = input || declared.find((one) => one.ordinal === item.ordinal)?.assertions[0]?.call || "";
          return (
            <button
              className="flex w-full min-w-0 items-baseline gap-2 rounded-md px-1.5 py-[5px] text-left transition-colors hover:bg-accent"
              key={item.id}
              onClick={() => onSelect(item.id)}
              type="button"
            >
              <StatusMark className="shrink-0 translate-y-0.5 opacity-70" status={item.status} />
              <span className="min-w-0 shrink-0 max-w-[55%] truncate text-ui text-foreground/80">{label}</span>
              {call && (
                <span className="min-w-0 flex-1 truncate text-right font-mono text-ui-sm text-muted-foreground/55">{call}</span>
              )}
              {/* The verdict in its shortest honest form. A case whose failure
                  carried no values says nothing here rather than guessing. */}
              {item.failure?.actual !== undefined && item.failure.expected !== undefined && (
                <span className="shrink-0 truncate font-mono text-ui-sm text-muted-foreground/70">
                  {item.failure.actual} <span className="text-muted-foreground/40">≠</span> {item.failure.expected}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RawOutput({
  open,
  onToggle,
  terminal,
  endRef,
}: {
  open: boolean;
  onToggle(): void;
  terminal: string;
  endRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="mt-3 border-t border-border/70 pt-2">
      <button
        className="inline-flex items-center gap-1.5 text-ui-sm text-muted-foreground transition-colors hover:text-foreground"
        onClick={onToggle}
        type="button"
      >
        <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} />
        Raw output
      </button>
      {open && (
        <pre className="app-scroll mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-[var(--color-background-elevated-secondary)] px-2 py-1.5 font-mono text-ui-sm leading-[1.6] text-muted-foreground">
          {terminal}
          <span ref={endRef} />
        </pre>
      )}
    </div>
  );
}
