/**
 * The replay's own numbers, recovered from the tool result the row was drawn from.
 *
 * `read_attempt` comes back with a `stats` block beside a report that can run to
 * thousands of lines, and the transcript kept only the one-line English summary the
 * worker wrote from it — so the row could say "4 never passed" and had no way to
 * colour the 4, size a bar, or tell a pass from an abandonment. The numbers are
 * read back here instead of being re-derived from that sentence, because parsing
 * prose the worker is free to reword is a bug waiting for the next edit.
 *
 * The payload is capped at 16k and the report is what overruns it, so `stats` is
 * serialised first and this falls back to lifting that one object out of a JSON
 * document whose tail was cut off. A truncated payload is the common case for a
 * long attempt, not an edge one.
 */
export type SolveStats = {
  elapsedMs: number;
  runs: number;
  submissions: number;
  casesTracked: number;
  /** Cases that failed on every run they appeared in. */
  neverPassed: number;
  /** Cases that passed and then broke again. */
  regressions: number;
  outcome: "passed" | "failed" | "abandoned" | "in-progress" | "";
  /** Submitted without ever running the visible cases. */
  submittedBlind: boolean;
};

const OUTCOMES = new Set(["passed", "failed", "abandoned", "in-progress"]);

/** The opening of the learner's own file, as the replay carried it back. */
export type SolveHead = { path: string; text: string };

/**
 * The code the replay was a replay of.
 *
 * Read separately from the numbers, and tolerant of a payload whose tail was cut
 * off, for the same reason: this is drawn behind the card, and a card that loses
 * its backdrop because the log ran long is worse than one that never had it.
 */
export function solveHead(output: string): SolveHead | null {
  const raw = (whole(output, "solve") ?? carved(output, "solve")) as { path?: unknown; text?: unknown } | null;
  if (!raw || typeof raw.text !== "string" || !raw.text.trim()) return null;
  return { path: typeof raw.path === "string" ? raw.path : "", text: raw.text };
}

export function solveStats(output: string): SolveStats | null {
  const raw = whole(output, "stats") ?? carved(output, "stats");
  if (!raw) return null;
  const number = (key: string) => {
    const value = raw[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  const outcome = typeof raw.outcome === "string" && OUTCOMES.has(raw.outcome) ? raw.outcome as SolveStats["outcome"] : "";
  return {
    elapsedMs: number("elapsedMs"),
    runs: number("runs"),
    submissions: number("submissions"),
    casesTracked: number("casesTracked"),
    neverPassed: number("neverPassed"),
    regressions: number("regressions"),
    outcome,
    submittedBlind: raw.submittedBlind === true,
  };
}

/** The ordinary path: a payload that fit. */
function whole(output: string, key: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const held = parsed && typeof parsed === "object" ? parsed[key] : null;
    return held && typeof held === "object" ? held as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** The truncated path: one object lifted out by matching its braces. */
function carved(output: string, key: string): Record<string, unknown> | null {
  const at = output.indexOf(`"${key}"`);
  if (at < 0) return null;
  const open = output.indexOf("{", at);
  if (open < 0) return null;
  let depth = 0;
  for (let index = open; index < output.length; index += 1) {
    if (output[index] === "{") depth += 1;
    else if (output[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(output.slice(open, index + 1)) as Record<string, unknown>;
          return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** How long they were on it, at the resolution the number deserves. */
export function spentOn(elapsedMs: number): string {
  const minutes = Math.round(elapsedMs / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(elapsedMs / 1_000))}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
