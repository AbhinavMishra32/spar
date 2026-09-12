/**
 * Reasoning, split into the sections the model gave it.
 *
 * Its own module because it is a heuristic over text — what counts as a
 * heading, what is only an emphasised phrase — and the component that draws it
 * reaches Monaco through the detail views, so testing it there would need a DOM
 * to answer a question that has nothing to do with one.
 */
/**
 * Reasoning summaries arrive as `**A heading**` followed by prose, several to a
 * block. Those headings are the model's own account of what it is doing, so they
 * become the rows — and the markup is removed rather than shown, which is what
 * put literal asterisks in the transcript.
 */
export function thoughts(body: string): Array<{ title?: string; body: string }> {
  const sections: Array<{ title?: string; body: string }> = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let cursor = 0;

  for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
    if (!isHeading(body, match)) continue;

    const before = clean(body.slice(cursor, match.index));
    if (before) {
      const open = sections.at(-1);
      if (open) open.body = clean(`${open.body} ${before}`);
      else sections.push({ body: before });
    }
    sections.push({ title: clean(match[1] ?? ""), body: "" });
    cursor = match.index + match[0].length;
  }

  const rest = clean(body.slice(cursor));
  if (rest) {
    const open = sections.at(-1);
    if (open) open.body = clean(`${open.body} ${rest}`);
    else sections.push({ body: rest });
  }
  return sections.filter((section) => section.title || section.body);
}

/**
 * Whether a bold run is a section heading or just an emphasised phrase.
 *
 * It has to start its own line, and the line has to be about that phrase —
 * nothing after it, or a colon. Every `**…**` used to become a row, so a model
 * that bolds terms as it writes ("a **typed superset of JavaScript**") produced
 * a column of two-word headings with the sentences they came from scattered
 * underneath. That is not a summary of the thinking, it is the thinking taken
 * apart.
 */
function isHeading(body: string, match: RegExpExecArray): boolean {
  const lineStart = body.lastIndexOf("\n", match.index - 1) + 1;
  /* Only whitespace or a list marker may sit before it on the line. */
  if (!/^[\s>*\-\d.)]*$/.test(body.slice(lineStart, match.index))) return false;

  const after = body.slice(match.index + match[0].length);
  const restOfLine = after.slice(0, after.indexOf("\n") === -1 ? after.length : after.indexOf("\n"));
  return /^\s*:?\s*$/.test(restOfLine);
}

/** Reasoning is emitted with hard wraps and blank runs that read as gaps in the
 *  transcript. The words are what matter here, so the whitespace is normalised. */
function clean(value: string): string {
  return value.replace(/\*\*/g, "").replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

