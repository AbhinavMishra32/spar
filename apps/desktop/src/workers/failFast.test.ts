import { describe, expect, it } from "vitest";
import { createFailFast, truncateAtFailure } from "./failFast.js";

/** node --test, one case in, one case failing. */
const TAP = [
  "TAP version 13",
  "# Subtest: tests/hidden.test.js",
  "    # Subtest: seeded case 1",
  "    ok 1 - seeded case 1",
  "    # Subtest: seeded case 2",
  "    not ok 2 - seeded case 2",
  "      ---",
  "      error: 'expected 6 to equal 4'",
  "      input: \"counts(['cat', 7])\"",
  "      expected: 4",
  "      actual: 6",
  "      ...",
  "    # Subtest: seeded case 3",
  "    ok 3 - seeded case 3",
  "",
].join("\n");

describe("fail-fast stream watcher", () => {
  it("runs on while every case is passing", () => {
    const watch = createFailFast();
    expect(watch.feed("TAP version 13\nok 1 - a\nok 2 - b\n")).toBe(false);
    expect(watch.failing()).toBe(false);
  });

  it("waits for the failing case's diagnostic before calling a stop", () => {
    const watch = createFailFast();
    // The block is the only place a hidden case ever says what it ran. Stopping
    // on the `not ok` line would throw exactly that away.
    expect(watch.feed("TAP version 13\n    not ok 2 - seeded case 2\n      ---\n")).toBe(false);
    expect(watch.failing()).toBe(true);
    expect(watch.feed("      expected: 4\n      actual: 6\n")).toBe(false);
    expect(watch.feed("      ...\n")).toBe(true);
  });

  it("stops a suite at its first failure, diagnostic intact", () => {
    const watch = createFailFast();
    const upTo = TAP.indexOf("      ...\n") + "      ...\n".length;
    expect(watch.feed(TAP.slice(0, upTo))).toBe(true);
  });

  it("stops at the next case when the failure carried no diagnostic", () => {
    const watch = createFailFast();
    expect(watch.feed("not ok 1 - bare\n")).toBe(false);
    expect(watch.feed("ok 2 - next\n")).toBe(true);
  });

  it("reads Spar's own check protocol as well as TAP", () => {
    const watch = createFailFast();
    expect(watch.feed("ok - first\nnot ok - second\n")).toBe(false);
    expect(watch.feed("  input: solve(3)\n  expected: 4\n  actual: 5\n")).toBe(false);
    expect(watch.feed("ok - third\n")).toBe(true);
  });

  it("matches verdicts split across two chunks", () => {
    const watch = createFailFast();
    // Chunks arrive on no boundary at all: this is one line in three writes.
    expect(watch.feed("not")).toBe(false);
    expect(watch.feed(" ok 1 - split")).toBe(false);
    expect(watch.failing()).toBe(false);
    expect(watch.feed("\n")).toBe(false);
    expect(watch.failing()).toBe(true);
  });

  it("does not mistake a diagnostic's own text for a verdict", () => {
    const watch = createFailFast();
    expect(watch.feed("not ok 1 - a\n  ---\n  message: 'not okay at all'\n")).toBe(false);
  });
});

describe("truncateAtFailure", () => {
  it("keeps a clean run whole", () => {
    expect(truncateAtFailure("ok 1 - a\nok 2 - b\n# tests 2\n")).toBe(null);
  });

  it("cuts after the failing case's diagnostic", () => {
    const cut = truncateAtFailure(TAP);
    expect(cut).toContain("ok 1 - seeded case 1");
    expect(cut).toContain("not ok 2 - seeded case 2");
    // The block is why the cut waits: it is the only place a hidden case says
    // what it ran.
    expect(cut).toContain("input: \"counts(['cat', 7])\"");
    expect(cut).toContain("      ...");
    expect(cut).not.toContain("seeded case 3");
  });

  it("drops the summary lines, which count a run this no longer describes", () => {
    const cut = truncateAtFailure("not ok 1 - a\n  ---\n  ...\nok 2 - b\n# tests 2\n# fail 1\n");
    expect(cut).not.toContain("# tests 2");
    expect(cut).not.toContain("ok 2 - b");
  });

  it("cuts at the next case when the failure carried no diagnostic", () => {
    expect(truncateAtFailure("ok 1 - a\nnot ok 2 - b\nok 3 - c\n")).toBe("ok 1 - a\nnot ok 2 - b");
  });

  it("keeps everything when the failure was the last thing said", () => {
    const output = "ok 1 - a\nnot ok 2 - b\n  ---\n  actual: 3\n";
    expect(truncateAtFailure(output)).toBe(output);
  });
});
