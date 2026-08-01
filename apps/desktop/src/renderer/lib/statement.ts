/**
 * Challenge statements arrive from the agent as one unbroken paragraph: the task,
 * every rule, all the examples and the export note run together in a single
 * blob. That is fine as a prompt and unreadable as a problem, so a statement that
 * is genuinely unstructured gets split along the seams it already has.
 *
 * This only ever *re-groups* the agent's own sentences — nothing is reworded and
 * nothing is dropped. A statement that already carries markdown structure is left
 * alone entirely, since the agent clearly meant that shape.
 */

export type Example = { call: string; result: string };

export type ParsedStatement = {
  /** True when the text was reshaped; false means render the original markdown. */
  structured: boolean;
  lead: string;
  requirements: string[];
  examples: Example[];
  note: string;
};

const EXAMPLES_MARKER = /\bexamples?\s*:/i;
const CONSTRAINTS_MARKER = /\bconstraints?\s*:/i;
const EXAMPLE_PAIR = /`([^`]+)`\s*(?:returns|→|->|=>|yields)\s*`([^`]+)`/gi;
// Runs to the end of the trailing code span rather than the first full stop,
// which would otherwise cut "Export with CommonJS: `module.exports = …`" at the
// period inside `module.exports`.
const TRAILING_NOTE = /\b(exports?\s+with[^`]*`[^`]+`\s*\.?)/i;

/** Markdown the agent authored deliberately: headings, lists, fences, blank lines. */
function alreadyStructured(source: string): boolean {
  return /\n\s*\n/.test(source) || /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```)/m.test(source);
}

/** Splits on sentence ends, but never inside `code spans` or bracketed groups. */
function sentences(source: string): string[] {
  const out: string[] = [];
  let buffer = "";
  let inCode = false;
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    buffer += character;
    if (character === "`") inCode = !inCode;
    if (!inCode) {
      if (character === "(" || character === "[") depth += 1;
      else if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
      const next = source[index + 1];
      // Only full stops end a sentence. A semicolon joins two halves of one
      // thought ("…finish time; for equal finish times, …") and splitting there
      // leaves fragments that start mid-sentence in lower case.
      const ends = character === ".";
      if (ends && depth === 0 && (next === undefined || next === " " || next === "\n")) {
        const trimmed = buffer.trim();
        if (trimmed) out.push(trimmed);
        buffer = "";
      }
    }
  }
  const rest = buffer.trim();
  if (rest) out.push(rest);
  return out;
}

export function parseStatement(source: string): ParsedStatement {
  const text = source.trim();
  const empty: ParsedStatement = { structured: false, lead: text, requirements: [], examples: [], note: "" };
  if (!text || alreadyStructured(text)) return empty;

  // Pull the examples tail off first; it is the bulk of most statements.
  const examplesAt = text.search(EXAMPLES_MARKER);
  const constraintsAt = text.search(CONSTRAINTS_MARKER);
  const splitAt = examplesAt >= 0 ? examplesAt : constraintsAt;
  const head = splitAt >= 0 ? text.slice(0, splitAt) : text;
  const tail = splitAt >= 0 ? text.slice(splitAt) : "";

  const examples: Example[] = [];
  EXAMPLE_PAIR.lastIndex = 0;
  for (let match = EXAMPLE_PAIR.exec(tail); match; match = EXAMPLE_PAIR.exec(tail)) {
    examples.push({ call: match[1]!.trim(), result: match[2]!.trim() });
  }

  // Anything in the tail that was not an example pair — usually the export note.
  let note = "";
  const noteMatch = TRAILING_NOTE.exec(tail || text);
  if (noteMatch) note = noteMatch[1]!.trim();

  const headSentences = sentences(head).filter(Boolean);
  if (!headSentences.length) return empty;

  const lead = headSentences[0]!;
  const requirements = supportingSentences(headSentences, note);

  // Re-grouping only earns its keep when there is something to group.
  if (requirements.length < 2 && examples.length === 0) return empty;

  return { structured: true, lead, requirements, examples, note };
}

/** Every sentence after the lead becomes its own requirement line. */
function supportingSentences(all: string[], note: string): string[] {
  return all
    .slice(1)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 1 && sentence !== note);
}
