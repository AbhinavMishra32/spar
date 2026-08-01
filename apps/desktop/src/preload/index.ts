import { contextBridge, ipcRenderer } from "electron";
import { ipc, type AgentStreamEvent, type SparApi } from "../shared/api.js";

const api: SparApi = {
  bootstrap: () => ipcRenderer.invoke(ipc.bootstrap),
  createSession: (input) => ipcRenderer.invoke(ipc.sessionsCreate, input),
  openSession: (sessionId) => ipcRenderer.invoke(ipc.sessionsOpen, sessionId),
  saveCheckpoint: (input) => ipcRenderer.invoke(ipc.checkpointSave, input),
  appendAttemptEvent: (input) => ipcRenderer.invoke(ipc.attemptAppend, input),
  readWorkspaceFile: (input) => ipcRenderer.invoke(ipc.workspaceRead, input),
  writeWorkspaceFile: (input) => ipcRenderer.invoke(ipc.workspaceWrite, input),
  run: (input) => ipcRenderer.invoke(ipc.runnerRun, input),
  submitAttempt:(input)=>ipcRenderer.invoke(ipc.attemptSubmit,input),
  sendAgentMessage: (input) => ipcRenderer.invoke(ipc.agentSend, input),
  abandonAttempt: (input) => ipcRenderer.invoke(ipc.attemptAbandon, input),
  requestNextChallenge: (input) => ipcRenderer.invoke(ipc.sessionNextChallenge, input),
  passwordAuth: (mode, email, password) => ipcRenderer.invoke(ipc.authPassword, { mode, email, password }),
  signOut: () => ipcRenderer.invoke(ipc.authSignOut),
  saveProviderSecret: (input) => ipcRenderer.invoke(ipc.settingsSaveSecret, input),
  listProviders: () => ipcRenderer.invoke(ipc.settingsProviders),
  disconnectProvider: (provider) => ipcRenderer.invoke(ipc.settingsProviderDisconnect, provider),
  setDefaultProvider: (provider, model) => ipcRenderer.invoke(ipc.settingsProviderDefault, { provider, model }),
  startProviderOAuth: (provider) => ipcRenderer.invoke(ipc.settingsProviderOauthStart, provider),
  submitProviderOAuth: (flowId, value) => ipcRenderer.invoke(ipc.settingsProviderOauthSubmit, { flowId, value }),
  cancelProviderOAuth: (flowId) => ipcRenderer.invoke(ipc.settingsProviderOauthCancel, flowId),
  openExternal: (url) => ipcRenderer.invoke(ipc.settingsOpenExternal, url),
  setTheme: (theme) => ipcRenderer.invoke(ipc.settingsTheme, theme),
  onProviderOAuthEvent: (listener) => subscribe("provider:oauth-event", listener),
  onAgentEvent: (listener) => subscribe("agent:event", listener),
  onRunnerEvent: (listener) => subscribe("runner:event", listener),
  onMenuCommand: (listener) => subscribe("menu:command", listener),
  onSyncState: (listener) => subscribe("sync:state", listener)
};
function subscribe<T>(channel: string, listener: (value: T) => void) { const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value); ipcRenderer.on(channel, handler); return () => ipcRenderer.removeListener(channel, handler); }
contextBridge.exposeInMainWorld("spar", api);
