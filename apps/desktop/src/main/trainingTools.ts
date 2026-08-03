import { randomUUID } from "node:crypto";
import { compileQuestion, fallbackDesign } from "@spar/training";
import { abilityStatusSchema, type AbilityStatus, type AskUserQuestionInput } from "@spar/domain";
import { DEFAULT_SECTIONS, foldAttempt, formatSolveLog, type CaseFilter, type ReplaySection } from "../shared/attemptReplay.js";
import type { ConceptTagInput, LocalStore } from "./store.js";
import type { UtilityClient } from "./utilityClient.js";
import type { WorkspaceService } from "./workspaces.js";

export async function executeTrainingTool(
  name: string,
  input: unknown,
  sessionId: string | undefined,
  local: LocalStore,
  workspaces: WorkspaceService,
  runner: UtilityClient,
) {
  if (!sessionId) throw new Error("Training tool call is missing its session context");
  const value = input as Record<string, unknown>;
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
    const duplicateTitle = local.readSession(sessionId)?.summary.questionTitles.some((question) => question.title.trim().toLocaleLowerCase() === proposedTitle.toLocaleLowerCase());
    if (duplicateTitle) return { status: "invalid", report: { valid: false, checks: [{ name: "adaptive progression", passed: false, detail: `A prior question in this session is already titled "${proposedTitle}". Use a different representation and a title that names it.` }] } };
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
    const language = value.language === "typescript" || value.language === "cpp" ? value.language : "javascript";
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
function abilityClaim(value: Record<string, unknown>): { summary?: string; practice?: string[]; concepts?: ConceptTagInput[]; status?: AbilityStatus } {
  const status = abilityStatusSchema.safeParse(value.status);
  return {
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(Array.isArray(value.practice) ? { practice: stringList(value.practice) } : {}),
    ...(Array.isArray(value.concepts) ? { concepts: conceptTags(value.concepts) } : {}),
    ...(status.success ? { status: status.data } : {}),
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
