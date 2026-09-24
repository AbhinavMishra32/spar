import { toolDefinitions } from "./agentTools.js";
import { mergeQuestionChanges, objectRecord, parseRepairChanges } from "./challengeRepair.js";
import { stableJson } from "./evidence.js";
import { describeChanges, streamInto, type StageLog } from "./challengeStages.js";

type Complete = (system: string, message: string, onText?: (delta: string) => void) => Promise<string>;

/** A second model reads the learner evidence and the proposed task before the
 * host publishes anything. It can question the premise and ask the author for
 * a targeted edit; it does not pick a topic or apply a fixed rotation rule. */
export async function reviewChallengeFit(input: {
  candidate: Record<string, unknown>;
  context: string;
  learnerMessage: string;
  currentTarget?: unknown;
  signal: AbortSignal;
  complete: Complete;
  progress(detail: string): void;
  /** Live stages under the authoring row, and the model tag they carry. */
  stages?: StageLog;
  model?: { model: string; provider: string };
  observe?(event: { pass: number; verdict: "accept" | "revise" | "unavailable" | "skipped"; reason?: string; candidateTitle: string }): void;
}): Promise<{ candidate: Record<string, unknown>; feedback: string | null }> {
  const context = objectRecord(JSON.parse(input.context));
  const recentChallenges = Array.isArray(context.recentChallenges) ? context.recentChallenges : [];
  if (!recentChallenges.length && !context.activeQuestion) {
    input.observe?.({ pass: 0, verdict: "skipped", reason: "No earlier challenge to compare", candidateTitle: String(input.candidate.title ?? "") });
    input.stages?.note("review", "skipped", "Skipped fit review", "no earlier challenge to compare against");
    return { candidate: input.candidate, feedback: null };
  }
  const active = objectRecord(context.activeQuestion);
  const evidence = {
    learnerGoal: objectRecord(context.session).originalGoal,
    learnerMessage: input.learnerMessage,
    activeTrainingTarget: input.currentTarget ?? context.activeTrainingTarget,
    activeQuestion: context.activeQuestion ? {
      title: active.title,
      statement: active.statement,
      kind: active.kind,
      abilityTitle: active.abilityTitle,
      specificGap: active.specificGap,
      desiredEvidence: active.desiredEvidence,
      status: active.status,
    } : null,
    recentChallenges,
    learnerStanding: context.learnerStanding,
  };
  let candidate = input.candidate;
  for (let pass = 0; pass < 2; pass += 1) {
    const observe = (verdict: "accept" | "revise" | "unavailable", reason: string) => input.observe?.({ pass: pass + 1, verdict, reason, candidateTitle: String(candidate.title ?? "") });
    if (input.signal.aborted) throw input.signal.reason;
    input.progress(pass === 0 ? "Reviewing challenge fit against your recent work" : "Checking the revised challenge's fit");
    const reviewing = input.stages?.begin("review", pass === 0 ? "Reviewer checking" : "Reviewer rechecking", pass === 0 ? "fit against your recent work" : "the revised challenge", { ...input.model, badge: `${recentChallenges.length} recent` });
    let assessment: Record<string, unknown> | null;
    try {
      assessment = parseRepairChanges(await input.complete(
        "You are a critical coding coach reviewing one candidate before publication. Use the learner's actual evidence and latest request. Decide whether this particular task is useful now. A deliberate repeat, small variation, topic switch, or advanced transfer can each be good; do not impose a sequence or novelty quota. A passed exercise is evidence that its stated task was completed, but not proof of every related skill. If a claimed gap conflicts with a passed exercise, name the conflict. Reject only a concrete problem in fit, meaning, or learner-request alignment. Return only JSON: {\"verdict\":\"accept\"|\"revise\",\"reason\":\"specific evidence-based explanation\"}. Do not evaluate whether code passes tests; the host does that separately.",
        `Learner evidence:\n${stableJson(evidence)}\n\nCandidate task:\n${stableJson(taskSummary(candidate))}`,
        streamInto(reviewing, "verdict"),
      ));
    } catch (error) {
      if (input.signal.aborted) throw error;
      observe("unavailable", error instanceof Error ? error.message : String(error));
      reviewing?.end("skipped", { verb: "Reviewer unavailable", detail: error instanceof Error ? error.message : String(error) });
      input.progress("Fit review unavailable; continuing with compiler validation");
      return { candidate, feedback: null };
    }
    if (!assessment || !["accept", "revise"].includes(String(assessment.verdict))) {
      observe("unavailable", "No parseable verdict");
      reviewing?.end("skipped", { verb: "Reviewer gave no verdict", detail: "Continuing with compiler validation" });
      input.progress("Fit review returned no verdict; continuing with compiler validation");
      return { candidate, feedback: null };
    }
    if (assessment.verdict === "accept") {
      observe("accept", String(assessment.reason ?? ""));
      reviewing?.end("done", { verb: "Reviewer accepted", detail: String(assessment.reason ?? "") });
      return { candidate, feedback: null };
    }
    const reason = String(assessment.reason ?? "The candidate does not yet fit the learner's evidence.").trim();
    observe("revise", reason);
    reviewing?.end("failed", { verb: "Reviewer asked for changes", detail: reason });
    if (pass === 1) return { candidate, feedback: reason };

    input.progress("Revising the challenge against that feedback");
    const revising = input.stages?.begin("revise", "Revising", "against the reviewer's feedback", input.model);
    let changes: Record<string, unknown> | null;
    try {
      changes = parseRepairChanges(await input.complete(
        "You authored a coding challenge. A second coach found a specific issue with its fit for this learner. Revise the challenge in the direction you judge best. Preserve the learner's intent and any useful parts of the design. If the stored training target is stale, include a trainingTarget correction in your patch; do not merely change the title. Update why when the teaching reason changes. Return only a JSON object of changed top-level fields. For file maps, include changed paths only and use null to delete a path. Keep starter, reference, visible tests, hidden tests, and statement coherent. Do not add commentary or a wrapper.",
        `Review feedback: ${reason}\n\nLearner evidence:\n${stableJson(evidence)}\n\nRetained candidate:\n${stableJson(candidate)}`,
        streamInto(revising, "patch"),
      ));
    } catch (error) {
      if (input.signal.aborted) throw error;
      revising?.end("failed", { verb: "Revision failed", detail: error instanceof Error ? error.message : String(error) });
      return { candidate, feedback: `${reason} Revision failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!changes || !Object.keys(changes).length) revising?.end("failed", { verb: "Revision failed", detail: "No usable changes" });
    if (!changes || !Object.keys(changes).length) return { candidate, feedback: `${reason} The revision contained no usable changes.` };
    const revised = mergeQuestionChanges(candidate, changes);
    if (stableJson(revised) === stableJson(candidate)) revising?.end("failed", { verb: "Revision failed", detail: "Left the challenge unchanged" });
    if (stableJson(revised) === stableJson(candidate)) return { candidate, feedback: `${reason} The revision left the challenge unchanged.` };
    try {
      const tool = "reason" in revised ? toolDefinitions.replace_current_question[1] : toolDefinitions.create_question[1];
      tool.parse(revised);
    } catch (error) {
      revising?.end("failed", { verb: "Revision failed", detail: "Did not match the challenge contract" });
      return { candidate, feedback: `${reason} The revision did not match the challenge tool contract: ${error instanceof Error ? error.message : String(error)}` };
    }
    revising?.end("done", { verb: "Revised", detail: describeChanges(changes) });
    candidate = revised;
  }
  return { candidate, feedback: "The revised challenge still needs a fit review." };
}

function taskSummary(candidate: Record<string, unknown>) {
  return {
    title: candidate.title,
    kind: candidate.kind,
    difficulty: candidate.difficulty,
    statement: candidate.statement,
    concepts: candidate.concepts,
    solutionRequirements: candidate.solutionRequirements,
    trainingTarget: candidate.trainingTarget,
    introductionReason: candidate.why,
    reasonForReplacement: candidate.reason,
  };
}
