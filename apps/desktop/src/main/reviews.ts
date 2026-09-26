import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_FSRS, DEFAULT_REVIEW_TARGETS, implicitCredit, newMemoryState, previewSchedule, retrievability, reviewGradeSchema, reviewPromptSchema, scheduleReview,
  type ConceptTag, type FsrsParameters, type FsrsRating, type InsightIndependence, type MemoryState, type ReviewCard, type ReviewCardDetail,
  type ReviewFormat, type ReviewGrade, type ReviewIntervalPreview, type ReviewLog, type ReviewOverview, type ReviewPending, type ReviewPrompt,
  type ReviewScheduleEntry, type ReviewSource, type ReviewTarget, reviewTargetSchema,
} from "@spar/domain";

/*
 * The review ledger: insight cards, their FSRS memory state, and every review.
 *
 * Its own module rather than more of LocalStore because it is its own subsystem
 * with its own invariants — one card per challenge, a schedule that only ever
 * moves by a logged review, prompts that are written before they are answered —
 * and because LocalStore is already the size where a new feature inside it is
 * hard to find. It shares LocalStore's connection, so a card and the question it
 * belongs to are always in the same transaction scope, and deleting a session
 * cascades through questions into cards and logs.
 */

export const REVIEW_SCHEMA = `
  CREATE TABLE IF NOT EXISTS review_cards (id TEXT PRIMARY KEY, question_id TEXT NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE, session_id TEXT NOT NULL, attempt_id TEXT, title TEXT NOT NULL, trigger_cue TEXT NOT NULL, insight TEXT NOT NULL, invariant TEXT, click TEXT NOT NULL, independence TEXT NOT NULL, pitfalls TEXT NOT NULL, rubric TEXT NOT NULL, transfer TEXT NOT NULL, concept_slugs TEXT NOT NULL, state TEXT NOT NULL, stability REAL NOT NULL, difficulty REAL NOT NULL, due_at TEXT NOT NULL, last_review_at TEXT, reps INTEGER NOT NULL, lapses INTEGER NOT NULL, suspended INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS review_cards_due_idx ON review_cards(suspended, due_at);
  CREATE TABLE IF NOT EXISTS review_logs (id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES review_cards(id) ON DELETE CASCADE, reviewed_at TEXT NOT NULL, source TEXT NOT NULL, format TEXT, rating INTEGER NOT NULL, suggested_rating INTEGER, prompt TEXT, answer TEXT, feedback TEXT, grade TEXT, elapsed_days REAL NOT NULL, scheduled_days REAL NOT NULL, retrievability REAL NOT NULL, stability_before REAL NOT NULL, stability_after REAL NOT NULL, difficulty_before REAL NOT NULL, difficulty_after REAL NOT NULL);
  CREATE INDEX IF NOT EXISTS review_logs_card_idx ON review_logs(card_id, reviewed_at);
  CREATE INDEX IF NOT EXISTS review_logs_time_idx ON review_logs(reviewed_at);
  CREATE TABLE IF NOT EXISTS review_prompts (id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES review_cards(id) ON DELETE CASCADE, payload TEXT NOT NULL, cue_shown INTEGER NOT NULL DEFAULT 0, answer TEXT, grade TEXT, suggested_rating INTEGER, created_at TEXT NOT NULL, graded_at TEXT, closed_at TEXT);
  CREATE INDEX IF NOT EXISTS review_prompts_card_idx ON review_prompts(card_id, created_at);
`;

/** How far a review of one card moves its siblings — cards whose primary concept
 *  is the same. Success shares less than failure pulls: a failure on a pattern is
 *  better evidence about the pattern than one success is. */
const SIBLING_CREDIT_WEIGHT = 0.2;
const SIBLING_PENALTY_WEIGHT = 0.35;
const DAY_MS = 86_400_000;

