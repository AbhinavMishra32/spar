import { LEARNER_NOTEBOOK } from "../shared/api.js";
import { normalizeStatementText } from "../shared/statementText.js";
import { figureProblems } from "../shared/figure.js";
import type { SkillService } from "./skills.js";
import { randomUUID } from "node:crypto";
import { compileQuestion, type DesignOrigin } from "@spar/training";
import { REVIEW_TARGETS, abilityStatusSchema, languageSchema, lessonInputSchema, type AbilityStatus, type AskUserQuestionInput, type ReviewTarget } from "@spar/domain";
import { DEFAULT_SECTIONS, foldAttempt, formatSolveLog, type CaseFilter, type ReplaySection } from "../shared/attemptReplay.js";
import type { ConceptTagInput, LocalStore } from "./store.js";
import type { UtilityClient } from "./utilityClient.js";
import type { WorkspaceService } from "./workspaces.js";
import type { WebSearchService } from "./webSearch.js";
import type { PracticeService } from "./practice.js";
import { assessPracticeAssignment } from "./practiceAssignmentPolicy.js";
import { reviewTargetMode } from "./reviewSession.js";
import { practiceSourceName } from "./practiceChoice.js";
import { SOURCE_READ_TOOLS, VISUALIZER_TOOLS } from "../workers/agentPolicy.js";
import type { VisualizerToolbox } from "./visualizerTools.js";
import type { AgentQuestions } from "./agentQuestions.js";

/**
 * A published challenge's language becomes the Track's.
 *
 * The learner who says "in python man!" is not asking about this one challenge;
 * they are telling Spar what this Track is for. Without this the correction
 * lasts exactly one turn, because `preferredLanguage` is rebuilt from the Track
 * on the next one and the next question comes back in the old language again.
 *
 * Derived from a tool result rather than from the learner's words: the agent has
 * already resolved "in python man!" into `language: "python"` on a candidate the
 * host compiled and ran. Nothing here reads natural language.
 */
function rememberTrackLanguage(local: LocalStore, trackId: string | null | undefined, value: Record<string, unknown>) {
  if (!trackId) return;
  const language = languageSchema.safeParse(value.language);
  if (!language.success) return;
  const track = local.listTracks().find((entry) => entry.id === trackId);
  if (!track || track.language === language.data) return;
  local.updateTrack(trackId, { language: language.data });
}

/** The agent may correct a stale target in the same call that publishes its
 * revised challenge. Nothing is changed until the candidate has compiled. */
function commitCandidateTarget(local: LocalStore, sessionId: string, trackId: string | null | undefined, value: Record<string, unknown>) {
  if (!value.trainingTarget || typeof value.trainingTarget !== "object") return;
  const target = local.setTrainingTarget(sessionId, value.trainingTarget as { ability: string; specificGap: string; desiredEvidence: string; avoidTesting: string[] });
  local.ensureAbility(target.abilityId, target.abilityTitle, trackId);
  local.queueAbilitySync(target.abilityId);
}

/**
 * The lesson this challenge is testing, handed back with it.
 *
 * "Teach, then test what you taught" is only real if the turn that sets the
 * challenge knows what was taught. Prompting for it is not enough — the agent
 * that authored a challenge two turns after a lesson is not reliably holding
 * that lesson in mind — so the host does the join on the tags both sides already
 * carry and says so in the result. The reply then has something specific to
 * point at, and the learner sees the two halves as one thing.
 */
function followsLesson(local: LocalStore, concepts: ConceptTagInput[], trackId: string | null | undefined) {
  const found = local.lessonForConcepts(concepts.map((tag) => tag.slug), trackId);
  if (!found) return {};
  return {
    followsLesson: { id: found.id, title: found.title, taughtAt: found.taughtAt },
    followsLessonNote: `This challenge shares a concept tag with "${found.title}". Decide whether the lesson helps with this step; if it does, explain the connection and point to [[lesson:${found.id}|${found.title}]].`,
  };
}

/** Each ```figure fence in a statement that does not check, as one sentence. */
export function statementFigureProblems(statement: string): string[] {
  return figureProblems(statement);
}

