import type { ChallengeSource } from "@spar/domain";

export type PresentedStatement = { statement: string; hints: string[] };

const SOURCE_NAME: Record<ChallengeSource["source"], string> = {
  leetcode: "LeetCode",
  codeforces: "Codeforces",
};

/**
 * Compatibility at the display boundary for challenges saved by older builds.
 *
 * New challenges persist provider prose, hints and source metadata separately.
 * Existing rows cannot be re-fetched or rewritten merely because somebody opens
 * them, though, so this removes the old app-authored markdown footer and repairs
 * the two provider artefacts that are already durable in those rows.
 */
export function presentSourcedStatement(sourceText: string, source: ChallengeSource | null): PresentedStatement {
  if (!source) return { statement: sourceText, hints: [] };

  const legacy = legacyHints(sourceText);
  let statement = legacy.statement;
  const footer = `\n\n---\n\n**${SOURCE_NAME[source.source]} ${source.displayId} ·`;
  const footerAt = statement.lastIndexOf(footer);
  if (footerAt >= 0) statement = statement.slice(0, footerAt);

  if (source.source === "codeforces") {
    statement = stripLegacyCodeforcesHeader(statement);
    statement = statement.replace(/\${3}([\s\S]*?)\${3}/g, (_match, body: string) => `\`${readableLatex(body)}\``);
    statement = statement.replace(/\n\nExamples?\s*$/i, "");
  }

  return {
    statement: statement.trim(),
    hints: unique([...(source.hints ?? []), ...legacy.hints]),
  };
}

function legacyHints(source: string): PresentedStatement {
  const match = /\n*<details><summary>[^<]*hint[^<]*<\/summary>\s*\n([\s\S]*?)\n<\/details>\s*$/i.exec(source);
  if (!match) return { statement: source, hints: [] };
  const hints = (match[1] ?? "")
    .split(/\n(?=\d+\.\s)/)
    .map((item) => item.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
  return { statement: source.slice(0, match.index), hints };
}

function stripLegacyCodeforcesHeader(source: string): string {
  /* Bound this compatibility read to the start of the statement. If a problem's
     prose later discusses "standard output", it must not eat the real content. */
  const prefix = source.slice(0, 1_200);
  const match = /^[\s\S]*?\btime limit per test\b[\s\S]*?\bmemory limit per test\b[\s\S]*?\binput\b\s+standard input\s+\boutput\b\s+standard output\s*/i.exec(prefix);
  return match ? source.slice(match[0].length) : source;
}

function readableLatex(value: string): string {
  return value
    .replace(/\\(?:leq?|le)/g, "≤").replace(/\\(?:geq?|ge)/g, "≥")
    .replace(/\\lt/g, "<").replace(/\\gt/g, ">")
    .replace(/\\ne(q)?/g, "≠").replace(/\\cdot|\\times/g, "×")
    .replace(/\\(?:ldots|dots)/g, "…").replace(/\\infty/g, "∞")
    .replace(/\\(?:text|mathrm|operatorname)\{([^{}]*)\}/g, "$1")
    .replace(/[{}]/g, "").replace(/\\([A-Za-z]+)/g, "$1").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
