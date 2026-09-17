import { normalizeStatementText } from "../shared/statementText.js";
import { randomUUID } from "node:crypto";
import { compileQuestion, fallbackDesign, type DesignOrigin } from "@spar/training";
import { abilityStatusSchema, GENERATED_DIFFICULTIES, languageSchema, lessonInputSchema, type AbilityStatus, type AskUserQuestionInput, type Question } from "@spar/domain";
import { DEFAULT_SECTIONS, foldAttempt, formatSolveLog, type CaseFilter, type ReplaySection } from "../shared/attemptReplay.js";
import type { ConceptTagInput, LocalStore } from "./store.js";
import type { UtilityClient } from "./utilityClient.js";
import type { WorkspaceService } from "./workspaces.js";
import type { WebSearchService } from "./webSearch.js";
import type { PracticeService } from "./practice.js";
import { assessGeneratedLevel, assessPracticeAssignment } from "./practiceAssignmentPolicy.js";
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
    followsLessonNote: `This challenge is on ground you already taught in "${found.title}". Say so in your reply and point at it as [[lesson:${found.id}|${found.title}]], so they can reread the idea they are now being asked to use — and make sure what you have set actually exercises what that lesson taught rather than a neighbouring idea.`,
  };
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
) {
  if (!sessionId) throw new Error("Training tool call is missing its session context");
  const value = input as Record<string, unknown>;
  const trackId = local.trackIdForSession(sessionId);
  /* Reads of the practice source go straight through to its MCP server, which
     owns their schemas and their failure wording. Nothing is unwrapped here: the
     agent gets exactly what the server said, including its "carry on without me"
     note when the source is unreachable. */
  if (SOURCE_READ_TOOLS.includes(name)) {
    if (!practice) return { error: "not-connected", message: "No practice source is available in this context." };
    return practice.callTool(name, value);
  }
  if (name === "assign_practice_problem") {
    if (!practice) return { status: "invalid", report: { valid: false, checks: [{ name: "practice source", passed: false, detail: "No practice source is connected, so there is no problem to assign. Write the challenge yourself with create_question." }] } };
    return assignPracticeProblem(value, sessionId, local, workspaces, practice);
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
  if (name === "read_session") return local.readSession(String(value.sessionId));
  /* Three readings of the same memory at three resolutions. `passages` are the
     standing claims; `patterns` are the mistake lifecycles open under them; and
     `evidence` is what was actually observed, one behaviour per row. The last
     two used to be written on every attempt-complete turn and read by nothing,
     so a finding could never be confirmed across attempts — only rewritten. */
  if (name === "search_learner_model") {
    const query = String(value.query ?? "");
    const limit = Number(value.limit ?? 4);
    const memory = local.searchLearnerMemory(query, limit, trackId);
    return { passages: local.searchLearner(query, limit, trackId), ...memory, note: memory.patterns.length || memory.evidence.length ? "`patterns` and `evidence` are your own earlier readings of this learner. A hypothesis here plus one new observation is what promotes it to a pattern; the host refuses a promotion whose evidence does not span two attempts." : "" };
  }
  if (name === "search_attempt_history") return { attempts: local.searchAttempts(String(value.query ?? ""), Number(value.limit ?? 5), trackId) };
  if (name === "search_challenge_history") return { challenges: local.searchChallenges(String(value.query ?? ""), Number(value.limit ?? 6), trackId) };
  if (name === "read_challenge") return { challenge: local.readChallenge(String(value.questionId ?? "")) };
  /* Both concept reads answer the same question at different resolutions.
     `read_concept_graph` is the shelf — what vocabulary exists near this topic
     and whether the learner has met it. `search_concept_evidence` is the
     finding — how they actually behave under one concept, split by sub-concept,
     which is the difference between "arrays are shaky" and "the in-place pass is
     the problem and two-pointers is fine". */
  if (name === "read_concept_graph") {
    const concepts = local.conceptGraph(String(value.query ?? value.conceptId ?? ""), Number(value.limit ?? 14), trackId);
    return { concepts, bounded: true, note: concepts.length ? "Counts roll each sub-concept's evidence into its area. `standing` is derived from graded outcomes; an untested concept is not a weak one." : "No concept in the vocabulary matches this query and the learner has no tagged evidence yet." };
  }
  if (name === "search_concept_evidence") {
    const report = local.conceptEvidenceReport(String(value.concept ?? value.query ?? ""), Number(value.limit ?? 3), trackId);
    return { concepts: report, note: report.length ? "Read subConcepts before the top-level counts: an area's average hides the specific one that is failing." : "This concept has no tagged challenges yet, so there is nothing to read behaviour from." };
  }
  if (name === "set_session_objective") return { committed: true, ...local.setObjective(sessionId, String(value.objective)) };
  if (name === "set_training_target") { const target=local.setTrainingTarget(sessionId, value as { ability: string; specificGap: string; desiredEvidence: string; avoidTesting: string[] });local.ensureAbility(target.abilityId,target.abilityTitle,trackId);local.queueAbilitySync(target.abilityId);return { committed: true, ...target }; }
  if (name === "commit_session_decision") return { committed: true, ...local.commitDecision(sessionId, value as { action: string; reason: string }) };
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
  if (name === "create_question") {
    const activeQuestion = openChallenge(local, sessionId);
    if (activeQuestion) {
      return { status: "invalid", report: { valid: false, checks: [{ name: "session lifecycle", passed: false, detail: `A playable challenge (${activeQuestion.title}) is already active for this session. End this agent turn instead of publishing another challenge.` }] } };
    }
    const proposedTitle = String(value.title ?? "").trim();
    /* Checked against the whole library, not this session. A session boundary is
       an implementation detail to the learner: the same challenge arriving under
       a new goal is the same challenge. */
    if (local.challengeTitleUsed(proposedTitle,trackId)) return { status: "invalid", report: { valid: false, checks: [{ name: "adaptive progression", passed: false, detail: `This Track has already used a challenge titled "${proposedTitle}". Use a different representation and a title that names it.` }] } };
    const saturation = saturatedConcept(local, sessionId, value.concepts);
    if (saturation) return { status: "invalid", report: { valid: false, checks: [{ name: "goal coverage", passed: false, detail: saturation }] } };
    /* The same level check the sourced path has always run, before the compile
       rather than after it: a challenge pitched at the wrong learner is wrong
       whether or not it builds, and building it first spends a toolchain round
       trip to find that out. */
    const levelTarget = local.latestTarget(sessionId);
    if (levelTarget) {
      const level = assessGeneratedLevel({
        difficulty: (GENERATED_DIFFICULTIES as readonly string[]).includes(String(value.difficulty)) ? (value.difficulty as Question["difficulty"]) : "developing",
        /* More than the point every profile is seeded with means at least one
           challenge has been graded, which is the whole of what this needs to
           know: whether the window is a measurement or an assumption. */
        graded: local.ratingHistory().length > 1,
        target: {
          rating: local.currentRating(),
          abilityStatus: local.readAbilityDetail(String(levelTarget.ability_id))?.ability.status ?? "uncertain",
          experience: local.getProfile()?.experience ?? "new",
        },
      });
      if (!level.passed) return { status: "invalid", report: { valid: false, checks: [level] } };
    }
    const compiled = await compileCandidate(input, sessionId, workspaces, runner);
    if (!compiled.report.valid) return { status: "invalid", report: compiled.report };
    const questionCreatedWhileCompiling = openChallenge(local, sessionId);
    if (questionCreatedWhileCompiling) {
      return { status: "invalid", report: { valid: false, checks: [{ name: "session lifecycle", passed: false, detail: `A playable challenge (${questionCreatedWhileCompiling.title}) was published while this candidate compiled. This candidate was discarded.` }] } };
    }
    await workspaces.writeAll(sessionId, { ...compiled.design.starterFiles, ...compiled.design.visibleTests });
    const question = local.createQuestion(sessionId, compiled.design, compiled.report, { concepts: conceptTags(value.concepts) });
    rememberTrackLanguage(local, trackId, value);
    return { status: "playable", question, report: compiled.report, ...followsLesson(local, conceptTags(value.concepts), trackId) };
  }
  /* Not in the agent's tool list. The controller reaches for this only after
     every model-authored candidate has been rejected, so that a session ends
     with something to attempt rather than with a compiler error. It is
     compiled and validated exactly like any other candidate — the guarantee
     comes from the design being written against the build contract, never from
     trusting it. */
  if (name === "create_fallback_question") {
    if (openChallenge(local, sessionId)) return { status: "invalid", report: { valid: false, checks: [{ name: "session lifecycle", passed: false, detail: "A challenge is already active for this session." }] } };
    const language = languageSchema.catch("javascript").parse(value.language);
    const design = fallbackDesign(language);
    const compiled = await compileCandidate(design, sessionId, workspaces, runner, "host");
    if (!compiled.report.valid) return { status: "invalid", report: compiled.report };
    await workspaces.writeAll(sessionId, { ...compiled.design.starterFiles, ...compiled.design.visibleTests });
    /* Tagged like any other challenge, and tagged for what it actually is rather
       than for the target it failed to hit. An untagged challenge is invisible to
       every concept rollup, and a fallback the learner attempted is still
       evidence about them — just evidence about tracing a running total. */
    const question = local.createQuestion(sessionId, compiled.design, compiled.report, { concepts: [{ slug: "tracing-execution", role: "primary" }, { slug: "prefix-sums", role: "supporting" }] });
    return { status: "playable", question, report: compiled.report, fallback: true };
  }
  if (name === "replace_current_question") {
    const activeQuestion = openChallenge(local, sessionId);
    if (!activeQuestion) return { status: "invalid", report: { valid: false, checks: [{ name: "session lifecycle", passed: false, detail: "There is no active challenge to replace." }] } };
    const compiled = await compileCandidate(input, sessionId, workspaces, runner);
    if (!compiled.report.valid) return { status: "invalid", report: compiled.report };
    const stillActive = local.readSession(sessionId)?.question;
    if (!stillActive || stillActive.id !== activeQuestion.id) return { status: "invalid", report: { valid: false, checks: [{ name: "session lifecycle", passed: false, detail: "The active challenge changed while this replacement compiled. The candidate was discarded." }] } };
    await workspaces.replaceAll(sessionId, { ...compiled.design.starterFiles, ...compiled.design.visibleTests });
    const question = local.replaceQuestion(sessionId, compiled.design, compiled.report, String(value.reason ?? "The learner asked the agent to adapt the challenge."), conceptTags(value.concepts));
    rememberTrackLanguage(local, trackId, value);
    return { status: "playable", question, replacedQuestionId: activeQuestion.id, report: compiled.report, ...followsLesson(local, conceptTags(value.concepts), trackId) };
  }
  if (name === "review_solution") {
    const attemptId = String(value.attemptId);
    const verdict = value.verdict === "rework" ? "rework" : "accepted";
    const reasons = Array.isArray(value.reasons) ? value.reasons.map((entry) => String(entry)).slice(0, 4) : [];
    local.appendNextEvent({ id: randomUUID(), attemptId, type: "submission_evaluated", occurredAt: new Date().toISOString(), payload: { review: verdict, reasons, approach: String(value.approach ?? ""), observedComplexity: String(value.observedComplexity ?? "") }, source: "system", schemaVersion: 1 });
    if (verdict === "accepted") return { review: "accepted", note: "Recorded. The attempt stays complete." };
    /* Reopening is the point of the tool, so it is the host that does it — an
       agent that says "that does not meet the requirement" and leaves the
       challenge closed has only complained. */
    const reopened = local.reopenAttempt(attemptId, reasons.join(" ") || "The solution did not meet the challenge's stated requirements.");
    return { review: "rework", reopened: true, questionId: reopened.questionId, note: "The challenge is open again for the learner. Tell them which requirement it misses and what to change — a nudge, not the solution. Do not update abilities or set a new challenge this turn." };
  }
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
  if (name === "propose_ability_update") {const updated=local.updateAbility({abilityId:String(value.abilityId),markdown:String(value.markdown),evidenceEventIds:stringList(value.evidenceEventIds),...abilityClaim(value)});local.queueAbilitySync(updated.id);return { committed: true, ...updated };}
  if (name === "upsert_ability") {const updated=local.upsertAbility({title:String(value.title),markdown:String(value.markdown),evidenceEventIds:stringList(value.evidenceEventIds),...abilityClaim(value)},trackId);local.queueAbilitySync(updated.id);return { committed: true, ...updated };}
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
  if (activeQuestion && design.title === activeQuestion.title) {
    return refuse("adaptive progression", `"${design.title}" is the challenge they are already on, so there is nothing to swap. Choose a different problem.`);
  }
  if (local.challengeTitleUsed(design.title,local.trackIdForSession(sessionId))) {
    return refuse("adaptive progression", `The learner has already been set "${design.title}". Choose a different problem, or write a challenge that approaches the same gap from another direction.`);
  }
  /* Nothing can grade it: no judge at the source, and no case Spar could recover
     from the statement. Assigning it would mean asking someone to solve something
     with no way to find out whether they had. */
  if (!source.remoteJudge && source.localCaseCount === 0) {
    return refuse("grading", `${practiceSourceName(provider)} is not judging submissions right now and Spar could not build a runnable case for "${design.title}"${mounted.harnessNote ? ` (${mounted.harnessNote})` : ""}. Nothing could grade this, so it must not be set. Choose a problem with published examples, or write the challenge yourself.`);
  }

  /* The model proposes; the host admits. Availability and a real judge say a
     problem can be assigned, not that it should be. Check the source's own
     concept metadata against the persisted target, then check the problem's own
     price against the rating window that exact ability's status calls for. */
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
  if (adaptiveChecks.some((check) => !check.passed)) return { status: "invalid" as const, report: { valid: false, checks: adaptiveChecks } };

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

  const report = { valid: true, sourced: true, checks: [{ name: "practice source", passed: true, detail: source.judge }, ...adaptiveChecks] };
  const concepts = conceptTags(value.concepts);
  await (activeQuestion ? workspaces.replaceAll(sessionId, mounted.files) : workspaces.writeAll(sessionId, mounted.files));
  const question = activeQuestion
    /* Recorded as a replacement, not as a fresh start: the abandoned attempt keeps
       its events and the new challenge keeps a pointer to what it superseded, so a
       later turn can see that they were moved off something rather than that they
       walked away from it. */
    ? local.replaceQuestion(sessionId, design, report, replaceReason, concepts, source)
    : local.createQuestion(sessionId, design, report, { concepts, source });
  /* The aim is recorded as a system message rather than dropped: `why` is the
     agent's statement of what this problem is supposed to discriminate, and a
     later turn reading the session has to be able to find it. */
  const why = String(value.why ?? "").trim();
  if (why) local.addMessage(sessionId, "system", `Set ${practiceSourceName(provider)} ${source.displayId} — ${design.title}. ${why}`);
  return {
    status: "playable",
    question,
    source: { slug: source.slug, displayId: source.displayId, url: source.url, difficulty: source.difficulty },
    judge: source.judge,
    localCases: source.localCaseCount,
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
  const events = local.readAttempt(attemptId);
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
  const allowed: ReplaySection[] = ["log", "cases", "runs", "timings"];
  if (!Array.isArray(value)) return DEFAULT_SECTIONS;
  const chosen = value.filter((entry): entry is ReplaySection => allowed.includes(entry as ReplaySection));
  return chosen.length ? chosen : DEFAULT_SECTIONS;
}

function caseFilter(value: unknown): CaseFilter {
  return value === "failed-ever" || value === "still-failing" || value === "fixed" ? value : "all";
}

/**
 * Refuses a session's *first* challenge when it lands on the concept the last
 * three challenges were already about and the learner's own goal never named it.
 *
 * This is the failure the learner actually reported: four unrelated goals — a
 * Google interview, TypeScript, C++, "hii" — each produced another off-by-one
 * loop repair, because the ability ledger held exactly one ability and every
 * retrieval returned it. Retrieval is supposed to calibrate difficulty; here it
 * was replacing the goal.
 *
 * Narrow on purpose, so legitimate repetition survives. It only applies to the
 * first challenge of a session — staying on a concept after an attempt is how
 * teaching works, and this must not touch that. And it yields whenever the goal
 * names the concept, which is what a drill started from an ability or concept
 * card does: those goals read "I want to go deeper on <that ability>", so the
 * learner asking for more of the same is always honoured.
 */
function saturatedConcept(local: LocalStore, sessionId: string, concepts: unknown): string | null {
  const primary = primaryConceptSlug(concepts);
  if (!primary) return null;
  const summary = local.readSession(sessionId)?.summary;
  if (!summary || summary.questionTitles.length > 0) return null;
  const recent = local.recentChallengeCoverage(3,local.trackIdForSession(sessionId));
  if (recent.length < 3 || !recent.every((row) => row.primaryConcept === primary)) return null;
  if (goalNames(summary.originalGoal, primary)) return null;
  return `The learner's last ${recent.length} challenges were all aimed at "${primary}" (${recent.map((row) => `"${row.title}"`).join(", ")}), and this session's goal — "${summary.originalGoal}" — does not name it. Retrieved history calibrates difficulty; it does not choose the topic. Set a target inside the surface this goal actually describes and aim this first challenge at a concept the learner has no recent evidence under.`;
}

function primaryConceptSlug(concepts: unknown): string | null {
  const tags = conceptTags(concepts);
  if (!tags.length) return null;
  return (tags.find((tag) => tag.role === "primary") ?? tags[0])?.slug?.trim().toLocaleLowerCase() ?? null;
}

/** Whether the goal itself asks for this concept. Slug words rather than the
 *  whole slug, so "loop-boundary-tracing" is named by "go deeper on loop
 *  boundary tracing" — the wording a drill session is created with. */
function goalNames(goal: string, slug: string): boolean {
  const words = slug.split(/[^a-z0-9]+/i).filter((word) => word.length > 2);
  if (!words.length) return false;
  const haystack = goal.toLocaleLowerCase();
  return words.every((word) => haystack.includes(word.toLocaleLowerCase()));
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

/** The parts of an ability write that are optional on both ability tools, kept in
 *  one place so `propose_ability_update` and `upsert_ability` cannot drift into
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

async function compileCandidate(input:unknown,sessionId:string,workspaces:WorkspaceService,runner:UtilityClient,origin:DesignOrigin="authored"){
  const candidate = input as Record<string, unknown>;
  const value=withRequirements(typeof candidate.statement === "string" ? { ...candidate, statement: normalizeStatementText(candidate.statement) } : candidate);
  return compileQuestion(value,async(files,_command,limits)=>{
    const validationId=randomUUID();
    const root=await workspaces.writeValidation(sessionId,validationId,files);
    try{return await runner.request("run",{root,language:String(value.language),command:"test",timeoutMs:limits.timeoutMs}).promise as {exitCode:number;stdout:string;stderr:string;durationMs:number};}
    finally{await workspaces.removeValidation(sessionId,validationId);}
  },origin);
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
