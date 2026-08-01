import { BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import { randomUUID } from "node:crypto";
import { sessionCheckpointSchema } from "@spar/domain";
import { attemptAppendInput, createSessionInput, ipc, providerSettingsInput, runInput, themePreferenceSchema, workspacePathInput, workspaceWriteInput, type ProviderId } from "../shared/api.js";
import type { AuthService } from "./auth.js";
import type { LocalStore } from "./store.js";
import type { UtilityClient } from "./utilityClient.js";
import type { WorkspaceService } from "./workspaces.js";
import type { ProviderService } from "./provider.js";

export function installIpc(deps: { store: LocalStore; workspaces: WorkspaceService; auth: AuthService; providers: ProviderService; runner: UtilityClient; agent: UtilityClient; window: () => BrowserWindow | null }) {
  const activeAgentRuns = new Map<string, string>();
  // Reservation is set before credential/provider awaits. Without it, the
  // renderer's planning poll can launch several turns for one session.
  const startingAgentRuns = new Map<string, Promise<{ runId: string }>>();
  const failedPlanningRuns = new Set<string>();
  ipcMain.handle(ipc.bootstrap, async () => ({ account: await deps.auth.account(), sessions: deps.store.listSessions(), theme: themePreferenceSchema.catch("system").parse(deps.store.getSetting("theme", "system")), syncState: "offline" }));
  ipcMain.handle(ipc.sessionsCreate, async (_event, value) => { const input = createSessionInput.parse(value); const created=deps.store.createSession(input.goal);const coldStart=!deps.store.hasRelevantLearnerEvidence(input.goal);await startAgentTurn(created.sessionId,`Start a new adaptive session for this learner goal: ${input.goal}`,"learner",coldStart?"cold-start":"session-start");return created; });
  ipcMain.handle(ipc.sessionsOpen, (_event, sessionId) => {
    const id=zUuid(sessionId);let detail=deps.store.readSession(id);
    if(detail?.summary.status!=="planning"||detail.pendingLearnerQuestion||activeAgentRuns.has(id)||startingAgentRuns.has(id))return detail;
    if(deps.store.resetIncompletePlanning(id)){failedPlanningRuns.delete(id);detail=deps.store.readSession(id);}
    if(!detail)return null;
    if(!deps.store.hasRelevantLearnerEvidence(detail.summary.originalGoal)){if(!failedPlanningRuns.has(id))void startAgentTurn(id,`Resume placement for this learner goal: ${detail.summary.originalGoal}. Ask one focused prerequisite and confidence question before choosing a target.`,"system","cold-start");return detail;}
    if(!failedPlanningRuns.has(id))void startAgentTurn(id,`Resume this persisted planning session for goal: ${detail.summary.originalGoal}. Re-evaluate the goal from relevant evidence and commit one fresh target.` ,"system","session-start");
    return detail;
  });
  ipcMain.handle(ipc.checkpointSave, (_event, value) => deps.store.saveCheckpoint(sessionCheckpointSchema.parse(value)));
  ipcMain.handle(ipc.attemptAppend, (_event, value) => deps.store.appendNextEvent(attemptAppendInput.parse(value)));
  ipcMain.handle(ipc.workspaceRead, (_event, value) => { const input = workspacePathInput.parse(value); return deps.workspaces.read(input.sessionId, input.path); });
  ipcMain.handle(ipc.workspaceWrite, (_event, value) => { const input = workspaceWriteInput.parse(value); return deps.workspaces.write(input.sessionId, input.path, input.content); });
  ipcMain.handle(ipc.runnerRun, (_event, value) => { const input = runInput.parse(value); const request = deps.runner.request("run", { ...input, root: deps.workspaces.sessionRoot(input.sessionId) }); void request.promise.catch((error) => deps.window()?.webContents.send("runner:event", { id: request.id, stream: "stderr", data: String(error) })); return { id: request.id }; });
  const startAgentTurn=async(sessionId:string,message:string,role:"learner"|"system"="learner",turnKind:"cold-start"|"session-start"|"attempt-complete"|"learner-message"="learner-message")=>{
    const activeRunId=activeAgentRuns.get(sessionId);if(activeRunId)return{runId:activeRunId};
    const starting=startingAgentRuns.get(sessionId);if(starting)return starting;
    const launch=(async()=>{
      failedPlanningRuns.delete(sessionId);deps.store.addMessage(sessionId,role,message);
      const account=await deps.auth.account();const token=await deps.auth.accessToken();
      if(!account)throw new Error("Sign in before starting the Training Agent");
      const providers=await deps.providers.resolve(account.id,token);
      if(!providers.length)throw new Error("Connect a model provider in Settings before starting the Training Agent");
      const session=deps.store.readSession(sessionId);if(!session)throw new Error("Session not found");
      const target=deps.store.latestTarget(sessionId);const defaultObjective="Investigating your prior evidence and defining the first training target.";
      const payload={sessionId,message,turnKind,resumeState:{...(session.summary.objective!==defaultObjective?{objective:{committed:true,objective:session.summary.objective}}:{}),...(target?{target:{committed:true,...target}}:{})},context:JSON.stringify({session:session.summary,activeQuestion:session.question,activeTrainingTarget:target,checkpoint:session.checkpoint,relevantAbilitySummary:deps.store.searchLearner(session.summary.originalGoal,4),accountId:account.id})};
      const first=deps.agent.request("turn",{...payload,provider:providers[0]});activeAgentRuns.set(sessionId,first.id);
      const attempt=async(request:ReturnType<UtilityClient["request"]>,index:number):Promise<void>=>{try{const value=await request.promise as {text?:string};if(value.text?.trim())deps.store.addMessage(sessionId,"agent",value.text.trim());activeAgentRuns.delete(sessionId);deps.window()?.webContents.send("agent:event",{runId:request.id,type:"done"});}catch(error){const next=providers[index+1];if(next){deps.store.addMessage(sessionId,"system",`Provider ${providers[index]?.provider??"unknown"} failed; retrying this turn with ${next.provider}.`);const retry=deps.agent.request("turn",{...payload,provider:next});activeAgentRuns.set(sessionId,retry.id);return attempt(retry,index+1);}activeAgentRuns.delete(sessionId);if(turnKind==="session-start"){deps.store.resetIncompletePlanning(sessionId);failedPlanningRuns.add(sessionId);}deps.window()?.webContents.send("agent:event",{runId:request.id,type:"error",text:error instanceof Error?error.message:String(error)});}};
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

  ipcMain.handle(ipc.agentSend, async (_event, value) => {
    const input = value as { sessionId?: unknown; message?: unknown }; const sessionId = zUuid(input.sessionId); if (typeof input.message !== "string" || !input.message.trim()) throw new Error("Message is required");
    if(deps.store.pendingIntake(sessionId)){deps.store.answerIntake(sessionId,input.message.trim());return startAgentTurn(sessionId,`The learner answered the cold-start placement question: ${input.message.trim()}\nUse this as explicit prerequisite and confidence evidence. Now set an accessible session objective and first Training Target, then create a foundation-level question that teaches or calibrates before assuming advanced knowledge.`,"learner","session-start");}
    return startAgentTurn(sessionId,input.message.trim(),"learner","learner-message");
  });
  ipcMain.handle(ipc.attemptSubmit,async(_event,value)=>{const input=value as {sessionId?:unknown;attemptId?:unknown};const sessionId=zUuid(input.sessionId);const attemptId=zUuid(input.attemptId);const bundle=deps.store.submissionBundle(attemptId);if(!bundle||bundle.session_id!==sessionId)throw new Error("Active attempt not found");const workspaceFiles:Record<string,string>={};for(const file of await deps.workspaces.list(sessionId))workspaceFiles[file]=await deps.workspaces.read(sessionId,file);const validationId=randomUUID();const root=await deps.workspaces.writeValidation(sessionId,validationId,{...workspaceFiles,...bundle.design.hiddenTests});let result:{exitCode:number;stdout:string;stderr:string;durationMs:number};try{result=await deps.runner.request("run",{root,language:bundle.language,command:"test",timeoutMs:8000}).promise as typeof result;}finally{await deps.workspaces.removeValidation(sessionId,validationId);}const append=(type:"submission_created"|"test_run"|"submission_evaluated"|"attempt_completed",payload:Record<string,unknown>,source:"learner"|"runner"|"system")=>deps.store.appendNextEvent({id:randomUUID(),attemptId,type,occurredAt:new Date().toISOString(),payload,source,schemaVersion:1});append("submission_created",{questionId:bundle.question_id},"learner");append("test_run",{scope:"visible-and-hidden",exitCode:result.exitCode,durationMs:result.durationMs},"runner");const outcome=result.exitCode===0?"passed":"failed";append("submission_evaluated",{outcome,exitCode:result.exitCode},"system");append("attempt_completed",{outcome},"system");deps.store.completeAttempt(attemptId,outcome);void startAgentTurn(sessionId,`The learner submitted attempt ${attemptId}. Deterministic visible and hidden tests produced outcome ${outcome} with exit code ${result.exitCode}. Inspect the attempt events and remarks, evaluate the evidence, update the relevant ability document, commit exactly one next pedagogical action, then create the next validated question from that decision. The new target and question must explicitly respond to this attempt without overreacting to it.`,"system","attempt-complete");return{outcome,exitCode:result.exitCode,summary:outcome==="passed"?"All visible and hidden tests passed.":"The submission failed one or more deterministic tests."};});
  ipcMain.handle(ipc.authPassword, async (_event, value) => { const input = value as { mode: "sign-in" | "sign-up"; email?: unknown; password?: unknown }; if ((input.mode !== "sign-in" && input.mode !== "sign-up") || typeof input.email !== "string" || typeof input.password !== "string") throw new Error("Email and password are required"); return deps.auth.password(input.mode, input.email, input.password); });
  ipcMain.handle(ipc.authSignOut, () => deps.auth.signOut());
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
function zUuid(value: unknown) { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid identifier"); return value; }
function providerId(value: unknown): ProviderId {
  if (typeof value !== "string" || !["openai-codex","claude-code","github-copilot","openai","anthropic","google","xai","openrouter","opencode","opencode-go","deepseek","minimax","moonshotai","kimi-coding","zai","vercel-ai-gateway","cloudflare-ai-gateway","ollama","lm-studio","custom"].includes(value)) throw new Error("Unknown provider");
  return value as ProviderId;
}