export type InsightInput = {
  questionId: string;
  attemptId: string | null;
  title: string;
  trigger: string;
  insight: string;
  invariant: string | null;
  click: { summary: string; runOrdinal: number | null; diff: string | null };
  independence: InsightIndependence;
  pitfalls: Array<{ mistake: string; fix: string }>;
  rubric: string[];
  transfer: string[];
  conceptSlugs: string[];
  /** What the card rehearses; left out, a refined card keeps what it had. */
  targets?: ReviewTarget[] | undefined;
  /** The learner's own words for what to remember, when they were asked. */
  remember?: string | null | undefined;
  firstRating: FsrsRating;
};

type CardRow = {
  id: string; question_id: string; session_id: string; attempt_id: string | null; title: string; trigger_cue: string; insight: string; invariant: string | null;
  click: string; independence: string; pitfalls: string; rubric: string; transfer: string; concept_slugs: string; targets: string | null; remember: string | null; state: string; stability: number; difficulty: number;
  due_at: string; last_review_at: string | null; reps: number; lapses: number; suspended: number; version: number; created_at: string; updated_at: string;
  question_title?: string;
};
type LogRow = {
  id: string; card_id: string; reviewed_at: string; source: string; format: string | null; target: string | null; rating: number; suggested_rating: number | null; prompt: string | null;
  answer: string | null; feedback: string | null; elapsed_days: number; scheduled_days: number; retrievability: number; stability_before: number; stability_after: number;
  difficulty_before: number; difficulty_after: number;
};
type PromptRow = { id: string; card_id: string; payload: string; cue_shown: number; revealed_at?: string | null; answer: string | null; grade: string | null; suggested_rating: number | null; created_at: string; graded_at: string | null; closed_at: string | null };

export class ReviewLedger {
  constructor(private readonly db: Database.Database, private readonly parameters: () => FsrsParameters = () => DEFAULT_FSRS) {
    db.exec(REVIEW_SCHEMA);
    this.ensureColumn("review_cards", "targets", "TEXT");
    this.ensureColumn("review_logs", "target", "TEXT");
    this.ensureColumn("review_prompts", "revealed_at", "TEXT");
    this.ensureColumn("review_cards", "remember", "TEXT");
  }

  private ensureColumn(table: string, column: string, declaration: string) {
    const columns = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  }

  /**
   * File what a solve taught.
   *
   * One card per challenge. A challenge solved again — the review sent it back
   * and the learner fixed it — refines the card it already has rather than
   * starting a second schedule, because it is still one idea; only a card that
   * has never been scheduled takes its first grade from this solve.
   */
  recordInsight(input: InsightInput, now = new Date()): { card: ReviewCard; created: boolean } {
    return this.db.transaction(() => {
      const question = this.db.prepare("SELECT id, session_id FROM questions WHERE id=?").get(input.questionId) as { id: string; session_id: string } | undefined;
      if (!question) throw new Error("That challenge no longer exists, so there is nothing to file an insight against.");
      const existing = this.db.prepare("SELECT * FROM review_cards WHERE question_id=?").get(input.questionId) as CardRow | undefined;
      const stamp = now.toISOString();
      const content = [input.attemptId, input.title.trim(), input.trigger.trim(), input.insight.trim(), input.invariant?.trim() || null, JSON.stringify(input.click), input.independence, JSON.stringify(input.pitfalls), JSON.stringify(input.rubric), JSON.stringify(input.transfer), JSON.stringify(unique(input.conceptSlugs))] as const;
      const targets = input.targets?.length ? JSON.stringify(cleanTargets(input.targets)) : null;
      const remember = input.remember?.trim().slice(0, 600) || null;
      if (existing) {
        this.db.prepare("UPDATE review_cards SET attempt_id=?, title=?, trigger_cue=?, insight=?, invariant=?, click=?, independence=?, pitfalls=?, rubric=?, transfer=?, concept_slugs=?, targets=COALESCE(?, targets), remember=COALESCE(?, remember), version=version+1, updated_at=? WHERE id=?")
          .run(...content, targets, remember, stamp, existing.id);
        return { card: this.card(existing.id)!, created: false };
      }
      const id = randomUUID();
      const scheduled = scheduleReview(newMemoryState(now), input.firstRating, now, this.parameters(), id);
      this.db.prepare(`INSERT INTO review_cards (id, question_id, session_id, attempt_id, title, trigger_cue, insight, invariant, click, independence, pitfalls, rubric, transfer, concept_slugs, targets, remember, state, stability, difficulty, due_at, last_review_at, reps, lapses, suspended, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`)
        .run(id, input.questionId, question.session_id, ...content, targets ?? JSON.stringify(DEFAULT_REVIEW_TARGETS), remember, scheduled.next.state, scheduled.next.stability, scheduled.next.difficulty, scheduled.next.dueAt, scheduled.next.lastReviewAt, scheduled.next.reps, scheduled.next.lapses, stamp, stamp);
      this.insertLog({ cardId: id, source: "solve", format: null, target: null, rating: input.firstRating, suggestedRating: null, prompt: null, answer: null, feedback: input.click.summary, grade: null }, newMemoryState(now), scheduled, now);
      return { card: this.card(id)!, created: true };
    })();
  }

