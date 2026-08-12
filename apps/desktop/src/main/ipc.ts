import { BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import { apiOriginIsUnconfigured } from "./apiOrigin.js";
import { fitWindowTo } from "./window.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { languageSchema, sessionCheckpointSchema, sessionSuggestionSchema, type AgentActivityStep, type ChallengeDetail, type LearnerProfile, type SessionSuggestion } from "@spar/domain";
import { attemptAppendInput, authRequestInput, challengeIdInput, challengeWriteInput, createSessionInput, ipc, practiceInput, profileInput, providerSettingsInput, reasoningEffortSchema, runInput, sessionFlagInput, sessionRenameInput, sessionStatusInput, sourceConnectionInput, sourceJudgeInput, sourceRegionInput, sourceRunInput, sourceSearchInput, sourceSlugInput, sourceStartInput, themePreferenceSchema, workspacePathInput, workspaceStateInput, workspaceWriteInput, type ProviderId, type SourceRunReport } from "../shared/api.js";
import type { PracticeVerdict } from "@spar/practice";
import { runLimits } from "@spar/training";
import { runEvidence } from "../shared/testReport.js";
import { sourceSubmissionOutput } from "../shared/sourceOutput.js";
import { canonicalWorkspacePath } from "../shared/workspacePath.js";
import { challengeFiles, challengeTimeline, seedFiles } from "./challengeFiles.js";
import { openChosenProblem } from "./practiceChoice.js";
import { judgeCaseBlock } from "./judgeCases.js";
import type { AuthService } from "./auth.js";
import type { LocalStore } from "./store.js";
import type { UtilityClient } from "./utilityClient.js";
import type { WorkspaceService } from "./workspaces.js";
import type { PracticeService } from "./practice.js";
import type { ProviderService } from "./provider.js";
import type { CloudSyncService } from "./sync.js";
import type { CheckpointService } from "./checkpoints.js";
import type { RestoreService } from "./restore.js";
import type { WebSearchService } from "./webSearch.js";
import { requestsChallengeRevision } from "./agentIntent.js";
import { forgetAgentActivity, takeAgentActivity } from "./agentActivity.js";
import type { AgentTurnKind } from "../workers/agentPolicy.js";

export function installIpc(deps: { store: LocalStore; workspaces: WorkspaceService; auth: AuthService; providers: ProviderService; practice: PracticeService; runner: UtilityClient; agent: UtilityClient; agentRunSessions: Map<string, string>; sync: CloudSyncService; checkpoints: CheckpointService; restore: RestoreService; web: WebSearchService; window: () => BrowserWindow | null }) {
  const activeAgentRuns = new Map<string, string>();
  // Reservation is set before credential/provider awaits. Without it, the
  // renderer's planning poll can launch several turns for one session.
  const startingAgentRuns = new Map<string, Promise<{ runId: string }>>();
  /* How many planning turns opening a session has launched on its own.
     `startingAgentRuns` only holds for as long as a launch is in flight, so it
     covers a burst of polls and nothing else: a turn that ended without leaving
     a question or a target behind released the claim, the next poll saw the same
     unfinished planning session and launched again, and the learner watched five
     identical "Resume placement" messages stack up in one thread. Auto-resume is
     a recovery path, so it gets one attempt; after that the session waits for the
     learner, who has Next challenge and the composer to ask again. Counted per
     session and never cleared by a launch — clearing it there is what made the
     old failure set unable to stop anything. */
  const autoResumedPlanning = new Map<string, number>();
  const AUTO_RESUME_LIMIT = 1;
  const mayAutoResume = (sessionId: string) => (autoResumedPlanning.get(sessionId) ?? 0) < AUTO_RESUME_LIMIT;
  const countAutoResume = (sessionId: string) => autoResumedPlanning.set(sessionId, (autoResumedPlanning.get(sessionId) ?? 0) + 1);
  /* A real learner action is the only thing that earns a fresh budget: they have
     seen the state and asked for it, so this is no longer a loop the app is
     driving by itself. */
  const clearAutoResume = (sessionId: string) => autoResumedPlanning.delete(sessionId);
  ipcMain.handle(ipc.bootstrap, async () => ({ account: await deps.auth.account(), profile: deps.store.getProfile(), sessions: deps.store.listSessions(), challenges: deps.store.listChallenges(), abilities: deps.store.listAbilities(), concepts: deps.store.listConcepts(), theme: themePreferenceSchema.catch("system").parse(deps.store.getSetting("theme", "system")), syncState: "offline", restore: deps.restore.current(), serverConfigured: !apiOriginIsUnconfigured() }));
  ipcMain.handle(ipc.restoreRetry, () => deps.restore.run());
  /* Checked before the session row exists, not after: a session created for a
     turn that can never run is a dead entry in the sidebar that the learner has
     to clean up to make the error go away. */
  ipcMain.handle(ipc.sessionsCreate, async (_event, value) => { const input = createSessionInput.parse(value); if(!await deps.providers.available())throw new Error(NO_PROVIDER); const created=deps.store.createSession(input.goal);const coldStart=!deps.store.hasRelevantLearnerEvidence(input.goal);await startAgentTurn(created.sessionId,`Start a new adaptive session for this learner goal: ${input.goal}`,"learner",coldStart?"cold-start":"session-start");return created; });
  /**
   * SQLite is the durable owner of an active challenge. A workspace can be
   * absent after an interrupted restore or an older checkpoint that carried no
   * files; recreate only missing declared files and never overwrite learner
   * content that is still present.
   */
  const ensureLiveWorkspace = async (sessionId: string, detail = deps.store.readSession(sessionId)) => {
    if (!detail?.question) return detail;
    const record = deps.store.challengeRecord(detail.question.id);
    if (!record) return detail;
    const declared = { ...record.design.starterFiles, ...record.design.visibleTests };
    const checkpoint = sessionCheckpointSchema.safeParse(detail.checkpoint);
    const checkpointFiles = checkpoint.success && checkpoint.data.attemptId === detail.question.attemptId
      ? checkpoint.data.workspaceFiles
      : [];
    for (const file of checkpointFiles) {
      const restoredPath = canonicalWorkspacePath(file.path);
      if (restoredPath in declared && (file.dirtyContent ?? file.content) !== undefined) {
        declared[restoredPath] = (file.dirtyContent ?? file.content)!;
      }
    }
    await deps.workspaces.ensureFiles(sessionId, declared);
    return detail;
  };
  ipcMain.handle(ipc.sessionsOpen, async (_event, sessionId) => {
    const id=zUuid(sessionId);let detail=deps.store.readSession(id);
    if(detail?.summary.status!=="planning"||detail.pendingLearnerQuestion||activeAgentRuns.has(id)||startingAgentRuns.has(id))return ensureLiveWorkspace(id, detail);
    if(deps.store.resetIncompletePlanning(id)){clearAutoResume(id);detail=deps.store.readSession(id);}
    if(!detail)return null;
    if(!mayAutoResume(id))return detail;
    const placementAnswer=deps.store.answeredIntake(id);
    countAutoResume(id);
    if(!deps.store.hasRelevantLearnerEvidence(detail.summary.originalGoal)&&!placementAnswer){void startAgentTurn(id,`Resume placement for this learner goal: ${detail.summary.originalGoal}. Ask one focused prerequisite and confidence question before choosing a target.`,"system","cold-start");return detail;}
    if(placementAnswer){void startAgentTurn(id,`Resume this persisted planning session for goal: ${detail.summary.originalGoal}. The learner already answered the placement question: ${placementAnswer}. Use that answer as explicit prerequisite and confidence evidence; do not ask placement again. Commit one accessible target and create a validated question.`,"system","session-start");return detail;}
    void startAgentTurn(id,`Resume this persisted planning session for goal: ${detail.summary.originalGoal}. Re-evaluate the goal from relevant evidence and commit one fresh target.` ,"system","session-start");
    return ensureLiveWorkspace(id, detail);
  });
  ipcMain.handle(ipc.workspaceStateSave, (_event, value) => { const { sessionId, ...state } = workspaceStateInput.parse(value); deps.checkpoints.remember(sessionId, state); });
  ipcMain.handle(ipc.attemptAppend, (_event, value) => deps.store.appendNextEvent(attemptAppendInput.parse(value)));
  ipcMain.handle(ipc.workspaceRead, async (_event, value) => {
    const input = workspacePathInput.parse(value);
    try { return await deps.workspaces.read(input.sessionId, input.path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await ensureLiveWorkspace(input.sessionId);
      return deps.workspaces.read(input.sessionId, input.path);
    }
  });
  /* Every saved file is a reason to checkpoint. The service debounces, so a burst
     of saves costs one row rather than one each. */
  ipcMain.handle(ipc.workspaceWrite, async (_event, value) => { const input = workspaceWriteInput.parse(value); await deps.workspaces.write(input.sessionId, input.path, input.content); deps.checkpoints.note(input.sessionId); });
  /* How long a run may take is decided here, from the language, and never taken
     from the window. The renderer used to send the number — 8s, hard-coded beside
     the Run button — which is why pressing Run on a C++ challenge killed the
     compile before it finished and reported the learner's correct solution as a
     stopped process. A caller may ask for *less* (a quick smoke run), never more. */
  ipcMain.handle(ipc.runnerRun, async (_event, value) => {
    const input = runInput.parse(value);
    await deps.workspaces.prepareForExecution(input.sessionId);
    const budget = runLimits(input.language).timeoutMs;
    const timeoutMs = input.timeoutMs === undefined ? budget : Math.min(input.timeoutMs, budget);
    const request = deps.runner.request("run", { ...input, timeoutMs, root: deps.workspaces.sessionRoot(input.sessionId) });
    void request.promise.catch((error) => deps.window()?.webContents.send("runner:event", { id: request.id, stream: "stderr", data: String(error) }));
    return { id: request.id };
  });
  const startAgentTurn=async(sessionId:string,message:string,role:"learner"|"system"="learner",turnKind:AgentTurnKind="learner-message")=>{
    const activeRunId=activeAgentRuns.get(sessionId);if(activeRunId)return{runId:activeRunId};
    const starting=startingAgentRuns.get(sessionId);if(starting)return starting;
    const launch=(async()=>{
      /* Credentials are resolved before the message is recorded. A turn with no
         provider behind it must leave the transcript exactly as it found it —
         otherwise the learner is looking at their own question sitting in the
         thread with nothing that will ever answer it. */
      const account=await deps.auth.account();const token=await deps.auth.accessToken();
      if(!account)throw new Error("Sign in before starting Spar");
      const providers=await deps.providers.resolve(account.id,token);
      if(!providers.length)throw new Error(NO_PROVIDER);
      deps.store.addMessage(sessionId,role,message);
      const session=deps.store.readSession(sessionId);if(!session)throw new Error("Session not found");
      const target=deps.store.latestTarget(sessionId);const defaultObjective="Investigating your prior evidence and defining the first training target.";
      /* Onboarding is evidence like any other: what the learner said about their
         experience and where they feel weak calibrates the first target, before
         any attempt exists to calibrate it from. `preferredLanguage` is the
         default the instructions read — a stated language in the goal still wins. */
      const profile=deps.store.getProfile();
      /* Resolved per turn rather than at startup: the learner can add or remove
         the key while the app is open, and the worker decides whether the web
         tools exist at all from this one flag. */
      /* Two conditions, and both are the learner's: a key has to exist, and they
         have to want the agent reaching outside their own record with it. */
      const webSearch=deps.store.getSetting<boolean>("web-search-enabled",true)&&await deps.web.keySource()!=="none";
      /* Resolved per turn, like the web key: the learner can connect or drop a
         source while the app is open, and a session that expired mid-turn must
         stop offering tools that can only answer "not connected". */
      const practiceInventory=await deps.practice.inventory().catch(()=>[]);
      const connectedSources=practiceInventory.filter((entry)=>entry.state==="connected");
      const practiceConnected=connectedSources.length>0;
      const practiceSummary=practiceConnected?{
        providers:connectedSources.map((entry)=>({source:entry.source,name:entry.name,region:entry.region,judgesSubmissions:entry.judgesSubmissions})),
        /* What has already been set from the source, so the agent can see it has
           asked for this problem before without spending a tool call to find out. */
        alreadyAssigned:deps.store.assignedPracticeProblems(12),
      }:null;
      const payload={sessionId,message,turnKind,webSearch,practiceSource:practiceConnected,activeQuestion:openQuestion(session)?{id:session.question!.id,attemptId:session.question!.attemptId}:null,resumeState:{...(session.summary.objective!==defaultObjective?{objective:{committed:true,objective:session.summary.objective}}:{}),...(turnKind!=="challenge-revision"&&target?{target:{committed:true,...target}}:{})},context:JSON.stringify({session:session.summary,activeQuestion:session.question,activeTrainingTarget:target,checkpoint:session.checkpoint,recentConversation:session.messages.slice(-12),relevantAbilitySummary:deps.store.searchLearner(session.summary.originalGoal,4),
        /* Carried unconditionally, unlike `relevantAbilitySummary`, which is
           scoped to the goal and so cannot show a topic the goal never mentions.
           Repetition across sessions is exactly the thing a goal-scoped view
           hides: the agent needs to see the last dozen challenges to know it has
           asked about the same concept twelve times. */
        recentChallenges:deps.store.recentChallengeCoverage(12),practiceSource:practiceSummary,accountId:account.id,preferredLanguage:profile?.language??"javascript",learnerProfile:profile?{name:profile.name,experience:profile.experience,focus:profile.focus,statedWeakness:profile.weakness}:null})};
      /* A run is claimed by its session for as long as it is in flight, in two
         places: `activeAgentRuns` guards against a second turn, and
         `agentRunSessions` is what lets the main process stamp a session id onto
         every streamed event — without which a session card that is not open
         could not tell that the agent is working on it. Both are released
         together, and a retried turn hands the claim to the new run id. */
      const claim=(runId:string)=>{activeAgentRuns.set(sessionId,runId);deps.agentRunSessions.set(runId,sessionId);return runId;};
      const release=(runId:string)=>{activeAgentRuns.delete(sessionId);deps.agentRunSessions.delete(runId);};
      const first=deps.agent.request("turn",{...payload,provider:providers[0]});claim(first.id);
      const attempt=async(request:ReturnType<UtilityClient["request"]>,index:number):Promise<void>=>{try{const value=await request.promise as {text?:string};
        /* The turn's own steps go into storage with the reply they produced. The
           live run is dropped the instant this `done` reaches the renderer, and
           without this the transcript would keep only the last sentence of a
           turn that read six things to arrive at it. */
        const activity=withoutFinalReply(takeAgentActivity(request.id),value.text ?? "");
        /* Recorded when there is activity even with no reply: an attempt-complete
           turn answers with a challenge rather than a sentence, and it used to
           leave the transcript with no trace that it ran at all. */
        if(value.text?.trim()||activity.length)deps.store.addMessage(sessionId,"agent",value.text?.trim()??"",activity);
        deps.window()?.webContents.send("agent:event",{runId:request.id,sessionId,type:"done"});release(request.id);}catch(error){forgetAgentActivity(request.id);const next=providers[index+1];if(next){deps.store.addMessage(sessionId,"system",`Provider ${providers[index]?.provider??"unknown"} failed; retrying this turn with ${next.provider}.`);const retry=deps.agent.request("turn",{...payload,provider:next});deps.agentRunSessions.delete(request.id);claim(retry.id);return attempt(retry,index+1);}if(turnKind==="session-start"){deps.store.resetIncompletePlanning(sessionId);}deps.window()?.webContents.send("agent:event",{runId:request.id,sessionId,type:"error",text:error instanceof Error?error.message:String(error)});release(request.id);}};
      void attempt(first,0);return{runId:first.id};
    })();
    startingAgentRuns.set(sessionId,launch);
    try{return await launch;}finally{startingAgentRuns.delete(sessionId);}
  };
  // Giving up is durable and evidence-bearing: the abandonment is recorded on the
  // attempt, and the agent is told so its next target answers the walk-away
  // rather than silently repeating the same challenge.
  ipcMain.handle(ipc.attemptAbandon, async (_event, value) => {
    const input = value as { sessionId?: unknown; attemptId?: unknown; reason?: unknown };
    const sessionId = zUuid(input.sessionId); const attemptId = zUuid(input.attemptId);
    const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
    const result = deps.store.abandonAttempt(attemptId, reason);
    if (result.sessionId !== sessionId) throw new Error("Attempt does not belong to this session");
    deps.store.addMessage(sessionId, "system", `The learner gave up on this challenge${reason ? `: ${reason}` : "."}`);
  });

  ipcMain.handle(ipc.attemptReset, (_event, value) => {
    const input = value as { sessionId?: unknown; attemptId?: unknown };
    const sessionId = zUuid(input.sessionId); const attemptId = zUuid(input.attemptId);
    deps.store.resetAttempt(sessionId, attemptId);
  });

  ipcMain.handle(ipc.sessionNextChallenge, async (_event, value) => {
    const sessionId = zUuid((value as { sessionId?: unknown }).sessionId);
    deps.store.setSessionStatus(sessionId, "planning");
    clearAutoResume(sessionId);
    return startAgentTurn(sessionId, "The learner asked for the next challenge. Use the existing evidence, including any challenge they gave up on, to choose one training target and create the next validated question.", "learner", "session-start");
  });

  /* Reads over the learner's own recorded history, so neither starts a turn and
     neither costs a provider call. */
  ipcMain.handle(ipc.conceptRead, (_event, value) => { if (typeof value !== "string" || !value.trim()) throw new Error("A concept is required"); return deps.store.conceptDetail(value); });
  ipcMain.handle(ipc.abilityRead, (_event, value) => deps.store.readAbilityDetail(zUuid(value)));

  /**
   * Practice from an ability or a concept. This is a real session, aimed: the
   * goal is written in the learner's voice because that is what a session is
   * started from, and the agent is separately told which ability or concept it
   * came from along with what the recorded evidence there currently says — so the
   * first challenge answers the gap rather than re-testing what already passed.
   *
   * Deliberately not a shortcut past `sessionsCreate`'s guard: a practice session
   * with no provider behind it would be a dead row in the sidebar, same as any
   * other.
   */
  ipcMain.handle(ipc.practiceStart, async (_event, value) => {
    const input = practiceInput.parse(value);
    if (!await deps.providers.available()) throw new Error(NO_PROVIDER);
    const ability = input.abilityId ? deps.store.readAbilityDetail(input.abilityId) : null;
    if (input.abilityId && !ability) throw new Error("That ability no longer exists");
    const concept = input.conceptSlug ? deps.store.conceptDetail(input.conceptSlug) : null;
    if (input.conceptSlug && !concept) throw new Error("That concept no longer exists");
    const subject = ability?.ability.title ?? concept?.concept.title ?? "";
    const goal = input.drill ?? (ability
      ? `I want to go deeper on ${subject.toLowerCase()}.`
      : `I want to get reliably good at ${subject.toLowerCase()}.`);
    const created = deps.store.createSession(goal);
    const aim = [
      `The learner started this session from ${ability ? `their "${subject}" ability` : `the "${subject}" concept`} rather than by typing a goal, so it is a deliberate drill on that and not a new direction.`,
      ability ? `That ability is currently ${ability.ability.status} across ${ability.ability.evidenceCount} linked evidence event${ability.ability.evidenceCount === 1 ? "" : "s"}${ability.ability.concepts.length ? `, covering ${ability.ability.concepts.map((tag) => tag.slug).join(", ")}` : ""}.` : "",
      concept ? `Recorded evidence for that concept: ${concept.concept.passedCount} passed, ${concept.concept.failedCount} failed, ${concept.concept.abandonedCount} abandoned across ${concept.concept.challengeCount} challenge${concept.concept.challengeCount === 1 ? "" : "s"}.${concept.children.length ? ` Sub-concepts with evidence: ${concept.children.map((child) => `${child.slug} (${child.passedCount}/${child.passedCount + child.failedCount + child.abandonedCount} passed)`).join(", ")}.` : ""}` : "",
      `Read the concept evidence first and aim the target at what is still uncertain there. Do not repeat a challenge title the learner has already seen.`,
    ].filter(Boolean).join(" ");
    await startAgentTurn(created.sessionId, `${goal}\n\n${aim}`, "learner", "session-start");
    return created;
  });

  ipcMain.handle(ipc.sessionsRename, (_event, value) => { const input = sessionRenameInput.parse(value); return deps.store.renameSession(input.sessionId, input.title); });
  ipcMain.handle(ipc.sessionsPin, (_event, value) => { const input = sessionFlagInput.parse(value); deps.store.setSessionPinned(input.sessionId, input.value); });
  ipcMain.handle(ipc.sessionsArchive, (_event, value) => { const input = sessionFlagInput.parse(value); deps.store.setSessionArchived(input.sessionId, input.value); });
  /* Calling a session finished is the learner's judgement, but only while nothing
     is live: a session with a challenge open on screen is described by that
     challenge, and a status behind it would contradict what they are looking at. */
  ipcMain.handle(ipc.sessionsStatus, (_event, value) => {
    const input = sessionStatusInput.parse(value);
    if (deps.store.readSession(input.sessionId)?.summary.activeQuestion) throw new Error("Finish or give up on the open challenge first");
    deps.store.setSessionStatus(input.sessionId, input.status);
  });
  /* A turn already in flight is dropped rather than waited for: the learner has
     said the session is going away, and the worker's result has nowhere to land
     once the row is gone. Anything the turn still writes is a no-op after this. */
  ipcMain.handle(ipc.sessionsDelete, async (_event, value) => {
    const sessionId = zUuid(value);
    activeAgentRuns.delete(sessionId);
    clearAutoResume(sessionId);
    if (!deps.store.deleteSession(sessionId)) return;
    await deps.workspaces.remove(sessionId);
  });

  /* ---- Practising a challenge from history --------------------------------
     A challenge in the history list is finished work, and re-opening it is
     rehearsal: no attempt is started, no event is appended, no agent turn is
     launched, and the session's own workspace is never touched. Everything
     below runs against `.spar/practice/<challengeId>` inside the session's
     directory, which is the learner's to keep and to throw away. */
  const challengeDetail = async (challengeId: string): Promise<ChallengeDetail | null> => {
    const record = deps.store.challengeRecord(challengeId);
    const summary = deps.store.listChallenges().find((item) => item.id === challengeId);
    if (!record || !summary) return null;
    const seed = seedFiles(record.design);
    await deps.workspaces.ensurePractice(record.sessionId, challengeId, seed);
    const content: Record<string, string> = {};
    let practiceEdited = false;
    for (const [path, generated] of Object.entries(seed)) {
      const saved = await deps.workspaces.readPractice(record.sessionId, challengeId, path);
      content[path] = saved ?? generated;
      if (saved !== null && saved !== generated) practiceEdited = true;
    }
    return {
      summary,
      statement: record.statement,
      kind: record.kind,
      sessionGoal: record.sessionGoal,
      sessionStatus: record.sessionStatus,
      abilityTitle: record.abilityTitle,
      specificGap: record.specificGap,
      desiredEvidence: record.desiredEvidence,
      action: record.action,
      files: challengeFiles(record.design, content),
      source: record.source,
      hiddenTestCount: Object.keys(record.design.hiddenTests).length,
      practiceEdited,
      timeline: challengeTimeline(record.attempts),
    };
  };
  /** The challenge's session and design, or a thrown error the renderer can show. */
  const practiceTarget = (challengeId: string) => {
    const record = deps.store.challengeRecord(challengeId);
    if (!record) throw new Error("That challenge no longer exists");
    return record;
  };

  ipcMain.handle(ipc.challengePreviews, () => deps.store.challengePreviews());
  ipcMain.handle(ipc.challengeRead, (_event, value) => challengeDetail(zUuid(value)));
  ipcMain.handle(ipc.challengeWrite, async (_event, value) => {
    const input = challengeWriteInput.parse(value);
    const record = practiceTarget(input.challengeId);
    // Visible tests are the challenge's contract. They are read-only in the
    // editor, and read-only here too — otherwise "practising" could quietly
    // become editing the cases until they pass.
    if (input.path in record.design.visibleTests) throw new Error("The test files state the challenge's contract and cannot be edited");
    await deps.workspaces.ensurePractice(record.sessionId, input.challengeId, seedFiles(record.design));
    await deps.workspaces.writePractice(record.sessionId, input.challengeId, { [input.path]: input.content });
  });
  ipcMain.handle(ipc.challengeRun, async (_event, value) => {
    const input = challengeIdInput.parse(value);
    const record = practiceTarget(input.challengeId);
    const root = await deps.workspaces.ensurePractice(record.sessionId, input.challengeId, seedFiles(record.design));
    const request = deps.runner.request("run", { root, language: record.design.language, command: "test", timeoutMs: runLimits(record.design.language).timeoutMs });
    void request.promise.catch((error) => deps.window()?.webContents.send("runner:event", { id: request.id, stream: "stderr", data: String(error) }));
    return { id: request.id };
  });
  /* The hidden suite, in a throwaway copy of the sandbox — the same shape as a
     real submission minus everything that makes a submission count. The verdict
     is returned and then forgotten. */
  ipcMain.handle(ipc.challengeCheck, async (_event, value) => {
    const input = challengeIdInput.parse(value);
    const record = practiceTarget(input.challengeId);
    const seed = seedFiles(record.design);
    await deps.workspaces.ensurePractice(record.sessionId, input.challengeId, seed);
    const practised: Record<string, string> = {};
    for (const path of Object.keys(seed)) practised[path] = (await deps.workspaces.readPractice(record.sessionId, input.challengeId, path)) ?? seed[path]!;
    const validationId = randomUUID();
    const root = await deps.workspaces.writeValidation(record.sessionId, validationId, { ...practised, ...record.design.hiddenTests });
    let result: { exitCode: number; stdout: string; stderr: string; durationMs: number };
    try {
      result = await deps.runner.request("run", { root, language: record.design.language, command: "test", timeoutMs: runLimits(record.design.language).timeoutMs }).promise as typeof result;
    } finally {
      await deps.workspaces.removeValidation(record.sessionId, validationId);
    }
    return {
      outcome: result.exitCode === 0 ? "passed" as const : "failed" as const,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      output: runOutput(result.stdout, result.stderr),
      summary: result.exitCode === 0 ? "All visible and hidden tests passed." : "The check failed one or more deterministic tests.",
    };
  });
  ipcMain.handle(ipc.challengeReset, async (_event, value) => {
    const input = challengeIdInput.parse(value);
    const record = practiceTarget(input.challengeId);
    await deps.workspaces.resetPractice(record.sessionId, input.challengeId, seedFiles(record.design));
    return challengeDetail(input.challengeId);
  });

  /* ---- Practice sources ---------------------------------------------------
     Connecting is a sign-in on the source's own page, run by the main process.
     Nothing here ever hands the renderer a session cookie: it asks for a state
     change and is told the state. */
  ipcMain.handle(ipc.sourceInventory, () => deps.practice.inventory());
  ipcMain.handle(ipc.sourceConnect, (_event, value) => deps.practice.connect(sourceConnectionInput.parse(value).source));
  ipcMain.handle(ipc.sourceDisconnect, (_event, value) => deps.practice.disconnect(sourceConnectionInput.parse(value).source));
  ipcMain.handle(ipc.sourceRegion, async (_event, value) => { const input = sourceRegionInput.parse(value); await deps.practice.setRegion(input.source, input.region); });
  ipcMain.handle(ipc.sourceJudge, (_event, value) => { const input = sourceJudgeInput.parse(value); deps.practice.setJudgePreference(input.source, input.preference); });
  ipcMain.handle(ipc.sourceSearch, async (_event, value) => {
    const input = sourceSearchInput.parse(value);
    const found = await deps.practice.search(input);
    return { total: found.total, failed: found.failed, problems: found.problems.map((problem) => ({ source: problem.source, sourceName: problem.source === "leetcode" ? "LeetCode" : "Codeforces", slug: problem.slug, displayId: problem.displayId, title: problem.title, difficulty: problem.difficulty, paidOnly: problem.paidOnly, acceptanceRate: problem.acceptanceRate, concepts: problem.concepts, status: problem.status })) };
  });
  ipcMain.handle(ipc.sourceProblem, async (_event, value) => { const input = sourceSlugInput.parse(value); return (await deps.practice.problem(input.source, input.slug)).problem; });
  /**
   * The learner picking a problem themselves.
   *
   * Opens the problem. It does not ask the agent to go and open the problem.
   *
   * That distinction is the whole of this handler and it used to be the other way
   * round: picking a problem created a session and posted an instruction into it
   * telling the agent to read the problem and assign it. Three things were wrong
   * with that. The instruction was written as a learner message, so the first
   * thing anyone saw on clicking a problem was a paragraph of tool directions
   * addressed to somebody else. The challenge did not exist until a turn had
   * finished, so the fastest path to a problem the learner had already chosen ran
   * through a model round trip. And it could fail — on a rate limit, on no
   * provider, on the agent deciding the adaptive checks said no — leaving a dead
   * session behind for a request that never needed a judgement call.
   *
   * Mounting is deterministic, so it happens here: read the problem, derive the
   * target from it, write the files, create the challenge. The learner lands in
   * the workspace with the problem open.
   *
   * The agent is not cut out of it — it is put *inside* it. Every turn started
   * from this session carries the active challenge, its target and its concepts in
   * context (see `startAgentTurn`), so the first thing the learner says in the
   * workspace reaches an agent that is already looking at what they are looking
   * at. What is gone is only the turn that had to run before anything appeared.
   *
   * No provider guard either, and that is deliberate rather than an oversight: a
   * mounted problem is readable, editable, runnable and submittable with no model
   * anywhere near it. Refusing to open one because no provider is connected would
   * withhold the part of the app that does not need one.
   */
  ipcMain.handle(ipc.sourceStart, async (_event, value) => {
    const input = sourceStartInput.parse(value);
    return openChosenProblem(deps, { source: input.source, slug: input.slug, language: input.language });
  });
  /**
   * Running the open challenge at its source, without submitting it.
   *
   * Recorded as a test run, because it is one: the source ran the learner's code
   * against the problem's published cases and said what happened. It is not
   * recorded as a submission, and it does not complete the attempt — nothing here
   * touches their record at the source.
   */
  ipcMain.handle(ipc.sourceRun, async (_event, value) => {
    const input = sourceRunInput.parse(value);
    const bundle = deps.store.submissionBundle(input.attemptId);
    if (!bundle || bundle.session_id !== input.sessionId) throw new Error("That attempt is no longer open.");
    const source = deps.store.readSession(input.sessionId)?.question?.source;
    if (!source) throw new Error("This challenge did not come from a practice source, so there is nowhere to run it.");
    if (source.source === "codeforces") throw new Error("Codeforces has no non-recording remote run. Use Run for the published examples, then Submit for the full Codeforces judge.");
    const code = await deps.workspaces.read(input.sessionId, solutionPath(bundle.design)).catch(() => "");
    if (!code.trim()) throw new Error("There is nothing to run yet.");
    // The problem's own examples, in the judge's wire format. See `judgeCaseBlock`.
    const testcases = await judgeCaseBlock(source, (slug) => deps.practice.judgeInput(source.source, slug));
    if (!testcases) {
      throw new Error(`${source.source === "leetcode" ? "LeetCode" : "Codeforces"} runs a solution against cases you give it, and Spar could not read any published for this problem. Submit instead — the hidden suite runs there.`);
    }
    const verdict = await deps.practice.run({ source, code, language: bundle.language, testcases });
    deps.store.appendNextEvent({
      id: randomUUID(), attemptId: input.attemptId, type: "test_run", occurredAt: new Date().toISOString(),
      payload: { scope: "source-run", judge: source.source, exitCode: verdict.outcome === "passed" ? 0 : 1, passed: verdict.outcome === "passed", status: verdict.status, passedCases: verdict.passedCases, totalCases: verdict.totalCases },
      source: "runner", schemaVersion: 1,
    });
    return sourceRunReport(verdict, source.source === "leetcode" ? "LeetCode" : "Codeforces");
  });

  ipcMain.handle(ipc.agentSend, async (_event, value) => {
    const input = value as { sessionId?: unknown; message?: unknown }; const sessionId = zUuid(input.sessionId); if (typeof input.message !== "string" || !input.message.trim()) throw new Error("Message is required");
    clearAutoResume(sessionId);
    if(deps.store.pendingIntake(sessionId)){
      deps.store.answerIntake(sessionId,input.message.trim());
      /* An answer given while a challenge is open is context for that challenge,
         not the start of a session: the agent asked something about work in
         progress, and a session-start turn would try to publish a second
         challenge over the one the learner is still on. */
      const answered=deps.store.readSession(sessionId);
      if(answered&&openQuestion(answered)){
        return startAgentTurn(sessionId,`The learner answered your question: ${input.message.trim()}\nUse it as evidence about the challenge they are working on now. A challenge is already active, so do not create another one.`,"learner","learner-message");
      }
      return startAgentTurn(sessionId,`The learner answered the cold-start placement question: ${input.message.trim()}\nUse this as explicit prerequisite and confidence evidence. Now set an accessible session objective and first Training Target, then create a foundation-level question that teaches or calibrates before assuming advanced knowledge.`,"learner","session-start");
    }
    const session=deps.store.readSession(sessionId);
    const turnKind=session?.question&&requestsChallengeRevision(input.message,session.messages)?"challenge-revision":"learner-message";
    return startAgentTurn(sessionId,input.message.trim(),"learner",turnKind);
  });
  /**
   * A submission judged by the source that wrote the problem.
   *
   * The same shape as the local path and the same events, so nothing downstream —
   * the replay, the ability update, the next turn — needs to know which judge
   * answered. What differs is only what is true: the hidden cases are the
   * source's, the verdict is the source's, and a pass here means the problem was
   * actually solved rather than that Spar's copy of two examples was satisfied.
   *
   * A judge that fails is recorded as nothing at all. `errored` is not a failed
   * submission — it is LeetCode being down or rate-limiting — and writing it into
   * the attempt would put an outage into the learner's evidence.
   */
  const submitToSource = async (input: { sessionId: string; attemptId: string; bundle: NonNullable<ReturnType<LocalStore["submissionBundle"]>>; source: NonNullable<NonNullable<ReturnType<LocalStore["readSession"]>>["question"]>["source"] }) => {
    const { sessionId, attemptId, bundle } = input;
    const source = input.source!;
    const path = solutionPath(bundle.design);
    const code = await deps.workspaces.read(sessionId, path).catch(() => "");
    if (!code.trim()) throw new Error("There is nothing to submit yet.");
    const verdict = await deps.practice.submit({ source, code, language: bundle.language });
    const append = (type: "submission_created" | "test_run" | "submission_evaluated" | "attempt_completed", payload: Record<string, unknown>, from: "learner" | "runner" | "system") =>
      deps.store.appendNextEvent({ id: randomUUID(), attemptId, type, occurredAt: new Date().toISOString(), payload, source: from, schemaVersion: 1 });
    const name = source.source === "leetcode" ? "LeetCode" : "Codeforces";
    if (verdict.outcome === "errored") {
      /* Not recorded. The learner is told plainly and their attempt is exactly
         where it was, because an outage is not something they did. */
      return { outcome: "failed" as const, exitCode: 1, durationMs: 0, output: verdict.status, summary: `${name} could not judge that submission (${verdict.status}). Nothing was recorded — try again in a moment.` };
    }
    append("submission_created", { questionId: bundle.question_id, judge: source.source, url: verdict.submissionUrl }, "learner");
    append("test_run", {
      scope: "source-submission", judge: source.source, exitCode: verdict.outcome === "passed" ? 0 : 1, passed: verdict.outcome === "passed",
      status: verdict.status, passedCases: verdict.passedCases, totalCases: verdict.totalCases,
      ...(verdict.failedCase ? { failedCase: verdict.failedCase } : {}),
      ...(verdict.runtime ? { runtime: verdict.runtime } : {}),
      ...(verdict.memory ? { memory: verdict.memory } : {}),
    }, "runner");
    append("submission_evaluated", { outcome: verdict.outcome, judge: source.source, status: verdict.status, url: verdict.submissionUrl }, "system");
    const output = sourceSubmissionOutput(verdict, name);
    if (verdict.outcome === "failed") {
      return { outcome: "failed" as const, exitCode: 1, durationMs: 0, output, summary: `${name} says ${verdict.status}${verdict.totalCases ? ` — ${verdict.passedCases} of ${verdict.totalCases} cases passed` : ""}. Keep going and submit again, or give up to move on.` };
    }
    append("attempt_completed", { outcome: "passed", judge: source.source }, "system");
    deps.store.completeAttempt(attemptId, "passed");
    void startAgentTurn(sessionId, `The learner solved attempt ${attemptId} — ${name} accepted their submission against every hidden case it has (${verdict.status}${verdict.runtime ? `, ${verdict.runtime}` : ""}). This was a real problem from ${name}, not one you wrote, so the verdict is theirs and it is stronger evidence than a local pass. Replay attempt ${attemptId} first and read how they got here, then read its recorded evaluation, update the relevant ability document, commit exactly one next pedagogical action, and either ask about a specific moment the replay could not explain or aim the next target and challenge. Prefer another real problem when one fits the target.`, "system", "attempt-complete");
    return { outcome: "passed" as const, exitCode: 0, durationMs: 0, output, summary: `${name} accepted it${verdict.runtime ? ` — ${verdict.runtime}` : ""}. Every hidden case passed.` };
  };

  ipcMain.handle(ipc.attemptSubmit,async(_event,value)=>{const input=value as {sessionId?:unknown;attemptId?:unknown};const sessionId=zUuid(input.sessionId);const attemptId=zUuid(input.attemptId);const bundle=deps.store.submissionBundle(attemptId);
    /* Only an active attempt can be submitted, and submitting completes it — so
       the ordinary way to arrive here twice is a second submission of an attempt
       that already has its verdict. Said as that, rather than as a lookup miss. */
    if(!bundle||bundle.session_id!==sessionId)throw new Error(deps.store.attemptSubject(attemptId)?"This attempt has already been graded. Spar is preparing what comes next.":"That attempt no longer exists.");
    /* A challenge from a source with a judge behind it is graded there, by the
       people who wrote the hidden cases. Everything after the verdict is the same
       either way — the same events, the same completion, the same turn — because
       the ability ledger must not be able to tell where a pass came from beyond
       what the evidence itself says. */
    const submissionSource=deps.store.readSession(sessionId)?.question?.source;
    if(submissionSource?.remoteJudge)return submitToSource({sessionId,attemptId,bundle,source:submissionSource});
    const workspaceFiles:Record<string,string>={};for(const file of await deps.workspaces.list(sessionId))workspaceFiles[file]=await deps.workspaces.read(sessionId,file);const validationId=randomUUID();const root=await deps.workspaces.writeValidation(sessionId,validationId,{...workspaceFiles,...bundle.design.hiddenTests});let result:{exitCode:number;stdout:string;stderr:string;durationMs:number};try{result=await deps.runner.request("run",{root,language:bundle.language,command:"test",timeoutMs:runLimits(bundle.language).timeoutMs}).promise as typeof result;}finally{await deps.workspaces.removeValidation(sessionId,validationId);}const append=(type:"submission_created"|"test_run"|"submission_evaluated"|"attempt_completed",payload:Record<string,unknown>,source:"learner"|"runner"|"system")=>deps.store.appendNextEvent({id:randomUUID(),attemptId,type,occurredAt:new Date().toISOString(),payload,source,schemaVersion:1});append("submission_created",{questionId:bundle.question_id},"learner");const output=runOutput(result.stdout,result.stderr);append("test_run",{scope:"visible-and-hidden",exitCode:result.exitCode,passed:result.exitCode===0,durationMs:result.durationMs,...runEvidence(output)},"runner");const outcome=result.exitCode===0?"passed":"failed";append("submission_evaluated",{outcome,exitCode:result.exitCode},"system");
    /* A failed submission leaves the attempt open. Solving it is the point, so a
       wrong answer is a step in the attempt rather than the end of it: the learner
       keeps working and submits again, every submission is recorded as evidence,
       and Spar is not asked to judge a challenge that is still being solved.
       Giving up is the other way out, and it is the learner's decision. */
    if(outcome==="failed")return{outcome,exitCode:result.exitCode,durationMs:result.durationMs,output,summary:"Some tests still fail. Keep going and submit again, or give up to move on."};
    append("attempt_completed",{outcome},"system");deps.store.completeAttempt(attemptId,outcome);void startAgentTurn(sessionId,`The learner solved attempt ${attemptId} — every visible and hidden test passes. They may have submitted several times before this one; every one of those is in the attempt's log. Replay attempt ${attemptId} first and read how they got here — which cases they fixed, which they never passed, which they broke, and when — then read its recorded evaluation, update the relevant ability document, commit exactly one next pedagogical action, and either ask the learner about a specific moment the replay could not explain or aim the next target and validated question. The verdict is already known; what you are looking for is the behaviour behind it. The new target and question must explicitly respond to this attempt without overreacting to it.`,"system","attempt-complete");return{outcome,exitCode:result.exitCode,durationMs:result.durationMs,output,summary:"All visible and hidden tests passed."};});
  /* Validated here rather than trusted from the window: the renderer is the one
     process in Spar that runs anybody's markdown, and this is the channel that
     spends credentials. The union is the same one the form switches on. */
  ipcMain.handle(ipc.authRequest, async (_event, value) => {
    const result = await deps.auth.request(authRequestInput.parse(value));
    if (result.status !== "signed-in") return result;
    /* An account that has signed in before has a profile and a history waiting on
       the server, and this device may hold neither — it is a new machine, or the
       same one after a sign-out, which empties it by design. So the pull happens
       here, before the window is told anything: the sign-in button's spinner is
       already built to wait across this call, and it is the only moment where
       "does this account need onboarding" can be answered truthfully.

       A brand-new account skips it. There is nothing to restore, and a round trip
       to find that out would only delay the intake it is about to be shown. */
    const restored = deps.auth.signedUpThisSession() ? "idle" as const : await deps.restore.run();
    /* The window grows to whatever comes next — the intake for a new account, the
       app for one that has already done it. Done here rather than from the
       renderer because the size of the window is not the renderer's to decide,
       and this is where signing in is known to have actually happened.

       A failed restore is deliberately *not* sent to the intake. The device does
       not know whether this account has been onboarded, and asking would overwrite
       a real profile with a second answer to the same questions. */
    fitWindowTo(deps.window(), deps.store.getProfile() || restored === "failed" ? "app" : "onboarding");
    return result;
  });
  /* Suggestions are drafted, never stored: until the learner opens one it is not
     evidence about them, and the intake it came from is already on disk. */
  ipcMain.handle(ipc.sessionsSuggest, async () => {
    const profile = deps.store.getProfile();
    if (!profile) throw new Error("Finish the intake before Spar drafts sessions");
    const account = await deps.auth.account();
    const token = account ? await deps.auth.accessToken() : null;
    const providers = account ? await deps.providers.resolve(account.id, token) : [];
    if (!providers.length) return { source: "starter" as const, suggestions: starterSuggestions(profile) };
    try {
      const value = await deps.agent.request("suggest", { profile, count: SUGGESTION_COUNT, provider: providers[0] }).promise as { text?: string };
      const drafted = parseSuggestions(value.text ?? "");
      return drafted.length ? { source: "agent" as const, suggestions: drafted } : { source: "starter" as const, suggestions: starterSuggestions(profile) };
    } catch {
      // A provider that is down is not a reason to strand someone at the end of
      // their intake; they get the starter set and the UI says which it is.
      return { source: "starter" as const, suggestions: starterSuggestions(profile) };
    }
  });
  /* The end of the intake is the moment Spar becomes a workspace rather than a
     card, so it is where the window opens out. */
  ipcMain.handle(ipc.profileSave, (_event, value) => { const input = profileInput.parse(value); const profile = { ...input, completedAt: new Date().toISOString() }; deps.store.saveProfile(profile); fitWindowTo(deps.window(), "app"); return profile; });
  ipcMain.handle(ipc.profileLanguage, (_event, value) => { deps.store.setPreferredLanguage(languageSchema.parse(value)); });
  /* Signing out empties the device, not just the keychain. The local store has no
     account column — every read is device-wide — so anything left behind would be
     served straight to whoever signs in next. The outbox is flushed first, while
     the token still authenticates: after the wipe there is no pull path, so work
     that never reached the cloud is gone for good. */
  ipcMain.handle(ipc.authSignOut, async () => {
    await deps.sync.flush().catch(() => undefined);
    await deps.practice.clearAllCredentials();
    await deps.auth.signOut();
    deps.store.clearAccountData();
    await deps.workspaces.clear();
    resetAppearance();
    fitWindowTo(deps.window(), "sign-in");
  });
  ipcMain.handle(ipc.authDeleteAccount, async () => { await deps.auth.deleteAccount(); await deps.practice.clearAllCredentials(); deps.store.clearAccountData(); await deps.workspaces.clear(); resetAppearance(); fitWindowTo(deps.window(), "sign-in"); });
  /* Light or dark is a choice someone made for their account, and the device is
     about to be handed to whoever signs in next — including, often enough, nobody.
     So the window goes back to following the OS, which is what a Spar nobody has
     signed into should look like. */
  const resetAppearance = () => {
    deps.store.setSetting("theme", "system");
    nativeTheme.themeSource = "system";
    deps.window()?.webContents.send("window:theme", "system");
  };
  ipcMain.handle(ipc.settingsSaveSecret, async (_event, value) => {
    const input = providerSettingsInput.parse(value);
    await deps.providers.saveCredential(input);
  });
  ipcMain.handle(ipc.settingsProviders, () => deps.providers.inventory());
  ipcMain.handle(ipc.settingsProviderDisconnect, (_event, value) => deps.providers.disconnect(providerId(value)));
  ipcMain.handle(ipc.settingsProviderDefault, (_event, value) => {
    const input = value as { provider?: unknown; model?: unknown };
    if (typeof input.model !== "string" || !input.model.trim()) throw new Error("Model is required");
    deps.providers.setDefault(providerId(input.provider), input.model.trim());
  });
  ipcMain.handle(ipc.settingsProviderUsage, (_event, value) => deps.providers.subscriptionUsage(providerId(value)));
  ipcMain.handle(ipc.settingsReasoningEffort, (_event, value) => deps.providers.setReasoningEffort(reasoningEffortSchema.parse(value)));
  /* The key goes in and never comes back out. Settings needs to know whether one
     is set and where it came from, which is not the same as needing to read it —
     and a renderer that can read it is one XSS away from exfiltrating it. */
  ipcMain.handle(ipc.settingsWebSearch, async () => ({ source: await deps.web.keySource(), enabled: deps.store.getSetting<boolean>("web-search-enabled", true) }));
  ipcMain.handle(ipc.settingsWebSearchEnabled, (_event, value) => { deps.store.setSetting("web-search-enabled", value === true); });
  ipcMain.handle(ipc.settingsWebSearchSave, async (_event, value) => {
    const key = typeof value === "string" ? value.trim() : "";
    if (!key) throw new Error("An Exa API key is required");
    await deps.auth.saveSecret("exa", key);
  });
  ipcMain.handle(ipc.settingsWebSearchClear, () => deps.auth.deleteSecret("exa"));
  ipcMain.handle(ipc.settingsProviderOauthStart, (_event, value) => deps.providers.startOAuth(providerId(value)));
  ipcMain.handle(ipc.settingsProviderOauthSubmit, (_event, value) => {
    const input = value as { flowId?: unknown; value?: unknown };
    if (typeof input.flowId !== "string" || typeof input.value !== "string") throw new Error("OAuth flow and value are required");
    deps.providers.submitOAuth(input.flowId, input.value);
  });
  ipcMain.handle(ipc.settingsProviderOauthCancel, (_event, value) => {
    if (typeof value !== "string") throw new Error("OAuth flow is required");
    deps.providers.cancelOAuth(value);
  });
  ipcMain.handle(ipc.settingsOpenExternal, async (_event, value) => {
    if (typeof value !== "string") throw new Error("URL is required");
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("Only HTTPS links can be opened");
    await shell.openExternal(url.toString());
  });
  ipcMain.handle(ipc.settingsTheme, (_event, value) => {
    const theme = themePreferenceSchema.parse(value);
    deps.store.setSetting("theme", theme);
    nativeTheme.themeSource = theme;
  });
}
const SUGGESTION_COUNT = 3;
/** One sentence for every refusal to run a turn, so the renderer can recognise
 *  it and the learner reads the same instruction wherever they hit it. */
const NO_PROVIDER = "Connect a model provider in Settings before starting Spar";

/** Models fence JSON however they like. Take the outermost array and let the
 *  schema throw the rest away; a malformed draft falls back to the starter set. */
function parseSuggestions(text: string): SessionSuggestion[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = z.array(sessionSuggestionSchema).safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data.slice(0, SUGGESTION_COUNT) : [];
  } catch {
    return [];
  }
}

/** No provider, or one that failed: the intake still says enough to open a door.
 *  Written from the learner's own answers rather than a canned list, but the
 *  renderer labels these as starting points, not as drafted for them. */
function starterSuggestions(profile: LearnerProfile): SessionSuggestion[] {
  const depth = profile.experience === "new" ? "I want to build the basics of" : profile.experience === "senior" ? "I want to pressure-test how I reason about" : "I want to get reliably good at";
  const areas = profile.focus.length ? profile.focus : ["Debugging", "Data structures", "Testing"];
  const seeds = areas.slice(0, profile.weakness.trim() ? SUGGESTION_COUNT - 1 : SUGGESTION_COUNT).map((area) => ({
    title: area,
    goal: `${depth} ${area.toLowerCase()}.`,
    why: "From the focus you picked during intake.",
  }));
  const weakness = profile.weakness.trim();
  return weakness
    ? [{ title: "Your stated weak spot", goal: weakness, why: "Straight from what you told Spar you get stuck on." }, ...seeds]
    : seeds;
}

/**
 * A submission's own output, for the result panel to read as test cases. The
 * head is kept rather than the tail: the TAP header and the earliest failures
 * are what the panel parses, and a run long enough to be cut has already said
 * everything the learner needs before the cut.
 */
const MAX_SUBMIT_OUTPUT = 200_000;
function runOutput(stdout: string, stderr: string) {
  const combined = `${stdout}${stderr ? `${stdout.endsWith("\n") || !stdout ? "" : "\n"}${stderr}` : ""}`;
  return combined.length > MAX_SUBMIT_OUTPUT
    ? `${combined.slice(0, MAX_SUBMIT_OUTPUT)}\n…output truncated.\n`
    : combined;
}

/**
 * The one file a sourced challenge's solution lives in.
 *
 * A mounted problem has exactly one starter file by construction — the source
 * publishes one function to write — so this is a lookup rather than a guess. It
 * falls back to the first starter file for the same reason `submittableCode`
 * falls back to the whole file: the learner's work has to reach the judge even
 * when the layout is not what was expected.
 */
function solutionPath(design: { starterFiles: Record<string, string> }): string {
  const paths = Object.keys(design.starterFiles);
  return paths.find((path) => /(^|\/)src\//.test(path)) ?? paths[0] ?? "src/solution.js";
}

/** A judged run at the source, as the result panel reads it. */
function sourceRunReport(verdict: PracticeVerdict, sourceName: string): SourceRunReport {
  return {
    outcome: verdict.outcome,
    status: verdict.status,
    passedCases: verdict.passedCases,
    totalCases: verdict.totalCases,
    runtime: verdict.runtime,
    memory: verdict.memory,
    failedCase: verdict.failedCase,
    cases: verdict.caseAnswers.map((entry) => ({ input: entry.input, expected: entry.expected, actual: entry.actual, passed: entry.passed })),
    url: verdict.submissionUrl,
    message: verdict.outcome === "errored"
      ? `${sourceName} could not run that (${verdict.status}). Nothing was recorded.`
      : verdict.outcome === "passed"
        ? `${sourceName} ran it against ${verdict.totalCases || verdict.caseAnswers.length} published case${(verdict.totalCases || verdict.caseAnswers.length) === 1 ? "" : "s"} and they all passed. Submit to run it against every hidden case.`
        : `${sourceName} says ${verdict.status}${verdict.totalCases ? ` — ${verdict.passedCases} of ${verdict.totalCases} cases passed` : ""}.`,
  };
}

/**
 * The last phase's own words are the reply, and the reply is stored as the
 * message body. Without dropping it the transcript would show the same sentence
 * twice: once as a mid-turn note and again as the answer.
 */
function withoutFinalReply(activity: AgentActivityStep[], reply: string): AgentActivityStep[] {
  const body = reply.trim();
  if (!body) return activity;
  const last = activity.at(-1);
  if (last?.kind !== "note") return activity;
  const said = last.text.trim();
  return said && (body.startsWith(said) || said.startsWith(body)) ? activity.slice(0, -1) : activity;
}

/**
 * Whether the session has a challenge the learner is still on.
 *
 * `readSession` returns the newest question whatever became of it, so a solved
 * one is still there — and treating that as active is what made an
 * attempt-complete turn look like a session that already had a challenge. The
 * attempt's own completion is the honest signal: while it is open the learner can
 * still submit, and once it closes the session is waiting for what comes next.
 */
function openQuestion(session: { question: { attemptCompletedAt: string | null } | null }): boolean {
  return Boolean(session.question && !session.question.attemptCompletedAt);
}

function zUuid(value: unknown) { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid identifier"); return value; }
function providerId(value: unknown): ProviderId {
  if (typeof value !== "string" || !["openai-codex","claude-code","github-copilot","openai","anthropic","google","xai","openrouter","cline","opencode","opencode-go","deepseek","minimax","moonshotai","kimi-coding","zai","vercel-ai-gateway","cloudflare-ai-gateway","ollama","lm-studio","custom"].includes(value)) throw new Error("Unknown provider");
  return value as ProviderId;
}
