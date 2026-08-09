import { conceptTitleFromSlug, seededConcept } from "@spar/domain";
import type { ChallengeSource, Language } from "@spar/domain";
import type { PracticeProblem, PracticeSourceId } from "@spar/practice";
import type { LocalStore } from "./store.js";
import type { PracticeService } from "./practice.js";
import type { WorkspaceService } from "./workspaces.js";

/**
 * The training target for a problem the learner picked themselves.
 *
 * Every challenge in Spar hangs off a persisted target — it is what the ability
 * rollups, the concept evidence and the challenge history all key on, and
 * `createQuestion` refuses without one. On the agent's path the target is the
 * interesting part: it reads the learner's record, decides what is worth finding
 * out, and then goes looking for a problem that would show it.
 *
 * This is the other direction. The problem is already fixed, so the target is
 * derived from it, and the wording says so rather than dressing the learner's
 * choice up as a diagnosis Spar made. That honesty is the whole point of keeping
 * this separate from `assessPracticeAssignment`: the adaptive policy exists to
 * stop the agent setting something too hard or off-target, and neither of those
 * is a reason to refuse a problem the learner asked for by name.
 *
 * Pure, so what the record ends up saying about a self-chosen problem can be
 * read off a test rather than out of a database.
 */

export type ChosenTarget = {
  /** The ability this counts as evidence about. Named, not id'd — the store
   *  resolves an existing ability with this title or opens a new one. */
  ability: string;
  specificGap: string;
  desiredEvidence: string;
  avoidTesting: string[];
  /** What the session says it is doing, in the learner's terms. */
  objective: string;
};

const SOURCE_NAME: Record<ChallengeSource["source"], string> = { leetcode: "LeetCode", codeforces: "Codeforces" };

/** A source's own name for itself, for the sentences both assignment paths write
 *  into the session. Shared so the two cannot drift into calling it two things. */
export function practiceSourceName(source: ChallengeSource["source"]): string {
  return SOURCE_NAME[source];
}

/** The concept an ability is opened under. A problem's primary concept where it
 *  has one, its first supporting concept where it does not, and the source's own
 *  first topic tag as the last resort — a problem with no metadata at all still
 *  has to land somewhere a later rollup can find it. */
export function chosenAbility(problem: Pick<PracticeProblem, "concepts" | "topicTags">): string {
  const primary = problem.concepts.find((concept) => concept.role === "primary") ?? problem.concepts[0];
  if (primary) return seededConcept(primary.slug)?.title ?? conceptTitleFromSlug(primary.slug);
  const tag = problem.topicTags[0];
  if (tag) return tag.name || conceptTitleFromSlug(tag.slug);
  return "Problem solving";
}

export function chosenTarget(
  problem: Pick<PracticeProblem, "title" | "difficulty" | "displayId" | "source" | "concepts" | "topicTags">,
  source: Pick<ChallengeSource, "judge">,
): ChosenTarget {
  const ability = chosenAbility(problem);
  const name = SOURCE_NAME[problem.source];
  const label = problem.displayId ? `${name} ${problem.displayId}` : name;

  return {
    ability,
    /* Stated as what it is. A specific gap Spar did not identify must not be
       written as though it had — a later turn reads these back as its own prior
       reasoning, and one invented line here becomes evidence forever. */
    specificGap: `Not diagnosed by Spar: the learner chose ${problem.title} (${label}, ${problem.difficulty}) themselves.`,
    desiredEvidence: `Whether they can take a ${problem.difficulty} ${name} problem on ${ability.toLowerCase()} from statement to a passing solution unaided. ${source.judge}`,
    avoidTesting: [],
    objective: `Solving ${problem.title} on ${name}.`,
  };
}

/** The concept tags a self-chosen problem carries. The source's mapping onto
 *  Spar's vocabulary, verbatim — the same tags the agent would have passed to
 *  `assign_practice_problem`, so a problem opened directly is filed exactly like
 *  one the agent assigned and neither is invisible to the concept rollups. */