export async function executeTrainingTool(
  name: string,
  input: unknown,
  sessionId: string | undefined,
  local: LocalStore,
  workspaces: WorkspaceService,
  runner: UtilityClient,
  web?: WebSearchService,
  practice?: PracticeService,
  /* Optional for the same reason `web` and `practice` are: the tool tests call
     this directly, and standing up a tracer to assert that `read_ability` reads
     an ability would be a fixture with no bearing on the thing under test. */
  visualizer?: VisualizerToolbox,
  questions?: AgentQuestions,
  /** Live compile runs for an authoring call, back to the worker that asked. */
  progress?: (value: unknown) => void,
  skills?: SkillService,
) {
  if (!sessionId) throw new Error("Training tool call is missing its session context");
  const value = input as Record<string, unknown>;
  const trackId = local.trackIdForSession(sessionId);
  /* Reads of the practice source go straight through to its MCP server, which
     owns their schemas and their failure wording. Nothing is unwrapped here: the
     agent gets exactly what the server said, including its "carry on without me"
     note when the source is unreachable. */
  /* The session's own choice of where challenges come from, enforced here
     rather than trusted to the prompt: a provider the learner left out is never
     searched, read or assigned, and a session that left Spar out never has a
     challenge written for it. */
  const problemSources = local.problemSourcesForSession(sessionId);
  const providers = problemSources.filter((source): source is "leetcode" | "codeforces" => source !== "spar");
  if (SOURCE_READ_TOOLS.includes(name)) {
    if (!practice) return { error: "not-connected", message: "No practice source is available in this context." };
    if (!providers.length) return { error: "not-allowed", message: "This session does not take problems from any provider. Write the challenge yourself." };
    if (name !== "search_practice_problems" && (value.source === "leetcode" || value.source === "codeforces") && !providers.includes(value.source)) {
      return { error: "not-allowed", message: `This session does not take problems from ${practiceSourceName(value.source)}. Use ${providers.map(practiceSourceName).join(" or ")}.` };
    }
    return practice.callTool(name, value, providers);
  }
  if (name === "assign_practice_problem") {
    if (!practice) return { status: "invalid", report: { valid: false, checks: [{ name: "practice source", passed: false, detail: "No practice source is connected, so there is no problem to assign. Write the challenge yourself with create_question." }] } };
    if ((value.source === "leetcode" || value.source === "codeforces") && !providers.includes(value.source)) {
      return { status: "invalid", report: { valid: false, checks: [{ name: "session sources", passed: false, detail: `This session does not take problems from ${practiceSourceName(value.source)}. ${providers.length ? `Assign a ${providers.map(practiceSourceName).join(" or ")} problem instead.` : "Write the challenge yourself."}` }] } };
    }
    return assignPracticeProblem(value, sessionId, local, workspaces, practice);
  }
  if ((name === "create_question" || name === "replace_current_question") && !problemSources.includes("spar")) {
    return { status: "invalid", report: { valid: false, checks: [{ name: "session sources", passed: false, detail: `This session only takes real problems from ${providers.map(practiceSourceName).join(" and ")}, so Spar does not write challenges for it. Search for one and assign it with assign_practice_problem.` }] } };
  }
  /* Optional so the tool tests can call this without standing up a network
     service. Missing reads as unconfigured, which is already a result the agent
     knows how to carry on from. */
  if (name === "web_search") {
    if (!web) return { configured: false, note: "Web search is unavailable in this context." };
    return web.search(String(value.query ?? ""), Number(value.limit ?? 5));
  }
  if (name === "web_fetch") {
    if (!web) return { configured: false, note: "Web fetch is unavailable in this context." };
    const urls = Array.isArray(value.urls) ? value.urls.map((entry) => String(entry)) : [String(value.url ?? "")];
    return web.fetch(urls);
  }
  /* The visualiser's own toolkit, routed as a unit. It keeps state the rest of
     these calls do not — a trace, held between calls so the agent can ask about
     one run rather than re-running it per question — so it is an object with a
     lifetime rather than another branch here. */
  if (visualizer?.handles(name)) return visualizer.execute(name, value, sessionId);
  if (VISUALIZER_TOOLS.includes(name)) return { error: "unavailable", note: "The execution visualiser is not available in this context." };
  /* The record, searched in one call. Each kind is the read that used to be its
     own tool; asking for several at once is the common case, and the coach
     narrows with `kinds` when it knows what it is after. */
  if (name === "search_record") return searchRecord(local, value, trackId);
  if (name === "read_record") return readRecord(local, value, trackId);
  /* The coach's own notebooks: this Track's, or the learner notebook every
     Track reads. The previous version goes back with the result so the thread
     can draw what changed; the worker drops it from what the model reads. */
  if (name === "update_notebook") {
    const key = value.notebook === "learner" ? LEARNER_NOTEBOOK : trackId;
    const edited = applyNotebookEdits(local.readNotebook(key)?.markdown ?? null, value);
    if ("error" in edited) return { status: "invalid", note: edited.error };
    const markdown = edited.markdown;
    const { saved, previous } = local.writeNotebook(key, { markdown, note: String(value.note ?? ""), author: "coach", sessionId });
    const unchanged = previous !== null && previous.version === saved.version;
    return { status: unchanged ? "unchanged" : "saved", version: saved.version, note: saved.note, markdown: saved.markdown, previous: unchanged ? null : previous?.markdown ?? null, previousAuthor: previous?.author ?? null };
  }
  /* What the builder needs to write a challenge that fits the Track: the open
     challenge when one is being revised, and the starters the learner has been
     handed so the next one has the same shape. Worker-only. */
  if (name === "challenge_builder_context") return builderContext(local, sessionId, trackId);
  if (name === "ask_user_question") {
    if (questions) return questions.ask(sessionId, value as AskUserQuestionInput);
    /* `pending` says whether the learner still has to answer. It used to be a
       constant `true`, so a question that came back already answered — the
       repeat ask after an answer reopens the turn — still read as waiting, and
       the agent asked again rather than using the answer sitting beside it. */
    const asked = local.setPendingIntake(sessionId, value as AskUserQuestionInput);
    return { pending: asked.status === "pending", ...asked };
  }
  /**
   * Teaching, written down.
   *
   * The counterpart to `create_question`, and the reason Spar no longer has to
   * answer every turn with a problem. A turn that has found the idea the learner
   * is missing can now put that idea somewhere durable and point at it, rather
   * than saying it into a reply that scrolls away — and a later turn can cite it
   * by id, which is the difference between "I explained this" and a claim the
   * learner can check.
   *
   * The host validates and files; it does not compile. There is nothing to run,
   * so the only failure here is a malformed lesson, and the agent is told what
   * was wrong in the same shape a rejected challenge is told.
   */
  if (name === "teach_lesson") {
    const parsed = lessonInputSchema.safeParse(value);
    if (!parsed.success) {
      return { status: "invalid", report: { valid: false, checks: parsed.error.issues.slice(0, 6).map((issue) => ({ name: issue.path.join(".") || "lesson", passed: false, detail: issue.message })) } };
    }
    /* A page's figure is checked like a statement's: one that does not draw
       is refused with the field at fault, rather than shown as an error box. */
    const brokenFigures = parsed.data.pages.flatMap((page, k) => figureProblems(page.body).map((problem) => `Page ${k + 1}, ${problem}`));
    if (brokenFigures.length) return { status: "invalid", report: { valid: false, checks: [{ name: "figures", passed: false, detail: `${brokenFigures.join(" ")} Fix the figure spec and send the lesson again; load the challenge-figures skill if you have not.` }] } };
    /* A lesson that cites another must cite one that exists. A dangling id is a
       chip the learner clicks and nothing happens, which is worse than the plain
       sentence it replaced — so the reference is dropped and the agent is told. */
    const dropped: string[] = [];
    const references = parsed.data.references.filter((reference) => {
      if (reference.kind !== "lesson") return true;
      if (local.readLesson(reference.lessonId)) return true;
      dropped.push(reference.label);
      return false;
    });
    const id = randomUUID();
    const lesson = { ...parsed.data, references };
    local.saveLesson({ id, sessionId, title: lesson.title, summary: lesson.summary, concepts: lesson.concepts, payload: lesson });
    return {
      status: "taught",
      lessonId: id,
      title: lesson.title,
      pages: lesson.pages.length,
      /* The id goes back so the reply can cite it, and the instruction to cite it
         goes back with it — the agent that just taught something is the one
         holding the reason it matters. */
      note: `Filed. Reference it in your reply as [[lesson:${id}|${lesson.title}]] so the learner can open it.`,
      ...(dropped.length ? { droppedReferences: dropped } : {}),
    };
  }
  /** One lesson, back in full. The turn's context carries titles; this is for the
   *  turn that has to build on what a lesson actually said rather than teach the
   *  same ground again under a new name. */
  if (name === "read_lesson") {
    const found = local.readLesson(String(value.lessonId ?? ""));
    if (!found) return { error: "not-found", note: "No lesson with that id. Check recentLessons in your context." };
    return { id: found.id, taughtAt: found.createdAt, ...(found.payload as Record<string, unknown>) };
  }
  /** What Spar has already taught near a topic. Read before teaching, so the
   *  same idea is cited rather than explained twice. */
  if (name === "search_lessons") {
    const found = local.searchLessons(String(value.query ?? ""), Number(value.limit ?? 6));
    return { lessons: found, note: found.length ? "Cite one of these with [[lesson:<id>|title]] rather than teaching it again." : "Nothing taught near this yet." };
  }
  /* A skill's body, handed over whole. The agent was only told the name and one
     sentence; this is the first time it sees the instructions, so they come back
     as the result rather than as a summary of them. */
  if (name === "load_skill") {
    const wanted = String(value.name ?? "").trim();
    const skill = skills?.read(wanted, { forAgent: true });
    if (!skill) {
      const known = skills?.catalog().map((entry) => entry.name) ?? [];
      return { error: "not-found", note: known.length ? `No enabled skill is called "${wanted}". Available: ${known.join(", ")}.` : "No skills are enabled." };
    }
    return { name: skill.name, description: skill.description, source: skill.source, instructions: skill.body };
  }
  /* Figures are checked before the compiler runs: a statement whose picture
     does not parse would otherwise publish with a broken box where the example
     should be, and the agent — which cannot see it — would never know. */
  if ((name === "create_question" || name === "replace_current_question") && typeof value.statement === "string") {
    const broken = statementFigureProblems(value.statement);
    if (broken.length) return { status: "invalid", report: { valid: false, checks: [{ name: "figures", passed: false, detail: `${broken.join(" ")} Fix the figure spec and publish again; load the challenge-figures skill if you have not.` }] } };
  }
  if (name === "create_question") {
    const activeQuestion = openChallenge(local, sessionId);
    if (activeQuestion) {
      return { status: "invalid", report: { valid: false, checks: [{ name: "session lifecycle", passed: false, detail: `A playable challenge (${activeQuestion.title}) is already active for this session. End this agent turn instead of publishing another challenge.` }] } };
    }
    const compiled = await compileCandidate(input, sessionId, workspaces, runner, "authored", progress);
    if (!compiled.report.valid) return { status: "invalid", report: compiled.report };
    const questionCreatedWhileCompiling = openChallenge(local, sessionId);
    if (questionCreatedWhileCompiling) {
      return { status: "invalid", report: { valid: false, checks: [{ name: "session lifecycle", passed: false, detail: `A playable challenge (${questionCreatedWhileCompiling.title}) was published while this candidate compiled. This candidate was discarded.` }] } };
    }
    /* Replaced, not overlaid: the previous challenge's files are finished work
       (its code is kept in the attempt), and a test file left behind from it is
       still picked up by the runner and fails every run of the new one. */
    await workspaces.replaceAll(sessionId, { ...compiled.design.starterFiles, ...compiled.design.visibleTests });
    commitCandidateTarget(local, sessionId, trackId, value);
    const question = local.createQuestion(sessionId, compiled.design, compiled.report, { concepts: conceptTags(value.concepts), introductionReason: String(value.why ?? "").trim() });
    rememberTrackLanguage(local, trackId, value);
    return { status: "playable", question, report: compiled.report, ...followsLesson(local, conceptTags(value.concepts), trackId) };
  }
  if (name === "replace_current_question") {
    const activeQuestion = openChallenge(local, sessionId);
    if (!activeQuestion) return { status: "invalid", report: { valid: false, checks: [{ name: "session lifecycle", passed: false, detail: "There is no active challenge to replace." }] } };
    const compiled = await compileCandidate(input, sessionId, workspaces, runner, "authored", progress);
    if (!compiled.report.valid) return { status: "invalid", report: compiled.report };
    const stillActive = local.readSession(sessionId)?.question;
    if (!stillActive || stillActive.id !== activeQuestion.id) return { status: "invalid", report: { valid: false, checks: [{ name: "session lifecycle", passed: false, detail: "The active challenge changed while this replacement compiled. The candidate was discarded." }] } };
    await workspaces.replaceAll(sessionId, { ...compiled.design.starterFiles, ...compiled.design.visibleTests });
    commitCandidateTarget(local, sessionId, trackId, value);
    const question = local.replaceQuestion(sessionId, compiled.design, compiled.report, String(value.reason ?? "The learner asked the agent to adapt the challenge."), conceptTags(value.concepts), undefined, String(value.why ?? "").trim());
    rememberTrackLanguage(local, trackId, value);
    return { status: "playable", question, replacedQuestionId: activeQuestion.id, report: compiled.report, ...followsLesson(local, conceptTags(value.concepts), trackId) };
  }
  if (name === "edit_challenge") return editChallenge(local, sessionId, value, workspaces, runner, progress);
  if (name === "review_solution") {
    const attemptId = String(value.attemptId);
    const verdict = value.verdict === "rework" ? "rework" : "accepted";
    const reasons = Array.isArray(value.reasons) ? value.reasons.map((entry) => String(entry)).slice(0, 6) : [];
    local.appendNextEvent({ id: randomUUID(), attemptId, type: "submission_evaluated", occurredAt: new Date().toISOString(), payload: { review: verdict, reasons, approach: String(value.approach ?? ""), observedComplexity: String(value.observedComplexity ?? "") }, source: "system", schemaVersion: 1 });
    if (verdict === "accepted") {
      const settled = settleBlockedAttempt(local, attemptId);
      return settled
        ? { review: "accepted", completed: true, note: "Every case of the last submission passed and only the process exit failed, so the host has completed the attempt as solved. It is rated, and record_insight now works for it." }
        : { review: "accepted", note: "Recorded." };
    }
    /* Reopening is the point of the tool, so it is the host that does it — an
       agent that says "that does not meet the requirement" and leaves the
       challenge closed has only complained. */
    const reopened = local.reopenAttempt(attemptId, reasons.join(" ") || "The solution did not meet the challenge's stated requirements.");
    return { review: "rework", reopened: true, questionId: reopened.questionId, note: "The challenge is open again for the learner. Tell them which requirement it misses and what to change — a nudge, not the solution. Do not update abilities or set a new challenge this turn." };
  }
  if (name === "record_insight") return recordInsight(local, value, sessionId);
  if (name === "read_attempt") return readAttemptForAgent(local, value, sessionId, workspaces);
  if (name === "read_submissions") return readSubmissionsForAgent(local, value, sessionId);
  /* The document plus what is open under it. The markdown is the claim; the
     patterns are the questions still outstanding about it and the evidence is
     what each one rests on. This read sits immediately before the update is
     proposed, so an update written without them could only restate the claim. */
  if (name === "read_ability") {
    const abilityId = String(value.abilityId);
    return { ability: local.readAbility(abilityId), patterns: local.patternsForAbility(abilityId), evidence: local.evidenceForAbility(abilityId).slice(0, 12) };
  }
  if (name === "update_ability") {
    const abilityId = typeof value.abilityId === "string" && value.abilityId ? value.abilityId : "";
    if (abilityId) {
      const before = local.readAbility(abilityId) as { markdown?: string } | null;
      if (!before) return { committed: false, note: `No ability ${abilityId}. Search the record for its id, or omit abilityId and give a title to introduce one.` };
      const updated = local.updateAbility({ abilityId, markdown: String(value.markdown), evidenceEventIds: stringList(value.evidenceEventIds), ...abilityClaim(value) });
      local.queueAbilitySync(updated.id);
      /* The version it replaced, for the thread to draw what changed. The worker
         keeps it out of the coach's context. */
      return { committed: true, ...updated, ...(typeof before.markdown === "string" ? { previousMarkdown: before.markdown } : {}) };
    }
    const title = typeof value.title === "string" ? value.title.trim() : "";
    if (!title) return { committed: false, note: "Give a title to introduce an ability, or an abilityId to update one." };
    const updated = local.upsertAbility({ title, markdown: String(value.markdown), evidenceEventIds: stringList(value.evidenceEventIds), ...abilityClaim(value) }, trackId);
    local.queueAbilitySync(updated.id);
    return { committed: true, ...updated };
  }
  throw new Error(`Unsupported Spar tool: ${name}`);
}

