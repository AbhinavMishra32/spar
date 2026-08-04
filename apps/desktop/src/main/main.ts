import { app, BrowserWindow, nativeTheme } from "electron";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { AuthService } from "./auth.js";
import { apiOrigin } from "./apiOrigin.js";
import { installDockIcon } from "./dockIcon.js";
import { installIpc } from "./ipc.js";
import { installMenu } from "./menu.js";
import { LocalStore } from "./store.js";
import { CloudSyncService } from "./sync.js";
import { UtilityClient } from "./utilityClient.js";
import { startUpdates } from "./updates.js";
import { executeTrainingTool } from "./trainingTools.js";
import { WebSearchService } from "./webSearch.js";
import { recordAgentActivity } from "./agentActivity.js";
import { ProviderService } from "./provider.js";
import { createMainWindow } from "./window.js";
import { WorkspaceService } from "./workspaces.js";
import { themePreferenceSchema } from "../shared/api.js";

let mainWindow: BrowserWindow | null = null;
let store: LocalStore;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  void app.whenReady().then(async () => {
    const root = path.join(app.getPath("userData"), "spar"); await mkdir(path.join(root, "workspaces"), { recursive: true });
    store = new LocalStore(path.join(root, "state.sqlite3")); nativeTheme.themeSource = themePreferenceSchema.catch("system").parse(store.getSetting("theme", "system")); const origin = apiOrigin(); const auth = new AuthService(origin); const workspaces = new WorkspaceService(path.join(root, "workspaces"));
    const providers = new ProviderService(auth, store, (event) => mainWindow?.webContents.send("provider:oauth-event", event));
    const runner = new UtilityClient("runner", (event) => mainWindow?.webContents.send("runner:event", { id: event.requestId, stream: event.stream, data: event.data, exitCode: event.exitCode }));
    /* Which session each in-flight run belongs to. The agent worker reports only
       its own request id, so the routing that lets an unopened session card show
       live work has to be held on this side and stamped on every event. */
    const agentRunSessions = new Map<string, string>();
    /* The learner's own Exa key, read through the same keychain the provider keys
       live in. Held here rather than in the worker: the utility process has no
       keychain access, and a key that crossed into it would also cross into every
       payload the worker serialises. */
    const web = new WebSearchService(() => auth.readSecret("exa"));
    const agent = new UtilityClient("agent", (event) => { const value = event.event as Record<string, unknown>; if (value?.type === "provider-usage") { providers.recordCodexRateLimits(value.headers as Record<string, string>); return; } const runId = String(event.requestId); recordAgentActivity(runId, value); mainWindow?.webContents.send("agent:event", { runId, sessionId: agentRunSessions.get(runId), ...value }); }, (name, input, context) => executeTrainingTool(name, input, context.sessionId, store, workspaces, runner, web));
    const sync=new CloudSyncService(store,auth,origin,(state)=>mainWindow?.webContents.send("sync:state",state));sync.start();
    installIpc({ store, workspaces, auth, providers, runner, agent, agentRunSessions, sync, web, window: () => mainWindow }); installMenu(() => mainWindow); installDockIcon(); mainWindow = createMainWindow(); startUpdates(mainWindow);
    app.on("before-quit", () => { sync.stop(); runner.stop(); agent.stop(); store.close(); });
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(); });
  });
}
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
