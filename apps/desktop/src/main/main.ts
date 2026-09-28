import { SkillService } from "./skills.js";
import { app, BrowserWindow, nativeTheme } from "electron";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { AuthService } from "./auth.js";
import { apiOrigin } from "./apiOrigin.js";
import { installDockIcon } from "./dockIcon.js";
import { installIpc } from "./ipc.js";
import { VisualizerService } from "./visualizer.js";
import { VisualizerToolbox } from "./visualizerTools.js";
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
import { gatedProfile, isolateDevProfile } from "./devProfile.js";
import { AccountFolders, swappable } from "./accounts.js";
import { installArrivalOverlay } from "./arrivalOverlay.js";
import { WorkspaceService } from "./workspaces.js";
import { themePreferenceSchema } from "../shared/api.js";
import { AgentQuestions } from "./agentQuestions.js";
import { AgentTelemetry } from "./agentTelemetry.js";
import { ReviewReminders } from "./reviewReminders.js";

let mainWindow: BrowserWindow | null = null;
let store: LocalStore;
let updates: UpdateService | null = null;

isolateDevProfile();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  void app.whenReady().then(async () => {
    const root = path.join(app.getPath("userData"), "spar"); await mkdir(root, { recursive: true });
    const origin = apiOrigin(); const auth = new AuthService(origin);
    /* Each account on this device has its own folder (see accounts.ts). The
       services below all hold `store`, which points at the folder of the
       account in use and is re-pointed when the learner switches. */
    const folders = new AccountFolders(root);
    const startingAccount = await auth.currentAccountId();
    folders.migrateLegacy(startingAccount);
    let active = folders.paths(startingAccount);
    const stores = swappable(new LocalStore(active.db, { userFile: active.userFile }));
    store = stores.proxy; nativeTheme.themeSource = themePreferenceSchema.catch("system").parse(store.getSetting("theme", "system")); const workspaces = new WorkspaceService(active.workspaces);
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
    const telemetry = new AgentTelemetry(store);
    /* The learner's own Exa key, read through the same keychain the provider keys
       live in. Held here rather than in the worker: the utility process has no
       keychain access, and a key that crossed into it would also cross into every
       payload the worker serialises. */
    const web = new WebSearchService(() => auth.readSecret("exa"));
    /* The visualiser owns its own execution process. A trace is issued on every
       run of code that does not work yet, so the likeliest outcome of any one of
       them is a program that never returns — and that should cost the learner
       one killed process, not the runner everything else shares. */
    const visualizer = new VisualizerService();
    /* The visualiser, as the agent reaches it. Constructed beside the service
       rather than inside it: the service runs one trace and forgets it, which is
       right for a page the learner is driving. The toolbox is what holds a run
       still between tool calls so a turn can ask several questions about it. */
    const visualizerTools = new VisualizerToolbox(visualizer, store, workspaces);
    /* Instructions the agent loads on demand. Built-in skills ship beside the
       app like the runtime icons; the learner's own live with their data. */
    const skills = new SkillService(
      app.isPackaged ? path.join(process.resourcesPath, "skills") : path.join(app.getAppPath(), "build", "skills"),
      active.skills,
      store,
    );
    /* Keeps the Dock badge on the number of spaced reviews due, and announces new
       ones while the app is in the background. */
    const reminders = new ReviewReminders(store, () => mainWindow);
    const agentQuestions = new AgentQuestions(store, (sessionId) => {
      mainWindow?.webContents.send("agent:event", { runId: "", sessionId, type: "question-pending" });
    });
    const agent = new UtilityClient("agent", (event) => { const value = event.event as Record<string, unknown>; if (value?.type === "provider-usage") { providers.recordCodexRateLimits(value.headers as Record<string, string>); return; } const runId = String(event.requestId); telemetry.record(runId,value); recordAgentActivity(runId, value); mainWindow?.webContents.send("agent:event", { runId, sessionId: agentRunSessions.get(runId), ...value }); }, async (name, input, context) => { const output = await executeTrainingTool(name, input, context.sessionId, store, workspaces, runner, web, practice, visualizerTools, agentQuestions, context.progress, skills); if (name === "record_insight") reminders.refresh(false); return output; });
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
      reminders.stop();
      await checkpoints.flushAll();
      checkpoints.stop();
      sync.stop();
      runner.stop();
      visualizer.stop();
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
    /* Moves the app onto another account's folder, or the signed-out one. Work
       in flight is written out first, and the workers are stopped: a turn that
       outlived the switch would write into the wrong account. They start again
       on the next request. */
    const activateAccount = async (accountId: string | null) => {
      const next = folders.paths(accountId);
      if (next.root === active.root) return;
      await sync.flush().catch(() => undefined);
      await checkpoints.flushAll().catch(() => undefined);
      checkpoints.stop();
      agent.stop();
      runner.stop();
      practice.stop();
      stores.swap(new LocalStore(next.db, { userFile: next.userFile })).close();
      workspaces.setRoot(next.workspaces);
      skills.setUserRoot(next.skills);
      restore.reset();
      active = next;
      const theme = themePreferenceSchema.catch("system").parse(store.getSetting("theme", "system"));
      nativeTheme.themeSource = theme;
      mainWindow?.webContents.send("window:theme", theme);
      reminders.refresh(false);
    };
    const accounts = { folders, activate: activateAccount };
    const signedIn = Boolean(await auth.account());
    const needsRestore = signedIn && !store.getProfile();
    const stage = !signedIn ? "sign-in" as const : needsRestore ? "restoring" as const : gatedProfile(store.getProfile()) ? "app" as const : "onboarding" as const;
    installIpc({ store, accounts, workspaces, auth, providers, practice, runner, agent, agentQuestions, agentRunSessions, telemetry, appVersion:app.getVersion(), sync, checkpoints, restore, web, visualizer, skills, window: () => mainWindow, onReviewsChanged: () => reminders.refresh(false) });
    updates = new UpdateService(store, () => mainWindow, prepareToExit);
    updates.installIpc();
    installMenu(() => mainWindow); installDockIcon(); mainWindow = createMainWindow({ stage });
    installArrivalOverlay(() => mainWindow); updates.start(); reminders.start();
    /* Started after the window exists, so its progress has somewhere to be
       reported. The renderer holds the restoring screen until this settles. */
    if (needsRestore) void restore.run().then((state) => { if (state !== "failed") fitWindowTo(mainWindow, gatedProfile(store.getProfile()) ? "app" : "onboarding"); });
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