export function chosenConcepts(problem: Pick<PracticeProblem, "concepts">): Array<{ slug: string; role: "primary" | "supporting" }> {
  return problem.concepts.map((concept) => ({ slug: concept.slug, role: concept.role }));
}

/** What the validation report says about a challenge nobody validated. There is
 *  no compiler run here and there was none on the agent's path either — a sourced
 *  problem has no reference solution to check a suite against — so the report
 *  carries the two facts that are true: who grades it, and who picked it. */
export function chosenReport(source: Pick<ChallengeSource, "judge">) {
  return {
    valid: true,
    sourced: true,
    chosenByLearner: true,
    checks: [
      { name: "practice source", passed: true, detail: source.judge },
      { name: "chosen by the learner", passed: true, detail: "The learner picked this problem from the library, so it was not held to the adaptive checks that bound what the agent may assign." },
    ],
  };
}

/**
 * Opening a problem the learner picked, start to finish.
 *
 * The whole sequence is here rather than in the IPC handler because the order is
 * the part that can be wrong, and an order that can be wrong should be testable
 * without an Electron window around it. Two constraints fix it:
 *
 * - The target is persisted before the challenge, because `createQuestion`
 *   refuses without one — every challenge in Spar hangs off a target, and that is
 *   what keeps this one visible to the ability and concept rollups.
 * - The files are on disk before the challenge exists, because the moment it does
 *   the renderer can open the workspace on it, and a workspace whose files have
 *   not landed yet is an empty editor.
 */
export async function openChosenProblem(
  deps: { store: LocalStore; practice: PracticeService; workspaces: WorkspaceService },
  input: { source: PracticeSourceId; slug: string; language?: Language | undefined },
): Promise<{ sessionId: string }> {
  const language = input.language ?? deps.store.getProfile()?.language ?? "javascript";
  const mounted = await deps.practice.mount({ source: input.source, slug: input.slug, language });
  const { problem, design, source, files } = mounted;

  /* Nothing could grade it. The same refusal the agent's path makes, for the same
     reason — asking someone to solve something with no way to find out whether
     they had is worse than saying so — and it is checked after the mount because
     the answer depends on what the harness could recover from the statement. */
  if (!source.remoteJudge && source.localCaseCount === 0) {
    throw new Error(`Spar cannot grade ${problem.title}: ${practiceSourceName(problem.source)} is not judging submissions right now, and no runnable case could be built from the examples published with the problem.`);
  }

  const target = chosenTarget(problem, source);
  const { sessionId } = deps.store.createSession(`Solve ${problem.title} on ${practiceSourceName(problem.source)}.`);
  deps.store.setObjective(sessionId, target.objective);
  /* The ability is opened and queued for sync here rather than left to the agent's
     `set_training_target` handler, because on this path there is no agent turn to
     run it — and an ability that exists only as a training-target row is one the
     Abilities page cannot show. */
  const persisted = deps.store.setTrainingTarget(sessionId, {
    ability: target.ability,
    specificGap: target.specificGap,
    desiredEvidence: target.desiredEvidence,
    avoidTesting: target.avoidTesting,
  });
  deps.store.ensureAbility(persisted.abilityId, persisted.abilityTitle);
  deps.store.queueAbilitySync(persisted.abilityId);

  await deps.workspaces.writeAll(sessionId, files);
  deps.store.createQuestion(sessionId, design, chosenReport(source), { concepts: chosenConcepts(problem), source });
  /* Recorded the way the agent records an assignment it made, so a later turn
     reading the session finds the same kind of line either way — and finds, in
     plain words, that this one was not its own idea. */
  deps.store.addMessage(
    sessionId,
    "system",
    `Set ${practiceSourceName(problem.source)} ${source.displayId} — ${design.title}. The learner chose it from the problem library, so no adaptive target was inferred. ${source.judge}`,
  );
  return { sessionId };
}
