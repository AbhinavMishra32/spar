import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Eye, EyeOff, Minus, X } from "lucide-react";

import { languageForPath } from "@spar/domain";
import { cn } from "@/lib/utils";
import { FileTab } from "../common/FileTab";
import { LanguageGlyph, languageOf } from "../common/LanguageGlyph";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Snippet } from "./Snippet";
import { FadedScroll } from "./ToolPayload";
import type { AttemptRead, CaseMark, ReadCase, ReadLogLine, ReadRun } from "./attemptReport";

/**
 * The attempt the tutor read, drawn.
 *
 * Opening this row used to mean reading a solve log out of escaped JSON — the
 * single worst payload in the app to meet as a payload, and the one with the
 * most to show as itself. Everything in it is an account of the learner's own
 * hour: which cases were green and when, what each run fixed and what it broke,
 * what they typed and how long they sat between runs.
 *
 * Four views because the replay answers four different questions and no one
 * layout answers them all — a case is read across the runs, a run is read
 * against the one before it, the log is read in order, and the code is read as
 * code. They are tabs rather than sections so the panel stays the size of a
 * step in a transcript, and the tab that opens first is the one with something
 * in it.
 *
 * The house style holds: no boxes, hairlines between things, one type size
 * throughout (the transcript sets it for everything in a tool panel), and
 * colour used only where it carries a verdict.
 */
export function AttemptReadView({ read }: { read: AttemptRead }) {
  const tabs = [
    { key: "cases", label: "Cases", count: read.cases.length },
    { key: "runs", label: "Runs", count: read.runs.length },
    { key: "log", label: "Log", count: read.log.length },
    { key: "code", label: "Code", count: read.files.length || (read.solve ? 1 : 0) },
    { key: "timings", label: "Timings", count: read.timings.length },
  ].filter((tab) => tab.count > 0);

  const [chosen, setChosen] = useState("");
  const tab = tabs.some((entry) => entry.key === chosen) ? chosen : tabs[0]?.key ?? "";

  if (read.nothing) return <p className="px-2.5 py-2 leading-[1.5] text-muted-foreground/85">{read.nothing}</p>;

  return (
    <div className="min-w-0">
      <Header read={read} />
      {tabs.length > 1 && <TabBar chosen={tab} onChoose={setChosen} tabs={tabs} />}
      {/* One panel at a time, cross-faded. The height is the panel's own, so a
          four-case attempt does not open a screenful of empty rule. */}
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="min-w-0"
          exit={{ opacity: 0, y: -3 }}
          initial={{ opacity: 0, y: 3 }}
          key={tab}
          transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
        >
          {tab === "cases" && <Cases cases={read.cases} runs={read.runs} />}
          {tab === "runs" && <Runs runs={read.runs} />}
          {tab === "log" && <Log lines={read.log} omitted={read.omitted} />}
          {tab === "code" && <Code read={read} />}
          {tab === "timings" && <Timings timings={read.timings} />}
        </motion.div>
      </AnimatePresence>

    </div>
  );
}

/* ---- The head of the panel ---------------------------------------------- */

/** What was read, and of what.
 *
 *  The challenge is named because a turn can read an attempt at a problem two
 *  challenges back and nothing else on the card says which one; the verdict is
 *  not, because the card above it already carries that and a panel that repeats
 *  its own header is a panel with one fact in it. */
