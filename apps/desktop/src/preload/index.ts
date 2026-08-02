import { contextBridge, ipcRenderer } from "electron";
import { ipc, type AgentStreamEvent, type NativeSurface, type SparApi, type WindowControls } from "../shared/api.js";

/** Injected by the main process via webPreferences.additionalArguments. */
function launchFlag(name: string, fallback: string) {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}

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
  renameSession: (input) => ipcRenderer.invoke(ipc.sessionsRename, input),
  setSessionPinned: (input) => ipcRenderer.invoke(ipc.sessionsPin, input),
  setSessionArchived: (input) => ipcRenderer.invoke(ipc.sessionsArchive, input),
  setSessionStatus: (input) => ipcRenderer.invoke(ipc.sessionsStatus, input),
  deleteSession: (sessionId) => ipcRenderer.invoke(ipc.sessionsDelete, sessionId),
  passwordAuth: (mode, email, password) => ipcRenderer.invoke(ipc.authPassword, { mode, email, password }),
  signOut: () => ipcRenderer.invoke(ipc.authSignOut),
  deleteAccount: () => ipcRenderer.invoke(ipc.authDeleteAccount),
  saveProfile: (input) => ipcRenderer.invoke(ipc.profileSave, input),
  setPreferredLanguage: (language) => ipcRenderer.invoke(ipc.profileLanguage, language),
  suggestSessions: () => ipcRenderer.invoke(ipc.sessionsSuggest),
  saveProviderSecret: (input) => ipcRenderer.invoke(ipc.settingsSaveSecret, input),
  listProviders: () => ipcRenderer.invoke(ipc.settingsProviders),
  disconnectProvider: (provider) => ipcRenderer.invoke(ipc.settingsProviderDisconnect, provider),
  setDefaultProvider: (provider, model) => ipcRenderer.invoke(ipc.settingsProviderDefault, { provider, model }),
  setReasoningEffort: (effort) => ipcRenderer.invoke(ipc.settingsReasoningEffort, effort),
  startProviderOAuth: (provider) => ipcRenderer.invoke(ipc.settingsProviderOauthStart, provider),
  submitProviderOAuth: (flowId, value) => ipcRenderer.invoke(ipc.settingsProviderOauthSubmit, { flowId, value }),
  cancelProviderOAuth: (flowId) => ipcRenderer.invoke(ipc.settingsProviderOauthCancel, flowId),
  openExternal: (url) => ipcRenderer.invoke(ipc.settingsOpenExternal, url),
  setTheme: (theme) => ipcRenderer.invoke(ipc.settingsTheme, theme),
  onProviderOAuthEvent: (listener) => subscribe("provider:oauth-event", listener),
  onAgentEvent: (listener) => subscribe("agent:event", listener),
  onRunnerEvent: (listener) => subscribe("runner:event", listener),
  onMenuCommand: (listener) => subscribe("menu:command", listener),
  chrome: {
    platform: process.platform,
    surface: launchFlag("spar-surface", "none") as NativeSurface,
    controls: launchFlag("spar-controls", process.platform === "darwin" ? "left" : "right") as WindowControls,
  },
  onNativeSurface: (listener) => subscribe("window:surface", listener),
  onSyncState: (listener) => subscribe("sync:state", listener)
};
function subscribe<T>(channel: string, listener: (value: T) => void) { const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value); ipcRenderer.on(channel, handler); return () => ipcRenderer.removeListener(channel, handler); }
contextBridge.exposeInMainWorld("spar", api);
