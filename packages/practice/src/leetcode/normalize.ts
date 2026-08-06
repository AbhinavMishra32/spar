import type { Language } from "@spar/domain";
import { conceptTagsForProblem } from "../concepts.js";
import type {
  PracticeCase, PracticeDifficulty, PracticeExample, PracticeLanguage, PracticeProblem,
  PracticeProblemSummary, PracticeReference, PracticeRegion, PracticeSignature,
} from "../types.js";
import { parseExamples, splitExampleInput, statementToMarkdown } from "./statement.js";
import { LEETCODE_ORIGIN } from "./session.js";

/**
 * The wire shape, turned into `PracticeProblem`.
 *
 * Every field LeetCode can send as something other than what it looks like is
 * handled here rather than at the call site, and there are more of them than the
 * schema suggests: `metaData` and `stats` are JSON *strings*, `similarQuestions`
 * is a JSON string on CN and a real array on global, `hints` can be absent
 * rather than empty, and `status` is null for a problem the learner has not
 * touched. Normalising in one place is what lets the rest of the package treat a
 * problem as data.
 */

/** The three languages Spar can build and run, and LeetCode's slugs for them.
 *  A snippet in any other language is dropped: offering the learner Rust in a
 *  workspace that cannot compile it is worse than not offering it. */
const LANGUAGE_BY_SLUG: Record<string, Language> = {
  javascript: "javascript",
  typescript: "typescript",
  cpp: "cpp",
};

/** Spar's language back to the slug a run must be posted with. */
export const SOURCE_LANGUAGE_SLUG: Record<Language, string> = {
  javascript: "javascript",
  typescript: "typescript",
  cpp: "cpp",
};

const DIFFICULTY: Record<string, PracticeDifficulty> = { easy: "easy", medium: "medium", hard: "hard" };

export function normalizeProblem(node: unknown, region: PracticeRegion): PracticeProblem | null {
  const raw = record(node);
  const slug = text(raw.titleSlug);
  const externalId = text(raw.questionId);
  if (!slug || !externalId) return null;

  const signature = parseSignature(raw.metaData);
  /* CN serves the translated statement and title alongside the English ones and
     leaves the originals populated, so the translation is preferred only when it
     exists — a CN problem with no translation must not come back blank. */
  const html = text(raw.translatedContent) || text(raw.content) || "";
  const statement = statementToMarkdown(html);
  const examples = buildExamples(html, signature);
  const topicTags = tags(raw.topicTags);

  return {
    source: "leetcode",
    region,
    slug,
    externalId,
    displayId: text(raw.questionFrontendId) || externalId,
    title: text(raw.translatedTitle) || text(raw.title) || slug,
    url: `${LEETCODE_ORIGIN[region]}/problems/${slug}/`,
    difficulty: DIFFICULTY[text(raw.difficulty).toLowerCase()] ?? "medium",
    paidOnly: raw.isPaidOnly === true,
    statement,
    hints: list(raw.hints).map((hint) => statementToMarkdown(hint)).filter(Boolean),
    topicTags,
    concepts: conceptTagsForProblem(topicTags),
    references: parseReferences(raw.similarQuestionList ?? raw.similarQuestions),
    languages: parseLanguages(raw.codeSnippets),
    signature,
    examples,
    sampleTestcases: list(raw.exampleTestcaseList),
    acceptanceRate: acceptance(raw),
    status: status(raw.status),
  };
}

export function normalizeProblemSummary(node: unknown): PracticeProblemSummary | null {
  const raw = record(node);
  const slug = text(raw.titleSlug);
  if (!slug) return null;
  const topicTags = tags(raw.topicTags).map((tag) => tag.slug);
  return {
    source: "leetcode",
    slug,
    displayId: text(raw.questionFrontendId) || text(raw.questionId),
    title: text(raw.title) || slug,
    difficulty: DIFFICULTY[text(raw.difficulty).toLowerCase()] ?? "medium",
    paidOnly: raw.isPaidOnly === true,
    acceptanceRate: acceptance(raw),
    topicTags,
    concepts: conceptTagsForProblem(topicTags).map((tag) => tag.slug),
    status: status(raw.status),
  };
}

/**
 * The runnable cases for a problem, best source first.
 *
 * The order is the point. A case whose expected value LeetCode itself published
 * in the statement is worth more than one anybody derived, so statement examples
 * come first and are marked as such; `origin` travels with the case so a failure
 * can be read for what it is. Sample inputs with no known expected value are not
 * returned at all — a case with a guessed expectation is a trap, and the honest
 * answer to "we only have the input" is to let the remote judge answer it.
 */
