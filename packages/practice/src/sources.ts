import type { PracticeRegion, PracticeSourceCapabilities, PracticeSourceId } from "./types.js";

/**
 * What Spar knows about each source before it has spoken to it.
 *
 * The descriptor is the thing Settings draws a row from and the thing the host
 * reads capabilities off, and it exists so that adding a second source is a data
 * change here plus a client, rather than a search through the app for everywhere
 * "leetcode" was special-cased.
 *
 * `capabilities` describes the source at its best — signed in, working. What is
 * available *right now* is that intersected with the connection state, which only
 * the host knows; see `effectiveCapabilities`.
 */
export type PracticeSourceDescriptor = {
  id: PracticeSourceId;
  name: string;
  /** One line for the Settings row: what this source is, in the learner's terms. */
  description: string;
  /** Where signing in happens. Opened in a window Spar does not type into. */
  signInUrl: Record<PracticeRegion, string>;
  homeUrl: Record<PracticeRegion, string>;
  regions: PracticeRegion[];
  /** How each region calls itself, for a picker that has to name both. */
  regionLabel: Record<PracticeRegion, string>;
  capabilities: PracticeSourceCapabilities;
  /** Said on the Settings row and in the sign-in window, because a learner
   *  handing an app their session deserves to be told what it will do with it. */
  authNote: string;
};

export const PRACTICE_SOURCES: PracticeSourceDescriptor[] = [
  {
    id: "leetcode",
    name: "LeetCode",
    description: "Practise real LeetCode problems, judged by LeetCode itself. Your solves count on your account.",
    signInUrl: {
      global: "https://leetcode.com/accounts/login/",
      cn: "https://leetcode.cn/accounts/login/",
    },
    homeUrl: { global: "https://leetcode.com", cn: "https://leetcode.cn" },
    regions: ["global", "cn"],
    regionLabel: { global: "leetcode.com", cn: "leetcode.cn" },
    capabilities: {
      remoteJudge: true,
      officialTestcases: true,
      search: true,
      progress: true,
      submissionHistory: true,
    },
    authNote: "You sign in on LeetCode's own page — Spar never sees your password. Spar keeps the session cookie LeetCode sets, in your system keychain, and uses it only for the problems and submissions you ask for.",
  },
];

const BY_ID = new Map(PRACTICE_SOURCES.map((source) => [source.id, source]));

export function practiceSource(id: PracticeSourceId): PracticeSourceDescriptor {
  const source = BY_ID.get(id);
  if (!source) throw new Error(`Unknown practice source: ${id}`);
  return source;
}

/**
 * What a source can do for this learner at this moment.
 *
 * Every capability that needs an account collapses to false while there is no
 * usable session, which is what stops the agent being offered a search it cannot
 * run and — more importantly — stops the host promising a remote verdict it
 * cannot obtain. A disconnected LeetCode still describes problems: its statements
 * are public, so `officialTestcases` survives and the local harness carries the
 * grading.
 */
export function effectiveCapabilities(id: PracticeSourceId, connected: boolean): PracticeSourceCapabilities {
  const base = practiceSource(id).capabilities;
  if (connected) return base;
  return {
    remoteJudge: false,
    officialTestcases: base.officialTestcases,
    /* Search and problem reads are public on LeetCode. What is lost while signed
       out is anything about *this learner*: which problems they have solved,
       their submissions, and their progress. */
    search: base.search,
    progress: false,
    submissionHistory: false,
  };
}

/**
 * One sentence naming who decides whether a solution is correct.
 *
 * Shown to the learner on a sourced challenge and given to the agent in its
 * context, because it is the single most important fact about a challenge and the
 * one place a mistake would be dishonest: a locally-graded run must never be
 * presented as the source having accepted the answer.
 */
export function judgeDescription(id: PracticeSourceId, capabilities: PracticeSourceCapabilities): string {
  const name = practiceSource(id).name;
  return capabilities.remoteJudge
    ? `${name} judges this one. A submission runs against every hidden case ${name} has, and the verdict is theirs.`
    : `${name} is not connected, so Spar grades this one locally against the cases published with the problem. That is weaker than ${name}'s own judge: passing here does not mean accepted there.`;
}