/**
 * Setting a real problem as this session's challenge.
 *
 * The sourced counterpart to `create_question`, and it is held to the same
 * lifecycle rules — one open challenge at a time, no repeating a title the
 * learner has already been asked — because those rules are about the learner's
 * experience rather than about where a problem came from.
 *
 * What it does *not* do is run the deterministic compiler. There is nothing to
 * compile: the problem was not generated, there is no reference solution to check
 * the tests against, and the visible suite is whatever the source published. The
 * guarantee that replaces it is stated rather than assumed — the mount records
 * which judge will decide, and this refuses outright when the answer is "nothing
 * can", because a challenge nobody can grade is not a challenge.
 */
async function assignPracticeProblem(
  value: Record<string, unknown>,
  sessionId: string,
  local: LocalStore,
  workspaces: WorkspaceService,
  practice: PracticeService,
) {
  const refuse = (checkName: string, detail: string) => ({ status: "invalid" as const, report: { valid: false, checks: [{ name: checkName, passed: false, detail }] } });
  const slug = String(value.slug ?? "").trim();
  if (!slug) return refuse("problem identity", "No problem slug was given.");
  const provider = value.source === "leetcode" || value.source === "codeforces" ? value.source : null;
  if (!provider) return refuse("problem identity", "No provider identity was given. Preserve `source` from the search result alongside its slug.");

  /* Replacing the open challenge with a real problem is the whole reason this
     takes a reason. "Just give me a LeetCode problem" arrives while a challenge is
     open — it is the commonest thing a learner says — and refusing it here left
     the agent one legal move: write its own challenge, name it after the LeetCode
     problem it could not assign, and grade it locally. The learner asked for the
     real one, so the real one has to be assignable over the top of what they have.
     Silence still refuses: without a reason this is the old guard, because setting
     a second problem nobody asked for would discard an attempt in progress. */
  const activeQuestion = openChallenge(local, sessionId);
  const replaceReason = String(value.replaceReason ?? "").trim();
  if (activeQuestion && !replaceReason) {
    return refuse("session lifecycle", `A playable challenge (${activeQuestion.title}) is already active for this session. If the learner asked for a different problem, assign this one again with \`replaceReason\` and it will supersede theirs; otherwise end this agent turn instead of assigning another problem.`);
  }

  let mounted: Awaited<ReturnType<PracticeService["mount"]>>;
  try {
    const language = languageSchema.catch(local.getProfile()?.language ?? "javascript").parse(value.language);
    mounted = await practice.mount({ source: provider, slug, language });
  } catch (error) {
    /* A slug the source does not have, a subscription-only problem, an expired
       session. All of them are the same instruction to the agent: this one is not
       available, choose another or write your own. */
    return refuse("problem availability", `${practiceSourceName(provider)} could not provide "${slug}": ${error instanceof Error ? error.message : String(error)}. Pick a different problem or write the challenge yourself.`);
  }

  const { design, source } = mounted;
  /* Nothing can grade it: no judge at the source, and no case Spar could recover
     from the statement. Assigning it would mean asking someone to solve something
     with no way to find out whether they had. */
  if (!source.remoteJudge && source.localCaseCount === 0) {
    return refuse("grading", `${practiceSourceName(provider)} is not judging submissions right now and Spar could not build a runnable case for "${design.title}"${mounted.harnessNote ? ` (${mounted.harnessNote})` : ""}. Nothing could grade this, so it must not be set. Choose a problem with published examples, or write the challenge yourself.`);
  }

  /* Keep the rating and concept comparison as evidence, without letting its
     heuristic override the agent's choice of a transfer or repeat problem. */
  const target = local.latestTarget(sessionId);
  if (!target) return refuse("training target", "A persisted training target is required before assigning a provider problem.");
  const ability = local.readAbilityDetail(String(target.ability_id));
  const adaptiveChecks = assessPracticeAssignment({
    target: {
      abilityTitle: String(target.ability_title),
      specificGap: String(target.specific_gap),
      desiredEvidence: String(target.desired_evidence),
      abilityStatus: ability?.ability.status ?? "uncertain",
      abilityConcepts: ability?.ability.concepts.map((concept) => concept.slug) ?? [],
      experience: local.getProfile()?.experience ?? "new",
      rating: local.currentRating(),
    },
    candidate: { difficulty: mounted.problem.difficulty, concepts: mounted.problem.concepts.map((concept) => concept.slug), source: mounted.problem.source, sourceRating: mounted.problem.sourceRating },
    proposedConcepts: conceptTags(value.concepts),
    why: String(value.why ?? ""),
  });

  /* Mounting went to the source, which takes as long as a network call takes. The
     challenge underneath can have changed in that time — the learner may have
     finished it — and superseding whatever is there now rather than what was there
     when this started would discard work nobody asked to discard. */
  const stillActive = openChallenge(local, sessionId);
  if (activeQuestion && (!stillActive || stillActive.id !== activeQuestion.id)) {
    return refuse("session lifecycle", "The active challenge changed while this problem was being read from the source, so it was not assigned. Look at the session again before assigning anything.");
  }
  if (!activeQuestion && stillActive) {
    return refuse("session lifecycle", `A playable challenge (${stillActive.title}) was published while this problem was being read from the source. This assignment was discarded.`);
  }

  const report = { valid: true, sourced: true, checks: [{ name: "practice source", passed: true, detail: source.judge }] };
  const concepts = conceptTags(value.concepts);
  await workspaces.replaceAll(sessionId, mounted.files);
  const question = activeQuestion
    /* Recorded as a replacement, not as a fresh start: the abandoned attempt keeps
       its events and the new challenge keeps a pointer to what it superseded, so a
       later turn can see that they were moved off something rather than that they
       walked away from it. */
    ? local.replaceQuestion(sessionId, design, report, replaceReason, concepts, source, String(value.why ?? "").trim())
    : local.createQuestion(sessionId, design, report, { concepts, source, introductionReason: String(value.why ?? "").trim() });
  return {
    status: "playable",
    question,
    source: { slug: source.slug, title: design.title, displayId: source.displayId, url: source.url, difficulty: source.difficulty },
    judge: source.judge,
    localCases: source.localCaseCount,
    /* Settled, and said so: the notes below are advisory comparisons, and read
       as a to-do list they sent a turn back into searching for a replacement
       for the problem it had just set — then telling the learner it was a poor
       step while it sat in front of them. */
    assigned: "This problem is now the learner's challenge. The selection notes are for explaining the fit honestly — say what in it is new or a stretch — not a reason to search again, replace it, or call it a poor next step. Do not search for or read other problems this turn.",
    selectionNotes: adaptiveChecks,
    ...followsLesson(local, concepts, local.trackIdForSession(sessionId)),
    ...(activeQuestion ? { replacedQuestionId: activeQuestion.id } : {}),
    ...(mounted.harnessNote ? { note: mounted.harnessNote } : {}),
  };
}