  card(id: string, now = new Date()): ReviewCard | null {
    const row = this.db.prepare("SELECT c.*, q.title question_title FROM review_cards c JOIN questions q ON q.id=c.question_id WHERE c.id=?").get(id) as CardRow | undefined;
    return row ? this.toCard(row, now) : null;
  }

  cardForQuestion(questionId: string, now = new Date()): ReviewCard | null {
    const row = this.db.prepare("SELECT c.*, q.title question_title FROM review_cards c JOIN questions q ON q.id=c.question_id WHERE c.question_id=?").get(questionId) as CardRow | undefined;
    return row ? this.toCard(row, now) : null;
  }

  list(now = new Date()): ReviewCard[] {
    return (this.db.prepare("SELECT c.*, q.title question_title FROM review_cards c JOIN questions q ON q.id=c.question_id ORDER BY c.due_at").all() as CardRow[]).map((row) => this.toCard(row, now));
  }

  /**
   * What is due, in the order to review it.
   *
   * Least-retained first — the card the forgetting curve says is slipping most —
   * then interleaved so two cards on the same pattern are never back to back.
   * Interleaving is the point: a queue of five sliding-window reviews in a row
   * rehearses the window, not the choosing of it.
   */
  due(now = new Date(), limit = 50): ReviewCard[] {
    const rows = this.db.prepare("SELECT c.*, q.title question_title FROM review_cards c JOIN questions q ON q.id=c.question_id WHERE c.suspended=0 AND c.due_at<=? ORDER BY c.due_at").all(now.toISOString()) as CardRow[];
    const cards = rows.map((row) => this.toCard(row, now)).sort((left, right) => left.retrievability - right.retrievability);
    return interleave(cards, (card) => card.concepts[0]?.slug ?? card.id).slice(0, limit);
  }

  detail(id: string, now = new Date()): ReviewCardDetail | null {
    const card = this.card(id, now);
    if (!card) return null;
    return { card, logs: this.logs(id), intervals: this.intervals(card, now) };
  }

  logs(cardId: string): ReviewLog[] {
    return (this.db.prepare("SELECT * FROM review_logs WHERE card_id=? ORDER BY reviewed_at").all(cardId) as LogRow[]).map(toLog);
  }

  intervals(card: ReviewCard, now = new Date()): ReviewIntervalPreview {
    const preview = previewSchedule(memoryOf(card), now, this.parameters(), `${card.id}:${card.reps}`);
    return Object.fromEntries(Object.entries(preview).map(([name, value]) => [name, { days: value.scheduledDays, dueAt: value.next.dueAt }])) as ReviewIntervalPreview;
  }

