import { describe, expect, it } from "vitest";
import { chooseCheckpoint, type SessionCheckpoint } from "./checkpoint";

const base = { sessionId: "00000000-0000-4000-8000-000000000001", version: 1, eventSequence: 3, savedAt: "2026-01-01T00:00:00.000Z" } as SessionCheckpoint;

describe("chooseCheckpoint", () => {
  it("prefers a newer durable version over wall-clock time", () => {
    const local = { ...base, version: 2, savedAt: "2025-01-01T00:00:00.000Z" };
    const remote = { ...base, version: 1, savedAt: "2027-01-01T00:00:00.000Z" };
    expect(chooseCheckpoint(local, remote)).toBe(local);
  });
});

