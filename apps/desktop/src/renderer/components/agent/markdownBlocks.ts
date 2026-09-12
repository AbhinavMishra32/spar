/**
 * Markdown, as blocks.
 *
 * Split from the renderer because this is the part with rules in it — what
 * counts as a table, where a list ends, which lines belong to a quote — and the
 * component it feeds reaches Monaco through the code theme, so testing the
 * parser there would need a DOM to answer questions that have nothing to do
 * with one.
 */
/** Blocks the renderer understands. Anything unrecognised falls through as a paragraph. */
export type Block =
  | { kind: "code"; language: string; body: string }
  | { kind: "heading"; level: number; body: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; body: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "rule" }
  | { kind: "paragraph"; body: string };

const FENCE = /^```(\w*)\s*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
/* A table's second line is its rule: pipes, dashes, and the optional colons that
   set alignment. Alignment is parsed away rather than honoured — a chat column
   is too narrow for right-aligned prose to read as anything but a mistake. */
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** The cells of one row. The outer pipes are optional in the wild, so they are
 *  trimmed rather than required. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function parse(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (!paragraph.length) return;
    blocks.push({ kind: "paragraph", body: paragraph.join("\n").trim() });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index]!)) {
        body.push(lines[index]!);
        index += 1;
      }
      blocks.push({ kind: "code", language: fence[1] || "text", body: body.join("\n") });
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    if (/^\s*(---|___|\*\*\*)\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1]!.length, body: heading[2]! });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      const body = [quote[1]!];
      while (index + 1 < lines.length && QUOTE.test(lines[index + 1]!)) {
        index += 1;
        body.push(QUOTE.exec(lines[index]!)![1]!);
      }
      blocks.push({ kind: "quote", body: body.join("\n") });
      continue;
    }

    /* A table is a header line, a rule, and rows — recognised by the rule,
       because a single line of pipes is far more often prose than a table. The
       agent reaches for these constantly to lay out a procedure, and without
       this they arrived as a paragraph of pipes and dashes. */
    if (line.includes("|") && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1]!)) {
      const header = cells(line);
      index += 1;
      const rows: string[][] = [];
      while (index + 1 < lines.length && lines[index + 1]!.includes("|") && lines[index + 1]!.trim()) {
        index += 1;
        const row = cells(lines[index]!);
        /* Ragged rows are padded rather than dropped: a model that miscounts a
           column should cost an empty cell, not the whole table. */
        while (row.length < header.length) row.push("");
        rows.push(row.slice(0, header.length));
      }
      flush();
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      flush();
      const isOrdered = Boolean(ordered);
      const items = [(bullet ?? ordered)![1]!];
      while (index + 1 < lines.length) {
        const next = lines[index + 1]!;
        const nextMatch = isOrdered ? ORDERED.exec(next) : BULLET.exec(next);
        if (!nextMatch) break;
        index += 1;
        items.push(nextMatch[1]!);
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }

    paragraph.push(line);
  }

  flush();
  return blocks;
}