function Header({ read }: { read: AttemptRead }) {
  const language = languageOf(read.language);
  return (
    <div className="min-w-0 border-b border-border/60 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-1.5">
        {language && <LanguageGlyph className="size-3.5 shrink-0" language={language} />}
        <span className="min-w-0 truncate font-medium text-foreground">{read.title || "This attempt"}</span>
        {opened(read.openedAt) && <span className="ml-auto shrink-0 text-muted-foreground/70">opened {opened(read.openedAt)}</span>}
      </div>
      {(read.asked.length > 0 || read.notes.length > 0) && (
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
          <span className="text-muted-foreground/70">Read</span>
          {read.asked.map((word) => (
            <span className="rounded-md bg-[var(--accent)] px-1.5 text-muted-foreground" key={word}>{word}</span>
          ))}
          {read.notes.map((note) => (
            <span className="text-muted-foreground/70" key={note}>{note.replace(/\.$/, "")}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** When they sat down to it. The report prints "today at 6:20pm" already;
 *  one written before that printed an instant, which is turned into the same. */
function opened(at: string): string {
  const when = Date.parse(at);
  if (!Number.isFinite(when)) return at;
  return new Date(when).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** The four questions, as a segmented control. The mark under the chosen one is
 *  a single element that travels between them, so switching tabs is one movement
 *  rather than one thing going out and another coming on. */
function TabBar({ chosen, onChoose, tabs }: { chosen: string; onChoose: (key: string) => void; tabs: Array<{ key: string; label: string; count: number }> }) {
  const reduced = useReducedMotion();
  return (
    <div className="app-scroll flex min-w-0 items-center gap-0.5 overflow-x-auto border-b border-border/60 px-1.5 py-1">
      {tabs.map((tab) => (
        <button
          className={cn(
            "relative shrink-0 cursor-default rounded-md px-2 py-0.5 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring",
            chosen === tab.key ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          key={tab.key}
          onClick={() => onChoose(tab.key)}
          type="button"
        >
          {chosen === tab.key && (
            <motion.span
              aria-hidden
              className="absolute inset-0 -z-10 rounded-md bg-[var(--accent)]"
              layoutId="attempt-read-tab"
              transition={reduced ? { duration: 0 } : { type: "spring", visualDuration: 0.28, bounce: 0.12 }}
            />
          )}
          <span className="font-medium">{tab.label}</span>
          <span className="ml-1 tabular-nums text-muted-foreground/70">{tab.count}</span>
        </button>
      ))}
    </div>
  );
}

/* ---- Cases -------------------------------------------------------------- */

/**
 * Every case, across every run.
 *
 * The transpose is the thing a chronological log cannot show and the thing a
 * learner most wants back: not "7 of 9 passed" but which two, and whether they
 * were failing the whole time or broke on the run before the submission. The
 * strip of marks is that history, one column per run, read left to right.
 */
function Cases({ cases, runs }: { cases: ReadCase[]; runs: ReadRun[] }) {
  const failing = cases.filter((item) => item.marks.at(-1) === "failed").length;
  return (
    <div className="min-w-0">
      {runs.length > 1 && (
        <p className="px-2.5 pt-2 text-muted-foreground/70">
          One row per case, one mark per run, oldest first.
          {failing > 0 ? ` ${failing} still failing at the end.` : ""}
        </p>
      )}
      <FadedScroll className="px-1.5 py-1">
        <div className="min-w-0">
          {cases.map((item) => (
            <CaseRow item={item} key={item.name} />
          ))}
        </div>
      </FadedScroll>
    </div>
  );
}

function CaseRow({ item }: { item: ReadCase }) {
  const failing = item.marks.at(-1) === "failed";
  return (
    <div className="min-w-0 rounded-lg px-1 py-[3px] transition-colors hover:bg-accent/50">
      <div className="flex min-w-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger className="shrink-0 cursor-default" tabIndex={-1} type="button">
            {item.hidden
              ? <EyeOff className="size-3 text-muted-foreground/45" />
              : <Eye className="size-3 text-muted-foreground/30" />}
          </TooltipTrigger>
          <TooltipContent>{item.hidden ? "Hidden — only runs on a submission" : "Visible while they worked"}</TooltipContent>
        </Tooltip>
        <span className={cn("min-w-0 flex-1 truncate", failing ? "text-foreground" : "text-foreground/80")} title={item.name}>{item.name}</span>
        {item.story && <span className="shrink-0 text-muted-foreground/65">{item.story}</span>}
        <Strip marks={item.marks} />
      </div>
    </div>
  );
}

/** A case's whole life, one mark per run. Long attempts keep the tail, which is
 *  the end of the story and the part that decided the verdict. */
function Strip({ marks }: { marks: CaseMark[] }) {
  const shown = marks.length > 14 ? marks.slice(-14) : marks;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {marks.length > shown.length && <span className="text-muted-foreground/40">…</span>}
      {shown.map((mark, index) => <Mark key={index} mark={mark} />)}
    </span>
  );
}

function Mark({ mark }: { mark: CaseMark }) {
  if (mark === "passed") {
    return (
      <span className="grid size-3.5 place-items-center rounded-[3px] bg-[var(--success)]/15">
        <Check className="size-2.5 text-[var(--success)]" />
      </span>
    );
  }
  if (mark === "failed") {
    return (
      <span className="grid size-3.5 place-items-center rounded-[3px] bg-destructive/15">
        <X className="size-2.5 text-destructive" />
      </span>
    );
  }
  if (mark === "absent") {
    return (
      <span className="grid size-3.5 place-items-center" title="Not run in that run">
        <span className="size-1 rounded-full bg-muted-foreground/30" />
      </span>
    );
  }
  return (
    <span className="grid size-3.5 place-items-center" title="Skipped">
      <Minus className="size-2.5 text-muted-foreground/50" />
    </span>
  );
}

/* ---- Runs --------------------------------------------------------------- */

/**
 * Each run against the one before it.
 *
 * The score alone says almost nothing — 5/7 twice in a row can mean nothing
 * moved or that two cases were fixed and two others broken. What moved is the
 * reading, so the names are printed and the run's own bar is only the backdrop
 * for them.
 */
function Runs({ runs }: { runs: ReadRun[] }) {
  return (
    <div className="min-w-0 px-2.5 py-1.5">
      {runs.map((run, index) => (
        <div className="min-w-0 py-1" key={`${run.at}-${index}`}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-mono tabular-nums text-muted-foreground/55">{run.at}</span>
            <span className={cn("shrink-0", run.submission ? "font-medium text-foreground/85" : "text-muted-foreground")}>
              {run.submission ? "submission" : "run"}
            </span>
            <Bar passed={run.passed} total={run.total} />
            <span className="shrink-0 tabular-nums">
              {run.total === null
                ? <span className="text-muted-foreground">{run.verdict}</span>
                : <>
                    <span className={run.passed === run.total ? "text-[var(--success)]" : "text-foreground"}>{run.passed}</span>
                    <span className="text-muted-foreground/60">/{run.total}</span>
                  </>}
            </span>
          </div>
          {(run.fixed.length > 0 || run.broke.length > 0) && (
            <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 pl-[3.75rem]">
              {run.fixed.length > 0 && <Delta names={run.fixed} tone="var(--success)" word="fixed" />}
              {run.broke.length > 0 && <Delta names={run.broke} tone="var(--destructive)" word="broke" />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** How much of the suite this run had green, as a length. Deliberately thin and
 *  unlabelled: the number beside it is the measurement, this is the shape of it
 *  down the column. */
function Bar({ passed, total }: { passed: number | null; total: number | null }) {
  if (passed === null || !total) return <span className="min-w-0 flex-1" />;
  const share = Math.max(0, Math.min(1, passed / total));
  const tone = share === 1 ? "var(--success)" : share > 0 ? "var(--warning)" : "var(--destructive)";
  return (
    <span className="relative h-1 min-w-6 flex-1 overflow-hidden rounded-full bg-[var(--border-surface-strong)]">
      <motion.span
        animate={{ scaleX: share }}
        className="absolute inset-0 origin-left rounded-full"
        initial={{ scaleX: 0 }}
        style={{ background: tone }}
        transition={{ type: "spring", visualDuration: 0.4, bounce: 0 }}
      />
    </span>
  );
}

function Delta({ names, tone, word }: { names: string[]; tone: string; word: string }) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-1">
      <span className="shrink-0 font-medium tabular-nums" style={{ color: tone }}>{names.length} {word}</span>
      {names.map((name) => (
        <span className="min-w-0 max-w-[14rem] truncate rounded-md bg-[var(--accent)] px-1.5 text-muted-foreground" key={name} title={name}>{name}</span>
      ))}
    </span>
  );
}

/* ---- The log ------------------------------------------------------------ */

/** What each recorded event was, in the learner's terms rather than the
 *  table's. `file_changed` is a save; `test_run` is them pressing run. */
const EVENT_WORDS: Record<string, string> = {
  attempt_started: "opened",
  file_changed: "saved",
  command_executed: "ran",
  test_run: "tested",
  submission_created: "submitted",
  submission_evaluated: "graded",
  attempt_completed: "closed",
  hint_requested: "asked for a hint",
  learner_remark: "said",
  agent_message: "replied",
};

/** The attempt in order, on a rail, with each run's cases folded under it. */
function Log({ lines, omitted }: { lines: ReadLogLine[]; omitted: number }) {
  return (
    <div className="min-w-0">
      {omitted > 0 && (
        <p className="px-2.5 pt-2 text-muted-foreground/70">{omitted} earlier {omitted === 1 ? "line" : "lines"} were past the call&rsquo;s own limit and were not read.</p>
      )}
      <FadedScroll className="px-2.5 py-1.5">
        <div className="min-w-0">
          {lines.map((line) => <LogRow key={line.sequence} line={line} />)}
        </div>
      </FadedScroll>
    </div>
  );
}

function LogRow({ line }: { line: ReadLogLine }) {
  const failed = line.cases.filter((item) => item.status === "failed");
  return (
    <div className="relative min-w-0 border-l border-border/70 py-1 pl-3">
      <span aria-hidden className="absolute -left-[3px] top-[0.95em] size-[5px] rounded-full bg-muted-foreground/50" />
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 font-mono tabular-nums text-muted-foreground/55">{line.at}</span>
        <span className="shrink-0 text-foreground/85">{EVENT_WORDS[line.type] ?? line.type.replace(/_/g, " ")}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground" title={line.detail}>{line.detail}</span>
        {line.cases.length > 0 && (
          <span className="shrink-0 tabular-nums text-muted-foreground/70">
            {line.cases.length - failed.length}/{line.cases.length}
          </span>
        )}
      </div>
      {/* Only what failed. A run's passing cases are already counted on the line
          above, and printing forty green names is how a log becomes unreadable. */}
      {failed.length > 0 && (
        <div className="mt-0.5 min-w-0 space-y-px">
          {failed.slice(0, 6).map((item) => (
            <div className="flex min-w-0 items-baseline gap-1.5" key={item.name}>
              <X className="size-2.5 shrink-0 translate-y-0.5 text-destructive" />
              <span className="min-w-0 shrink truncate text-foreground/75">{item.name}</span>
              {item.note && <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground/60" title={item.note}>{item.note}</span>}
            </div>
          ))}
          {failed.length > 6 && <p className="text-muted-foreground/60">and {failed.length - 6} more failing</p>}
        </div>
      )}
    </div>
  );
}

/* ---- Code and timings ---------------------------------------------------- */

/** The file they wrote, as the replay carried it back. */
function Code({ read }: { read: AttemptRead }) {
  const files = read.files.length ? read.files : read.solve ? [read.solve] : [];
  const [selected, setSelected] = useState("");
  const current = files.find((file) => file.path === selected) ?? files[0];
  if (!current) return null;

  return (
    <div className="min-w-0 pt-1.5">
      {files.length > 1 && (
        <div className="app-scroll flex items-center gap-1 overflow-x-auto px-1.5 pb-1.5">
          {files.map((file) => (
            <FileTab
              active={file.path === current.path}
              className="text-[length:inherit]"
              key={file.path}
              onClick={() => setSelected(file.path)}
              path={file.path}
            />
          ))}
        </div>
      )}
      <Snippet body={current.text} language={languageForPath(current.path) ?? languageOf(read.language) ?? "text"} />
    </div>
  );
}

/** The clock facts, which are the ones a learner never has for themselves: how
 *  long they sat before the first run, and the longest gap in the middle. */
function Timings({ timings }: { timings: string[] }) {
  return (
    <div className="min-w-0 px-2.5 py-1.5">
      {timings.map((line) => {
        const at = line.indexOf(":");
        const label = at < 0 ? line : line.slice(0, at);
        const value = at < 0 ? "" : line.slice(at + 1).trim();
        return (
          <div className="flex min-w-0 items-baseline gap-2 py-[2px]" key={line}>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
            <span className="shrink-0 font-medium tabular-nums text-foreground/85">{value}</span>
          </div>
        );
      })}
    </div>
  );
}