/**
 * The challenge the learner is still on, or null.
 *
 * `readSession` returns the newest question whatever became of it, so a solved
 * one is still there — and every lifecycle guard here read that as "a challenge
 * is already active". The turn that runs right after a learner solves something
 * is exactly the turn that must publish the next challenge, so it was refused
 * fifteen times in a row and then refused its fallback for the same reason. The
 * attempt's completion is the honest signal: while it is open the learner can
 * still submit, and once it closes the session is waiting for what is next.
 */
function openChallenge(local: LocalStore, sessionId: string) {
  const question = local.readSession(sessionId)?.question;
  return question && !question.attemptCompletedAt ? question : null;
}

const RECORD_KINDS = ["abilities", "patterns", "attempts", "challenges", "concepts", "lessons"] as const;

function searchRecord(local: LocalStore, value: Record<string, unknown>, trackId: string | null) {
  const query = String(value.query ?? "");
  const limit = Math.max(1, Math.min(12, Number(value.limit ?? 6) || 6));
  const asked = stringList(value.kinds).filter((kind): kind is (typeof RECORD_KINDS)[number] => (RECORD_KINDS as readonly string[]).includes(kind));
  const kinds = new Set(asked.length ? asked : RECORD_KINDS);
  const result: Record<string, unknown> = {};
  if (kinds.has("abilities")) result.abilities = local.searchLearner(query, limit, trackId).map((row) => ({ id: row.id, title: row.title, status: row.status, version: row.version, updatedAt: row.updated_at, markdown: row.markdown.slice(0, 900) }));
  if (kinds.has("patterns")) {
    const memory = local.searchLearnerMemory(query, limit, trackId);
    result.patterns = memory.patterns;
    result.observations = memory.evidence;
  }
  if (kinds.has("attempts")) result.attempts = local.searchAttempts(query, limit, trackId);
  if (kinds.has("challenges")) result.challenges = local.searchChallenges(query, limit, trackId).map((row) => ({ id: row.id, title: row.title, difficulty: row.difficulty, language: row.language, outcome: row.lastOutcome, assistance: row.assistance, source: row.source?.source ?? "spar", concepts: row.concepts.map((tag) => tag.slug), replaces: row.replacesQuestionTitle, replacedBy: row.replacedByQuestionTitle, createdAt: row.createdAt }));
  if (kinds.has("concepts")) result.concepts = local.conceptGraph(query, Math.min(14, limit * 2), trackId);
  if (kinds.has("lessons")) result.lessons = local.searchLessons(query, limit);
  const found = Object.values(result).some((entry) => Array.isArray(entry) && entry.length > 0);
  return { ...result, note: found ? "Patterns and observations are your own earlier readings of this learner; one new matching observation promotes a hypothesis to a pattern. For a concept, read_record kind concept splits the evidence by sub-concept." : "Nothing in the record matches. An untested concept is not a weak one." };
}

