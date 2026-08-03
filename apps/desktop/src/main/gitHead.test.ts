import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findGitDir, readGitHead } from "./gitHead.js";

const SHA = "4f2b9c1d8e7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c";
const OTHER = "aaaabbbbccccddddeeeeffff00001111222233334";

const roots: string[] = [];

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), "spar-githead-"));
  roots.push(dir);
  return dir;
}

function write(file: string, contents: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("reading git HEAD", () => {
  it("resolves a branch through its loose ref", () => {
    const git = path.join(scratch(), ".git");
    write(path.join(git, "HEAD"), "ref: refs/heads/main\n");
    write(path.join(git, "refs/heads/main"), `${SHA}\n`);

    expect(readGitHead(git)).toEqual({ commit: SHA, branch: "main" });
  });

  // The branch you have been on for weeks is exactly the one git has packed.
  it("falls back to packed-refs when the ref has no file of its own", () => {
    const git = path.join(scratch(), ".git");
    write(path.join(git, "HEAD"), "ref: refs/heads/feature/big-rename\n");
    write(
      path.join(git, "packed-refs"),
      `# pack-refs with: peeled fully-peeled sorted\n${OTHER} refs/heads/main\n${SHA} refs/heads/feature/big-rename\n`,
    );

    expect(readGitHead(git)).toEqual({ commit: SHA, branch: "feature/big-rename" });
  });

  it("reports a detached HEAD as a commit with no branch", () => {
    const git = path.join(scratch(), ".git");
    write(path.join(git, "HEAD"), `${SHA}\n`);

    expect(readGitHead(git)).toEqual({ commit: SHA, branch: null });
  });

  // A worktree's HEAD is its own; its refs belong to the checkout it came from.
  it("follows commondir out of a linked worktree to find the refs", () => {
    const root = scratch();
    const main = path.join(root, ".git");
    const linked = path.join(main, "worktrees", "review");
    write(path.join(main, "refs/heads/main"), `${SHA}\n`);
    write(path.join(linked, "HEAD"), "ref: refs/heads/main\n");
    write(path.join(linked, "commondir"), "../..\n");

    expect(readGitHead(linked)).toEqual({ commit: SHA, branch: "main" });
  });

  it("names the branch even when the ref cannot be resolved", () => {
    const git = path.join(scratch(), ".git");
    write(path.join(git, "HEAD"), "ref: refs/heads/orphan\n");

    expect(readGitHead(git)).toEqual({ commit: null, branch: "orphan" });
  });

  it("reports nothing rather than guessing when there is no HEAD at all", () => {
    expect(readGitHead(path.join(scratch(), ".git"))).toEqual({ commit: null, branch: null });
  });
});

describe("locating the git directory", () => {
  it("walks up from a nested path to the repository", () => {
    const root = scratch();
    const git = path.join(root, ".git");
    write(path.join(git, "HEAD"), `${SHA}\n`);
    const nested = path.join(root, "apps/desktop/dist/main");
    mkdirSync(nested, { recursive: true });

    expect(findGitDir(nested)).toBe(git);
  });

  it("follows the gitdir pointer a worktree leaves in place of a directory", () => {
    const root = scratch();
    const real = path.join(root, "elsewhere/.git/worktrees/review");
    mkdirSync(real, { recursive: true });
    const checkout = path.join(root, "checkout");
    mkdirSync(checkout, { recursive: true });
    write(path.join(checkout, ".git"), `gitdir: ${real}\n`);

    expect(findGitDir(checkout)).toBe(real);
  });

  // A packaged app installed outside any repository, which is the normal case
  // for a release and must not be mistaken for a build failure.
  it("returns null when no repository is above the path", () => {
    expect(findGitDir(scratch())).toBe(null);
  });
});