  /* ---- Prompts: written by the agent, answered by the learner ------------- */

  savePrompt(cardId: string, prompt: ReviewPrompt, now = new Date()): ReviewPending {
    const id = randomUUID();
    this.db.prepare("UPDATE review_prompts SET closed_at=? WHERE card_id=? AND closed_at IS NULL").run(now.toISOString(), cardId);
    this.db.prepare("INSERT INTO review_prompts (id, card_id, payload, created_at) VALUES (?, ?, ?, ?)").run(id, cardId, JSON.stringify(prompt), now.toISOString());
    return pendingOf({ id, card_id: cardId, payload: JSON.stringify(prompt), created_at: now.toISOString() });
  }

  /** The prompt still waiting on this card, so leaving a review does not throw
   *  away a question the agent already spent a call writing — unless its back
   *  was seen, which would make asking it again a reading test. */
  openPrompt(cardId: string): ReviewPending | null {
    const row = this.db.prepare("SELECT * FROM review_prompts WHERE card_id=? AND closed_at IS NULL AND graded_at IS NULL AND revealed_at IS NULL ORDER BY created_at DESC LIMIT 1").get(cardId) as PromptRow | undefined;
    if (!row) return null;
    /* A question written before cards had a back was written as an essay
       prompt; asking it now would bring the old kind of review back. */
    if (!reviewPromptSchema.safeParse(JSON.parse(row.payload)).data?.answer) {
      this.db.prepare("UPDATE review_prompts SET closed_at=? WHERE id=?").run(new Date().toISOString(), row.id);
      return null;
    }
    return pendingOf(row);
  }

  prompt(id: string): { row: PromptRow; prompt: ReviewPrompt } | null {
    const row = this.db.prepare("SELECT * FROM review_prompts WHERE id=?").get(id) as PromptRow | undefined;
    if (!row) return null;
    const parsed = reviewPromptSchema.safeParse(JSON.parse(row.payload));
    return parsed.success ? { row, prompt: parsed.data } : null;
  }

  revealCue(id: string): string | null {
    const found = this.prompt(id);
    if (!found || found.row.closed_at) return null;
    this.db.prepare("UPDATE review_prompts SET cue_shown=1 WHERE id=?").run(id);
    return found.prompt.cue;
  }

  /** Flip the card. The back is whatever the writer put there, or its
   *  expected points when it wrote none. */
  revealAnswer(id: string, now = new Date()): string | null {
    const found = this.prompt(id);
    if (!found || found.row.closed_at) return null;
    if (!found.row.revealed_at) this.db.prepare("UPDATE review_prompts SET revealed_at=? WHERE id=?").run(now.toISOString(), id);
    return found.prompt.answer ?? found.prompt.expected.map((point) => `- ${point}`).join("\n");
  }

  /** Leave a review without filing it. The card keeps its schedule; the
   *  question is kept for next time only if its back was never seen. */
  abandonPrompt(id: string, now = new Date()) {
    const found = this.prompt(id);
    if (!found || found.row.closed_at) return;
    if (found.row.revealed_at || found.row.graded_at) this.db.prepare("UPDATE review_prompts SET closed_at=? WHERE id=?").run(now.toISOString(), id);
  }

  saveGrade(id: string, answer: string, grade: ReviewGrade, suggestedRating: FsrsRating, now = new Date()) {
    this.db.prepare("UPDATE review_prompts SET answer=?, grade=?, suggested_rating=?, graded_at=? WHERE id=?").run(answer, JSON.stringify(grade), suggestedRating, now.toISOString(), id);
  }