function readRecord(local: LocalStore, value: Record<string, unknown>, trackId: string | null) {
  const id = String(value.id ?? "").trim();
  if (value.kind === "challenge") {
    const challenge = local.readChallenge(id);
    if (!challenge) return { error: "not-found", note: "No challenge with that id. The journey document and search_record list challenge ids." };
    const design = challenge.design as Record<string, unknown>;
    return {
      id: challenge.id, title: challenge.title, statement: challenge.statement, language: challenge.language, kind: challenge.kind, difficulty: challenge.difficulty, status: challenge.status,
      concepts: challenge.concepts, introductionReason: challenge.introduction_reason,
      design: { starterFiles: design.starterFiles, visibleTests: design.visibleTests, referenceFiles: design.referenceFiles, solutionRequirements: design.solutionRequirements },
      attempts: (challenge.attempts as unknown as Array<Record<string, unknown> & { events: unknown[] }>).map((attempt) => ({ id: attempt.id, status: attempt.status, startedAt: attempt.started_at, completedAt: attempt.completed_at, events: attempt.events.length })),
      note: "Use read_attempt with an attemptId for how any of these attempts went.",
    };
  }
  if (value.kind === "ability") {
    const ability = local.readAbility(id);
    if (!ability) return { error: "not-found", note: "No ability with that id. search_record with kinds [\"abilities\"] finds ability ids." };
    return { ability, patterns: local.patternsForAbility(id), evidence: local.evidenceForAbility(id).slice(0, 12) };
  }
  if (value.kind === "lesson") {
    const found = local.readLesson(id);
    if (!found) return { error: "not-found", note: "No lesson with that id." };
    return { id: found.id, taughtAt: found.createdAt, ...(found.payload as Record<string, unknown>) };
  }
  if (value.kind === "concept") {
    const report = local.conceptEvidenceReport(id, 3, trackId);
    return { concepts: report, note: report.length ? "Read subConcepts before the totals: an area's average hides the one that is failing." : "No tagged challenges under this concept yet." };
  }
  return { error: "unknown-kind", note: "kind is one of challenge, ability, lesson, concept." };
}

function builderContext(local: LocalStore, sessionId: string, trackId: string | null) {
  const open = openChallenge(local, sessionId);
  const track = trackId ? local.listTracks().find((entry) => entry.id === trackId) ?? null : null;
  let openDesign: Record<string, unknown> | null = null;
  if (open) {
    const record = local.readChallenge(open.id);
    const design = (record?.design ?? {}) as Record<string, unknown>;
    openDesign = { title: open.title, statement: open.statement, language: open.language, kind: open.kind, difficulty: open.difficulty, starterFiles: design.starterFiles, referenceFiles: design.referenceFiles, visibleTests: design.visibleTests, solutionRequirements: design.solutionRequirements };
  }
  const recent = local.journey(trackId, 4).challenges.filter((entry) => entry.source === "spar" && entry.starter).slice(-3).map((entry) => ({ title: entry.title, language: entry.language, difficulty: entry.difficulty, starter: entry.starter }));
  return { preferredLanguage: track?.language ?? local.getProfile()?.language ?? "javascript", open: openDesign, recentStarters: recent };
}

/**
 * One attempt, read whole.
 *
 * Four tools used to arrive here. Two of them were this same function with a
 * different name on the wire, one was it with the files left off, and the fourth
 * folded the log — so a turn that wanted to know how someone was doing paid for
 * the same read up to four times over, and the learner watched a row for each.
 * What comes back now is what all four returned together: their code, the log,
 * the derived views, and the deterministic verdict that the model is never
 * allowed to form an opinion of its own about.
 *
 * The order of the keys is load-bearing. The transcript stores a 16k slice of
 * this payload and draws the card and the attempt panel out of it, so the things
 * it needs — the numbers, the head of their file, then the log itself — are
 * serialised ahead of the two that exist for the model alone and can each fill
 * the cap by themselves. The agent always receives the whole thing; this
 * ordering decides only what survives into the UI.
 */
async function readAttemptForAgent(local: LocalStore, value: Record<string, unknown>, sessionId: string, workspaces: WorkspaceService) {
  /* Omitting the id means the attempt in front of the learner, which is what it
     nearly always was. The model used to have to carry a uuid from the context
     into every call, and a call it got wrong came back empty. */
  const attemptId = String(value.attemptId ?? "") || activeAttemptId(local, sessionId);
  const events = value.segments === "all" ? local.readAttemptHistory(attemptId) : local.readAttempt(attemptId);
  /* The workspace is the live one, so it answers for the open attempt and not
     for an older one being read out of history. Never fails the read.

     Narrowed to the files this attempt actually touched, because a session's
     workspace outlives its challenges: the third problem of a session is solved
     next to the first two, and listing the directory handed the agent whichever
     of them the filesystem named first. The learner then watched their tutor
     open their solve and read a function from two challenges ago. */
  const files = await attemptFiles(sessionId, workspaces, edited(events)).catch(() => []);
  if (!events.length) {
    return { stats: null, filters: null, solve: null, files, events: [], report: `No events are recorded for attempt ${attemptId || "(none given)"}, so there is no log to read. Do not infer anything about the learner from this.` };
  }
  const subject = local.attemptSubject(attemptId);
  const filters = {
    sections: sectionList(value.sections),
    events: stringList(value.eventTypes),
    cases: caseFilter(value.cases),
    scope: value.scope === "since-last-submission" ? "since-last-submission" as const : "all" as const,
    caseDetail: value.caseDetail === "brief" ? "brief" as const : "full" as const,
    maxLines: typeof value.maxLines === "number" && Number.isFinite(value.maxLines) ? Math.max(20, Math.min(2_000, Math.round(value.maxLines))) : Number.MAX_SAFE_INTEGER,
  };
  const replay = foldAttempt(events, {
    ...(subject?.title ? { title: subject.title } : {}),
    ...(subject?.language ? { language: subject.language } : {}),
  });
  // Payloads are already represented in the report. Link its sequence numbers
  // to durable evidence IDs without repeating the payload or its description.
  const evidence = events.map(({ id, sequence }) => ({ id, sequence }));
  return { stats: replay.stats, filters, solve: solveHead(files), report: formatSolveLog(replay, filters), files, events: evidence };

}

/**
 * A solved challenge's insight, filed as a review card.
 *
 * Refused for anything but a pass: a card is a claim that there is an idea here
 * the learner got to, and an abandoned or failing attempt has not got there yet.
 * An assisted breakthrough is capped at Hard for its first grade, whatever the
 * agent proposed — the idea arrived from outside, so the first review comes
 * early enough to find out whether it stayed.
 */
