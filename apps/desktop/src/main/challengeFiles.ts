import type { ChallengeCodePreview, ChallengeFile, ChallengeTimelineEntry, QuestionDesign } from "@spar/domain";

/**
 * Reading a compiled challenge as files rather than as a design blob.
 *
 * A challenge in history has no live attempt behind it, so everything here is
 * derived from the stored design: the files it was compiled with, the excerpt a
 * history card shows, and the plain-language line each recorded event gets in
 * the timeline. Nothing in this module reads or writes learner state.
 */

export function fileLanguage(path: string): string {
  if (path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".mts")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) return "javascript";
  if (/\.(cpp|cc|cxx|hpp|hh|hxx|h)$/.test(path)) return "cpp";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  return "plaintext";
}

/** What the practice sandbox is seeded with: the starter the learner writes in,
 *  plus the visible tests that state the contract. Hidden tests are deliberately
 *  absent — they are only ever written into a throwaway sandbox at check time. */
export function seedFiles(design: QuestionDesign): Record<string, string> {
  return { ...design.starterFiles, ...design.visibleTests };
}

/** The challenge's files in the order the page mounts them: solution files first,
 *  because that is the one the learner lands in, then the read-only tests. */
export function challengeFiles(design: QuestionDesign, content: Record<string, string>): ChallengeFile[] {
  const tests = new Set(Object.keys(design.visibleTests));
  return Object.keys(seedFiles(design))
    .sort()
    .map((path) => ({
      path,
      language: fileLanguage(path),
      role: tests.has(path) ? ("test" as const) : ("solution" as const),
      readOnly: tests.has(path),
      content: content[path] ?? "",
    }))
    .sort((left, right) => Number(left.role === "test") - Number(right.role === "test"));
}

/** Lines of the excerpt, and the width one is allowed to reach before it is cut.
 *  Both are read as a shape rather than as text at card size, so the point is
 *  that the block keeps a consistent silhouette in a list. */
const PREVIEW_LINES = 9;
const PREVIEW_COLUMNS = 88;

/** The starter file worth showing: the one the learner actually writes in. Falls
 *  back to whichever file is longest, so a challenge whose starter is a stub
 *  still previews as something rather than as three blank lines. */
export function codePreview(design: QuestionDesign): ChallengeCodePreview | null {
  const candidates = Object.entries(design.starterFiles ?? {}).filter(([, body]) => body.trim());
  if (!candidates.length) return null;
  const [path, body] = candidates.sort(
    (left, right) => right[1].trim().length - left[1].trim().length || left[0].localeCompare(right[0]),
  )[0]!;

  const lines = body.replace(/\r\n/g, "\n").split("\n");
  // Leading blank lines and a lone file-header comment carry nothing at this
  // size; the excerpt starts where the code does.
  let start = 0;
  while (start < lines.length && !lines[start]!.trim()) start += 1;
  const kept = lines.slice(start, start + PREVIEW_LINES).map((line) => (line.length > PREVIEW_COLUMNS ? `${line.slice(0, PREVIEW_COLUMNS - 1)}…` : line));
  while (kept.length && !kept[kept.length - 1]!.trim()) kept.pop();

  return {
    path,
    language: fileLanguage(path),
    code: kept.join("\n"),
    remainingLines: Math.max(0, lines.length - start - kept.length),
  };
}

/* Read structurally rather than as `AttemptEvent`. These come back off the event
   table, where `type` and `source` are whatever was written — including types an
   older build emitted — and a stored history is not a place to narrow. */
type RecordedEvent = { id: string; type: string; source: string; occurredAt: string; payload: Record<string, unknown> };
type RecordedAttempt = { ordinal: number; events: RecordedEvent[] };

/** One readable line per recorded event. The payloads are the agent's and the
 *  runner's own shapes, so anything unrecognised falls through to its type
 *  rather than being guessed at — an invented summary would read as evidence. */
export function challengeTimeline(attempts: RecordedAttempt[]): ChallengeTimelineEntry[] {
  const entries: ChallengeTimelineEntry[] = [];
  for (const attempt of attempts) {
    for (const event of attempt.events) {
      entries.push({
        id: event.id,
        attemptOrdinal: attempt.ordinal,
        type: event.type,
        source: event.source,
        occurredAt: event.occurredAt,
        detail: describe(event.type, event.payload),
      });
    }
  }
  return entries;
}

function describe(type: string, payload: Record<string, unknown>): string {
  const text = (key: string) => (typeof payload[key] === "string" ? (payload[key] as string) : "");
  switch (type) {
    case "attempt_started":
      return payload.replacesQuestionId ? "Opened in place of an earlier challenge" : "Challenge opened";
    case "file_changed":
      return text("path");
    case "command_executed":
      return text("command") === "test" ? "Ran the visible cases" : `Ran ${text("command")}`;
    case "test_run": {
      const scope = text("scope") === "visible" ? "visible cases" : "visible and hidden cases";
      return `${payload.passed ? "Passed" : "Failed"} the ${scope}`;
    }
    case "submission_created":
      return "Submitted for judging";
    case "submission_evaluated":
      return text("outcome") === "passed" ? "Judged: all tests passed" : "Judged: one or more tests failed";
    case "attempt_completed": {
      const reason = text("reason");
      const outcome = text("outcome");
      const headline =
        outcome === "passed" ? "Completed — passed"
        : outcome === "failed" ? "Completed — failed"
        : outcome === "replaced" ? "Swapped out for a better-aimed challenge"
        : "Given up on";
      return reason ? `${headline}: ${reason}` : headline;
    }
    default:
      return type.replace(/_/g, " ");
  }
}