export function casesForProblem(problem: PracticeProblem): PracticeCase[] {
  const params = problem.signature?.params.map((param) => param.name) ?? [];
  const cases: PracticeCase[] = [];
  problem.examples.forEach((example, index) => {
    if (!example.input.length || !example.output) return;
    cases.push({ name: `Example ${index + 1}`, input: example.input, expected: example.output, origin: "statement" });
  });
  /* The source's own sample inputs, where they line up with an example we already
     have an expected value for. This is not redundant: `exampleTestcaseList` is
     the exact serialisation the judge accepts, so where the two agree the case
     can be replayed remotely *and* locally, and where they disagree the source's
     wins for the remote path. */
  if (params.length) {
    problem.sampleTestcases.forEach((block, index) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length !== params.length) return;
      const existing = cases[index];
      if (existing && existing.input.length === lines.length) existing.input = lines;
    });
  }
  return cases;
}

/** Cases from the statement, in the shape a caller can run. Split per argument
 *  when the signature makes it possible, and dropped when it does not — a case
 *  whose arguments cannot be separated cannot be called. */
function buildExamples(html: string, signature: PracticeSignature | null): PracticeExample[] {
  const params = signature?.params.map((param) => param.name) ?? [];
  return parseExamples(html).flatMap((example) => {
    const input = params.length ? splitExampleInput(example.input, params) : [example.input];
    if (!input) return [];
    return [{ input, output: example.output, explanation: example.explanation }];
  });
}

/**
 * `metaData`, which is a JSON string holding the signature.
 *
 * Design problems ("implement an LRU cache") have a `classname` and a list of
 * methods instead of a single entry point, and those cannot be driven by a
 * generated harness at all. They are marked `classBased` rather than rejected:
 * the problem is still perfectly solvable against LeetCode's own judge, and the
 * only thing that must not happen is Spar pretending it can grade it locally.
 */
function parseSignature(value: unknown): PracticeSignature | null {
  const meta = json(value);
  if (!meta) return null;
  const raw = record(meta);
  const name = text(raw.name);
  if (!name) {
    const className = text(raw.classname);
    return className ? { name: className, params: [], returnType: "void", classBased: true } : null;
  }
  const params = Array.isArray(raw.params)
    ? raw.params.flatMap((entry) => {
      const param = record(entry);
      const paramName = text(param.name);
      return paramName ? [{ name: paramName, type: text(param.type) }] : [];
    })
    : [];
  return { name, params, returnType: text(record(raw.return).type) || "void", classBased: false };
}

function parseLanguages(value: unknown): PracticeLanguage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const snippet = record(entry);
    const language = LANGUAGE_BY_SLUG[text(snippet.langSlug)];
    if (!language) return [];
    return [{ language, slug: text(snippet.langSlug), starter: text(snippet.code) }];
  });
}

/** Related problems. Global sends an array of nodes; CN sends the same
 *  information as a JSON string under a different key, with camelCase fields. */
function parseReferences(value: unknown): PracticeReference[] {
  const entries = Array.isArray(value) ? value : Array.isArray(json(value)) ? (json(value) as unknown[]) : [];
  return entries.flatMap((entry) => {
    const raw = record(entry);
    const slug = text(raw.titleSlug);
    if (!slug) return [];
    return [{
      slug,
      title: text(raw.translatedTitle) || text(raw.title) || slug,
      difficulty: DIFFICULTY[text(raw.difficulty).toLowerCase()] ?? null,
      relation: "similar" as const,
      paidOnly: raw.isPaidOnly === true || raw.paidOnly === true,
    }];
  });
}

/** Acceptance rate, from whichever of the two places the response put it. The
 *  question node has `acRate` on global only; `stats` carries it as a formatted
 *  percentage string on both. */
function acceptance(raw: Record<string, unknown>): number | null {
  const direct = raw.acRate;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const stats = json(raw.stats);
  const rate = stats ? text(record(stats).acRate) : "";
  const parsed = Number.parseFloat(rate.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** LeetCode's per-learner status: "ac" solved, "notac" attempted, null untouched.
 *  Only present while authenticated, so `unknown` and `todo` are different
 *  answers — one means nobody asked, the other means they have not started. */
function status(value: unknown): PracticeProblem["status"] {
  const flag = text(value).toLowerCase();
  if (flag === "ac") return "solved";
  if (flag === "notac" || flag === "tried") return "attempted";
  if (value === null) return "todo";
  return "unknown";
}

function tags(value: unknown): Array<{ slug: string; name: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const raw = record(entry);
    const slug = text(raw.slug);
    return slug ? [{ slug, name: text(raw.translatedName) || text(raw.name) || slug }] : [];
  });
}

function json(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