function recordInsight(local: LocalStore, value: Record<string, unknown>, sessionId: string) {
  const attemptId = String(value.attemptId ?? "") || activeAttemptId(local, sessionId);
  const subject = attemptId ? local.attemptSubject(attemptId) : null;
  if (!subject) return { status: "invalid", note: "No attempt to file an insight against. Name the solved attempt." };
  const outcome = [...local.readAttempt(attemptId)].reverse().find((event) => event.type === "attempt_completed")?.payload.outcome;
  if (outcome !== "passed") return { status: "invalid", note: "That attempt has not passed, so there is no solved idea to file yet. File the insight on the turn after they solve it." };
  const remember = typeof value.remember === "string" ? value.remember.trim() : "";
  if (!remember && reviewTargetMode(local) === "ask" && !local.reviews.cardForQuestion(subject.question_id)) {
    return { status: "invalid", note: "This learner decides what their reviews ask about. Ask them with ask_user_question what they want to remember from this problem — options named from this solve (the step that cracked it, the general pattern, the problem itself), multiple allowed, custom on — then file the card about what they chose, with targets from their answer and their words as remember." };
  }
  const named = stringList(value.concepts);
  const slugs = named.length
    ? named.flatMap((slug) => { try { return [local.ensureConcept({ slug }).slug]; } catch { return []; } })
    : [...local.questionConcepts(subject.question_id)].sort((left, right) => (left.role === "primary" ? 0 : 1) - (right.role === "primary" ? 0 : 1)).map((tag) => tag.slug);
  const click = value.click && typeof value.click === "object" ? value.click as Record<string, unknown> : {};
  const independence = value.independence === "independent" || value.independence === "assisted" ? value.independence : "unknown";
  const proposed = ({ again: 1, hard: 2, good: 3, easy: 4 } as const)[String(value.firstGrade) as "again" | "hard" | "good" | "easy"] ?? 3;
  const firstRating = independence === "assisted" ? Math.min(proposed, 2) as 1 | 2 : proposed;
  const pitfalls = Array.isArray(value.pitfalls) ? value.pitfalls.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return typeof row.mistake === "string" && typeof row.fix === "string" ? [{ mistake: row.mistake.trim(), fix: row.fix.trim() }] : [];
  }).slice(0, 4) : [];
  const { card, created } = local.reviews.recordInsight({
    questionId: subject.question_id,
    attemptId,
    title: String(value.title ?? subject.title),
    trigger: String(value.trigger ?? ""),
    insight: String(value.insight ?? ""),
    invariant: typeof value.invariant === "string" && value.invariant.trim() ? value.invariant : null,
    click: { summary: String(click.summary ?? ""), runOrdinal: typeof click.runOrdinal === "number" ? click.runOrdinal : null, diff: typeof click.diff === "string" && click.diff.trim() ? click.diff : null },
    independence,
    pitfalls,
    rubric: stringList(value.rubric).slice(0, 5),
    transfer: stringList(value.transfer).slice(0, 4),
    conceptSlugs: slugs,
    targets: stringList(value.targets).filter((target): target is ReviewTarget => (REVIEW_TARGETS as readonly string[]).includes(target)),
    remember: remember || null,
    firstRating,
  });
  const related = local.reviews.related(slugs, subject.question_id, 4).map((entry) => ({ cardId: entry.id, title: entry.title, challenge: entry.questionTitle, insight: entry.insight, dueAt: entry.dueAt }));
  const days = Math.max(1, Math.round((Date.parse(card.dueAt) - Date.now()) / 86_400_000));
  return {
    status: "filed",
    cardId: card.id,
    created,
    firstReviewInDays: created ? days : null,
    dueAt: card.dueAt,
    targets: card.targets,
    ...(firstRating !== proposed ? { gradeCapped: "The breakthrough was assisted, so the first grade was capped at hard and the first review comes sooner." } : {}),
    related,
    note: created
      ? `Filed. The first review is due in about ${days} day${days === 1 ? "" : "s"}. If you mention it, say so plainly — "I've filed the idea that cracked this for review in ${days} day${days === 1 ? "" : "s"}" — and do not restate the card.${related.length ? " Related cards on the same pattern are listed: if this insight contradicts or deepens one of them, say how in a sentence." : ""}`
      : "Refined the card this challenge already had. Its review schedule is unchanged.",
  };
}

/** The attempt the learner has open right now, for a call that named none. */
/**
 * What the learner sent, as a list or as one submission in full.
 *
 * Two reads behind one tool because they are one question asked at two depths.
 * The listing is cheap and is what a turn opens with; the detail is a whole
 * solution and is only worth spending once the turn knows which submission it
 * is about.
 *
 * The reply is told, every time, how to cite what it just read. A tutor that
 * says "your second submission" in prose has made a claim the learner cannot
 * check; the same sentence with the reference in it is a door.
 */
function readSubmissionsForAgent(local: LocalStore, value: Record<string, unknown>, sessionId: string) {
  const named = String(value.submissionId ?? "");
  if (named) {
    const submission = local.readSubmission(named);
    if (!submission) return { submission: null, note: `No submission ${named} is recorded. List the challenge's submissions first and take an id from there.` };
    return {
      submission,
      cite: `[[submission:${submission.id}|your ${ordinalWord(submission.ordinal)} submission]]`,
      note: "`code` is exactly what was sent, and `cases` is what it was graded on — a failing case carries the input it ran and the values it produced. Refer to this submission by the `cite` string, not by its id.",
    };
  }

  const challengeId = String(value.challengeId ?? "") || local.readSession(sessionId)?.question?.id || "";
  if (!challengeId) return { submissions: [], note: "No challenge is open and none was named, so there are no submissions to read." };
  const wanted = value.outcome === "passed" || value.outcome === "failed" ? value.outcome : "all";
  const limit = typeof value.limit === "number" && Number.isFinite(value.limit) ? Math.max(1, Math.min(40, Math.round(value.limit))) : 20;
  const all = local.submissionsForQuestion(challengeId).filter((row) => wanted === "all" || row.outcome === wanted);
  /* Capped from the end. A learner who submitted thirty times has a story in the
     last five, not the first five — and the ordinals stay absolute, so a capped
     list still says which submission of the whole set each row is. */
  const submissions = all.slice(Math.max(0, all.length - limit));
  return {
    challengeId,
    submissions,
    omitted: all.length - submissions.length,
    note: submissions.length
      ? "Oldest first. Name one with `submissionId` to read its code and case grid. Cite any you mention as [[submission:<id>|a few words]] so the learner can open it."
      : "Nothing has been submitted at this challenge yet. Do not infer anything from that beyond it.",
  };
}

const ORDINAL_WORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
function ordinalWord(value: number): string {
  return ORDINAL_WORD[value] ?? `${value}th`;
}

function activeAttemptId(local: LocalStore, sessionId: string): string {
  return local.readSession(sessionId)?.question?.attemptId ?? "";
}

/**
 * The top of the file they actually wrote, beside the log of how they wrote it.
 *
 * A head and not the file, because the whole file is already in `files`: this is
 * the copy the transcript draws behind the card, at the opacity of a watermark,
 * and it is serialised early precisely so a long log cannot take it. "Read your
 * attempt" is a claim about their code, and a row that makes that claim over a
 * blank panel is the agent talking about something the learner cannot see.
 */
function solveHead(files: Array<{ path: string; text: string }>): { path: string; text: string } | null {
  const [file] = files;
  if (!file) return null;
  const head = file.text.split("\n").slice(0, SOLVE_HEAD_LINES).join("\n");
  return { path: file.path, text: head.length > SOLVE_HEAD ? `${head.slice(0, SOLVE_HEAD)}…` : head };
}

function sectionList(value: unknown): ReplaySection[] {
  const allowed: ReplaySection[] = ["log", "cases", "runs", "code", "timings", "turning-points"];
  if (!Array.isArray(value)) return DEFAULT_SECTIONS;
  const chosen = value.filter((entry): entry is ReplaySection => allowed.includes(entry as ReplaySection));
  return chosen.length ? chosen : DEFAULT_SECTIONS;
}

function caseFilter(value: unknown): CaseFilter {
  return value === "failed-ever" || value === "still-failing" || value === "fixed" ? value : "all";
}

/** Concept tags off a tool call. Shape is already checked by the tool schema, so
 *  this only narrows it — the store owns slug normalization and creation. */
function conceptTags(value: unknown): ConceptTagInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return entry.trim() ? [{ slug: entry }] : [];
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const slug = typeof record.slug === "string" ? record.slug : typeof record.title === "string" ? record.title : "";
    if (!slug.trim()) return [];
    return [{
      slug,
      ...(typeof record.title === "string" ? { title: record.title } : {}),
      ...(typeof record.kind === "string" ? { kind: record.kind } : {}),
      ...(typeof record.parentSlug === "string" ? { parentSlug: record.parentSlug } : {}),
      ...(typeof record.description === "string" ? { description: record.description } : {}),
      ...(typeof record.role === "string" ? { role: record.role } : {}),
    }];
  });
}

/**
 * An open attempt the runner failed on its exit code alone, completed on the
 * coach's acceptance. The evidence decides, not the coach: only when the last
 * submission passed every case it ran, and failed none. It happened when a
 * stale test file from an earlier challenge crashed every run; any other
 * failure after the cases would be the same shape and the same injustice.
 */