  gradeFor(id: string): { answer: string; grade: ReviewGrade; suggestedRating: FsrsRating } | null {
    const row = this.db.prepare("SELECT answer, grade, suggested_rating FROM review_prompts WHERE id=?").get(id) as { answer: string | null; grade: string | null; suggested_rating: number | null } | undefined;
    if (!row?.grade || row.answer === null || !row.suggested_rating) return null;
    const grade = reviewGradeSchema.safeParse(JSON.parse(row.grade));
    return grade.success ? { answer: row.answer, grade: grade.data, suggestedRating: row.suggested_rating as FsrsRating } : null;
  }

  /* ---- Reviews ------------------------------------------------------------ */

  /**
   * Grade a card, reschedule it, and give its siblings their share.
   *
   * Every change to a schedule goes through here and leaves a log row with the
   * memory state before and after, which is exactly what an FSRS optimiser needs
   * to refit the parameters to this learner later. Implicit credit is logged
   * too, as `implicit`, so an optimiser can leave it out.
   */
  review(cardId: string, rating: FsrsRating, detail: { source: ReviewSource; format: ReviewFormat | null; target?: ReviewTarget | null | undefined; prompt: string | null; answer: string | null; feedback: string | null; grade: ReviewGrade | null; suggestedRating: FsrsRating | null; promptId?: string }, now = new Date()): { card: ReviewCard; log: ReviewLog; siblings: number } {
    return this.db.transaction(() => {
      const card = this.card(cardId, now);
      if (!card) throw new Error("That review card no longer exists.");
      const before = memoryOf(card);
      const scheduled = scheduleReview(before, rating, now, this.parameters(), `${card.id}:${card.reps}`);
      this.writeMemory(card.id, scheduled.next, now);
      const log = this.insertLog({ cardId, rating, ...detail }, before, scheduled, now);
      if (detail.promptId) this.db.prepare("UPDATE review_prompts SET closed_at=? WHERE id=?").run(now.toISOString(), detail.promptId);
      const siblings = this.creditSiblings(card, rating, now);
      return { card: this.card(cardId, now)!, log, siblings };
    })();
  }

  /** The learner's own say in what a card rehearses. */
  setTargets(cardId: string, targets: ReviewTarget[]) {
    const clean = cleanTargets(targets);
    if (!clean.length) throw new Error("A card has to rehearse at least one thing.");
    this.db.prepare("UPDATE review_cards SET targets=?, updated_at=? WHERE id=?").run(JSON.stringify(clean), new Date().toISOString(), cardId);
  }

  setSuspended(cardId: string, suspended: boolean) {
    this.db.prepare("UPDATE review_cards SET suspended=?, updated_at=? WHERE id=?").run(suspended ? 1 : 0, new Date().toISOString(), cardId);
  }

  /** Cards on the same patterns, for the agent writing a new one: the earlier
   *  insight to build on, or to say this one is different from. */
  related(conceptSlugs: string[], exceptQuestionId: string | null, limit = 5, now = new Date()): ReviewCard[] {
    const wanted = new Set(conceptSlugs);
    if (!wanted.size) return [];
    return this.list(now)
      .filter((card) => card.questionId !== exceptQuestionId && card.concepts.some((tag) => wanted.has(tag.slug)))
      .slice(0, limit);
  }

  /** Recent reviews under these concepts, newest first — what the prompt writer
   *  reads so it does not ask the same kind of question it asked last time. */
  recentLogs(cardId: string, limit = 6): ReviewLog[] {
    return (this.db.prepare("SELECT * FROM review_logs WHERE card_id=? AND source!='implicit' ORDER BY reviewed_at DESC LIMIT ?").all(cardId, limit) as LogRow[]).map(toLog);
  }

