import { contextBridge, ipcRenderer } from "electron";
import { ipc, type AgentStreamEvent, type PracticeApi } from "../shared/api.js";

const api: PracticeApi = {
  bootstrap: () => ipcRenderer.invoke(ipc.bootstrap),
  createSession: (input) => ipcRenderer.invoke(ipc.sessionsCreate, input),
  openSession: (sessionId) => ipcRenderer.invoke(ipc.sessionsOpen, sessionId),
  saveCheckpoint: (input) => ipcRenderer.invoke(ipc.checkpointSave, input),
  appendAttemptEvent: (input) => ipcRenderer.invoke(ipc.attemptAppend, input),
  readWorkspaceFile: (input) => ipcRenderer.invoke(ipc.workspaceRead, input),
  writeWorkspaceFile: (input) => ipcRenderer.invoke(ipc.workspaceWrite, input),
  run: (input) => ipcRenderer.invoke(ipc.runnerRun, input),
  sendAgentMessage: (input) => ipcRenderer.invoke(ipc.agentSend, input),
  startAuth: (provider, email) => ipcRenderer.invoke(ipc.authStart, { provider, email }),
  signOut: () => ipcRenderer.invoke(ipc.authSignOut),
  saveProviderSecret: (input) => ipcRenderer.invoke(ipc.settingsSaveSecret, input),
  onAgentEvent: (listener) => subscribe("agent:event", listener),
  onRunnerEvent: (listener) => subscribe("runner:event", listener)
};
function subscribe<T>(channel: string, listener: (value: T) => void) { const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value); ipcRenderer.on(channel, handler); return () => ipcRenderer.removeListener(channel, handler); }
contextBridge.exposeInMainWorld("practice", api);