function settleBlockedAttempt(local: LocalStore, attemptId: string): boolean {
  const bundle = local.submissionBundle(attemptId);
  if (!bundle) return false;
  const events = local.readAttempt(attemptId);
  if (events.some((event) => event.type === "attempt_completed")) return false;
  const lastRun = [...events].reverse().find((event) => event.type === "test_run" && event.payload.scope === "visible-and-hidden");
  const payload = (lastRun?.payload ?? {}) as { exitCode?: unknown; passedCases?: unknown; failedCases?: unknown };
  const passed = typeof payload.passedCases === "number" ? payload.passedCases : 0;
  if (!lastRun || payload.exitCode === 0 || passed === 0 || payload.failedCases !== 0) return false;
  local.appendNextEvent({ id: randomUUID(), attemptId, type: "attempt_completed", occurredAt: new Date().toISOString(), payload: { outcome: "passed", settledBy: "review", note: `All ${passed} cases passed; the run failed only on its exit code.` }, source: "system", schemaVersion: 1 });
  local.completeAttempt(attemptId, "passed");
  return true;
}

/** The notebook an update_notebook call asks for: the whole document it sent, or
 *  the current one with its edits applied. An edit whose text is missing or
 *  ambiguous is refused with the reason, never guessed at. */
export function applyNotebookEdits(current: string | null, value: Record<string, unknown>): { markdown: string } | { error: string } {
  const edits = Array.isArray(value.edits) ? value.edits as Array<{ find?: unknown; replace?: unknown }> : [];
  if (typeof value.markdown === "string" && edits.length) return { error: "Send edits or markdown, not both." };
  if (typeof value.markdown === "string") return value.markdown.trim() ? { markdown: value.markdown } : { error: "The notebook cannot be empty." };
  if (!edits.length) return { error: "Send edits, or the whole markdown." };
  if (current === null) return { error: "There is no notebook yet. Start it with the whole markdown." };
  let text = current;
  for (const [index, edit] of edits.entries()) {
    const find = typeof edit.find === "string" ? edit.find : "";
    const replace = typeof edit.replace === "string" ? edit.replace : "";
    const at = find ? text.indexOf(find) : -1;
    if (at < 0) return { error: `Edit ${index + 1}: its find text is not in the notebook${index ? " (after the edits before it)" : ""}. Copy it exactly from the notebook in your context.` };
    if (text.indexOf(find, at + 1) >= 0) return { error: `Edit ${index + 1}: its find text occurs more than once. Include more of the surrounding text so it matches one place.` };
    text = text.slice(0, at) + replace + text.slice(at + find.length);
  }
  return text.trim() ? { markdown: text } : { error: "Those edits would leave the notebook empty." };
}

/** The optional parts of an ability write, shared by both branches of
 *  update_ability (an existing ability, or a new one) so they cannot drift into
 *  supporting different halves of what an ability is. */
