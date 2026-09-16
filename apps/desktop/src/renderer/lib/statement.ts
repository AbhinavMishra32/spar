import { normalizeStatementText } from "../../shared/statementText";

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

export type Example = { call: string; result: string; note?: string };

export type ParsedStatement = {
  /** True when the text was reshaped; false means render the original markdown. */
  structured: boolean;
  lead: string;
  requirements: string[];
  examples: Example[];
  note: string;
};

/** A heading the statement gives itself, in any of the shapes a model writes. */
const HEADING = /^\s{0,3}(?:#{1,6}\s*|\*\*)\s*([A-Za-z][A-Za-z \-]{2,40}?)\s*(?:\*\*)?\s*:?\s*$/;
const LEAD_HEADING = /^(problem|problem description|description|task|the problem)$/i;
const EXAMPLES_HEADING = /^(examples?|sample|samples|sample cases?)$/i;
const NOTE_HEADING = /^(constraints?|notes?|requirements?|rules?)$/i;
/** `Input:` / `Output:` / `Explanation:` in a bullet, a numbered item, or bold.
 *  The asterisks are allowed on either side of the colon, because `**Input:**`
 *  closes the bold after it and `**Input**:` before it, and models write both. */
const FIELD = /^\s*(?:[-*+]\s*|\d+[.)]\s*)?\*{0,2}\s*(input|output|returns?|result|explanation|why)\s*\*{0,2}\s*:\s*\*{0,2}\s*(.*)$/i;

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
  const text = normalizeStatementText(source).trim();
  const empty: ParsedStatement = { structured: false, lead: text, requirements: [], examples: [], note: "" };
  if (!text) return empty;
  if (alreadyStructured(text)) return fromMarkdown(text) ?? empty;

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

/**
 * A statement that wrote its own headings, read as the same four parts.
 *
 * The agent writes a proper problem page now — "Problem description", numbered
 * examples with Input and Output, "Constraints" — and the old rule was to leave
 * markdown alone and render it as written. That gave the page two competing
 * hierarchies: its own headings and numbers in the prose, sitting above a panel
 * whose whole job is to present exactly those parts. It also renders badly,
 * because three examples written as three separate lists all number themselves
 * `1.`.
 *
 * So the sections are read out instead of printed. The heading names go — the
 * surface already says what each part is — and what was under them becomes the
 * lead, the requirement bullets, the example cards and the closing note. Nothing
 * is reworded and nothing is dropped: an example's explanation travels with the
 * example it explains.
 */
function fromMarkdown(text: string): ParsedStatement | null {
  const sections = splitByHeading(text);
  const examples = readExamples(sections.examples);
  const lead = sections.lead.trim();
  if (!lead) return null;
  /* Rewriting has to earn its keep. A statement that is one paragraph of prose
     under a heading has nothing to group, and is better as it was written. */
  const requirements = bulletsOf(sections.body);
  if (examples.length === 0 && requirements.length < 2) return null;
  return { structured: true, lead: [lead, sections.body.trim() && requirements.length === 0 ? sections.body.trim() : ""].filter(Boolean).join("\n\n"), requirements, examples, note: sections.note.trim() };
}

/** The statement cut at its own headings, into the four parts the panel draws. */
function splitByHeading(text: string): { lead: string; body: string; examples: string; note: string } {
  const parts = { lead: "", body: "", examples: "", note: "" };
  let current: keyof typeof parts = "lead";
  let seenLead = false;

  for (const line of text.split("\n")) {
    const heading = HEADING.exec(line)?.[1]?.trim();
    if (heading) {
      if (EXAMPLES_HEADING.test(heading)) { current = "examples"; continue; }
      if (NOTE_HEADING.test(heading)) { current = "note"; continue; }
      if (LEAD_HEADING.test(heading)) { current = seenLead ? "body" : "lead"; continue; }
      /* A heading this does not know the name of is content, not structure:
         keeping it is the only way an unusual section is not silently lost. */
      parts[current] += `${line}\n`;
      continue;
    }
    /* The first paragraph is the lead; everything after it, up to a heading, is
       what the requirements are drawn from. */
    if (current === "lead" && seenLead && !line.trim()) current = "body";
    if (line.trim()) seenLead = true;
    parts[current] += `${line}\n`;
  }
  return parts;
}

/**
 * The examples section, as cards.
 *
 * Two shapes, because the agent writes both. `Input:` / `Output:` /
 * `Explanation:` lines belong to one example until the next `Input:` starts
 * another; a bare "`call` returns `result`" pair is one example on its own line.
 */
function readExamples(section: string): Example[] {
  if (!section.trim()) return [];
  const examples: Example[] = [];
  let open: Example | null = null;
  const close = () => { if (open?.call) examples.push(open); open = null; };

  for (const line of section.split("\n")) {
    const field = FIELD.exec(line);
    const key = field?.[1]?.toLowerCase();
    const value = field?.[2]?.trim() ?? "";
    if (key === "input") { close(); open = { call: value, result: "" }; continue; }
    if (open && (key === "output" || key === "returns" || key === "return" || key === "result")) { open.result = value; continue; }
    if (open && (key === "explanation" || key === "why")) { open.note = value; continue; }
    /* Not a field, so either a pair written inline or prose continuing the
       explanation of the example above it. */
    EXAMPLE_PAIR.lastIndex = 0;
    const pair = EXAMPLE_PAIR.exec(line);
    if (pair) { close(); examples.push({ call: pair[1]!.trim(), result: pair[2]!.trim() }); continue; }
    if (open?.note && line.trim()) open.note += ` ${line.trim()}`;
  }
  close();
  return examples.filter((example) => example.result);
}

/** The requirement lines of a section: its bullets, or its sentences when it
 *  wrote none. Markers are stripped — the panel draws its own. */
function bulletsOf(section: string): string[] {
  const lines = section.split("\n").map((line) => line.trim()).filter(Boolean);
  const bullets = lines.filter((line) => /^([-*+]|\d+[.)])\s/.test(line)).map((line) => line.replace(/^([-*+]|\d+[.)])\s+/, "").trim());
  if (bullets.length) return bullets;
  return sentences(lines.join(" ")).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 1);
}

/** Every sentence after the lead becomes its own requirement line. */
function supportingSentences(all: string[], note: string): string[] {
  return all
    .slice(1)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 1 && sentence !== note);
}