  overview(now = new Date()): ReviewOverview {
    const cards = this.list(now);
    const active = cards.filter((card) => !card.suspended);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const upcoming = Array.from({ length: 14 }, (_, index) => {
      const day = new Date(now);
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() + index);
      return { date: localDate(day), count: 0 };
    });
    for (const card of active) {
      const due = new Date(card.dueAt);
      const key = due.getTime() <= now.getTime() ? upcoming[0]!.date : localDate(due);
      const slot = upcoming.find((entry) => entry.date === key);
      if (slot) slot.count += 1;
    }
    const byQuestion: Record<string, ReviewScheduleEntry> = {};
    for (const card of cards) {
      byQuestion[card.questionId] = { cardId: card.id, title: card.title, state: card.state, dueAt: card.dueAt, lastReviewAt: card.lastReviewAt, reps: card.reps, lapses: card.lapses, retrievability: card.retrievability, createdAt: card.createdAt, suspended: card.suspended };
    }
    const reviewDays = new Set((this.db.prepare("SELECT reviewed_at FROM review_logs WHERE source IN ('recall','resolve') AND reviewed_at>=?").all(new Date(now.getTime() - 400 * DAY_MS).toISOString()) as Array<{ reviewed_at: string }>).map((row) => localDate(new Date(row.reviewed_at))));
    const today = localDate(now);
    const reviewedToday = (this.db.prepare("SELECT reviewed_at FROM review_logs WHERE source IN ('recall','resolve') AND reviewed_at>=?").all(new Date(now.getTime() - 2 * DAY_MS).toISOString()) as Array<{ reviewed_at: string }>).filter((row) => localDate(new Date(row.reviewed_at)) === today).length;
    return {
      totalCards: cards.length,
      dueCount: active.filter((card) => Date.parse(card.dueAt) <= now.getTime()).length,
      dueTodayCount: active.filter((card) => Date.parse(card.dueAt) <= endOfToday.getTime()).length,
      retention: active.length ? active.reduce((sum, card) => sum + card.retrievability, 0) / active.length : null,
      nextDueAt: active.map((card) => card.dueAt).sort()[0] ?? null,
      upcoming,
      reviewedToday,
      streakDays: streak(reviewDays, now),
      byQuestion,
    };
  }

  clear() {
    for (const table of ["review_prompts", "review_logs", "review_cards"]) this.db.prepare(`DELETE FROM ${table}`).run();
  }

  /* ---- Internals ---------------------------------------------------------- */

  private creditSiblings(card: ReviewCard, rating: FsrsRating, now: Date): number {
    const primary = card.concepts[0]?.slug;
    if (!primary) return 0;
    const weight = rating === 1 ? SIBLING_PENALTY_WEIGHT : SIBLING_CREDIT_WEIGHT * (rating === 2 ? 0.5 : 1);
    const rows = this.db.prepare("SELECT c.*, q.title question_title FROM review_cards c JOIN questions q ON q.id=c.question_id WHERE c.id!=? AND c.suspended=0").all(card.id) as CardRow[];
    let credited = 0;
    for (const row of rows) {
      const slugs = parseList(row.concept_slugs);
      if (slugs[0] !== primary) continue;
      const sibling = this.toCard(row, now);
      const before = memoryOf(sibling);
      const next = implicitCredit(before, rating, now, weight, this.parameters());
      if (!next) continue;
      this.db.prepare("UPDATE review_cards SET stability=?, due_at=?, updated_at=? WHERE id=?").run(next.stability, next.dueAt, now.toISOString(), sibling.id);
      this.db.prepare(`INSERT INTO review_logs (id, card_id, reviewed_at, source, format, rating, suggested_rating, prompt, answer, feedback, grade, elapsed_days, scheduled_days, retrievability, stability_before, stability_after, difficulty_before, difficulty_after)
        VALUES (?, ?, ?, 'implicit', NULL, ?, NULL, NULL, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), sibling.id, now.toISOString(), rating, `Shared the ${card.concepts[0]?.title ?? primary} review of "${card.title}".`, before.lastReviewAt ? (now.getTime() - Date.parse(before.lastReviewAt)) / DAY_MS : 0, before.lastReviewAt ? (Date.parse(next.dueAt) - Date.parse(before.lastReviewAt)) / DAY_MS : 0, sibling.retrievability, before.stability, next.stability, before.difficulty, next.difficulty);
      credited += 1;
    }
    return credited;
  }

  private writeMemory(cardId: string, memory: MemoryState, now: Date) {
    this.db.prepare("UPDATE review_cards SET state=?, stability=?, difficulty=?, due_at=?, last_review_at=?, reps=?, lapses=?, updated_at=? WHERE id=?")
      .run(memory.state, memory.stability, memory.difficulty, memory.dueAt, memory.lastReviewAt, memory.reps, memory.lapses, now.toISOString(), cardId);
  }

  private insertLog(detail: { cardId: string; source: ReviewSource; format: ReviewFormat | null; target?: ReviewTarget | null | undefined; rating: FsrsRating; suggestedRating: FsrsRating | null; prompt: string | null; answer: string | null; feedback: string | null; grade: ReviewGrade | null }, before: MemoryState, scheduled: ReturnType<typeof scheduleReview>, now: Date): ReviewLog {
    const row: LogRow = {
      id: randomUUID(), card_id: detail.cardId, reviewed_at: now.toISOString(), source: detail.source, format: detail.format, target: detail.target ?? null, rating: detail.rating,
      suggested_rating: detail.suggestedRating, prompt: detail.prompt, answer: detail.answer, feedback: detail.feedback,
      elapsed_days: scheduled.elapsedDays, scheduled_days: scheduled.scheduledDays, retrievability: scheduled.retrievability,
      stability_before: before.stability, stability_after: scheduled.next.stability, difficulty_before: before.difficulty, difficulty_after: scheduled.next.difficulty,
    };
    this.db.prepare(`INSERT INTO review_logs (id, card_id, reviewed_at, source, format, target, rating, suggested_rating, prompt, answer, feedback, grade, elapsed_days, scheduled_days, retrievability, stability_before, stability_after, difficulty_before, difficulty_after)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.card_id, row.reviewed_at, row.source, row.format, row.target, row.rating, row.suggested_rating, row.prompt, row.answer, row.feedback, detail.grade ? JSON.stringify(detail.grade) : null, row.elapsed_days, row.scheduled_days, row.retrievability, row.stability_before, row.stability_after, row.difficulty_before, row.difficulty_after);
    return toLog(row);
  }

  private conceptTags(slugs: string[]): ConceptTag[] {
    if (!slugs.length) return [];
    const rows = this.db.prepare(`SELECT c.slug, c.title, c.kind, c.parent_slug, p.title parent_title FROM concepts c LEFT JOIN concepts p ON p.slug=c.parent_slug WHERE c.slug IN (${slugs.map(() => "?").join(",")})`).all(...slugs) as Array<{ slug: string; title: string; kind: string; parent_slug: string | null; parent_title: string | null }>;
    const found = new Map(rows.map((row) => [row.slug, row]));
    return slugs.flatMap((slug, index) => {
      const row = found.get(slug);
      if (!row) return [];
      return [{ slug, title: row.title, kind: (row.kind === "engineering" || row.kind === "craft" ? row.kind : "dsa") as ConceptTag["kind"], parentSlug: row.parent_slug, parentTitle: row.parent_title, role: index === 0 ? "primary" as const : "supporting" as const }];
    });
  }

  private toCard(row: CardRow, now: Date): ReviewCard {
    const elapsed = row.last_review_at ? (now.getTime() - Date.parse(row.last_review_at)) / DAY_MS : 0;
    const click = parseObject(row.click) as Partial<ReviewCard["click"]>;
    return {
      id: row.id,
      questionId: row.question_id,
      questionTitle: row.question_title ?? "",
      sessionId: row.session_id,
      attemptId: row.attempt_id,
      title: row.title,
      trigger: row.trigger_cue,
      insight: row.insight,
      invariant: row.invariant,
      click: { summary: String(click.summary ?? ""), runOrdinal: typeof click.runOrdinal === "number" ? click.runOrdinal : null, diff: typeof click.diff === "string" ? click.diff : null },
      independence: row.independence === "independent" || row.independence === "assisted" ? row.independence : "unknown",
      pitfalls: (parseArray(row.pitfalls) as Array<{ mistake?: unknown; fix?: unknown }>).flatMap((item) => item && typeof item.mistake === "string" && typeof item.fix === "string" ? [{ mistake: item.mistake, fix: item.fix }] : []),
      rubric: parseList(row.rubric),
      transfer: parseList(row.transfer),
      concepts: this.conceptTags(parseList(row.concept_slugs)),
      targets: row.targets ? orDefault(cleanTargets(parseList(row.targets))) : [...DEFAULT_REVIEW_TARGETS],
      remember: row.remember ?? null,
      state: row.state === "review" || row.state === "relearning" ? row.state : "new",
      stability: row.stability,
      difficulty: row.difficulty,
      dueAt: row.due_at,
      lastReviewAt: row.last_review_at,
      reps: row.reps,
      lapses: row.lapses,
      retrievability: row.last_review_at ? retrievability(row.stability, elapsed, this.parameters()) : 0,
      suspended: row.suspended === 1,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function memoryOf(card: ReviewCard): MemoryState {
  return { state: card.state, stability: card.stability, difficulty: card.difficulty, lastReviewAt: card.lastReviewAt, dueAt: card.dueAt, reps: card.reps, lapses: card.lapses };
}

function toLog(row: LogRow): ReviewLog {
  return {
    id: row.id, cardId: row.card_id, reviewedAt: row.reviewed_at,
    source: row.source === "solve" || row.source === "resolve" || row.source === "implicit" ? row.source : "recall",
    format: (row.format as ReviewFormat | null) ?? null, target: reviewTargetSchema.safeParse(row.target).data ?? null, rating: row.rating, suggestedRating: row.suggested_rating,
    prompt: row.prompt, answer: row.answer, feedback: row.feedback, elapsedDays: row.elapsed_days, scheduledDays: row.scheduled_days,
    retrievability: row.retrievability, stabilityBefore: row.stability_before, stabilityAfter: row.stability_after, difficultyAfter: row.difficulty_after,
  };
}

function pendingOf(row: Pick<PromptRow, "id" | "card_id" | "payload" | "created_at">): ReviewPending {
  const prompt = reviewPromptSchema.parse(JSON.parse(row.payload));
  return { id: row.id, cardId: row.card_id, createdAt: row.created_at, format: prompt.format, ...(prompt.target ? { target: prompt.target } : {}), prompt: prompt.prompt, cue: prompt.cue };
}

/** Round-robin over groups, keeping each group's own order. */
export function interleave<T>(items: T[], key: (item: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  const out: T[] = [];
  let last = "";
  while (out.length < items.length) {
    const candidates = [...groups.entries()].filter(([, queue]) => queue.length);
    const pick = candidates.find(([name]) => name !== last) ?? candidates[0]!;
    out.push(pick[1].shift()!);
    last = pick[0];
  }
  return out;
}

function streak(days: Set<string>, now: Date): number {
  let count = 0;
  const cursor = new Date(now);
  if (!days.has(localDate(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(localDate(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function localDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function cleanTargets(values: readonly string[]): ReviewTarget[] {
  return [...new Set(values)].filter((value): value is ReviewTarget => reviewTargetSchema.safeParse(value).success);
}

function orDefault(targets: ReviewTarget[]): ReviewTarget[] {
  return targets.length ? targets : [...DEFAULT_REVIEW_TARGETS];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function parseArray(value: string): unknown[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function parseList(value: string): string[] {
  return parseArray(value).filter((entry): entry is string => typeof entry === "string");
}
function parseObject(value: string): Record<string, unknown> {
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}
