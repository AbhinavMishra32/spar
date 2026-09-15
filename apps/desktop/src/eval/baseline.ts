import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The same eval, run against an older Spar.
 *
 * This is the part that makes "did the change help" answerable rather than
 * assertable. A checkout of the baseline commit, the *current* scenarios and
 * verifiers copied in on top of it, and the suite run there. The scenarios have
 * to travel because they did not exist at the baseline commit; the host must not
 * travel, because the host is the thing being measured.
 *
 * Which is exactly why the eval code is written to probe rather than assume. Run
 * against a commit whose store has no `decayAbilities` and no pattern reads, the
 * harness records what is missing and the affected checks skip. "The baseline
 * could not see its own patterns" is the finding; "the baseline crashed" would
 * have thrown it away.
 *
 * ## Dependencies
 *
 * A fresh worktree has no `node_modules`, and installing one per comparison
 * would mean an electron rebuild of better-sqlite3 every time — minutes, for
 * bytes that are already on the disk. So the worktree gets a *mirror*: a real
 * directory whose every entry is a link to the main checkout's, with one
 * deliberate exception.
 *
 * The exception is the workspace packages. `@spar/domain` and its siblings are
 * linked to the **worktree's** copies, not to the main checkout's, because the
 * rating lives in `@spar/domain` and a baseline running the candidate's rating
 * code would be a comparison of a build against itself. Third-party packages are
 * shared, on the grounds that a dependency bump is not what anybody is measuring
 * here, and the lockfile would tell you about it anyway.
 */

const MIRROR_EXCEPT = "@spar";

export type BaselineRun = { worktree: string; outDir: string };

export function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

/**
 * Prepare a worktree at `ref` with today's eval code in it, and hand back where
 * it is. Kept rather than removed afterwards: the second comparison against the
 * same baseline is the common case, and `git worktree` makes reuse cheap.
 */
export function prepareBaseline(ref: string, options: { root?: string } = {}): string {
  const root = options.root ?? repoRoot();
  const worktree = join(root, ".spar-eval", "worktrees", ref.replace(/[^a-zA-Z0-9._-]/g, "_"));

  if (!existsSync(join(worktree, ".git"))) {
    mkdirSync(dirname(worktree), { recursive: true });
    rmSync(worktree, { recursive: true, force: true });
    git(root, ["worktree", "add", "--detach", "--force", worktree, ref]);
  } else {
    /* Reset rather than reuse as-is. The copy below leaves the eval directories
       dirty, and a worktree that has quietly drifted from `ref` is a baseline
       that is not the baseline. */
    git(worktree, ["checkout", "--detach", ref]);
    git(worktree, ["reset", "--hard", ref]);
    git(worktree, ["clean", "-fd", "--", "apps/desktop/src/eval", "packages/eval"]);
  }

  /* Today's eval on yesterday's host. Everything else in the worktree is the
     baseline's own code. */
  cpSync(join(root, "packages/eval"), join(worktree, "packages/eval"), { recursive: true, filter: notBuildOutput });
  cpSync(join(root, "apps/desktop/src/eval"), join(worktree, "apps/desktop/src/eval"), { recursive: true });

  mirrorModules(root, worktree, ["", "apps/desktop", "apps/api", "packages/domain", "packages/database", "packages/practice", "packages/provider", "packages/training", "packages/visualizer", "packages/eval"]);
  return worktree;
}

/**
 * Run the eval CLI inside a checkout, under Electron's Node.
 *
 * Electron rather than plain Node because `better-sqlite3` is built for
 * Electron's ABI, and the scenarios use a real store on the real schema. A mock
 * store would agree with whatever it was written to agree with.
 */
export function runSuiteIn(checkout: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}): void {
  const desktop = join(checkout, "apps/desktop");
  execFileSync(join(desktop, "node_modules/.bin/electron"), [join(desktop, "node_modules/tsx/dist/cli.mjs"), join(desktop, "src/eval/cli.ts"), ...args], {
    cwd: desktop,
    stdio: "inherit",
    /* `development` resolves the workspace packages to their TypeScript sources,
       so a comparison never depends on whose `dist` happens to be built. */
    env: { ...process.env, ...options.env, ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --conditions=development`.trim() },
  });
}

/**
 * A node_modules directory made of links to another one.
 *
 * Shallow on purpose — one link per top-level package, rather than a copy — so
 * it costs nothing and so pnpm's own internal links (which are relative, inside
 * `.pnpm`) keep resolving where they always did. Workspace packages are pointed
 * back into this checkout, which is the entire reason this is not a single
 * symlink of the whole directory.
 */
function mirrorModules(root: string, worktree: string, dirs: string[]): void {
  for (const dir of dirs) {
    const source = join(root, dir, "node_modules");
    if (!existsSync(source)) continue;
    const target = join(worktree, dir, "node_modules");
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });

    for (const entry of readdirSync(source)) {
      if (entry === MIRROR_EXCEPT) {
        mkdirSync(join(target, entry), { recursive: true });
        for (const scoped of readdirSync(join(source, entry))) {
          /* Where the baseline's own copy of this workspace package lives. It is
             a symlink in the source, so follow it to a path and re-root it. */
          const local = rerootWorkspaceLink(root, worktree, join(source, entry, scoped));
          if (local) symlinkSync(local, join(target, entry, scoped), "dir");
        }
        continue;
      }
      symlinkSync(join(source, entry), join(target, entry), "junction");
    }
  }
}

function rerootWorkspaceLink(root: string, worktree: string, link: string): string | null {
  try {
    const resolved = lstatSync(link).isSymbolicLink() ? resolve(dirname(link), readlinkSync(link)) : link;
    /* Only re-root things that actually live in this repository. A scoped
       package installed from a registry is shared like any other. */
    if (!resolved.startsWith(root + "/")) return resolved;
    return join(worktree, resolved.slice(root.length + 1));
  } catch {
    return null;
  }
}

const notBuildOutput = (source: string) => !source.includes("/node_modules") && !source.includes("/dist");

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}
