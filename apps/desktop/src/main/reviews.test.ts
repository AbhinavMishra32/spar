import { describe, expect, it } from "vitest";
import type { QuestionDesign, ReviewPrompt } from "@spar/domain";
import { LocalStore } from "./store.js";
import { interleave, type InsightInput } from "./reviews.js";
import { ReviewService, cappedRating, resolveRating } from "./reviewSession.js";

const DAY = 86_400_000;
const start = new Date("2026-03-02T10:00:00Z");
const later = (days: number) => new Date(start.getTime() + days * DAY);

const design = (title: string): QuestionDesign => ({ title, language: "javascript", kind: "function", statement: "Implement the target behavior while preserving the declared invariant through every transition.", starterFiles: { "src/index.js": "export function solve(){ throw new Error(\"implement\") }" }, referenceFiles: { "src/index.js": "export function solve(){ return true }" }, visibleTests: { "tests/visible.test.js": "// visible" }, hiddenTests: { "tests/hidden.test.js": "// hidden" }, knownIncorrectFiles: [{ "src/index.js": "export function solve(){ return false }" }], runCommand: "node --test", accidentalDifficulty: [], expectedFailureSignatures: ["returns before restoring the invariant"] });

function insight(questionId: string, overrides: Partial<InsightInput> = {}): InsightInput {
  return {
    questionId, attemptId: null, title: "Shrink the window from the left", trigger: "Longest contiguous run under a constraint",
    insight: "Grow the right edge, and move the left edge only while the window breaks the constraint.", invariant: "The window is always valid after the inner loop.",
    click: { summary: "Replaced the restart-from-scratch scan with a left pointer that only moves forward.", runOrdinal: 3, diff: null },
    independence: "independent", pitfalls: [{ mistake: "Reset the window on every violation", fix: "Advance the left edge instead" }],
    rubric: ["two pointers", "left only moves forward", "O(n)"], transfer: ["Longest substring without repeats"], conceptSlugs: ["sliding-window"], firstRating: 3,
    ...overrides,
  };
}

function withChallenges(count: number, run: (store: LocalStore, questions: string[]) => void) {
  const store = new LocalStore(":memory:");
  try {
    const { sessionId } = store.createSession("Practise sliding windows");
    store.setTrainingTarget(sessionId, { ability: "Sliding window", specificGap: "Shrink instead of restart", desiredEvidence: "Linear scan", avoidTesting: [] });
    store.ensureConcept({ slug: "sliding-window" });
    store.ensureConcept({ slug: "hashing" });
    const questions = Array.from({ length: count }, (_, index) => store.createQuestion(sessionId, design(`Window ${index + 1}`), { valid: true }).id);
    run(store, questions);
  } finally {
    store.close();
  }
}

const prompt: ReviewPrompt = { format: "recognize", prompt: "Given a stream of readings, find the longest stretch whose spread stays under k. How?", answer: "1. Two pointers.\n2. The left edge only moves forward.", cue: "What happens when the stretch breaks the rule?", expected: ["two pointers", "left edge only advances"] };
/** A question from before cards had a back. */
const { answer: _answer, ...essayPrompt } = prompt;

describe("filing an insight", () => {
  it("creates a card with its first review scheduled a day or more out and a solve log", () => {
    withChallenges(1, (store, [question]) => {
      const { card, created } = store.reviews.recordInsight(insight(question!), start);
      expect(created).toBe(true);
      expect(card.reps).toBe(1);
      expect(Date.parse(card.dueAt) - start.getTime()).toBeGreaterThanOrEqual(DAY);
      expect(card.concepts.map((tag) => tag.slug)).toEqual(["sliding-window"]);
      expect(store.reviews.logs(card.id).map((log) => log.source)).toEqual(["solve"]);
    });
  });

  it("refines the existing card on a second filing without moving its schedule", () => {
    withChallenges(1, (store, [question]) => {
      const first = store.reviews.recordInsight(insight(question!), start).card;
      const again = store.reviews.recordInsight(insight(question!, { insight: "A sharper statement of the same idea, written after a second look." }), later(1));
      expect(again.created).toBe(false);
      expect(again.card.id).toBe(first.id);
      expect(again.card.version).toBe(2);
      expect(again.card.dueAt).toBe(first.dueAt);
    });
  });

  it("schedules an assisted first grade sooner than an independent one", () => {
    withChallenges(2, (store, [a, b]) => {
      const independent = store.reviews.recordInsight(insight(a!), start).card;
      const assisted = store.reviews.recordInsight(insight(b!, { firstRating: 2, independence: "assisted" }), start).card;
      expect(Date.parse(assisted.dueAt)).toBeLessThan(Date.parse(independent.dueAt));
    });
  });

  it("goes when its challenge goes, and with account data", () => {
    withChallenges(1, (store, [question]) => {
      store.reviews.recordInsight(insight(question!), start);
      store.clearAccountData();
      expect(store.reviews.list()).toEqual([]);
    });
  });
});

