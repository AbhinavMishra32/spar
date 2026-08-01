import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleSlash,
  Loader2,
  MinusCircle,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import type { ActiveQuestion, SessionDetail } from "@spar/domain";
import { cn } from "@/lib/utils";
import { fileName } from "@/lib/format";
import { declaredCases } from "@/lib/testCases";
import { EMPTY_REPORT, headline, parseTestOutput, type CaseStatus, type TestCaseResult } from "@/lib/testReport";
import { RuntimeConsole, type RuntimeLog } from "../agent/RuntimeConsole";
import { AttemptsPanel } from "./AttemptsPanel";

export type ResultTab = "testcase" | "result" | "trace" | "attempts";
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
  outcome,
  logs,
  events,
  onClearTerminal,
  onCollapse,
}: {
  question: ActiveQuestion;
  tab: ResultTab;
  onTab(tab: ResultTab): void;
  testFiles: Record<string, string>;
  terminal: string;
  running: boolean;
  outcome: RunOutcome;
  logs: RuntimeLog[];
  events: SessionDetail["events"];
  onClearTerminal(): void;
  onCollapse(): void;
}) {
  const declared = useMemo(() => declaredCases(testFiles, question.visibleTestFiles), [testFiles, question.visibleTestFiles]);
  const report = useMemo(() => (running ? EMPTY_REPORT : parseTestOutput(terminal)), [terminal, running]);

  const [selectedDeclared, setSelectedDeclared] = useState("");
  const [selectedResult, setSelectedResult] = useState("");
  const [rawOpen, setRawOpen] = useState(false);
  const rawEnd = useRef<HTMLDivElement>(null);

  const activeDeclared = declared.cases.find((item) => item.id === selectedDeclared) ?? declared.cases[0];
  // A failure is what the learner needs; select it rather than making them hunt.
  const firstFailure = report.cases.find((item) => item.status === "failed");
  const activeResult =
    report.cases.find((item) => item.id === selectedResult) ?? firstFailure ?? report.cases[0];

  useEffect(() => {
    setSelectedResult("");
    setRawOpen(false);
  }, [terminal === ""]);

  useEffect(() => {
    if (rawOpen) rawEnd.current?.scrollIntoView({ block: "end" });
  }, [terminal, rawOpen]);

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
              <Loader2 className="size-3 animate-spin" />
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
        <Tab
          active={tab === "trace"}
          badge={logs.length > 0 ? <Count>{logs.length}</Count> : undefined}
          label="Agent trace"
          onClick={() => onTab("trace")}
        />
        <Tab
          active={tab === "attempts"}
          badge={events.length > 0 ? <Count>{events.length}</Count> : undefined}
          label="Attempt"
          onClick={() => onTab("attempts")}
        />
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
        (question.visibleTestFiles.length === 0 ? (
          <div className="flex flex-1 items-center gap-2 px-3 py-3 text-ui text-muted-foreground">
            <CircleSlash className="size-3.5 shrink-0" />
            This challenge exposes no visible cases — submitting runs the hidden suite.
          </div>
        ) : declared.parsed && activeDeclared ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <CaseRail cases={declared.cases} activeId={activeDeclared.id} onSelect={setSelectedDeclared} />
            <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              <p className="text-content font-medium">{activeDeclared.name}</p>
              <p className="mt-0.5 font-mono text-ui-sm text-muted-foreground/70">{fileName(activeDeclared.file)}</p>
              {activeDeclared.assertions.length ? (
                <div className="mt-2.5 space-y-2.5">
                  {activeDeclared.assertions.map((assertion, index) => (
                    <div className="grid grid-cols-2 gap-2" key={index}>
                      <ValueBlock label="Call" value={assertion.call} />
                      <ValueBlock
                        label={assertion.method === "throws" ? "Throws" : "Expected"}
                        value={assertion.expected || "—"}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-ui text-muted-foreground">
                  This case asserts through a helper, so its inputs are not shown inline. Open the test file in the editor to
                  read it in full.
                </p>
              )}
            </div>
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
              <Loader2 className="size-3.5 animate-spin" />
              Running the visible cases…
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
                      {report.passed}/{report.cases.length} passed
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
                    <CaseDetail result={activeResult} />
                    <RawOutput open={rawOpen} onToggle={() => setRawOpen((value) => !value)} terminal={terminal} endRef={rawEnd} />
                  </div>
                </>
              ) : (
                // C++ challenges and crashed runs have no TAP to read.
                <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2">
                  <p className="mb-1.5 flex items-center gap-1.5 text-ui-sm text-muted-foreground/70">
                    <AlertTriangle className="size-3" />
                    No structured cases in this run — showing raw output.
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

      {tab === "trace" && <RuntimeConsole className="flex-1" logs={logs} />}

      {tab === "attempts" && (
        <div className="min-h-0 flex-1">
          <AttemptsPanel events={events} />
        </div>
      )}
    </div>
  );
}

function CaseDetail({ result }: { result: TestCaseResult }) {
  const failure = result.failure;
  const message = headline(failure?.message);

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <StatusMark className="size-3.5" status={result.status} />
        <p className="min-w-0 flex-1 truncate text-content font-medium">{result.name}</p>
        {result.durationMs !== undefined && (
          <span className="shrink-0 text-ui-sm text-muted-foreground/70 tabular-nums">{result.durationMs.toFixed(1)} ms</span>
        )}
      </div>

      {result.status === "passed" && (
        <p className="mt-1.5 text-ui text-muted-foreground">This case passed.</p>
      )}
      {result.status === "skipped" && <p className="mt-1.5 text-ui text-muted-foreground">This case was skipped.</p>}

      {failure && (
        <>
          {message && <p className="mt-1.5 text-ui leading-[1.6] text-foreground/85">{message}</p>}
          {(failure.expected !== undefined || failure.actual !== undefined) && (
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
