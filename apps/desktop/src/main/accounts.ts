import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

/* Every account signed in on this device keeps its own folder under
   `<userData>/spar/accounts/<id>/`: the local store, its workspaces, its own
   skills and user.md. Switching account opens a different folder, and signing
   out deletes only the folder of the account that left.

   It used to be one folder for the whole device, cleared on sign-out. Anything
   that got past the sign-out (an expired session, a keychain reset) was then
   read as the next account's data, and a new sign-up opened straight into
   someone else's profile instead of onboarding. */

export type AccountPaths = { root: string; db: string; userFile: string; workspaces: string; skills: string };

/** Items that made up the single-folder layout, moved as they are. */
const LEGACY = ["state.sqlite3", "state.sqlite3-wal", "state.sqlite3-shm", "user.md", "workspaces", "skills"];

export class AccountFolders {
  constructor(private readonly base: string) {}

  /** An account's folder, or the one used while nobody is signed in (it only
   *  ever holds device settings such as the theme). */
  paths(accountId: string | null): AccountPaths {
    const root = path.join(this.base, accountId ? path.join("accounts", folderName(accountId)) : "signed-out");
    mkdirSync(path.join(root, "workspaces"), { recursive: true });
    return { root, db: path.join(root, "state.sqlite3"), userFile: path.join(root, "user.md"), workspaces: path.join(root, "workspaces"), skills: path.join(root, "skills") };
  }

  /** Moves the single-folder layout into the account it belonged to: whoever is
   *  signed in when this version first runs. With nobody signed in, the data
   *  has no owner that can be proven, so it is set aside rather than handed to
   *  whoever signs in next. Their cloud copy comes back through restore. */
  migrateLegacy(accountId: string | null) {
    if (!existsSync(path.join(this.base, "state.sqlite3"))) return;
    const owned = accountId ? this.paths(accountId).root : null;
    const target = owned && !existsSync(path.join(owned, "state.sqlite3")) ? owned : path.join(this.base, "set-aside", new Date().toISOString().replace(/[:.]/g, "-"));
    mkdirSync(target, { recursive: true });
    for (const item of LEGACY) {
      const from = path.join(this.base, item);
      if (!existsSync(from)) continue;
      const to = path.join(target, item);
      // `paths()` makes an empty workspaces folder; the old one replaces it.
      if (existsSync(to)) rmSync(to, { recursive: true, force: true });
      renameSync(from, to);
    }
  }

  remove(accountId: string) {
    rmSync(path.join(this.base, "accounts", folderName(accountId)), { recursive: true, force: true });
  }
}

/** Account ids are the server's, but a folder name is not the place to trust that. */
function folderName(accountId: string) {
  return accountId.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** An object whose target can be replaced while everything holding it keeps the
 *  same reference. The services built at launch all take the store once, so
 *  switching account swaps what this points at rather than rebuilding them. */
export function swappable<T extends object>(initial: T) {
  let current = initial;
  const proxy = new Proxy(Object.create(null) as T, {
    get(_target, property) {
      const value = Reflect.get(current, property, current) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(current) : value;
    },
    set(_target, property, value) { return Reflect.set(current, property, value, current); },
    has(_target, property) { return property in current; },
    getPrototypeOf() { return Object.getPrototypeOf(current) as object | null; },
  });
  return {
    proxy,
    current: () => current,
    /** Points at `next` and hands back what it pointed at before. */
    swap(next: T) {
      const previous = current;
      current = next;
      return previous;
    },
  };
}
