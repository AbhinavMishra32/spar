import { app } from "electron";
import { findGitDir, readGitHead, type GitHead } from "./gitHead.js";
import type { BuildInfo } from "../shared/api.js";

/**
 * Which copy of Spar this is. A packaged release is identified by its version,
 * but a version number alone says nothing about a build made from source — two
 * checkouts a month apart both call themselves 0.0.1 — so the commit travels
 * with it and stands in as the identity when there is no release behind it.
 */

const BAKED = /^[0-9a-f]{7,40}$/;

let cached: BuildInfo | undefined;

export function buildInfo(): BuildInfo {
  if (cached) return cached;

  // A packaged app ships without a repository beside it, so the release
  // pipeline bakes the SHA into the environment instead. Where both exist the
  // baked one wins: it is what was recorded at the moment the build was cut.
  const baked = process.env.SPAR_COMMIT?.trim();
  let head: GitHead = { commit: null, branch: null };
  try {
    const dir = findGitDir(app.getAppPath());
    if (dir) head = readGitHead(dir);
  } catch {
    // An unreadable repository is not a reason to fail to open a window.
  }

  cached = {
    version: app.getVersion(),
    commit: baked && BAKED.test(baked) ? baked : head.commit,
    branch: process.env.SPAR_BRANCH?.trim() || head.branch,
    packaged: app.isPackaged,
  };
  return cached;
}
