import { beforeEach, describe, expect, it } from "vitest";
import { introSeen, markIntroSeen } from "./introSeen";

/* The renderer suite runs in node, so the one browser API this module touches is
   stood up here rather than pulled in as a DOM environment for four tests. */
const store = new Map<string, string>();
globalThis.localStorage = {
  clear: () => store.clear(),
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
} as Storage;

describe("challenge intro memory", () => {
  beforeEach(() => localStorage.clear());

  it("does not replay an intro the learner has already been shown", () => {
    expect(introSeen("attempt-1")).toBe(false);
    markIntroSeen("attempt-1");
    expect(introSeen("attempt-1")).toBe(true);
  });

  it("still announces a different attempt", () => {
    markIntroSeen("attempt-1");
    expect(introSeen("attempt-2")).toBe(false);
  });

  it("survives a reload, because the stored list is the whole state", () => {
    markIntroSeen("attempt-1");
    markIntroSeen("attempt-1");
    expect(JSON.parse(localStorage.getItem("spar.intro.seen")!)).toEqual(["attempt-1"]);
  });

  it("treats unreadable storage as never seen rather than throwing", () => {
    localStorage.setItem("spar.intro.seen", "{not json");
    expect(introSeen("attempt-1")).toBe(false);
  });
});
