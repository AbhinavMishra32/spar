import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Reading what HEAD points at, straight off disk. This runs before the first
 * window paints, and shelling out to `git` there is a process spawn to learn
 * something that is three small files away. No electron import on purpose: the
 * parsing is the part that can be wrong, so it stays independently testable.
 */

export type GitHead = { commit: string | null; branch: string | null };

const SHA = /^[0-9a-f]{40}$/;

function read(file: string) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** `.git` is a directory in an ordinary clone and a `gitdir: <path>` pointer in
 *  a linked worktree or a submodule. Resolves to the real directory either way,
 *  walking up because the app path is nested well below the repository root. */
export function findGitDir(from: string): string | null {
  for (let dir = path.resolve(from); ; ) {
    const candidate = path.join(dir, ".git");
    const entry = statSync(candidate, { throwIfNoEntry: false });
    if (entry?.isDirectory()) return candidate;
    if (entry?.isFile()) {
      const pointer = read(candidate)?.match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
      return pointer ? path.resolve(dir, pointer) : null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readGitHead(gitDir: string): GitHead {
  const head = read(path.join(gitDir, "HEAD"))?.trim();
  if (!head) return { commit: null, branch: null };
  // A detached HEAD stores the SHA itself, and has no branch to name.
  if (SHA.test(head)) return { commit: head, branch: null };

  const ref = head.match(/^ref:\s*(.+)$/)?.[1]?.trim();
  if (!ref) return { commit: null, branch: null };
  const branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;

  // A linked worktree keeps its own HEAD but shares refs with the main
  // checkout, which `commondir` points back at.
  const shared = read(path.join(gitDir, "commondir"))?.trim();
  const refRoot = shared ? path.resolve(gitDir, shared) : gitDir;

  const loose = read(path.join(refRoot, ref))?.trim();
  if (loose && SHA.test(loose)) return { commit: loose, branch };

  // Once a ref has been packed it no longer has a file of its own, and a
  // long-lived clone packs the branch you have been on for weeks.
  const packed = read(path.join(refRoot, "packed-refs")) ?? "";
  const line = packed.split("\n").find((entry) => entry.endsWith(` ${ref}`));
  const sha = line?.slice(0, 40);
  return { commit: sha && SHA.test(sha) ? sha : null, branch };
}
