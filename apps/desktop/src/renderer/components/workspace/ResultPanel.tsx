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
import { SparDots } from "@/components/common/SparDots";
import { EMPTY_REPORT, headline, parseTestOutput, type CaseStatus, type TestCaseResult, type TestReport } from "../../../shared/testReport";
import { AttemptsPanel } from "./AttemptsPanel";

export type ResultTab = "testcase" | "result" | "attempts";
export type RunOutcome = { kind: "passed" | "failed"; summary: string } | null;

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

/** The horizontal case rail. One chip per case, selected chip drives the detail below. */
function CaseRail({
  cases,
  activeId,
  onSelect,
}: {
  cases: Array<{ id: string; ordinal: number; status?: CaseStatus }>;
  activeId: string;
  onSelect(id: string): void;
}) {
  return (
    <div className="app-scroll flex shrink-0 items-center gap-1 overflow-x-auto px-2 py-1.5">
      {cases.map((item) => (
        <button
          key={item.id}
          className={cn(
            "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-ui transition-colors",
            activeId === item.id
              ? "border-[var(--border-strong)] bg-accent text-foreground"
              : "border-transparent bg-[var(--color-background-elevated-secondary)] text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onSelect(item.id)}
          type="button"
        >
          {item.status && <StatusMark status={item.status} />}
          Case {item.ordinal}
        </button>
      ))}
    </div>
  );
}

/** A labelled value block — the expected/actual pair a failure is judged on. */
function ValueBlock({ label, value, tone }: { label: string; value: string; tone?: "expected" | "actual" }) {
  return (
    <div className="min-w-0">
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
          "app-scroll overflow-x-auto rounded-lg border px-2 py-1.5 font-mono text-ui-sm leading-[1.6]",
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

export function ResultPanel({
  question,
  tab,
  onTab,
  testFiles,
  terminal,
  running,
  busyLabel,
  outcome,
  events,
  attempt,
  onClearTerminal,
  onCollapse,
}: {
  /* Only the visible test files are read here, and a challenge re-opened from
     history has those without having a live attempt behind it. Narrowed to what
     is used so the practice page can mount this panel without inventing an
     attempt id it has no business holding. `source` comes with it because a
     sourced problem publishes its cases and they are the cases — the generated
     test file is downstream of them. */
  question: Pick<ActiveQuestion, "visibleTestFiles"> & Partial<Pick<ActiveQuestion, "source">>;
  tab: ResultTab;
  onTab(tab: ResultTab): void;
  testFiles: Record<string, string>;
  terminal: string;
  running: boolean;
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

  const [selectedDeclared, setSelectedDeclared] = useState("");
  const [selectedResult, setSelectedResult] = useState("");
  /* Null until the learner touches it, so the default can depend on the run: a
     graded run says everything in its cases and the log is noise, while an
     ungraded one keeps the reason it did not run in the output itself — which is
     the one thing they need and must not be a click away. */
  const [rawOpen, setRawOpen] = useState<boolean | null>(null);
  const rawEnd = useRef<HTMLDivElement>(null);

  const activeDeclared = declared.cases.find((item) => item.id === selectedDeclared) ?? declared.cases[0];
  // A failure is what the learner needs; select it rather than making them hunt.
  const firstFailure = report.cases.find((item) => item.status === "failed");
  const activeResult =
    report.cases.find((item) => item.id === selectedResult) ?? firstFailure ?? report.cases[0];
  /* Protocol results and source declarations have independent ids. Ordinal is
     their stable join key; name is a fallback for source judges that report a
     sparse subset and preserve the published case name instead. */
  const declaredForResult = activeResult
    ? declared.cases.find((item) => item.ordinal === activeResult.ordinal)
      ?? declared.cases.find((item) => item.name === activeResult.name)
    : undefined;

  const rawShown = rawOpen ?? !report.parsed;

  useEffect(() => {
    setSelectedResult("");
    setRawOpen(null);
  }, [terminal === ""]);

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
              <SparDots pattern="wave" size={14} />
            ) : report.parsed ? (
              <span
                className={cn(
                  "rounded-full px-1.5 text-ui-sm tabular-nums",
                  report.failed ? "bg-destructive/15 text-destructive" : "bg-[var(--success)]/15 text-[var(--success)]",
                )}
              >
                {report.passed}/{report.cases.length}
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
          {running ? (
            <div className="flex flex-1 items-center gap-2 px-3 py-3 text-ui text-muted-foreground">
              <SparDots pattern="wave" size={18} />
              {busyLabel ?? "Running the visible cases…"}
            </div>
          ) : !terminal ? (
            <div className="flex flex-1 items-center gap-2 px-3 py-3 text-ui text-muted-foreground/70">
              <Terminal className="size-3.5 shrink-0" />
              Run the visible cases, or submit to also run the hidden suite.
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
                {report.parsed ? (
                  <>
                    <span
                      className={cn(
                        "text-content font-semibold",
                        report.failed ? "text-destructive" : "text-[var(--success)]",
                      )}
                    >
                      {report.failed ? "Wrong Answer" : "Accepted"}
                    </span>
                    <span className="text-ui text-muted-foreground tabular-nums">
                      {/* Counted from the totals, not from the rows on screen. A
                          submission judged at the source reports 9 of 212 while
                          naming only the one case it rejected, and "9/1 passed" is
                          not a thing that can be true. */}
                      {report.passed}/{report.passed + report.failed + report.skipped || report.cases.length} passed
                      {report.skipped ? ` · ${report.skipped} skipped` : ""}
                    </span>
                    {report.durationMs !== undefined && (
                      <span className="ml-auto text-ui-sm text-muted-foreground/70 tabular-nums">
                        {report.durationMs.toFixed(0)} ms
                      </span>
                    )}
                  </>
                ) : (
                  outcome && (
                    <span
                      className={cn(
                        "text-content font-semibold",
                        outcome.kind === "passed" ? "text-[var(--success)]" : "text-destructive",
                      )}
                    >
                      {outcome.kind === "passed" ? "Accepted" : "Wrong Answer"}
                    </span>
                  )
                )}
              </div>

              {report.parsed && activeResult ? (
                <>
                  <CaseRail
                    activeId={activeResult.id}
                    cases={report.cases}
                    onSelect={setSelectedResult}
                  />
                  <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                    <CaseDetail declared={declaredForResult} result={activeResult} />
                    <RawOutput open={rawShown} onToggle={() => setRawOpen(!rawShown)} terminal={terminal} endRef={rawEnd} />
                  </div>
                </>
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
export function caseValues(result: TestCaseResult, declared?: DeclaredCase): CaseValue[] {
  const assertions = declared?.assertions ?? [];
  if (!assertions.length && (result.failure?.expected !== undefined || result.failure?.actual !== undefined)) {
    return [{ input: "—", expected: result.failure.expected ?? "—", ...(result.failure.actual === undefined ? {} : { output: result.failure.actual }) }];
  }
  return assertions.map((assertion, index) => ({
    input: assertion.call || "—",
    expected: index === 0 ? (result.failure?.expected ?? assertion.expected) || "—" : assertion.expected || "—",
    ...(index === 0 && result.failure?.actual !== undefined
      ? { output: result.failure.actual }
      : result.status === "passed"
        ? { output: assertion.expected || "—" }
        : {}),
  }));
}

function CaseDetail({ result, declared }: { result: TestCaseResult; declared: DeclaredCase | undefined }) {
  const failure = result.failure;
  const message = headline(failure?.message);
  const values = caseValues(result, declared);

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <StatusMark className="size-3.5" status={result.status} />
        <p className="min-w-0 flex-1 truncate text-content font-medium">{result.name}</p>
        {result.durationMs !== undefined && (
          <span className="shrink-0 text-ui-sm text-muted-foreground/70 tabular-nums">{result.durationMs.toFixed(1)} ms</span>
        )}
      </div>

      {values.length > 0 && (
        <div className="mt-2.5 space-y-3">
          {values.map((value, index) => (
            <div className="space-y-2" key={index}>
              <ValueBlock label={values.length > 1 ? `Input ${index + 1}` : "Input"} value={value.input} />
              <div className="grid grid-cols-2 gap-2">
                <ValueBlock
                  label="Output"
                  value={value.output ?? "Not reported"}
                  {...(result.status === "failed" && value.output !== undefined ? { tone: "actual" as const } : {})}
                />
                <ValueBlock label="Expected" tone="expected" value={value.expected} />
              </div>
            </div>
          ))}
        </div>
      )}
      {result.status === "passed" && values.length === 0 && (
        <p className="mt-1.5 text-ui text-muted-foreground">This case passed, but the test did not declare its input and expected value.</p>
      )}
      {result.status === "skipped" && <p className="mt-1.5 text-ui text-muted-foreground">This case was skipped.</p>}

      {failure && (
        <>
          {message && <p className="mt-1.5 text-ui leading-[1.6] text-foreground/85">{message}</p>}
          {values.length === 0 && (failure.expected !== undefined || failure.actual !== undefined) && (
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <ValueBlock label="Expected" tone="expected" value={failure.expected ?? "—"} />
              <ValueBlock label="Your output" tone="actual" value={failure.actual ?? "—"} />
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
