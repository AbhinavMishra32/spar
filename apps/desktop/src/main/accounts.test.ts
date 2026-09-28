import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AccountFolders, swappable } from "./accounts.js";

const base = () => mkdtempSync(path.join(tmpdir(), "spar-accounts-"));
/** The one-folder layout from before accounts had folders of their own. */
const legacy = (root: string) => {
  writeFileSync(path.join(root, "state.sqlite3"), "db");
  writeFileSync(path.join(root, "user.md"), "# About them");
  mkdirSync(path.join(root, "workspaces", "session-1"), { recursive: true });
};

describe("account folders", () => {
  it("gives each account its own folder", () => {
    const folders = new AccountFolders(base());
    expect(folders.paths("a1").db).not.toBe(folders.paths("b2").db);
    expect(folders.paths(null).root).toMatch(/signed-out$/);
  });

  it("moves the old layout into the account signed in when it upgrades", () => {
    const root = base();
    legacy(root);
    const folders = new AccountFolders(root);
    folders.migrateLegacy("a1");
    const paths = folders.paths("a1");
    expect(readFileSync(paths.db, "utf8")).toBe("db");
    expect(readFileSync(paths.userFile, "utf8")).toBe("# About them");
    expect(existsSync(path.join(paths.workspaces, "session-1"))).toBe(true);
    expect(existsSync(path.join(root, "state.sqlite3"))).toBe(false);
  });

  it("sets aside data nobody is signed in to claim, so a new account starts empty", () => {
    const root = base();
    legacy(root);
    const folders = new AccountFolders(root);
    folders.migrateLegacy(null);
    expect(existsSync(path.join(root, "state.sqlite3"))).toBe(false);
    expect(readdirSync(path.join(root, "set-aside"))).toHaveLength(1);
    expect(existsSync(folders.paths("new-account").db)).toBe(false);
  });

  it("removes only the account that left", () => {
    const folders = new AccountFolders(base());
    const kept = folders.paths("a1");
    folders.remove(folders.paths("b2") && "b2");
    expect(existsSync(kept.root)).toBe(true);
  });

  it("keeps an id from reaching outside the accounts folder", () => {
    const root = base();
    expect(path.dirname(new AccountFolders(root).paths("../../elsewhere").root)).toBe(path.join(root, "accounts"));
  });
});

describe("swappable", () => {
  class Counter { constructor(readonly name: string) {} count = 0; bump() { this.count += 1; return this.name; } }
  it("sends every call to whatever it points at now", () => {
    const handle = swappable(new Counter("first"));
    const held = handle.proxy;
    expect(held.bump()).toBe("first");
    const previous = handle.swap(new Counter("second"));
    expect(previous.count).toBe(1);
    expect(held.bump()).toBe("second");
    expect(held.count).toBe(1);
    expect(held instanceof Counter).toBe(true);
  });
});
