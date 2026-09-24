import { ESTABLISHED_DEVIATION, generatedDifficultyFor } from "@spar/domain";
import type { LocalStore } from "./store.js";
import { trainingWindow } from "./practiceAssignmentPolicy.js";
import type { AgentTurnKind } from "../workers/agentPolicy.js";

/**
 * Everything the agent is told before a turn, in one place.
 *
 * This used to be a single object literal inside `startAgentTurn`, several
 * hundred characters wide, and that was fine while the main process was the only
 * thing that ever started a turn. It is not any more: the eval runs the real
 * worker against a real store, and a turn assembled a second time by a second
 * caller is a turn that measures a prompt the product does not send. So the
 * prompt has one author.
 *
 * Which parts are arguments and which are read here is not arbitrary. Anything
 * the *record* can answer — the session, the target, the profile, the Track, the
 * rating, the open patterns — is read here, so no caller can get it wrong or
 * leave it out. Anything that depends on the machine rather than the learner —
 * whether a web key exists, which practice sources are connected, which account
 * is signed in — is passed in, because those are facts about the running app and
 * the store has no opinion about them.
 */

export type TurnPayloadInput = {
  store: LocalStore;
  sessionId: string;
  message: string;
  turnKind: AgentTurnKind;
  /** Whether the agent may reach outside the learner's own record. Two
   *  conditions and both are the learner's: a key exists, and they want it used. */
  webSearch: boolean;
  practiceSource: boolean;
  practiceSummary: unknown;
  accountId: string;
  /** Rehydrate a successful handoff if the provider failed while writing its reply. */
  resumeSince?: string;
};

export type TurnPayload = {
  sessionId: string;
  message: string;
  turnKind: AgentTurnKind;
  webSearch: boolean;
  practiceSource: boolean;
  activeQuestion: { id: string; attemptId: string } | null;
  resumeState: Record<string, unknown>;
  context: string;
};

const DEFAULT_OBJECTIVE = "Investigating your prior evidence and defining the first training target.";

export function agentTurnPayload(input: TurnPayloadInput): TurnPayload {
  const { store, sessionId, turnKind } = input;
  const session = store.readSession(sessionId);
  if (!session) throw new Error("Session not found");
  const target = store.latestTarget(sessionId);
  /* Onboarding is evidence like any other: what the learner said about their
     experience and where they feel weak calibrates the first target, before any
     attempt exists to calibrate it from. */
  const profile = store.getProfile();
  /* Bound once, because it answers two questions: what the Track is, and which
     language its challenges are written in. */
  const track = session.summary.trackId ? store.listTracks().find((item) => item.id === session.summary.trackId) ?? null : null;

  const intake = (turnKind === "cold-start" || turnKind === "session-start") ? store.answeredIntake(sessionId) : undefined;
  const lesson = input.resumeSince ? store.lessonPublishedSince(sessionId, input.resumeSince) : null;

  return {
    sessionId,
    message: input.message,
    turnKind,
    webSearch: input.webSearch,
    practiceSource: input.practiceSource,
    activeQuestion: openQuestion(session) ? { id: session.question!.id, attemptId: session.question!.attemptId } : null,
    resumeState: {
      ...(intake ? { intake: { result: { status: "answered", answer: intake } } } : {}),
      ...(lesson ? { lesson: { result: lesson } } : {}),
      ...(session.summary.objective !== DEFAULT_OBJECTIVE ? { objective: { committed: true, objective: session.summary.objective } } : {}),
      ...((turnKind === "session-start" || turnKind === "cold-start") && !session.question && target ? { target: { committed: true, ...target } } : {}),
    },
    context: JSON.stringify({
      session: session.summary,
      activeQuestion: session.question,
      activeTrainingTarget: target,
      targetProgress: store.targetProgress(sessionId),
      /* The conversation is for continuity, not a second copy of every tool
         payload behind it. Activity input/output can be tens of kilobytes per
         reply and is already available through the tools that own it. */
      recentConversation: session.messages.slice(-12).map(({ id, role, body, createdAt }) => ({ id, role, body, createdAt })),
      track,
      relevantAbilitySummary: store.searchLearner(session.summary.originalGoal, 4, session.summary.trackId),
      /* Carried unconditionally, unlike `relevantAbilitySummary`, which is
         scoped to the goal and so cannot show a topic the goal never mentions.
         Repetition across sessions is exactly the thing a goal-scoped view
         hides: the agent needs to see the last dozen challenges to know it has
         asked about the same concept twelve times. */
      recentChallenges: store.recentChallengeCoverage(12, session.summary.trackId),
      /* Carried for the same reason and read the other way round. A pattern is
         the agent's own standing suspicion about how this learner goes wrong,
         and until it was in the turn's context nothing put one in front of the
         agent unprompted — so a hypothesis written three attempts ago only came
         back if somebody happened to search the words it was filed under. Open
         ones only: a resolved pattern is history, and history is what
         `search_learner_model` is for. */
      /* What has already been explained to them, so it can be built on and
         pointed at rather than taught a second time. Ids included: the reference
         the agent writes into a reply — [[lesson:id|title]] — is what turns "I
         showed you this" from a claim into a page the learner can open. */
      recentLessons: store.recentLessons(6, session.summary.trackId),
      openPatterns: store.listPatterns(session.summary.trackId).filter((pattern) => pattern.status !== "resolved").slice(0, 8),
      /* Where the learner is rated, and the range of problem difficulty that
         follows from it. The host has always enforced a level rule on what the
         agent may assign and never told the agent what the rule was, so the
         agent chose against a difficulty word and found out it had guessed wrong
         from a refusal. This is the same window `assessPracticeAssignment`
         checks against, computed the same way, so searching inside it and being
         admitted are the same condition rather than two that happen to agree.

         Stated in item-rating points because that is what the sources publish: a
         Codeforces problem carries its own number, and the three-band prices in
         `itemRating` put LeetCode on the same scale. */
      learnerStanding: learnerStanding(store, target, profile),
      practiceSource: input.practiceSummary,
      accountId: input.accountId,
      preferredLanguage: track?.language ?? profile?.language ?? "javascript",
      learnerProfile: profile ? { name: profile.name, experience: profile.experience, focus: profile.focus, statedWeakness: profile.weakness } : null,
    }),
  };
}

/** Bound to the ability the session is actually training, because the window is
 *  not one range per learner: a settled ability wants a stretch and an untested
 *  one wants something readable, off the same rating. */
function learnerStanding(store: LocalStore, target: { ability_id?: unknown } | null | undefined, profile: { experience?: "new" | "working" | "senior" } | null) {
  const rating = store.currentRating();
  const ability = target ? store.readAbilityDetail(String(target.ability_id)) : null;
  const status = ability?.ability.status ?? "uncertain";
  const window = trainingWindow({ rating, abilityStatus: status, experience: profile?.experience ?? "new" });
  return {
    rating: Math.round(rating.rating),
    provisional: rating.deviation > ESTABLISHED_DEVIATION,
    abilityStatus: status,
    setProblemsRated: window,
    /* The same window, said in the only vocabulary `create_question` has. The
       range is what the host enforces, but the agent cannot write a challenge to
       a number — it picks one of four words, and before this it picked one with
       nothing to pick against. */
    writeProblemsAt: generatedDifficultyFor(window),
  };
}

/** Whether the learner still has a challenge in front of them. While it is open
 *  they can still submit; once it closes the session is waiting for what comes
 *  next. */
export function openQuestion(session: { question: { attemptCompletedAt: string | null } | null }): boolean {
  return Boolean(session.question && !session.question.attemptCompletedAt);
}
