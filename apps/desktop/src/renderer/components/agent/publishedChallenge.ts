import { languageSchema, type Language, type Question } from "@spar/domain";
import type { ToolPart } from "./agentRun";

/**
 * What the transcript knows about a challenge the moment it lands.
 *
 * The thread has no access to the session's question record — it is a list of
 * things that happened, not a view of current state — so everything the card
 * draws has to come off the tool row itself. That is not a compromise: the row
 * carries the design the agent sent and the result the host sent back, which
 * between them hold the title, the language, the band, what it is about, and how
 * many cases will grade it. A card built from those is a card that cannot
 * disagree with the challenge it is announcing.
 *
 * Read tolerantly on purpose — see `fields`. A row whose payload was clipped
 * still yields a title, and a card with a title and nothing else is the row this
 * replaces.
 */
export type PublishedChallenge = {
  title: string;
  /** Null when the payload was clipped before the field, which is the one case
   *  where the card simply shows less rather than guessing. */
  language: Language | null;
  difficulty: Question["difficulty"] | null;
  /** The source's own band, for a problem Spar mounted rather than wrote. Spar's
   *  four bands and a judge's three are different claims by different graders,
   *  so they are carried separately rather than folded into one field that would
   *  have to lie about which of them said it. */
  band: "easy" | "medium" | "hard" | null;
  /** The judge that will decide it, for a problem Spar did not write. */
  source: "leetcode" | "codeforces" | null;
  /** How the source names it on its own site — "4/A", "1". */
  displayId: string | null;
  /** What it is about, primary first, as the agent tagged it. */
  concepts: string[];
  /** Whether this took the place of a challenge that was already open. */
  replaced: boolean;
  /** The challenge this one superseded. Kept separately from `replaced` so the
   *  transcript can offer the actual earlier card instead of a decorative
   *  second layer that leads nowhere. */
  replacedQuestionId: string | null;
  /** Cases the grader runs, measured by the compiler rather than counted off the
   *  test source. Null for a sourced problem, which Spar did not compile. */
  cases: number | null;
  /** The published challenge's own id, which is what a card can act on — saving
   *  it, opening it. Null while the call is still running and for a row stored
   *  before the result carried one. */
  questionId: string | null;
  /** Its place in the session, for the same compact identity the workspace
   *  toolbar uses. */
  ordinal: number | null;
};

const DIFFICULTIES = new Set(["foundation", "developing", "proficient", "advanced"]);
const BANDS = new Set(["easy", "medium", "hard"]);

/**
 * One tool payload, as fields, whether or not it survived the trip whole.
 *
 * `toolPayload` caps a payload at 16k characters and a challenge design carries
 * its starter files and its whole visible suite, so a large one arrives with its
 * closing brace missing and `JSON.parse` throws on the lot. The fallback reads
 * top-level keys straight out of the pretty-printed text — two-space indent,
 * which is exactly what makes a top-level key distinguishable from the same key
 * nested inside a file map — so a clipped payload still gives up everything
 * before the cut instead of nothing at all.
 */
function fields(payload: string): Record<string, unknown> {
  if (!payload.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* Clipped, so scrape what arrived. Strings only: a top-level object or array
       that was cut in half cannot be recovered by a regex and must not be
       guessed at. */
    const found: Record<string, unknown> = {};
    for (const match of payload.matchAll(/^ {2}"([A-Za-z]+)": "((?:[^"\\]|\\.)*)"/gm)) {
      try { found[match[1]!] = JSON.parse(`"${match[2]!}"`); } catch { /* not a string this row can use */ }
    }
    return found;
  }
  return {};
}

function text(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === "string" ? (record[key] as string).trim() : "";
}

/** The agent's tags, primary first. Its own `role` decides that rather than the
 *  order it happened to write them in — the prompt asks for most-specific-first
 *  and the primary is the one the challenge is actually aimed at, which is the
 *  one worth reading when only two fit on the card. */
function concepts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const tag = entry as Record<string, unknown>;
    const slug = typeof tag.slug === "string" ? tag.slug.trim() : "";
    if (!slug) return [];
    return [{ label: typeof tag.title === "string" && tag.title.trim() ? tag.title.trim() : slug.replace(/-/g, " "), primary: tag.role === "primary" }];
  });
  return [...tags.filter((tag) => tag.primary), ...tags.filter((tag) => !tag.primary)].map((tag) => tag.label);
}

/** Cases the reference actually ran, as the compiler counted them. */
function caseCount(report: unknown): number | null {
  if (!report || typeof report !== "object") return null;
  const counts = (report as Record<string, unknown>).caseCounts;
  if (!counts || typeof counts !== "object") return null;
  const { visible, hidden } = counts as Record<string, unknown>;
  if (typeof visible !== "number" || typeof hidden !== "number") return null;
  return visible + hidden;
}

/** The id the host gave the challenge it just wrote. */
function questionId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" && id ? id : null;
}

function questionOrdinal(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const ordinal = (value as Record<string, unknown>).ordinal;
  return typeof ordinal === "number" && Number.isInteger(ordinal) && ordinal > 0 ? ordinal : null;
}

export function readPublishedChallenge(part: ToolPart): PublishedChallenge {
  const sent = fields(part.input);
  const back = fields(part.output);
  const sourced = part.tool === "assign_practice_problem";
  const source = sent.source === "leetcode" || sent.source === "codeforces" ? sent.source : null;
  const published = back.source && typeof back.source === "object" ? back.source as Record<string, unknown> : {};
  const language = languageSchema.safeParse(sent.language);
  const difficulty = text(sent, "difficulty");
  const band = text(published, "difficulty");

  return {
    /* `label` is the worker's own summary of the call and is set from the design's
       title, so it is both the most reliable field here and the one the row above
       this card already used. A sourced problem has no title in its arguments —
       the title belongs to the source and arrives with the mount — so it falls
       back to the slug, which is the problem's own name on its own site. */
    title: part.label.trim() || text(sent, "slug") || "Challenge",
    language: language.success ? language.data : null,
    /* Spar's four bands for a challenge it wrote; the source's three for one it
       mounted, because the source graded it and Spar did not. */
    difficulty: DIFFICULTIES.has(difficulty) ? difficulty as Question["difficulty"] : null,
    band: BANDS.has(band) ? band as PublishedChallenge["band"] : null,
    source: sourced ? source : null,
    displayId: text(published, "displayId") || null,
    concepts: concepts(sent.concepts),
    replaced: part.tool === "replace_current_question" || typeof back.replacedQuestionId === "string",
    replacedQuestionId: typeof back.replacedQuestionId === "string" && back.replacedQuestionId ? back.replacedQuestionId : null,
    cases: sourced ? null : caseCount(back.report),
    questionId: questionId(back.question),
    ordinal: questionOrdinal(back.question),
  };
}
