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
import { CheckpointService } from "./checkpoints.js";
import { RestoreService } from "./restore.js";
import { UtilityClient } from "./utilityClient.js";
import { UpdateService } from "./updates.js";
import { executeTrainingTool } from "./trainingTools.js";
import { WebSearchService } from "./webSearch.js";
import { recordAgentActivity } from "./agentActivity.js";
import { PracticeService } from "./practice.js";
import { ProviderService } from "./provider.js";
import { createMainWindow, fitWindowTo } from "./window.js";
import { WorkspaceService } from "./workspaces.js";
import { themePreferenceSchema } from "../shared/api.js";

let mainWindow: BrowserWindow | null = null;
let store: LocalStore;
let updates: UpdateService | null = null;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  void app.whenReady().then(async () => {
    const root = path.join(app.getPath("userData"), "spar"); await mkdir(path.join(root, "workspaces"), { recursive: true });
    store = new LocalStore(path.join(root, "state.sqlite3")); nativeTheme.themeSource = themePreferenceSchema.catch("system").parse(store.getSetting("theme", "system")); const origin = apiOrigin(); const auth = new AuthService(origin); const workspaces = new WorkspaceService(path.join(root, "workspaces"));
    const providers = new ProviderService(auth, store, (event) => mainWindow?.webContents.send("provider:oauth-event", event));
    /* Where real problems come from. Holds the source's session in the keychain,
       mounts one of its problems as a challenge, and is the only thing in the app
       that knows LeetCode exists. */
    const practice = new PracticeService(auth, store, () => mainWindow, (event) => mainWindow?.webContents.send("practice:event", event));
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
    const agent = new UtilityClient("agent", (event) => { const value = event.event as Record<string, unknown>; if (value?.type === "provider-usage") { providers.recordCodexRateLimits(value.headers as Record<string, string>); return; } const runId = String(event.requestId); recordAgentActivity(runId, value); mainWindow?.webContents.send("agent:event", { runId, sessionId: agentRunSessions.get(runId), ...value }); }, (name, input, context) => executeTrainingTool(name, input, context.sessionId, store, workspaces, runner, web, practice));
    const sync=new CloudSyncService(store,auth,origin,(state)=>mainWindow?.webContents.send("sync:state",state));sync.start();
    /* Writes the checkpoints that make a session resumable on another machine.
       Nothing wrote them before, so `checkpoints` was empty on every install and
       the cloud's copy was empty with it. */
    const checkpoints=new CheckpointService(store,workspaces);
    /* The pull half of sync. Sign-in drives it; this launch path is the resume
       for a device that was interrupted partway through one. */
    const restore=new RestoreService(store,workspaces,auth,origin,(state)=>mainWindow?.webContents.send("restore:state",state));
    /* One idempotent shutdown path is shared by an ordinary quit and an update.
       quitAndInstall closes windows before Electron emits before-quit, so waiting
       until that event to save would race the native installer. The updater
       explicitly awaits this function first; the later event sees the same
       settled promise and cannot close SQLite twice. */
    let shutdown: Promise<void> | null = null;
    const prepareToExit = () => shutdown ??= (async () => {
      practice.stop();
      await checkpoints.flushAll();
      checkpoints.stop();
      sync.stop();
      runner.stop();
      agent.stop();
      updates?.stop();
      store.close();
    })();
    /* Asked before the window exists so it can open at the size it belongs at.
       Opening large and shrinking once the renderer reports in would read as the
       app correcting a mistake in front of the learner.

       A signed-in device with no profile is not necessarily a new account — far
       more often it is a machine that has not finished restoring one. So it opens
       at "restoring" and the pull below settles which of the two it was. */
    const signedIn = Boolean(await auth.account());
    const needsRestore = signedIn && !store.getProfile();
    const stage = !signedIn ? "sign-in" as const : needsRestore ? "restoring" as const : "app" as const;
    installIpc({ store, workspaces, auth, providers, practice, runner, agent, agentRunSessions, sync, checkpoints, restore, web, window: () => mainWindow });
    updates = new UpdateService(store, () => mainWindow, prepareToExit);
    updates.installIpc();
    installMenu(() => mainWindow); installDockIcon(); mainWindow = createMainWindow({ stage }); updates.start();
    /* Started after the window exists, so its progress has somewhere to be
       reported. The renderer holds the restoring screen until this settles. */
    if (needsRestore) void restore.run().then((state) => { if (state !== "failed") fitWindowTo(mainWindow, store.getProfile() ? "app" : "onboarding"); });
    /* Checkpoints are flushed before the store closes: quitting is the one moment
       there is no next debounce tick to wait for, and the session the learner just
       closed the laptop on is exactly the one worth not losing. */
    app.on("before-quit", () => { void prepareToExit(); });
    app.on("activate", async () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow({ stage: !(await auth.account()) ? "sign-in" : store.getProfile() ? "app" : "restoring" }); });
  }).catch((error: unknown) => {
    /* A rejected async Electron event otherwise becomes an unhandled promise and
       leaves a process with a Dock icon but no window. This is the last-resort
       boundary; recoverable dependencies such as Keychain are handled closer to
       their owner, while a genuinely failed bootstrap exits cleanly. */
    console.error("Desktop bootstrap failed:", error);
    app.quit();
  });
}
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
