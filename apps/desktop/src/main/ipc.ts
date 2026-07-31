import { BrowserWindow, ipcMain } from "electron";
import { attemptEventSchema, sessionCheckpointSchema } from "@pracai/domain";
import { createSessionInput, ipc, runInput, workspacePathInput, workspaceWriteInput } from "../shared/api.js";
import type { AuthService } from "./auth.js";
import type { LocalStore } from "./store.js";
import type { UtilityClient } from "./utilityClient.js";
import type { WorkspaceService } from "./workspaces.js";

export function installIpc(deps: { store: LocalStore; workspaces: WorkspaceService; auth: AuthService; runner: UtilityClient; agent: UtilityClient; window: () => BrowserWindow | null }) {
  ipcMain.handle(ipc.bootstrap, async () => ({ account: await deps.auth.account(), sessions: deps.store.listSessions(), theme: deps.store.getSetting("theme", "system"), syncState: "offline" }));
  ipcMain.handle(ipc.sessionsCreate, (_event, value) => { const input = createSessionInput.parse(value); return deps.store.createSession(input.goal); });
  ipcMain.handle(ipc.sessionsOpen, (_event, sessionId) => deps.store.readSession(zUuid(sessionId)));
  ipcMain.handle(ipc.checkpointSave, (_event, value) => deps.store.saveCheckpoint(sessionCheckpointSchema.parse(value)));
  ipcMain.handle(ipc.attemptAppend, (_event, value) => deps.store.appendEvent(attemptEventSchema.parse(value)));
  ipcMain.handle(ipc.workspaceRead, (_event, value) => { const input = workspacePathInput.parse(value); return deps.workspaces.read(input.sessionId, input.path); });
  ipcMain.handle(ipc.workspaceWrite, (_event, value) => { const input = workspaceWriteInput.parse(value); return deps.workspaces.write(input.sessionId, input.path, input.content); });
  ipcMain.handle(ipc.runnerRun, (_event, value) => { const input = runInput.parse(value); const request = deps.runner.request("run", { ...input, root: deps.workspaces.sessionRoot(input.sessionId) }); void request.promise.catch((error) => deps.window()?.webContents.send("runner:event", { id: request.id, stream: "stderr", data: String(error) })); return { id: request.id }; });
  ipcMain.handle(ipc.agentSend, async (_event, value) => {
    const input = value as { sessionId?: unknown; message?: unknown }; const sessionId = zUuid(input.sessionId); if (typeof input.message !== "string" || !input.message.trim()) throw new Error("Message is required");
    const account = await deps.auth.account(); const token = await deps.auth.accessToken(); const byok = await deps.auth.readSecret("openai");
    const provider = byok ? { model: deps.store.getSetting("provider-model", "gpt-4.1"), baseUrl: deps.store.getSetting("provider-base-url", "https://api.openai.com/v1"), apiKey: byok } : token ? { model: "practice-training", baseUrl: `${process.env.PRACTICE_API_ORIGIN ?? "http://localhost:4318"}/v1/ai`, apiKey: token } : null;
    if (!provider || !account) throw new Error("Sign in or configure a provider key before starting the Training Agent");
    const session = deps.store.readSession(sessionId); const request = deps.agent.request("turn", { message: input.message, context: JSON.stringify({ session: session?.summary, checkpoint: session?.checkpoint, accountId: account.id }), provider });
    void request.promise.then(() => deps.window()?.webContents.send("agent:event", { runId: request.id, type: "done" })).catch((error) => deps.window()?.webContents.send("agent:event", { runId: request.id, type: "error", text: String(error) }));
    return { runId: request.id };
  });
  ipcMain.handle(ipc.authStart, (_event, value) => { const input = value as { provider: "email" | "google" | "github"; email?: string }; return deps.auth.start(input.provider, input.email); });
  ipcMain.handle(ipc.authSignOut, () => deps.auth.signOut());
  ipcMain.handle(ipc.settingsSaveSecret, (_event, value) => { const input = value as { account?: unknown; secret?: unknown }; if (typeof input.account !== "string" || typeof input.secret !== "string" || input.secret.length < 8) throw new Error("Invalid provider secret"); return deps.auth.saveSecret(input.account, input.secret); });
}
function zUuid(value: unknown) { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid identifier"); return value; }

