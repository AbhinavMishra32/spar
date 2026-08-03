import { BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { languageSchema, sessionCheckpointSchema, sessionSuggestionSchema, type ChallengeDetail, type LearnerProfile, type SessionSuggestion } from "@spar/domain";
import { attemptAppendInput, challengeIdInput, challengeWriteInput, createSessionInput, ipc, practiceInput, profileInput, providerSettingsInput, reasoningEffortSchema, runInput, sessionFlagInput, sessionRenameInput, sessionStatusInput, themePreferenceSchema, workspacePathInput, workspaceWriteInput, type ProviderId } from "../shared/api.js";
import { challengeFiles, challengeTimeline, seedFiles } from "./challengeFiles.js";
import type { AuthService } from "./auth.js";
import type { LocalStore } from "./store.js";
import type { UtilityClient } from "./utilityClient.js";
import type { WorkspaceService } from "./workspaces.js";
import type { ProviderService } from "./provider.js";
import type { CloudSyncService } from "./sync.js";
import { requestsChallengeRevision } from "./agentIntent.js";
import type { AgentTurnKind } from "../workers/agentPolicy.js";

export function installIpc(deps: { store: LocalStore; workspaces: WorkspaceService; auth: AuthService; providers: ProviderService; runner: UtilityClient; agent: UtilityClient; agentRunSessions: Map<string, string>; sync: CloudSyncService; window: () => BrowserWindow | null }) {
  const activeAgentRuns = new Map<string, string>();
  // Reservation is set before credential/provider awaits. Without it, the
  // renderer's planning poll can launch several turns for one session.
  const startingAgentRuns = new Map<string, Promise<{ runId: string }>>();
  const failedPlanningRuns = new Set<string>();
  ipcMain.handle(ipc.bootstrap, async () => ({ account: await deps.auth.account(), profile: deps.store.getProfile(), sessions: deps.store.listSessions(), challenges: deps.store.listChallenges(), abilities: deps.store.listAbilities(), concepts: deps.store.listConcepts(), theme: themePreferenceSchema.catch("system").parse(deps.store.getSetting("theme", "system")), syncState: "offline" }));
  /* Checked before the session row exists, not after: a session created for a
     turn that can never run is a dead entry in the sidebar that the learner has
     to clean up to make the error go away. */
  ipcMain.handle(ipc.sessionsCreate, async (_event, value) => { const input = createSessionInput.parse(value); if(!await deps.providers.available())throw new Error(NO_PROVIDER); const created=deps.store.createSession(input.goal);const coldStart=!deps.store.hasRelevantLearnerEvidence(input.goal);await startAgentTurn(created.sessionId,`Start a new adaptive session for this learner goal: ${input.goal}`,"learner",coldStart?"cold-start":"session-start");return created; });
  ipcMain.handle(ipc.sessionsOpen, (_event, sessionId) => {
    const id=zUuid(sessionId);let detail=deps.store.readSession(id);
    if(detail?.summary.status!=="planning"||detail.pendingLearnerQuestion||activeAgentRuns.has(id)||startingAgentRuns.has(id))return detail;
    if(deps.store.resetIncompletePlanning(id)){failedPlanningRuns.delete(id);detail=deps.store.readSession(id);}
    if(!detail)return null;
    const placementAnswer=deps.store.answeredIntake(id);
    if(!deps.store.hasRelevantLearnerEvidence(detail.summary.originalGoal)&&!placementAnswer){if(!failedPlanningRuns.has(id))void startAgentTurn(id,`Resume placement for this learner goal: ${detail.summary.originalGoal}. Ask one focused prerequisite and confidence question before choosing a target.`,"system","cold-start");return detail;}
    if(placementAnswer){if(!failedPlanningRuns.has(id))void startAgentTurn(id,`Resume this persisted planning session for goal: ${detail.summary.originalGoal}. The learner already answered the placement question: ${placementAnswer}. Use that answer as explicit prerequisite and confidence evidence; do not ask placement again. Commit one accessible target and create a validated question.`,"system","session-start");return detail;}
    if(!failedPlanningRuns.has(id))void startAgentTurn(id,`Resume this persisted planning session for goal: ${detail.summary.originalGoal}. Re-evaluate the goal from relevant evidence and commit one fresh target.` ,"system","session-start");
    return detail;
  });
  ipcMain.handle(ipc.checkpointSave, (_event, value) => deps.store.saveCheckpoint(sessionCheckpointSchema.parse(value)));
  ipcMain.handle(ipc.attemptAppend, (_event, value) => deps.store.appendNextEvent(attemptAppendInput.parse(value)));
  ipcMain.handle(ipc.workspaceRead, (_event, value) => { const input = workspacePathInput.parse(value); return deps.workspaces.read(input.sessionId, input.path); });
  ipcMain.handle(ipc.workspaceWrite, (_event, value) => { const input = workspaceWriteInput.parse(value); return deps.workspaces.write(input.sessionId, input.path, input.content); });
  ipcMain.handle(ipc.runnerRun, (_event, value) => { const input = runInput.parse(value); const request = deps.runner.request("run", { ...input, root: deps.workspaces.sessionRoot(input.sessionId) }); void request.promise.catch((error) => deps.window()?.webContents.send("runner:event", { id: request.id, stream: "stderr", data: String(error) })); return { id: request.id }; });
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
      failedPlanningRuns.delete(sessionId);deps.store.addMessage(sessionId,role,message);
      const session=deps.store.readSession(sessionId);if(!session)throw new Error("Session not found");
      const target=deps.store.latestTarget(sessionId);const defaultObjective="Investigating your prior evidence and defining the first training target.";
      /* Onboarding is evidence like any other: what the learner said about their
         experience and where they feel weak calibrates the first target, before
         any attempt exists to calibrate it from. `preferredLanguage` is the
         default the instructions read — a stated language in the goal still wins. */
      const profile=deps.store.getProfile();
      const payload={sessionId,message,turnKind,activeQuestion:session.question?{id:session.question.id,attemptId:session.question.attemptId}:null,resumeState:{...(session.summary.objective!==defaultObjective?{objective:{committed:true,objective:session.summary.objective}}:{}),...(turnKind!=="challenge-revision"&&target?{target:{committed:true,...target}}:{})},context:JSON.stringify({session:session.summary,activeQuestion:session.question,activeTrainingTarget:target,checkpoint:session.checkpoint,recentConversation:session.messages.slice(-12),relevantAbilitySummary:deps.store.searchLearner(session.summary.originalGoal,4),accountId:account.id,preferredLanguage:profile?.language??"javascript",learnerProfile:profile?{name:profile.name,experience:profile.experience,focus:profile.focus,statedWeakness:profile.weakness}:null})};
      /* A run is claimed by its session for as long as it is in flight, in two
         places: `activeAgentRuns` guards against a second turn, and
         `agentRunSessions` is what lets the main process stamp a session id onto
         every streamed event — without which a session card that is not open
         could not tell that the agent is working on it. Both are released
         together, and a retried turn hands the claim to the new run id. */
      const claim=(runId:string)=>{activeAgentRuns.set(sessionId,runId);deps.agentRunSessions.set(runId,sessionId);return runId;};
      const release=(runId:string)=>{activeAgentRuns.delete(sessionId);deps.agentRunSessions.delete(runId);};
      const first=deps.agent.request("turn",{...payload,provider:providers[0]});claim(first.id);
      const attempt=async(request:ReturnType<UtilityClient["request"]>,index:number):Promise<void>=>{try{const value=await request.promise as {text?:string};if(value.text?.trim())deps.store.addMessage(sessionId,"agent",value.text.trim());deps.window()?.webContents.send("agent:event",{runId:request.id,sessionId,type:"done"});release(request.id);}catch(error){const next=providers[index+1];if(next){deps.store.addMessage(sessionId,"system",`Provider ${providers[index]?.provider??"unknown"} failed; retrying this turn with ${next.provider}.`);const retry=deps.agent.request("turn",{...payload,provider:next});deps.agentRunSessions.delete(request.id);claim(retry.id);return attempt(retry,index+1);}if(turnKind==="session-start"){deps.store.resetIncompletePlanning(sessionId);failedPlanningRuns.add(sessionId);}deps.window()?.webContents.send("agent:event",{runId:request.id,sessionId,type:"error",text:error instanceof Error?error.message:String(error)});release(request.id);}};
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

  ipcMain.handle(ipc.sessionNextChallenge, async (_event, value) => {
    const sessionId = zUuid((value as { sessionId?: unknown }).sessionId);
    deps.store.setSessionStatus(sessionId, "planning");
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
    failedPlanningRuns.delete(sessionId);
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
    const request = deps.runner.request("run", { root, language: record.design.language, command: "test", timeoutMs: 8_000 });
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
      result = await deps.runner.request("run", { root, language: record.design.language, command: "test", timeoutMs: 8_000 }).promise as typeof result;
    } finally {
      await deps.workspaces.removeValidation(record.sessionId, validationId);
    }
    return {
      outcome: result.exitCode === 0 ? "passed" as const : "failed" as const,
      exitCode: result.exitCode,
      summary: `${result.stdout}\n${result.stderr}`.trim().slice(-12_000),
    };
  });
  ipcMain.handle(ipc.challengeReset, async (_event, value) => {
    const input = challengeIdInput.parse(value);
    const record = practiceTarget(input.challengeId);
    await deps.workspaces.resetPractice(record.sessionId, input.challengeId, seedFiles(record.design));
    return challengeDetail(input.challengeId);
  });

  ipcMain.handle(ipc.agentSend, async (_event, value) => {
    const input = value as { sessionId?: unknown; message?: unknown }; const sessionId = zUuid(input.sessionId); if (typeof input.message !== "string" || !input.message.trim()) throw new Error("Message is required");
    if(deps.store.pendingIntake(sessionId)){deps.store.answerIntake(sessionId,input.message.trim());return startAgentTurn(sessionId,`The learner answered the cold-start placement question: ${input.message.trim()}\nUse this as explicit prerequisite and confidence evidence. Now set an accessible session objective and first Training Target, then create a foundation-level question that teaches or calibrates before assuming advanced knowledge.`,"learner","session-start");}
    const session=deps.store.readSession(sessionId);
    const turnKind=session?.question&&requestsChallengeRevision(input.message,session.messages)?"challenge-revision":"learner-message";
    return startAgentTurn(sessionId,input.message.trim(),"learner",turnKind);
  });
  ipcMain.handle(ipc.attemptSubmit,async(_event,value)=>{const input=value as {sessionId?:unknown;attemptId?:unknown};const sessionId=zUuid(input.sessionId);const attemptId=zUuid(input.attemptId);const bundle=deps.store.submissionBundle(attemptId);if(!bundle||bundle.session_id!==sessionId)throw new Error("Active attempt not found");const workspaceFiles:Record<string,string>={};for(const file of await deps.workspaces.list(sessionId))workspaceFiles[file]=await deps.workspaces.read(sessionId,file);const validationId=randomUUID();const root=await deps.workspaces.writeValidation(sessionId,validationId,{...workspaceFiles,...bundle.design.hiddenTests});let result:{exitCode:number;stdout:string;stderr:string;durationMs:number};try{result=await deps.runner.request("run",{root,language:bundle.language,command:"test",timeoutMs:8000}).promise as typeof result;}finally{await deps.workspaces.removeValidation(sessionId,validationId);}const append=(type:"submission_created"|"test_run"|"submission_evaluated"|"attempt_completed",payload:Record<string,unknown>,source:"learner"|"runner"|"system")=>deps.store.appendNextEvent({id:randomUUID(),attemptId,type,occurredAt:new Date().toISOString(),payload,source,schemaVersion:1});append("submission_created",{questionId:bundle.question_id},"learner");append("test_run",{scope:"visible-and-hidden",exitCode:result.exitCode,passed:result.exitCode===0,durationMs:result.durationMs,summary:`${result.stdout}\n${result.stderr}`.trim().slice(-12000)},"runner");const outcome=result.exitCode===0?"passed":"failed";append("submission_evaluated",{outcome,exitCode:result.exitCode},"system");append("attempt_completed",{outcome},"system");deps.store.completeAttempt(attemptId,outcome);void startAgentTurn(sessionId,`The learner submitted attempt ${attemptId}. Deterministic visible and hidden tests produced outcome ${outcome} with exit code ${result.exitCode}. Inspect the attempt events and test evidence, update the relevant ability document, commit exactly one next pedagogical action, then create the next validated question from that decision. The new target and question must explicitly respond to this attempt without overreacting to it.`,"system","attempt-complete");return{outcome,exitCode:result.exitCode,summary:outcome==="passed"?"All visible and hidden tests passed.":"The submission failed one or more deterministic tests."};});
  ipcMain.handle(ipc.authPassword, async (_event, value) => { const input = value as { mode: "sign-in" | "sign-up"; email?: unknown; password?: unknown }; if ((input.mode !== "sign-in" && input.mode !== "sign-up") || typeof input.email !== "string" || typeof input.password !== "string") throw new Error("Email and password are required"); return deps.auth.password(input.mode, input.email, input.password); });
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
  ipcMain.handle(ipc.profileSave, (_event, value) => { const input = profileInput.parse(value); const profile = { ...input, completedAt: new Date().toISOString() }; deps.store.saveProfile(profile); return profile; });
  ipcMain.handle(ipc.profileLanguage, (_event, value) => { deps.store.setPreferredLanguage(languageSchema.parse(value)); });
  /* Signing out empties the device, not just the keychain. The local store has no
     account column — every read is device-wide — so anything left behind would be
     served straight to whoever signs in next. The outbox is flushed first, while
     the token still authenticates: after the wipe there is no pull path, so work
     that never reached the cloud is gone for good. */
  ipcMain.handle(ipc.authSignOut, async () => {
    await deps.sync.flush().catch(() => undefined);
    await deps.auth.signOut();
    deps.store.clearAccountData();
    await deps.workspaces.clear();
  });
  ipcMain.handle(ipc.authDeleteAccount, async () => { await deps.auth.deleteAccount(); deps.store.clearAccountData(); await deps.workspaces.clear(); });
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

function zUuid(value: unknown) { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid identifier"); return value; }
function providerId(value: unknown): ProviderId {
  if (typeof value !== "string" || !["openai-codex","claude-code","github-copilot","openai","anthropic","google","xai","openrouter","opencode","opencode-go","deepseek","minimax","moonshotai","kimi-coding","zai","vercel-ai-gateway","cloudflare-ai-gateway","ollama","lm-studio","custom"].includes(value)) throw new Error("Unknown provider");
  return value as ProviderId;
}