describe("what a card rehearses", () => {
  it("keeps the agent's targets, defaults when it named none, and lets the learner change them", () => {
    withChallenges(2, (store, [a, b]) => {
      const chosen = store.reviews.recordInsight(insight(a!, { targets: ["problem", "pitfall", "problem"] }), start).card;
      expect(chosen.targets).toEqual(["problem", "pitfall"]);
      const plain = store.reviews.recordInsight(insight(b!), start).card;
      expect(plain.targets).toEqual(["turning-point", "pattern"]);
      store.reviews.setTargets(plain.id, ["concept"]);
      expect(store.reviews.card(plain.id)!.targets).toEqual(["concept"]);
      expect(() => store.reviews.setTargets(plain.id, [])).toThrow();
      // A refinement that names no targets leaves the learner's choice alone.
      expect(store.reviews.recordInsight(insight(b!), later(1)).card.targets).toEqual(["concept"]);
    });
  });

  it("records the target on the prompt and on the review it files", () => {
    withChallenges(1, (store, [question]) => {
      const card = store.reviews.recordInsight(insight(question!), start).card;
      const pending = store.reviews.savePrompt(card.id, { ...prompt, target: "pattern" }, later(2));
      expect(pending.target).toBe("pattern");
      expect(store.reviews.openPrompt(card.id)?.target).toBe("pattern");
      const filed = store.reviews.review(card.id, 3, { source: "recall", format: "recognize", target: "pattern", prompt: prompt.prompt, answer: "two pointers", feedback: null, grade: null, suggestedRating: 3, promptId: pending.id }, later(2));
      expect(filed.log.target).toBe("pattern");
      expect(store.reviews.recentLogs(card.id)[0]?.target).toBe("pattern");
    });
  });
});

describe("a review, Anki-style", () => {
  const service = (store: LocalStore) => new ReviewService({ store, agent: {} as never, providers: async () => [] });

  it("flips to the written back, or to the expected points on an older prompt", () => {
    withChallenges(1, (store, [question]) => {
      const card = store.reviews.recordInsight(insight(question!), start).card;
      const withBack = store.reviews.savePrompt(card.id, { ...prompt, answer: "1. Two pointers.\n2. Left only moves forward." }, later(2));
      expect(service(store).reveal(withBack.id).answer).toContain("Left only moves forward");
      const older = store.reviews.savePrompt(card.id, essayPrompt, later(2));
      expect(service(store).reveal(older.id).answer).toBe("- two pointers\n- left edge only advances");
    });
  });

  it("files a self-graded review only after the card is flipped", () => {
    withChallenges(1, (store, [question]) => {
      const card = store.reviews.recordInsight(insight(question!), start).card;
      const pending = store.reviews.savePrompt(card.id, { ...prompt, answer: "Two pointers.", target: "pattern" }, later(2));
      expect(() => service(store).commit(pending.id, 3)).toThrow(/Flip the card/);
      service(store).reveal(pending.id);
      const filed = service(store).commit(pending.id, 3);
      expect(filed.log).toMatchObject({ source: "recall", rating: 3, target: "pattern", answer: null, suggestedRating: null });
      expect(filed.card.reps).toBe(2);
    });
  });

  it("files nothing when the learner walks away, and only reuses a flashcard whose back was never seen", () => {
    withChallenges(1, (store, [question]) => {
      const card = store.reviews.recordInsight(insight(question!), start).card;
      const essay = store.reviews.savePrompt(card.id, essayPrompt, later(2));
      expect(store.reviews.openPrompt(card.id)).toBeNull();
      expect(store.reviews.prompt(essay.id)?.row.closed_at).not.toBeNull();
      const unseen = store.reviews.savePrompt(card.id, prompt, later(2));
      service(store).abandon(unseen.id);
      expect(store.reviews.openPrompt(card.id)?.id).toBe(unseen.id);
      service(store).reveal(unseen.id);
      expect(store.reviews.openPrompt(card.id)).toBeNull();
      service(store).abandon(unseen.id);
      expect(store.reviews.prompt(unseen.id)?.row.closed_at).not.toBeNull();
      expect(store.reviews.card(card.id)!.reps).toBe(1);
    });
  });
});