function abilityClaim(value: Record<string, unknown>): { summary?: string; practice?: string[]; concepts?: ConceptTagInput[]; status?: AbilityStatus; evidence?: Array<{eventId:string;statement:string;polarity:"supporting"|"contradictory"|"neutral";independence:"independent"|"assisted"|"unknown";strength:number}>; pattern?:{title:string;description:string;status:"observation"|"hypothesis"|"pattern"|"monitoring"|"resolved";evidenceEventIds:string[]} } {
  const status = abilityStatusSchema.safeParse(value.status);
  return {
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(Array.isArray(value.practice) ? { practice: stringList(value.practice) } : {}),
    ...(Array.isArray(value.concepts) ? { concepts: conceptTags(value.concepts) } : {}),
    ...(status.success ? { status: status.data } : {}),
    ...(Array.isArray(value.evidence) ? { evidence: value.evidence.flatMap((item)=>{if(!item||typeof item!=="object")return[];const row=item as Record<string,unknown>;if(typeof row.eventId!=="string"||typeof row.statement!=="string")return[];return[{eventId:row.eventId,statement:row.statement,polarity:row.polarity==="supporting"||row.polarity==="contradictory"?row.polarity:"neutral",independence:row.independence==="independent"||row.independence==="assisted"?row.independence:"unknown",strength:typeof row.strength==="number"?row.strength:0.5}];}) } : {}),
    ...(value.pattern&&typeof value.pattern==="object"?{pattern:value.pattern as {title:string;description:string;status:"observation"|"hypothesis"|"pattern"|"monitoring"|"resolved";evidenceEventIds:string[]}}:{}),
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

/**
 * The stated requirements, written into the problem page.
 *
 * A constraint the learner is judged against has to be on the page they read,
 * not only in the field the agent filled in — otherwise the first they hear of
 * "this had to be one pass" is the review that sends it back, which is a trick
 * rather than a challenge. Done here, in the host, so it is true of every
 * challenge rather than of the ones where the agent remembered to repeat itself
 * in the statement.
 */
function withRequirements(value: Record<string, unknown>): Record<string, unknown> {
  const requirements = Array.isArray(value.solutionRequirements) ? value.solutionRequirements.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 4) : [];
  if (!requirements.length || typeof value.statement !== "string") return value;
  if (/^##\s*How this must be solved/m.test(value.statement)) return value;
  const section = ["", "## How this must be solved", "", ...requirements.map((entry) => `- ${entry}`), "", "Passing the tests is not enough on its own: a solution that ignores these is handed back with an explanation."].join("\n");
  return { ...value, solutionRequirements: requirements, statement: `${value.statement.trimEnd()}\n${section}\n` };
}

async function compileCandidate(input:unknown,sessionId:string,workspaces:WorkspaceService,runner:UtilityClient,origin:DesignOrigin="authored",progress?:(value:unknown)=>void){
  const candidate = input as Record<string, unknown>;
  const value=withRequirements(typeof candidate.statement === "string" ? { ...candidate, statement: normalizeStatementText(candidate.statement) } : candidate);
  return compileQuestion(value,async(files,_command,limits)=>{
    const validationId=randomUUID();
    const root=await workspaces.writeValidation(sessionId,validationId,files);
    try{return await runner.request("run",{root,language:String(value.language),command:"test",timeoutMs:limits.timeoutMs}).promise as {exitCode:number;stdout:string;stderr:string;durationMs:number};}
    finally{await workspaces.removeValidation(sessionId,validationId);}
  },origin,progress);
}

type EditPart = "statement" | "title" | "starter" | "reference" | "visibleTests";
type ChallengeEdit = { part: EditPart; path?: string; find: string; replace: string };
const FILE_PARTS = { starter: "starterFiles", reference: "referenceFiles", visibleTests: "visibleTests" } as const;

/** One exact passage replaced, or why not. The failure carries the current
 *  text when it is short enough to be useful, so the next call can copy it. */
function replaceOnce(text: string, find: string, replace: string, where: string): { text: string } | { error: string } {
  const count = find ? text.split(find).length - 1 : 0;
  if (count === 1) return { text: text.replace(find, () => replace) };
  if (count > 1) return { error: `${where}: the text to find occurs ${count} times. Include more of the surrounding text so it names one place.` };
  const shown = text.length <= 6_000 ? ` Its current text:\n${text}` : " Read the challenge with read_record for its current text.";
  return { error: `${where}: the text to find is not there. Copy it exactly from the current version.${shown}` };
}

/**
 * The open challenge, changed in place.
 *
 * Most changes to a challenge the learner is working are small: a sentence
 * that confused them, a figure, one more example, a test case they found,
 * a type in the starter. Sending those through the builder rewrote the whole
 * challenge, re-validated it from nothing and replaced the learner's files. Here
 * the coach names exact passages, the host applies them, and only what the
 * change can break is checked: a statement edit has its figures checked, and any
 * edit to code or tests reruns the full validation before anything lands. The
 * question and attempt stay the same, and the learner's own code is never
 * overwritten — a starter edit reaches their file only when the passage is
 * still there to change.
 */
async function editChallenge(local: LocalStore, sessionId: string, value: Record<string, unknown>, workspaces: WorkspaceService, runner: UtilityClient, progress?: (value: unknown) => void) {
  const refuse = (name: string, detail: string) => ({ status: "invalid", report: { valid: false, checks: [{ name, passed: false, detail }] } });
  const active = openChallenge(local, sessionId);
  if (!active) return refuse("session lifecycle", "No challenge is open to edit. Use set_challenge to set one.");
  if (active.source) return refuse("source", "This is a provider's problem: its statement and judge are theirs, so it cannot be edited. Explain the point in the conversation, or replace it.");
  const stored = local.questionDesign(active.id);
  if (!stored) return refuse("session lifecycle", "The open challenge could not be read.");
  const edits = (Array.isArray(value.edits) ? value.edits : []) as ChallengeEdit[];
  const before = stored.design;
  const design = structuredClone(before);
  const touched = new Map<string, { part: EditPart; path?: string }>();
  for (const [k, edit] of edits.entries()) {
    const where = `edits.${k} (${edit.part}${edit.path ? ` ${edit.path}` : ""})`;
    if (edit.part === "statement" || edit.part === "title") {
      const next = replaceOnce(design[edit.part], edit.find, edit.replace, where);
      if ("error" in next) return refuse("edit", next.error);
      design[edit.part] = next.text;
      touched.set(edit.part, { part: edit.part });
      continue;
    }
    const files = design[FILE_PARTS[edit.part]];
    const paths = Object.keys(files);
    const path = edit.path ?? (paths.length === 1 ? paths[0] : undefined);
    if (!path || !(path in files)) return refuse("edit", `${where}: name one of its files in path: ${paths.join(", ") || "(none)"}. Adding or removing files needs set_challenge.`);
    const next = replaceOnce(files[path]!, edit.find, edit.replace, where);
    if ("error" in next) return refuse("edit", next.error);
    files[path] = next.text;
    touched.set(`${edit.part}:${path}`, { part: edit.part, path });
  }
  design.statement = normalizeStatementText(design.statement);
  if (design.title.trim().length < 3) return refuse("title", "The title would be empty.");
  if (design.statement.trim().length < 30) return refuse("statement", "The statement would be too short to read as a challenge.");
  const broken = figureProblems(design.statement);
  if (broken.length) return refuse("figures", `${broken.join(" ")} Fix the figure spec and edit again; load the challenge-figures skill if you have not.`);

  /* Words only: nothing the tests or reference depend on changed, so the
     existing validation still stands. */
  const codeChanged = [...touched.values()].some((entry) => entry.part !== "statement" && entry.part !== "title");
  let saved = design;
  let report = stored.report;
  if (codeChanged) {
    const compiled = await compileCandidate(design, sessionId, workspaces, runner, "authored", progress);
    if (!compiled.report.valid) return { status: "invalid", report: compiled.report, note: "Nothing was changed: the edited challenge did not validate. Fix the edit, or use set_challenge if the change is bigger than a few passages." };
    saved = compiled.design;
    report = compiled.report;
  }
  const still = openChallenge(local, sessionId);
  if (!still || still.id !== active.id) return refuse("session lifecycle", "The open challenge changed while this edit was checked. Nothing was changed.");

  /* The learner's files. Visible tests are the challenge's own and follow it.
     A starter file they have not touched follows too; one they have is edited
     only where the same passage is still there, and otherwise left alone. */
  const learnerFiles: Array<{ path: string; outcome: "updated" | "merged" | "kept" }> = [];
  for (const { part, path } of touched.values()) {
    if (!path || (part !== "starter" && part !== "visibleTests")) continue;
    const next = saved[FILE_PARTS[part]][path] ?? design[FILE_PARTS[part]][path]!;
    const old = before[FILE_PARTS[part]][path]!;
    const current = await workspaces.read(sessionId, path).catch(() => null);
    if (part === "visibleTests" || current === null || current === old) {
      await workspaces.write(sessionId, path, next);
      if (part === "starter") learnerFiles.push({ path, outcome: "updated" });
      continue;
    }
    let merged: string | null = current;
    for (const edit of edits) {
      if (edit.part !== "starter" || (edit.path ?? path) !== path || merged === null) continue;
      const applied = replaceOnce(merged, edit.find, edit.replace, path);
      merged = "text" in applied ? applied.text : null;
    }
    if (merged !== null) await workspaces.write(sessionId, path, merged);
    learnerFiles.push({ path, outcome: merged !== null ? "merged" : "kept" });
  }
  const note = String(value.note ?? "").trim();
  const revision = local.editQuestion(active.id, saved, report);
  const changed = [...touched.values()];
  local.appendNextEvent({ id: randomUUID(), attemptId: active.attemptId, type: "agent_message", occurredAt: new Date().toISOString(), payload: { kind: "challenge_edited", note, changed, revision }, source: "agent", schemaVersion: 1 });
  const kept = learnerFiles.filter((file) => file.outcome === "kept").map((file) => file.path);
  return {
    status: "edited",
    questionId: active.id,
    title: saved.title,
    revision,
    changed,
    validated: codeChanged ? "full" : "figures",
    learnerFiles,
    /* For the thread to draw what changed; the worker keeps these out of the
       coach's context. */
    before: pick(before, changed),
    after: pick(saved, changed),
    note: kept.length
      ? `Edited. The learner had already changed ${kept.join(", ")} where your edit falls, so their file was left as it is: tell them what changed if it affects their code.`
      : "Edited in place. The learner sees the change now and keeps their code.",
  };
}

/** The parts an edit touched, as text, for a before/after view. */
function pick(design: import("@spar/domain").QuestionDesign, changed: Array<{ part: EditPart; path?: string }>) {
  return changed.map(({ part, path }) => ({ part, ...(path ? { path } : {}), text: part === "statement" || part === "title" ? design[part] : design[FILE_PARTS[part]][path!] ?? "" }));
}

/** The opening of the learner's solve, as `read_attempt` carries it. A screen
 *  of code at the size the transcript draws it, and no more. */
const SOLVE_HEAD_LINES = 28;
const SOLVE_HEAD = 1_200;

/** Every file this attempt saved, most recently saved first. The order is what
 *  decides which file the transcript draws as "your solve", so it is the one
 *  they were last working in rather than whichever the directory listed. */
function edited(events: Array<{ type: string; payload: Record<string, unknown> }>): string[] {
  const seen: string[] = [];
  for (const event of events) {
    if (event.type !== "file_changed") continue;
    const path = typeof event.payload.path === "string" ? event.payload.path : "";
    if (!path) continue;
    const at = seen.indexOf(path);
    if (at >= 0) seen.splice(at, 1);
    seen.unshift(path);
  }
  return seen;
}

/**
 * What the learner has written, right now.
 *
 * Their own files, not the tests and not the harness: the tests are the
 * challenge's, the agent set them, and handing them back costs context to say
 * something the agent already knows. Failures come with their own case detail
 * from the run, so nothing is lost by leaving them out.
 */
async function attemptFiles(sessionId: string, workspaces: WorkspaceService, edited: string[] = []): Promise<Array<{ path: string; text: string }>> {
  /* What they saved during this attempt, newest first, and only the rest of the
     workspace when they saved nothing — an attempt opened a minute ago has no
     edits yet and its starter file is still the right answer. */
  const paths = edited.length ? edited : await workspaces.list(sessionId).catch(() => [] as string[]);
  const mine = paths.filter((file) => {
    const name = file.split("/").pop() ?? file;
    return !name.startsWith("test_") && !name.endsWith("_test.py") && !name.includes(".test.") && !name.endsWith(".md") && !name.endsWith(".json");
  });
  const files = await Promise.all(mine.map(async (path) => {
    const text = await workspaces.read(sessionId, path).catch(() => "");
    return { path, text };
  }));
  return files.filter((file) => file.text.trim());
}
