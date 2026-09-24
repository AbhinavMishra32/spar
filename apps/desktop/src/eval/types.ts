import type { LocalStore } from "../main/store.js";

/**
 * What an eval scenario is in Spar: a learner, a misconception they actually
 * have, and a sequence of attempts that shows it.
 *
 * The ground truth is *constructed* rather than labelled. Nobody annotates what
 * this learner's problem is after the fact — the scenario declares it, and then
 * every attempt in the scenario is written to be consistent with it. That is the
 * difference between an eval that measures whether Spar reached the right
 * conclusion and one that measures whether Spar agreed with a judge, and it is
 * worth a great deal: on the trajectory scenarios there is nothing to calibrate,
 * because the answer was decided before the run started.
 *
 * The claim under test is Spar's own, stated as narrowly as Spar states it. Not
 * "did it notice sliding windows are hard" but "did it work out that the
 * invariant is restored once and not repeatedly, did it say so in those terms,
 * did it stop re-deriving it every attempt, and did the next problem go after
 * exactly that".
 */

/** The thing the simulated learner gets wrong, in the three forms the verifiers
 *  need it: a slug to match concepts against, a sentence a person would write,
 *  and the words that have to appear somewhere in Spar's own reading for it to
 *  count as having named the thing rather than the topic. */
export type Misconception = {
  slug: string;
  statement: string;
  /** Lowercased substrings. A reading counts as behavioural when it contains at
   *  least `markersRequired` of them — several rather than one, because any
   *  single word can turn up in a sentence that says nothing. */
  markers: string[];
  markersRequired: number;
  /** Words that mean the reading is a verdict rather than an interpretation. A
   *  statement carrying one of these and none of the markers is exactly the
   *  failure this whole eval exists to detect. */
  verdictWords: string[];
};

export type ScriptedAttempt = {
  /** How Spar's own attempt lifecycle ends. `failed` is not among them on
   *  purpose: a wrong submission leaves the attempt open and the learner keeps
   *  working, so the only ways out are solving it and giving up. */
  outcome: "passed" | "abandoned";
  /** Whether the learner asked for help before getting there. Assisted solves
   *  are discounted as proof and still count as something Spar watched. */
  hints: number;
  /** Whether a case that had passed on an earlier run failed again on a later
   *  one. This is the signature of an invariant restored once rather than
   *  repeatedly, and the replay calls it the most diagnostic thing in the
   *  trace — so a scenario claiming inconsistency has to actually produce it. */
  regressed: boolean;
  /** What a replay of this attempt would support saying, in the words the agent
   *  is supposed to write down. The scripted agent uses it verbatim: the point
   *  of these runs is to measure what the *host* does with a good reading, not
   *  to test whether a string can be copied. */
  reading: string;
  /** How the learner's solve probability maps onto this attempt, for scenarios
   *  that check the rating moved the right way. */
  note?: string;
};

export type ScenarioProfile = { name: string; experience: "new" | "working" | "senior"; focus: string; weakness: string; language: string };

export type Scenario = {
  id: string;
  /** One line, in the product's language, for the report. */
  claim: string;
  goal: string;
  profile: ScenarioProfile;
  ability: { title: string; concepts: Array<{ slug: string; role: "primary" | "supporting" }> };
  misconception: Misconception;
  attempts: ScriptedAttempt[];
  /** Problems the agent may choose between when the scenario exercises problem
   *  selection. Priced the way a source prices them, so the host's own gate is
   *  what admits or refuses them. */
  candidates?: Array<{ source: "leetcode" | "codeforces"; slug: string; title: string; difficulty: "easy" | "medium" | "hard"; sourceRating?: number | null }>;
  /** What this run of attempts ought to have led Spar to conclude.
   *
   *  Stated in the fixture rather than inside a verifier, because it is part of
   *  the ground truth and not part of the machinery: a scenario where somebody
   *  solves three problems unaided and one where somebody fails four want
   *  opposite verdicts from the same check, and threading that through the
   *  verifier as a special case would hide the claim in the code that tests it.
   *  Anything left out is not checked, which is how a scenario says "this run
   *  makes no claim about the rating" rather than silently asserting one. */
  expect: {
    /** Statuses this record cannot honestly support. */
    statusNot?: string[];
    proficiencyBelow?: number;
    proficiencyAbove?: number;
    /** Which way the rating should have gone by the end. */
    rating?: "up" | "down";
    trend?: "improving" | "declining" | "stable";
    /** Whether the finding is meant to be a standing pattern by the end. False
     *  for a learner who does not have a recurring mistake to find. */
    pattern?: boolean;
  };
};

/**
 * The agent, as the harness drives it.
 *
 * Two implementations and the harness cannot tell them apart: the scripted one,
 * which holds the pedagogy fixed so a difference between two runs is a
 * difference in the host, and the live one, which runs Spar's real worker
 * against a real model. Everything either side of this interface — the learner,
 * the store, the durable events, the snapshots — is identical, which is the only
 * reason a scripted number and a live number can be put on the same page.
 */
export type ScenarioAgent = {
  openTarget(): Promise<void>;
  afterAttempt(input: { attemptNumber: number; attemptId: string; attempt: ScriptedAttempt; eventIds: string[] }): Promise<void>;
  close?(): void;
};

/**
 * Everything the harness is allowed to touch on the host.
 *
 * Narrow on purpose, and every member optional-by-probe rather than by type. The
 * comparison harness runs the *same* scenario code against an older checkout of
 * Spar, where some of these do not exist yet — and the whole point of that run is
 * to find out what the older host could not do. A harness that crashed on a
 * missing method would report "the baseline failed to run" where the honest
 * answer is "the baseline could not see its own patterns".
 */
export type Host = {
  store: LocalStore;
  /** Calls a host tool by name, exactly as the agent would. Returns the tool's
   *  own result, including the `checks` a refusal carries. */
  tool(name: string, input: Record<string, unknown>): Promise<unknown>;
};

/** What Spar believed at one moment, projected to the parts a verdict depends
 *  on. Deliberately small: a snapshot that carried everything would diff against
 *  itself on every run. */
export type LedgerSnapshot = {
  abilities: Array<{ title: string; status: string; proficiency: number; confidence: number; evidenceCount: number; trainingStatus: string }>;
  patterns: Array<{ title: string; status: string; abilityTitle: string; evidenceCount: number }>;
  evidence: Array<{ abilityTitle: string; statement: string; polarity: string; independence: string; strength: number }>;
  rating: { rating: number; deviation: number; provisional: boolean } | null;
  notices: string[];
};
