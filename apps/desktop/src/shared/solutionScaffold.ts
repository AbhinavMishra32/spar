const START = "spar:solution:start";
const END = "spar:solution:end";

export type SolutionScaffold = {
  /** The infrastructure before the learner-authored body, marker included. */
  before: string;
  /** Exactly what Spar submits to the provider. */
  body: string;
  /** The infrastructure after the body, marker and local-test export included. */
  after: string;
};

/**
 * Split a durable workspace file into its learner and host-owned projections.
 *
 * This follows the same boundary as `submittableCode`: first start marker, last
 * end marker, and both complete marker lines kept outside the visible body. It
 * lives in shared code because editors and read-only history previews must agree
 * on which bytes are the learner's solution.
 */
export function splitSolutionScaffold(content: string): SolutionScaffold | null {
  const start = content.indexOf(START);
  const end = content.lastIndexOf(END);
  if (start < 0 || end <= start) return null;
  const bodyStart = content.indexOf("\n", start);
  if (bodyStart < 0 || bodyStart > end) return null;
  const bodyEnd = content.lastIndexOf("\n", end);
  if (bodyEnd <= bodyStart) return null;
  return {
    before: content.slice(0, bodyStart + 1),
    body: content.slice(bodyStart + 1, bodyEnd),
    after: content.slice(bodyEnd),
  };
}

/** Recompose an edited clean body without allowing it to mutate the scaffold. */
export function withSolutionBody(scaffold: SolutionScaffold, body: string): string {
  return `${scaffold.before}${body}${scaffold.after}`;
}
