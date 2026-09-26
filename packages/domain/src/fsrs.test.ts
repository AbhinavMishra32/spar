import { describe, expect, it } from "vitest";
import { DEFAULT_FSRS, implicitCredit, initialDifficulty, initialStability, intervalDays, newMemoryState, previewSchedule, retrievability, scheduleReview, type MemoryState } from "./fsrs.js";

const DAY = 86_400_000;
const start = new Date("2026-01-01T09:00:00Z");
const later = (days: number) => new Date(start.getTime() + days * DAY);

describe("the forgetting curve", () => {
  it("is 90% exactly one stability after the last review", () => {
    expect(retrievability(7, 7)).toBeCloseTo(0.9, 6);
    expect(retrievability(30, 30)).toBeCloseTo(0.9, 6);
  });

  it("starts at certainty and only falls", () => {
    expect(retrievability(5, 0)).toBe(1);
    expect(retrievability(5, 1)).toBeGreaterThan(retrievability(5, 10));
  });

  it("schedules one stability out at 90% desired retention", () => {
    expect(intervalDays(12)).toBeCloseTo(12, 6);
    expect(intervalDays(12, { ...DEFAULT_FSRS, desiredRetention: 0.95 })).toBeLessThan(12);
  });
});

describe("a first review", () => {
  it("uses the published initial stabilities and orders the grades", () => {
    expect(initialStability(1)).toBeCloseTo(0.212);
    expect(initialStability(3)).toBeCloseTo(2.3065);
    expect(initialDifficulty(1)).toBeGreaterThan(initialDifficulty(4));
  });

  it("never schedules sooner than tomorrow, even after Again", () => {
    const first = scheduleReview(newMemoryState(start), 1, start);
    expect(first.scheduledDays).toBe(1);
    expect(first.next.state).toBe("review");
    expect(first.next.lapses).toBe(0);
  });
});

describe("later reviews", () => {
  const solved: MemoryState = scheduleReview(newMemoryState(start), 3, start).next;

  it("grows stability on a recall, more for Easy than for Hard", () => {
    const at = later(3);
    const preview = previewSchedule(solved, at);
    expect(preview.hard.next.stability).toBeGreaterThan(solved.stability);
    expect(preview.easy.next.stability).toBeGreaterThan(preview.good.next.stability);
    expect(preview.good.next.stability).toBeGreaterThan(preview.hard.next.stability);
    expect(preview.easy.scheduledDays).toBeGreaterThanOrEqual(preview.good.scheduledDays);
  });

  it("rewards a successful review more when it was nearly forgotten", () => {
    const early = scheduleReview(solved, 3, later(1)).next.stability;
    const late = scheduleReview(solved, 3, later(6)).next.stability;
    expect(late).toBeGreaterThan(early);
  });

  it("drops stability and counts a lapse on Again", () => {
    const grown = scheduleReview(solved, 3, later(3)).next;
    const lapsed = scheduleReview(grown, 1, later(20));
    expect(lapsed.next.stability).toBeLessThan(grown.stability);
    expect(lapsed.next.lapses).toBe(1);
    expect(lapsed.next.state).toBe("relearning");
    expect(lapsed.scheduledDays).toBe(1);
  });

  it("caps intervals at the maximum", () => {
    let card = solved;
    let at = start;
    for (let index = 0; index < 12; index += 1) {
      at = new Date(Date.parse(card.dueAt));
      card = scheduleReview(card, 4, at).next;
    }
    expect((Date.parse(card.dueAt) - at.getTime()) / DAY).toBeLessThanOrEqual(365);
  });

  it("fuzzes deterministically from the seed", () => {
    const grown = scheduleReview(solved, 3, later(3)).next;
    const a = scheduleReview(grown, 3, later(15), DEFAULT_FSRS, "card-a").scheduledDays;
    const again = scheduleReview(grown, 3, later(15), DEFAULT_FSRS, "card-a").scheduledDays;
    expect(a).toBe(again);
  });
});

describe("implicit credit from a sibling review", () => {
  const card = scheduleReview(scheduleReview(newMemoryState(start), 3, start).next, 3, later(3)).next;

  it("moves stability part of the way toward a real review", () => {
    const credited = implicitCredit(card, 3, later(8), 0.3)!;
    const full = scheduleReview(card, 3, later(8)).next.stability;
    expect(credited.stability).toBeGreaterThan(card.stability);
    expect(credited.stability).toBeLessThan(full);
    expect(Date.parse(credited.dueAt)).toBeGreaterThanOrEqual(Date.parse(card.dueAt));
    expect(credited.reps).toBe(card.reps);
  });

  it("pulls due dates forward on a failure but never into the past", () => {
    const credited = implicitCredit(card, 1, later(4), 0.5)!;
    expect(Date.parse(credited.dueAt)).toBeLessThanOrEqual(Date.parse(card.dueAt));
    expect(Date.parse(credited.dueAt)).toBeGreaterThan(later(4).getTime());
  });

  it("does nothing to a card reviewed today or never reviewed", () => {
    expect(implicitCredit(card, 3, new Date(Date.parse(card.lastReviewAt!) + 3_600_000), 0.3)).toBeNull();
    expect(implicitCredit(newMemoryState(start), 3, later(3), 0.3)).toBeNull();
  });
});
