import { beforeEach, describe, expect, it } from "vitest";
import { knownSuiteSize, rememberSuiteSize } from "./suiteSize";

/* The renderer suite runs in node, so the one browser API this module touches is
   stood up here rather than pulled in as a DOM environment for six tests. */
const store = new Map<string, string>();
globalThis.localStorage = {
  clear: () => store.clear(),
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
} as Storage;

describe("suiteSize", () => {
  beforeEach(() => localStorage.clear());

  it("knows nothing about a challenge it has never run", () => {
    expect(knownSuiteSize("q1", true)).toBe(0);
  });

  it("remembers what a suite turned out to be", () => {
    rememberSuiteSize("q1", true, 35);
    expect(knownSuiteSize("q1", true)).toBe(35);
  });

  it("keeps the visible and hidden suites apart", () => {
    // The whole point: three visible cases and thirty-five hidden ones are two
    // different grids, and one number for both redraws every run at the other's
    // size.
    rememberSuiteSize("q1", false, 3);
    rememberSuiteSize("q1", true, 35);
    expect(knownSuiteSize("q1", false)).toBe(3);
    expect(knownSuiteSize("q1", true)).toBe(35);
  });

  it("takes the newest count when a suite changes size", () => {
    rememberSuiteSize("q1", true, 35);
    rememberSuiteSize("q1", true, 41);
    expect(knownSuiteSize("q1", true)).toBe(41);
  });

  it("refuses a count that is not a real suite", () => {
    rememberSuiteSize("q1", true, 0);
    rememberSuiteSize("q2", true, -4);
    rememberSuiteSize("q3", true, 2.5);
    expect(knownSuiteSize("q1", true)).toBe(0);
    expect(knownSuiteSize("q2", true)).toBe(0);
    expect(knownSuiteSize("q3", true)).toBe(0);
  });

  it("survives a corrupted store rather than throwing at the panel", () => {
    localStorage.setItem("spar.suite.size", "not json");
    expect(knownSuiteSize("q1", true)).toBe(0);
    rememberSuiteSize("q1", true, 9);
    expect(knownSuiteSize("q1", true)).toBe(9);
  });
});
