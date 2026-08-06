import { describe, expect, it } from "vitest";
import { chooseCheckpoint, workspaceFileSchema, type SessionCheckpoint } from "./checkpoint.js";

const base = { sessionId: "00000000-0000-4000-8000-000000000001", version: 1, eventSequence: 3, savedAt: "2026-01-01T00:00:00.000Z" } as SessionCheckpoint;

describe("chooseCheckpoint", () => {
  it("prefers a newer durable version over wall-clock time", () => {
    const local = { ...base, version: 2, savedAt: "2025-01-01T00:00:00.000Z" };
    const remote = { ...base, version: 1, savedAt: "2027-01-01T00:00:00.000Z" };
    expect(chooseCheckpoint(local, remote)).toBe(local);
  });
});

/* A checkpoint carries the files themselves now, which is what lets a session
   resume on a different machine rather than reopening as an empty editor. */
describe("workspace files in a checkpoint", () => {
  const hash = "a".repeat(64);

  it("carries the saved contents and an unsaved buffer separately", () => {
    const parsed = workspaceFileSchema.parse({ path: "src/index.js", contentHash: hash, content: "saved", dirtyContent: "typing" });
    expect(parsed).toMatchObject({ content: "saved", dirtyContent: "typing" });
  });

  /* Both are optional, and a file with neither is the shape an oversized file
     takes: named and hashed so a restore can report the gap, without the bytes. */
  it("accepts a file recorded without its contents", () => {
    const parsed = workspaceFileSchema.parse({ path: "src/generated.js", contentHash: hash });
    expect(parsed.content).toBeUndefined();
    expect(parsed.dirtyContent).toBeUndefined();
  });

  /* Older rows predate the field. They have to keep parsing, because a checkpoint
     written by 0.1 is still the best account of where that session got to. */
  it("still reads a checkpoint written before contents were carried", () => {
    expect(workspaceFileSchema.parse({ path: "src/index.js", contentHash: hash, dirtyContent: "typing" }).content).toBeUndefined();
  });
});
