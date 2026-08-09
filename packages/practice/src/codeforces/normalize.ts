import type { Language } from "@spar/domain";
import { conceptTagsForProblem } from "../concepts.js";
import type { PracticeCase, PracticeDifficulty, PracticeProblem, PracticeProblemSummary } from "../types.js";
import { CODEFORCES_ORIGIN } from "./session.js";

export type CodeforcesProblemWire = { contestId?: number; problemsetName?: string; index?: string; name?: string; type?: string; points?: number; rating?: number; tags?: string[] };
export type CodeforcesProblemStatWire = { contestId?: number; index?: string; solvedCount?: number };

export function codeforcesSlug(problem: CodeforcesProblemWire): string {
  return problem.contestId && problem.index ? `${problem.contestId}/${problem.index}` : "";
}

export function parseCodeforcesSlug(slug: string): { contestId: number; index: string } | null {
  const match = /^(\d+)\/([A-Za-z0-9]+)$/.exec(slug.trim());
  return match ? { contestId: Number(match[1]), index: match[2]! } : null;
}

export function codeforcesDifficulty(rating?: number): PracticeDifficulty {
  if (!rating || rating <= 1200) return "easy";
  if (rating <= 1900) return "medium";
  return "hard";
}

export function normalizeCodeforcesSummary(problem: CodeforcesProblemWire, stat?: CodeforcesProblemStatWire, status: PracticeProblemSummary["status"] = "unknown"): PracticeProblemSummary | null {
  const slug = codeforcesSlug(problem);
  if (!slug || !problem.name) return null;
  const tags = problem.tags ?? [];
  const concepts = conceptTagsForProblem(tags.map((name) => ({ slug: name, name }))).map((entry) => entry.slug);
  return {
    source: "codeforces", slug, displayId: slug, title: problem.name,
    difficulty: codeforcesDifficulty(problem.rating), paidOnly: false, acceptanceRate: null,
    topicTags: tags, concepts, status,
  };
}

export function normalizeCodeforcesProblem(problem: CodeforcesProblemWire, html: string, status: PracticeProblem["status"] = "unknown"): PracticeProblem | null {
  const summary = normalizeCodeforcesSummary(problem, undefined, status);
  const parsed = parseCodeforcesSlug(summary?.slug ?? "");
  if (!summary || !parsed) return null;
  const statement = extractProblemStatement(html);
  const examples = extractSamples(html);
  const topicTags = (problem.tags ?? []).map((name) => ({ slug: name, name }));
  const languages: PracticeProblem["languages"] = (["javascript", "typescript", "cpp"] as Language[]).map((language) => ({ language, slug: CODEFORCES_LANGUAGE_SLUG[language], starter: starter(language) }));
  return {
    ...summary,
    region: "global",
    externalId: summary.slug,
    url: `${CODEFORCES_ORIGIN}/problemset/problem/${parsed.contestId}/${parsed.index}`,
    statement,
    hints: [], topicTags, concepts: conceptTagsForProblem(topicTags), references: [], languages,
    signature: null,
    examples: examples.map((entry) => ({ input: [entry.input], output: entry.output, explanation: "" })),
    sampleTestcases: examples.map((entry) => entry.input),
  };
}

export function casesForCodeforcesProblem(problem: PracticeProblem): PracticeCase[] {
  return problem.examples.flatMap((example, index) => example.input.length === 1 && example.output.trim()
    ? [{ name: `Example ${index + 1}`, input: example.input, expected: example.output, origin: "source" as const }]
    : []);
}

export const CODEFORCES_LANGUAGE_SLUG: Record<Language, string> = { javascript: "javascript", typescript: "typescript", cpp: "cpp" };

function starter(language: Language): string {
  if (language === "cpp") return "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n\n  // Read input, solve the problem, and print the answer.\n  return 0;\n}";
  if (language === "typescript") return "import * as fs from \"fs\";\n\nconst input: string = fs.readFileSync(0, \"utf8\").trim();\n// Parse input, solve the problem, and print the answer.\nvoid input;";
  return "const fs = require(\"fs\");\n\nconst input = fs.readFileSync(0, \"utf8\").trim();\n// Parse input, solve the problem, and print the answer.\nvoid input;";
}

function extractProblemStatement(html: string): string {
  const block = balancedDiv(html, html.search(/<div[^>]+class=["'][^"']*problem-statement/));
  if (!block) return "Codeforces did not return a readable statement for this problem.";
  return decode(block
    .replace(/<div[^>]+class=["']header["'][^>]*>[\s\S]*?<\/div>\s*<div[^>]+class=["']time-limit["'][^>]*>[\s\S]*?<\/div>\s*<div[^>]+class=["']memory-limit["'][^>]*>[\s\S]*?<\/div>\s*<div[^>]+class=["']input-file["'][^>]*>[\s\S]*?<\/div>\s*<div[^>]+class=["']output-file["'][^>]*>[\s\S]*?<\/div>/i, "")
    .replace(/<div[^>]+class=["']sample-test["'][^>]*>[\s\S]*$/i, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_match, body: string) => `\n\n\`\`\`text\n${htmlText(body)}\n\`\`\`\n\n`)
    .replace(/<li[^>]*>/gi, "\n- ").replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|section|h\d)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
  ).replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractSamples(html: string): Array<{ input: string; output: string }> {
  const block = balancedDiv(html, html.search(/<div[^>]+class=["'][^"']*sample-test/));
  if (!block) return [];
  const inputs = [...block.matchAll(/<div[^>]+class=["']input["'][^>]*>[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>[\s\S]*?<\/div>/gi)].map((match) => htmlText(match[1] ?? ""));
  const outputs = [...block.matchAll(/<div[^>]+class=["']output["'][^>]*>[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>[\s\S]*?<\/div>/gi)].map((match) => htmlText(match[1] ?? ""));
  return inputs.flatMap((input, index) => outputs[index] === undefined ? [] : [{ input, output: outputs[index]! }]);
}

function balancedDiv(html: string, start: number): string {
  if (start < 0) return "";
  const tokens = /<\/?div\b[^>]*>/gi;
  tokens.lastIndex = start;
  let depth = 0;
  for (let match = tokens.exec(html); match; match = tokens.exec(html)) {
    if (/^<div/i.test(match[0])) depth += 1; else depth -= 1;
    if (depth === 0) return html.slice(start, tokens.lastIndex);
  }
  return "";
}

function htmlText(value: string): string { return decode(value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\r/g, "").trim(); }
function decode(value: string): string { return value.replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&").replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code))); }
