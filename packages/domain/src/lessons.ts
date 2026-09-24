import { z } from "zod";
import { id, isoDate } from "./model.js";

/**
 * Something Spar taught, kept.
 *
 * Spar's only durable output used to be challenges: every turn that had
 * something to say about an idea said it in the reply and the reply scrolled
 * away, so the agent could never point at what it had already explained and the
 * learner could never go back to it. A turn that needed to teach either taught
 * into the void or skipped the teaching and set another problem.
 *
 * A lesson is the other kind of thing a turn can produce. It is addressable, so
 * a later turn can say "this is the aliasing I showed you" and mean a page the
 * learner can open; and it is durable, so what was taught outlives the session
 * it was taught in.
 *
 * Deliberately not a document. It is pages, each one short enough to hold in
 * mind at once, because the failure mode of an agent given a markdown field is
 * an essay nobody reads. The page boundary is the pacing.
 */

/** One page. The title is what the deck's rail and the card's preview show, so
 *  it has to say what the page is about rather than number it. */
export const lessonPageSchema = z.object({
  title: z.string().min(3).max(90),
  /** Markdown. Spar's own `[[concept:…]]` and `[[lesson:…]]` references work
   *  here exactly as they do in a reply — see `MarkdownLinks`. */
  body: z.string().min(20).max(4_000),
  /** The one sentence to keep if they keep nothing else. Optional because not
   *  every page has a line worth pulling out, and a forced one is filler. */
  takeaway: z.string().min(8).max(200).optional(),
});
export type LessonPage = z.infer<typeof lessonPageSchema>;

/**
 * Somewhere else to read, and how much weight it carries.
 *
 * Four kinds because they are four different promises. A `url` was fetched this
 * turn and is current. A `concept` and a `lesson` are Spar's own records, and
 * both resolve to something already in the learner's history. A `reading` is the
 * agent naming a book or a chapter from its own memory, which is worth saying
 * and is not worth dressing up as a link — it gets no chip and no click, so a
 * remembered title can never look like a checked one.
 */
export const lessonReferenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url"),
    label: z.string().min(3).max(120),
    url: z.string().url(),
    /** Why this one is worth the click, in the agent's own words. */
    note: z.string().min(8).max(240),
  }),
  z.object({
    kind: z.literal("concept"),
    label: z.string().min(2).max(120),
    slug: z.string().min(2).max(60),
    note: z.string().min(8).max(240),
  }),
  z.object({
    kind: z.literal("lesson"),
    label: z.string().min(3).max(120),
    lessonId: id,
    note: z.string().min(8).max(240),
  }),
  z.object({
    kind: z.literal("reading"),
    label: z.string().min(3).max(120),
    note: z.string().min(8).max(240),
  }),
]);
export type LessonReference = z.infer<typeof lessonReferenceSchema>;

/**
 * What the agent sends when it teaches.
 *
 * `summary` is the sentence under the title on the card and in the reply's own
 * reference to it, so it says what the learner will know afterwards rather than
 * what the lesson covers. `concepts` is what files it against everything else
 * they have done — the same vocabulary a challenge is tagged with, so a concept
 * card can show what was taught about it alongside what was tested.
 */
export const lessonInputSchema = z.object({
  title: z.string().min(4).max(90),
  summary: z.string().min(20).max(300),
  concepts: z.array(z.string().min(2).max(60)).min(1).max(5)
    .describe("concept slugs, primary first, in the same vocabulary challenges are tagged with"),
  pages: z.array(lessonPageSchema).min(1).max(8),
  references: z.array(lessonReferenceSchema).max(6).default([]),
});
export type LessonInput = z.infer<typeof lessonInputSchema>;

/** A stored lesson: what was sent, plus where and when it was taught. */
export const lessonSchema = lessonInputSchema.extend({
  id,
  sessionId: id,
  createdAt: isoDate,
});
export type Lesson = z.infer<typeof lessonSchema>;
