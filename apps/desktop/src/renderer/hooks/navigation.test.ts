import { describe, expect, it } from "vitest";

import { HISTORY_LIMIT, canGoBack, canGoForward, forget, step, visit, type History, type View } from "./navigation";

const start: History = { entries: [{ page: "home" }], index: 0 };
const workspace = (sessionId: string): View => ({ page: "workspace", sessionId });
const ability = (abilityId: string): View => ({ page: "ability", abilityId });

/** The view the cursor is on. */
const at = (history: History): View => history.entries[history.index]!;

describe("visit", () => {
  it("records a move and puts the cursor on it", () => {
    const history = visit(start, { page: "settings" });
    expect(at(history)).toEqual({ page: "settings" });
    expect(history.entries).toHaveLength(2);
  });

  it("ignores a move to where it already is", () => {
    /* The call sites fire when nothing changed — reopening the session already
       open, re-picking the current page — and each would otherwise be an entry
       to press back through. */
    const history = visit(visit(start, { page: "settings" }), { page: "settings" });
    expect(history.entries).toHaveLength(2);
  });

  it("treats a different session as a different place", () => {
    const history = visit(visit(start, workspace("a")), workspace("b"));
    expect(history.entries).toHaveLength(3);
  });

  it("treats an ability as a place rather than the page holding it", () => {
    /* What makes back land on the ability you were reading rather than on the
       Progress index it was opened from. */
    const history = visit(visit(start, ability("a1")), ability("a2"));
    expect(history.entries).toHaveLength(3);
    expect(at(history)).toEqual(ability("a2"));
  });

  it("treats one challenge reached twice as one place", () => {
    /* Both libraries open the same challenge, and opening it again from the
       other one is not a move — recording it would put the same page in the
       history twice. */
    const history = visit(
      visit(start, { page: "challenge", challengeId: "c1" }),
      { page: "challenge", challengeId: "c1" },
    );
    expect(history.entries).toHaveLength(2);
  });

  it("discards the forward tail when visiting from the middle", () => {
    const forward = visit(visit(start, { page: "settings" }), { page: "sessions" });
    const back = step(forward, -1)!.history;
    const history = visit(back, workspace("a"));

    expect(history.entries.map((view) => view.page)).toEqual(["home", "settings", "workspace"]);
    expect(canGoForward(history)).toBe(false);
  });

  it("stops growing at the limit, keeping the most recent", () => {
    let history = start;
    for (let index = 0; index < HISTORY_LIMIT + 10; index += 1) history = visit(history, workspace(`s${index}`));
    expect(history.entries).toHaveLength(HISTORY_LIMIT);
    expect(at(history)).toEqual(workspace(`s${HISTORY_LIMIT + 9}`));
    expect(history.index).toBe(HISTORY_LIMIT - 1);
  });
});

describe("step", () => {
  it("moves back and forward over the same entries", () => {
    const history = visit(visit(start, { page: "settings" }), { page: "sessions" });

    const back = step(history, -1)!;
    expect(back.view).toEqual({ page: "settings" });

    const forward = step(back.history, 1)!;
    expect(forward.view).toEqual({ page: "sessions" });
  });

  it("returns nothing at either end", () => {
    expect(step(start, -1)).toBeNull();
    expect(step(start, 1)).toBeNull();
    expect(canGoBack(start)).toBe(false);
    expect(canGoForward(start)).toBe(false);
  });

  it("does not consume the entry it leaves", () => {
    const history = visit(start, { page: "settings" });
    const back = step(history, -1)!.history;
    expect(back.entries).toHaveLength(2);
    expect(canGoForward(back)).toBe(true);
  });
});

describe("forget", () => {
  it("drops every entry for a deleted session", () => {
    const history = visit(visit(visit(start, workspace("a")), workspace("b")), { page: "settings" });
    const after = forget(history, "a");
    expect(after.entries.some((view) => view.page === "workspace" && view.sessionId === "a")).toBe(false);
  });

  it("drops the baseline surface of the same session too", () => {
    const history = visit(start, { page: "baseline", sessionId: "a" });
    const after = forget(history, "a");
    expect(after.entries).toEqual([{ page: "home" }]);
  });

  it("keeps the cursor on the view it was on", () => {
    const history = visit(visit(visit(start, workspace("a")), { page: "settings" }), { page: "sessions" });
    const after = forget(step(history, -1)!.history, "a");
    expect(at(after)).toEqual({ page: "settings" });
  });

  it("moves the cursor to the end when its own view was deleted", () => {
    const history = visit(visit(start, { page: "settings" }), workspace("a"));
    const after = forget(history, "a");
    expect(at(after)).toEqual({ page: "settings" });
  });

  it("collapses entries left duplicated by the removal", () => {
    /* today → workspace a → today would leave two adjacent "today", so back
       would appear to do nothing once. */
    const history = visit(visit(start, workspace("a")), { page: "home" });
    const after = forget(history, "a");
    expect(after.entries).toEqual([{ page: "home" }]);
    expect(after.index).toBe(0);
  });

  it("never empties, so there is always somewhere to be", () => {
    const after = forget({ entries: [workspace("a")], index: 0 }, "a");
    expect(after).toEqual({ entries: [{ page: "home" }], index: 0 });
  });
});
