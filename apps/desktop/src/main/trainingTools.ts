import { randomUUID } from "node:crypto";
import { compileQuestion, fallbackDesign } from "@spar/training";
import { abilityStatusSchema, languageSchema, type AbilityStatus, type AskUserQuestionInput } from "@spar/domain";
import { DEFAULT_SECTIONS, foldAttempt, formatSolveLog, type CaseFilter, type ReplaySection } from "../shared/attemptReplay.js";
import type { ConceptTagInput, LocalStore } from "./store.js";
import type { UtilityClient } from "./utilityClient.js";
import type { WorkspaceService } from "./workspaces.js";
import type { WebSearchService } from "./webSearch.js";
import type { PracticeService } from "./practice.js";
import { assessPracticeAssignment } from "./practiceAssignmentPolicy.js";
import { practiceSourceName } from "./practiceChoice.js";
import { SOURCE_READ_TOOLS } from "../workers/agentPolicy.js";

export async function executeTrainingTool(
  name: string,
  input: unknown,
  sessionId: string | undefined,
  local: LocalStore,
  workspaces: WorkspaceService,
  runner: UtilityClient,
  web?: WebSearchService,
  practice?: PracticeService,
) {
  if (!sessionId) throw new Error("Training tool call is missing its session context");
  const value = input as Record<string, unknown>;
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
  if (name === "read_session") return local.readSession(String(value.sessionId));
  if (name === "search_learner_model") return { passages: local.searchLearner(String(value.query ?? ""), Number(value.limit ?? 4)) };
  if (name === "search_attempt_history") return { attempts: local.searchAttempts(String(value.query ?? ""), Number(value.limit ?? 5)) };
  if (name === "search_challenge_history") return { challenges: local.searchChallenges(String(value.query ?? ""), Number(value.limit ?? 6)) };
  if (name === "read_challenge") return { challenge: local.readChallenge(String(value.questionId ?? "")) };
  /* Both concept reads answer the same question at different resolutions.
     `read_concept_graph` is the shelf — what vocabulary exists near this topic
     and whether the learner has met it. `search_concept_evidence` is the
     finding — how they actually behave under one concept, split by sub-concept,
     which is the difference between "arrays are shaky" and "the in-place pass is
     the problem and two-pointers is fine". */
  if (name === "read_concept_graph") {
    const concepts = local.conceptGraph(String(value.query ?? value.conceptId ?? ""), Number(value.limit ?? 14));
    return { concepts, bounded: true, note: concepts.length ? "Counts roll each sub-concept's evidence into its area. `standing` is derived from graded outcomes; an untested concept is not a weak one." : "No concept in the vocabulary matches this query and the learner has no tagged evidence yet." };
  }
  if (name === "search_concept_evidence") {
    const report = local.conceptEvidenceReport(String(value.concept ?? value.query ?? ""), Number(value.limit ?? 3));
    return { concepts: report, note: report.length ? "Read subConcepts before the top-level counts: an area's average hides the specific one that is failing." : "This concept has no tagged challenges yet, so there is nothing to read behaviour from." };
  }
  if (name === "set_session_objective") return { committed: true, ...local.setObjective(sessionId, String(value.objective)) };
  if (name === "set_training_target") { const target=local.setTrainingTarget(sessionId, value as { ability: string; specificGap: string; desiredEvidence: string; avoidTesting: string[] });local.ensureAbility(target.abilityId,target.abilityTitle);local.queueAbilitySync(target.abilityId);return { committed: true, ...target }; }
  if (name === "commit_session_decision") return { committed: true, ...local.commitDecision(sessionId, value as { action: string; reason: string }) };
  if (name === "ask_user_question") {
    return { pending: true, ...local.setPendingIntake(sessionId, value as AskUserQuestionInput) };
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
    if (local.challengeTitleUsed(proposedTitle)) return { status: "invalid", report: { valid: false, checks: [{ name: "adaptive progression", passed: false, detail: `The learner has already been asked a challenge titled "${proposedTitle}". Use a different representation and a title that names it.` }] } };
    const saturation = saturatedConcept(local, sessionId, value.concepts);
    if (saturation) return { status: "invalid", report: { valid: false, checks: [{ name: "goal coverage", passed: false, detail: saturation }] } };
    const compiled = await compileCandidate(input, sessionId, workspaces, runner);
    if (!compiled.report.valid) return { status: "invalid", report: compiled.report };
    const questionCreatedWhileCompiling = openChallenge(local, sessionId);
    if (questionCreatedWhileCompiling) {
      return { status: "invalid", report: { valid: false, checks: [{ name: "session lifecycle", passed: false, detail: `A playable challenge (${questionCreatedWhileCompiling.title}) was published while this candidate compiled. This candidate was discarded.` }] } };
    }
    await workspaces.writeAll(sessionId, { ...compiled.design.starterFiles, ...compiled.design.visibleTests });
    const question = local.createQuestion(sessionId, compiled.design, compiled.report, { concepts: conceptTags(value.concepts) });
    return { status: "playable", question, report: compiled.report };
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
    const compiled = await compileCandidate(design, sessionId, workspaces, runner);
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
    return { status: "playable", question, replacedQuestionId: activeQuestion.id, report: compiled.report };
  }
  if (name === "inspect_current_attempt" || name === "read_attempt") return { events: local.readAttempt(String(value.attemptId)) };
  if (name === "evaluate_attempt") return { events: local.readAttempt(String(value.attemptId)) };
  if (name === "replay_attempt") return replayForAgent(local, value);
  if (name === "read_ability") return { ability: local.readAbility(String(value.abilityId)) };
  if (name === "propose_ability_update") {const updated=local.updateAbility({abilityId:String(value.abilityId),markdown:String(value.markdown),evidenceEventIds:stringList(value.evidenceEventIds),...abilityClaim(value)});local.queueAbilitySync(updated.id);return { committed: true, ...updated };}
  if (name === "upsert_ability") {const updated=local.upsertAbility({title:String(value.title),markdown:String(value.markdown),evidenceEventIds:stringList(value.evidenceEventIds),...abilityClaim(value)});local.queueAbilitySync(updated.id);return { committed: true, ...updated };}
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
  if (local.challengeTitleUsed(design.title)) {
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
     concept metadata against the persisted target, then bound difficulty using
     the durable status of that exact ability. */
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
    },
    candidate: { difficulty: mounted.problem.difficulty, concepts: mounted.problem.concepts.map((concept) => concept.slug) },
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
 * One tool call, the attempt's whole log.
 *
 * A string rather than a structure on purpose: the questions worth asking of a
 * solve are questions about order and adjacency — was this fixed before or after
 * that was seen — and a nested object makes the reader rebuild both. The
 * parameters are the only thing that decides how much comes back, so a turn that
 * needs the entire log takes it and a turn that needs only the failing cases
 * since the last submission pays for that much. `stats` rides along for the row
 * the learner sees in the transcript; the log itself is `report`.
 */
function replayForAgent(local: LocalStore, value: Record<string, unknown>) {
  const attemptId = String(value.attemptId ?? "");
  const events = local.readAttempt(attemptId);
  if (!events.length) {
    return { report: `No events are recorded for attempt ${attemptId || "(none given)"}, so there is no log to read. Do not infer anything about the learner from this.`, stats: null, filters: null };
  }
  const subject = local.attemptSubject(attemptId);
  const filters = {
    sections: sectionList(value.sections),
    events: stringList(value.eventTypes),
    cases: caseFilter(value.cases),
    scope: value.scope === "since-last-submission" ? "since-last-submission" as const : "all" as const,
    caseDetail: value.caseDetail === "brief" ? "brief" as const : "full" as const,
    maxLines: typeof value.maxLines === "number" && Number.isFinite(value.maxLines) ? Math.max(20, Math.min(2_000, Math.round(value.maxLines))) : 400,
  };
  const replay = foldAttempt(events, {
    ...(subject?.title ? { title: subject.title } : {}),
    ...(subject?.language ? { language: subject.language } : {}),
  });
  return { report: formatSolveLog(replay, filters), stats: replay.stats, filters };
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
  const recent = local.recentChallengeCoverage(3);
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

async function compileCandidate(input:unknown,sessionId:string,workspaces:WorkspaceService,runner:UtilityClient){
  const value=input as Record<string,unknown>;
  return compileQuestion(input,async(files,_command,limits)=>{
    const validationId=randomUUID();
    const root=await workspaces.writeValidation(sessionId,validationId,files);
    try{return await runner.request("run",{root,language:String(value.language),command:"test",timeoutMs:limits.timeoutMs}).promise as {exitCode:number;stdout:string;stderr:string;durationMs:number};}
    finally{await workspaces.removeValidation(sessionId,validationId);}
  });
}
