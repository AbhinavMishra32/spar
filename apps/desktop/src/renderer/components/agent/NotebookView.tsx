import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { diffCounts, lineDiff, wordDiff, type DiffLine } from "./lineDiff";

/**
 * The coach's notebook: the page of markdown it keeps about the learner, per
 * Track, and rewrites as it learns how they learn. Drawn in two places — under
 * the `update_notebook` row that changed it, and in the Track's own notebook
 * dialog — so the pieces live here rather than in either.
 */

export type NotebookCall = {
  markdown: string;
  note: string;
  version: number | null;
  /** The whole page before this write. Null for the first one. */
  previous: string | null;
  status: "saved" | "unchanged" | null;
};

function record(payload: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function readNotebookCall(input: string, output: string): NotebookCall {
  const sent = record(input);
  const back = record(output);
  const status = back.status === "saved" || back.status === "unchanged" ? back.status : null;
  return {
    /* The host's copy first: a call made of edits sends only fragments. */
    markdown: typeof back.markdown === "string" ? back.markdown : typeof sent.markdown === "string" ? sent.markdown : "",
    note: typeof back.note === "string" && back.note.trim() ? back.note.trim() : typeof sent.note === "string" ? sent.note.trim() : "",
    version: typeof back.version === "number" ? back.version : null,
    previous: typeof back.previous === "string" ? back.previous : null,
    status,
  };
}

/** Unchanged lines kept either side of a change. The rest fold away. */
const CONTEXT = 2;

type Segment = { kind: "lines"; lines: DiffLine[] } | { kind: "fold"; lines: DiffLine[] };

function segments(diff: DiffLine[]): Segment[] {
  const keep = diff.map(() => false);
  diff.forEach((line, index) => {
    if (line.kind === "same") return;
    for (let offset = -CONTEXT; offset <= CONTEXT; offset += 1) {
      if (index + offset >= 0 && index + offset < diff.length) keep[index + offset] = true;
    }
  });
  const out: Segment[] = [];
  diff.forEach((line, index) => {
    const kind = keep[index] ? "lines" : "fold";
    const tail = out[out.length - 1];
    if (tail?.kind === kind) tail.lines.push(line);
    else out.push({ kind, lines: [line] });
  });
  /* A fold of one line hides nothing worth a click. */
  return out.map((segment) => (segment.kind === "fold" && segment.lines.length < 3 ? { kind: "lines", lines: segment.lines } : segment));
}

function DiffRow({ line }: { line: DiffLine }) {
  return (
    <div
      className={cn(
        "flex min-w-0 gap-2 px-3",
        line.kind === "added" && "bg-[color-mix(in_srgb,var(--success)_11%,transparent)] text-[var(--success)]",
        line.kind === "removed" && "bg-destructive/10 text-destructive",
        line.kind === "same" && "text-muted-foreground/70",
      )}
    >
      <span aria-hidden className="w-2.5 shrink-0 select-none opacity-70">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
      <span className="sr-only">{line.kind === "added" ? "Added: " : line.kind === "removed" ? "Removed: " : ""}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
        {line.spans
          ? line.spans.map((span, index) => span.changed
            ? (
              <mark
                className={cn(
                  "rounded-[3px] text-inherit",
                  line.kind === "added" ? "bg-[color-mix(in_srgb,var(--success)_32%,transparent)]" : "bg-destructive/30",
                )}
                key={index}
              >
                {span.text}
              </mark>
            )
            : <span key={index}>{span.text}</span>)
          : line.text || " "}
      </span>
    </div>
  );
}

function Fold({ lines }: { lines: DiffLine[] }) {
  const [open, setOpen] = useState(false);
  if (open) return <>{lines.map((line, index) => <DiffRow key={index} line={line} />)}</>;
  return (
    <button
      className="block w-full cursor-default px-3 py-0.5 text-left text-muted-foreground/60 outline-none transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
      onClick={() => setOpen(true)}
      type="button"
    >
      ⋯ {lines.length} unchanged lines
    </button>
  );
}

/** A line diff between two versions of a page: added green, removed red,
 *  unchanged dimmed, and long unchanged stretches folded. */
export function LineDiffView({ before, after, className }: { before: string | null; after: string; className?: string }) {
  const diff = useMemo(() => wordDiff(lineDiff(before, after)), [before, after]);
  const parts = useMemo(() => segments(diff), [diff]);
  if (!diff.some((line) => line.kind !== "same")) {
    return <p className={cn("px-3 py-2 text-thread-tool text-muted-foreground", className)}>No changes from the previous version.</p>;
  }
  return (
    <div className={cn("py-1.5 font-mono text-thread-tool leading-[1.6]", className)}>
      {parts.map((segment, index) => segment.kind === "fold"
        ? <Fold key={index} lines={segment.lines} />
        : segment.lines.map((line, offset) => <DiffRow key={`${index}-${offset}`} line={line} />))}
    </div>
  );
}

export function DiffCounts({ before, after, className }: { before: string | null; after: string; className?: string }) {
  const { added, removed } = useMemo(() => diffCounts(lineDiff(before, after)), [before, after]);
  if (!added && !removed) return null;
  return (
    <span className={cn("shrink-0 font-mono tabular-nums", className)}>
      {added > 0 && <span className="text-[var(--success)]">+{added}</span>}
      {added > 0 && removed > 0 && " "}
      {removed > 0 && <span className="text-destructive">−{removed}</span>}
    </span>
  );
}

const TAB = "cursor-default rounded-[var(--radius-md)] px-1.5 py-0.5 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring";

/**
 * The notebook as one `update_notebook` call left it, hung under that call's
 * row. The page is what the coach will read before its next turn; "Changes" is
 * what this turn taught it.
 */
export function NotebookCard({ input, output }: { input: string; output: string }) {
  const call = useMemo(() => readNotebookCall(input, output), [input, output]);
  return <MarkdownRecordCard empty="The notebook is empty." label={call.note || "Coach's notebook"} markdown={call.markdown} pageTab="Notebook" previous={call.previous} unchanged={call.status === "unchanged"} version={call.version} />;
}

/** What one `update_ability` call wrote: the ability's document, and the version
 *  it replaced when there was one. */
export function readAbilityCall(input: string, output: string) {
  const sent = record(input);
  const back = record(output);
  const markdown = typeof back.markdown === "string" ? back.markdown : typeof sent.markdown === "string" ? sent.markdown : "";
  const previous = typeof back.previousMarkdown === "string" ? back.previousMarkdown : null;
  return {
    title: typeof back.title === "string" ? back.title : typeof sent.title === "string" ? sent.title : "Ability",
    markdown,
    previous,
    version: typeof back.version === "number" ? back.version : null,
    unchanged: previous !== null && previous.trim() === markdown.trim(),
  };
}

/** The ability document an `update_ability` call left, drawn like the notebook:
 *  the page, and what this turn changed on it. */
export function AbilityCard({ input, output }: { input: string; output: string }) {
  const call = useMemo(() => readAbilityCall(input, output), [input, output]);
  return <MarkdownRecordCard empty="The ability document is empty." label={call.title} markdown={call.markdown} pageTab="Ability" previous={call.previous} unchanged={call.unchanged} version={call.version} />;
}

function MarkdownRecordCard({ label, markdown, previous, version, unchanged, pageTab, empty }: {
  label: string;
  markdown: string;
  previous: string | null;
  version: number | null;
  unchanged: boolean;
  pageTab: string;
  empty: string;
}) {
  const [view, setView] = useState<"notes" | "changes">(previous !== null && !unchanged ? "changes" : "notes");
  return (
    <div className="pb-1.5 pt-0.5">
      <div className="transcript-block min-w-0 overflow-hidden">
        <div className="flex min-w-0 items-start gap-2 border-b border-border/50 px-3 py-1.5 text-thread-tool">
          {version !== null && (
            <span className="shrink-0 rounded-md bg-[var(--color-background-elevated-secondary)] px-1.5 py-0.5 font-mono tabular-nums text-muted-foreground">v{version}</span>
          )}
          <span className="min-w-0 flex-1 text-pretty break-words text-[var(--transcript-step)]">
            {label}
            {unchanged && <span className="ml-1.5 text-muted-foreground">· unchanged</span>}
          </span>
          <div className="flex shrink-0 items-center gap-0.5" role="tablist">
            {(["notes", "changes"] as const).map((option) => (
              <button
                aria-selected={view === option}
                className={cn(TAB, view === option ? "bg-[var(--color-background-elevated-secondary)] text-foreground" : "text-muted-foreground hover:text-foreground")}
                key={option}
                onClick={() => setView(option)}
                role="tab"
                type="button"
              >
                {option === "notes" ? pageTab : "Changes"}
                {option === "changes" && <DiffCounts after={markdown} before={previous} className="ml-1" />}
              </button>
            ))}
          </div>
        </div>
        <div className="app-scroll max-h-80 overflow-y-auto">
          {view === "changes" ? (
            <LineDiffView after={markdown} before={previous} />
          ) : markdown.trim() ? (
            <Markdown className="px-3.5 py-2.5" source={markdown} />
          ) : (
            <p className="px-3 py-2 text-thread-tool text-muted-foreground">{empty}</p>
          )}
        </div>
      </div>
    </div>
  );
}