describe("reviewing", () => {
  it("comes due, reschedules on a graded review, and closes the prompt", () => {
    withChallenges(1, (store, [question]) => {
      const card = store.reviews.recordInsight(insight(question!), start).card;
      const at = new Date(Date.parse(card.dueAt) + 60_000);
      expect(store.reviews.due(at).map((entry) => entry.id)).toEqual([card.id]);
      const pending = store.reviews.savePrompt(card.id, prompt, at);
      expect(pending).not.toHaveProperty("expected");
      expect(store.reviews.openPrompt(card.id)?.id).toBe(pending.id);
      const filed = store.reviews.review(card.id, 3, { source: "recall", format: "recognize", prompt: prompt.prompt, answer: "two pointers", feedback: "Yes.", grade: null, suggestedRating: 3, promptId: pending.id }, at);
      expect(filed.card.reps).toBe(2);
      expect(filed.card.stability).toBeGreaterThan(card.stability);
      expect(Date.parse(filed.card.dueAt)).toBeGreaterThan(at.getTime() + DAY);
      expect(store.reviews.openPrompt(card.id)).toBeNull();
      expect(store.reviews.due(at)).toEqual([]);
    });
  });

  it("counts a lapse and brings a forgotten card back tomorrow", () => {
    withChallenges(1, (store, [question]) => {
      const card = store.reviews.recordInsight(insight(question!), start).card;
      const at = later(10);
      const filed = store.reviews.review(card.id, 1, { source: "recall", format: "invariant", prompt: null, answer: "idk", feedback: null, grade: null, suggestedRating: 1 }, at);
      expect(filed.card.lapses).toBe(1);
      expect(filed.card.state).toBe("relearning");
      expect(Date.parse(filed.card.dueAt) - at.getTime()).toBe(DAY);
    });
  });

  it("credits a sibling on the same primary concept, and logs it as implicit", () => {
    withChallenges(3, (store, [a, b, c]) => {
      const reviewed = store.reviews.recordInsight(insight(a!), start).card;
      const sibling = store.reviews.recordInsight(insight(b!), start).card;
      const stranger = store.reviews.recordInsight(insight(c!, { conceptSlugs: ["hashing"] }), start).card;
      const filed = store.reviews.review(reviewed.id, 3, { source: "recall", format: "recognize", prompt: null, answer: null, feedback: null, grade: null, suggestedRating: 3 }, later(2));
      expect(filed.siblings).toBe(1);
      const credited = store.reviews.card(sibling.id, later(2))!;
      expect(credited.stability).toBeGreaterThan(sibling.stability);
      expect(credited.reps).toBe(sibling.reps);
      expect(store.reviews.logs(sibling.id).map((log) => log.source)).toEqual(["solve", "implicit"]);
      expect(store.reviews.card(stranger.id)!.stability).toBe(stranger.stability);
      expect(store.reviews.recentLogs(sibling.id).map((log) => log.source)).toEqual(["solve"]);
    });
  });

  it("keeps a paused card out of the queue and the due count", () => {
    withChallenges(1, (store, [question]) => {
      const card = store.reviews.recordInsight(insight(question!), start).card;
      store.reviews.setSuspended(card.id, true);
      const at = later(30);
      expect(store.reviews.due(at)).toEqual([]);
      expect(store.reviews.overview(at).dueCount).toBe(0);
      expect(store.reviews.overview(at).byQuestion[question!]?.suspended).toBe(true);
    });
  });
});

describe("the overview", () => {
  it("places each card on the History page by its challenge and counts the fortnight ahead", () => {
    withChallenges(2, (store, [a, b]) => {
      const first = store.reviews.recordInsight(insight(a!), start).card;
      store.reviews.recordInsight(insight(b!, { conceptSlugs: ["hashing"] }), start);
      const overview = store.reviews.overview(start);
      expect(overview.totalCards).toBe(2);
      expect(overview.dueCount).toBe(0);
      expect(overview.upcoming).toHaveLength(14);
      expect(overview.upcoming.reduce((sum, day) => sum + day.count, 0)).toBe(2);
      expect(overview.byQuestion[a!]).toMatchObject({ cardId: first.id, dueAt: first.dueAt });
      expect(overview.retention).toBeCloseTo(1, 1);
    });
  });
});

describe("interleaving", () => {
  it("never puts two cards on the same pattern back to back when it can avoid it", () => {
    const order = interleave(["a1", "a2", "a3", "b1", "c1"], (value) => value[0]!);
    for (let index = 1; index < order.length - 1; index += 1) expect(order[index]![0]).not.toBe(order[index - 1]![0]);
    expect([...order].sort()).toEqual(["a1", "a2", "a3", "b1", "c1"]);
  });
});

describe("grades the host decides", () => {
  it("caps a review at Hard once the nudge was seen", () => {
    expect(cappedRating(4, true)).toMatchObject({ rating: 2 });
    expect(cappedRating(1, true)).toMatchObject({ rating: 1, capReason: null });
    expect(cappedRating(3, false)).toMatchObject({ rating: 3, capReason: null });
  });

  it("grades a re-solve from its checks and time", () => {
    expect(resolveRating({ passed: false, checks: 1, elapsedMs: 60_000 })).toBe(1);
    expect(resolveRating({ passed: true, checks: 1, elapsedMs: 10 * 60_000 })).toBe(4);
    expect(resolveRating({ passed: true, checks: 2, elapsedMs: 20 * 60_000 })).toBe(3);
    expect(resolveRating({ passed: true, checks: 4, elapsedMs: 5 * 60_000 })).toBe(2);
    expect(resolveRating({ passed: true, checks: 1, elapsedMs: 50 * 60_000 })).toBe(2);
  });
});
