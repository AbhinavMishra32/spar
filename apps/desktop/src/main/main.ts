import { app, BrowserWindow, protocol } from "electron";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { AuthService } from "./auth.js";
import { installIpc } from "./ipc.js";
import { installMenu } from "./menu.js";
import { LocalStore } from "./store.js";
import { UtilityClient } from "./utilityClient.js";
import { createMainWindow } from "./window.js";
import { WorkspaceService } from "./workspaces.js";

protocol.registerSchemesAsPrivileged([{ scheme: "practice-ai", privileges: { secure: true, standard: true } }]);
let mainWindow: BrowserWindow | null = null;
let store: LocalStore;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => { mainWindow?.show(); mainWindow?.focus(); const url = argv.find((value) => value.startsWith("practice-ai://")); if (url) void completeAuth(url); });
  app.on("open-url", (event, url) => { event.preventDefault(); void completeAuth(url); });
  void app.whenReady().then(async () => {
    const root = path.join(app.getPath("userData"), "practice-ai"); await mkdir(path.join(root, "workspaces"), { recursive: true });
    store = new LocalStore(path.join(root, "state.sqlite3")); const auth = new AuthService(process.env.PRACTICE_API_ORIGIN ?? "http://localhost:4318"); const workspaces = new WorkspaceService(path.join(root, "workspaces"));
    const runner = new UtilityClient("runner", (event) => mainWindow?.webContents.send("runner:event", { id: event.requestId, stream: event.stream, data: event.data, exitCode: event.exitCode }));
    const agent = new UtilityClient("agent", (event) => { const value = event.event as Record<string, unknown>; mainWindow?.webContents.send("agent:event", { runId: event.requestId, ...value }); }, (name, input) => executeTrainingTool(name, input, store));
    installIpc({ store, workspaces, auth, runner, agent, window: () => mainWindow }); installMenu(() => mainWindow); mainWindow = createMainWindow();
    app.on("before-quit", () => { runner.stop(); agent.stop(); store.close(); });
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(); });
  });
}
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

async function completeAuth(url: string) { const auth = new AuthService(process.env.PRACTICE_API_ORIGIN ?? "http://localhost:4318"); try { await auth.complete(url); mainWindow?.webContents.send("auth:changed"); } catch (error) { mainWindow?.webContents.send("auth:error", error instanceof Error ? error.message : String(error)); } }
async function executeTrainingTool(name: string, input: unknown, local: LocalStore) {
  if (name === "read_session") return local.readSession(String((input as { sessionId: string }).sessionId));
  if (name === "search_learner_model") return { passages: [], note: "No matching learner evidence yet." };
  if (name === "search_attempt_history") return { attempts: [] };
  if (name === "read_concept_graph") return { nodes: [], bounded: true };
  if (name === "set_session_objective" || name === "set_training_target" || name === "commit_session_decision") return { committed: true, value: input };
  if (name === "ask_learner") return { pending: true, value: input };
  if (name === "create_question") return { status: "queued-for-validation", design: input };
  if (name === "inspect_current_attempt" || name === "read_attempt") return { events: [], diffs: [], testRuns: [] };
  if (name === "evaluate_attempt") return { status: "requires-submission" };
  if (name === "read_ability") return { found: false };
  if (name === "propose_ability_update") return { proposed: true, requiresCommit: true };
  throw new Error(`Unsupported Training Agent tool: ${name}`);
}

