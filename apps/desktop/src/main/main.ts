import { app, BrowserWindow } from "electron";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { AuthService } from "./auth.js";
import { installIpc } from "./ipc.js";
import { installMenu } from "./menu.js";
import { LocalStore } from "./store.js";
import { CloudSyncService } from "./sync.js";
import { UtilityClient } from "./utilityClient.js";
import { startUpdates } from "./updates.js";
import { executeTrainingTool } from "./trainingTools.js";
import { createMainWindow } from "./window.js";
import { WorkspaceService } from "./workspaces.js";

let mainWindow: BrowserWindow | null = null;
let store: LocalStore;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  void app.whenReady().then(async () => {
    const root = path.join(app.getPath("userData"), "practice-ai"); await mkdir(path.join(root, "workspaces"), { recursive: true });
    store = new LocalStore(path.join(root, "state.sqlite3")); const apiOrigin=process.env.PRACTICE_API_ORIGIN ?? "http://localhost:4318"; const auth = new AuthService(apiOrigin); const workspaces = new WorkspaceService(path.join(root, "workspaces"));
    const runner = new UtilityClient("runner", (event) => mainWindow?.webContents.send("runner:event", { id: event.requestId, stream: event.stream, data: event.data, exitCode: event.exitCode }));
    const agent = new UtilityClient("agent", (event) => { const value = event.event as Record<string, unknown>; mainWindow?.webContents.send("agent:event", { runId: event.requestId, ...value }); }, (name, input, context) => executeTrainingTool(name, input, context.sessionId, store, workspaces, runner));
    const sync=new CloudSyncService(store,auth,apiOrigin,(state)=>mainWindow?.webContents.send("sync:state",state));sync.start();
    installIpc({ store, workspaces, auth, runner, agent, window: () => mainWindow }); installMenu(() => mainWindow); mainWindow = createMainWindow(); startUpdates(mainWindow);
    app.on("before-quit", () => { sync.stop(); runner.stop(); agent.stop(); store.close(); });
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(); });
  });
}
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
