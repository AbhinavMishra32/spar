import type { ToolPart } from "./agentRun";

/**
 * What the transcript knows about a lesson the moment it lands.
 *
 * The same trick the challenge card uses, for the same reason: the thread is a
 * list of things that happened, not a view of current state, so the card is
 * built from the tool row itself — the pages the agent sent and the id the host
 * sent back. A card built from those cannot disagree with the lesson it is
 * announcing, and it draws with no fetch, which is what lets an old transcript
 * scroll at speed.
 *
 * Read tolerantly on purpose. `toolPayload` caps a payload at 16k and a lesson
 * carries every page of markdown, so a long one arrives with its closing brace
 * missing. A clipped payload still yields a title and whatever pages made it
 * through, and a card with a title and one page is a better row than no card.
 */
export type TaughtLesson = {
  /** The host's id for it, and the only thing a card can act on. Null while the
   *  call is still running and for a row whose result was clipped. */
  id: string | null;
  title: string;
  summary: string;
  /** Page titles, in order. The titles rather than the count, because the count
   *  is a size and the titles are a reason to open it. */
  pages: string[];
  /** How many places to read next. A number, not the list: a reading list on a
   *  card is a card nobody reads. */
  references: number;
  concepts: string[];
};

function fields(payload: string): Record<string, unknown> {
  if (!payload.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* Clipped. Scrape the top-level string keys, which the two-space indent of
       the pretty-printed payload makes distinguishable from the same key nested
       inside a page. Strings only: a half-written array cannot be guessed at. */
    const found: Record<string, unknown> = {};
    for (const match of payload.matchAll(/^ {2}"([A-Za-z]+)": "((?:[^"\\]|\\.)*)"/gm)) {
      try { found[match[1]!] = JSON.parse(`"${match[2]!}"`); } catch { /* not a string this card can use */ }
    }
    return found;
  }
  return {};
}

function text(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === "string" ? (record[key] as string).trim() : "";
}

function titles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const title = (entry as Record<string, unknown>).title;
    return typeof title === "string" && title.trim() ? [title.trim()] : [];
  });
}

function slugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (typeof entry === "string" && entry.trim() ? [entry.trim()] : []));
}

/** The shared-layout id a lesson's card and its reader both claim, so opening
 *  one is the card growing rather than a panel arriving over it. */
export function lessonLayoutId(id: string): string {
  return `lesson-surface-${id}`;
}

export function readTaughtLesson(part: ToolPart): TaughtLesson {
  const sent = fields(part.input);
  const back = fields(part.output);
  return {
    id: text(back, "lessonId") || null,
    /* `label` is the worker's own summary of the call and is set from the
       lesson's title, so it survives a clip that ate the arguments. */
    title: text(back, "title") || text(sent, "title") || part.label.trim() || "Lesson",
    summary: text(sent, "summary"),
    pages: titles(sent.pages),
    references: Array.isArray(sent.references) ? sent.references.length : 0,
    concepts: slugs(sent.concepts),
  };
}

/** A bounded transition: no spring tail after the panel reaches its destination. */
export const LESSON_MORPH = { type: "tween", duration: 0.24, ease: [0.22, 0.8, 0.25, 1] } as const;
