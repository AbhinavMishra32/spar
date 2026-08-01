import { z } from "zod";
import { attemptEventSchema, sessionCheckpointSchema, sessionSummarySchema, type SessionDetail } from "@pracai/domain";

export const ipc = {
  bootstrap: "app:bootstrap", sessionsCreate: "sessions:create", sessionsOpen: "sessions:open",
  checkpointSave: "checkpoint:save", attemptAppend: "attempt:append", workspaceRead: "workspace:read",
  workspaceWrite: "workspace:write", runnerRun: "runner:run", agentSend: "agent:send", attemptSubmit: "attempt:submit",
  authPassword: "auth:password", authSignOut: "auth:sign-out", settingsSaveSecret: "settings:save-secret",
  settingsProviders: "settings:providers", settingsProviderDisconnect: "settings:provider-disconnect",
  settingsProviderDefault: "settings:provider-default", settingsProviderOauthStart: "settings:provider-oauth-start",
  settingsProviderOauthSubmit: "settings:provider-oauth-submit", settingsProviderOauthCancel: "settings:provider-oauth-cancel",
  settingsOpenExternal: "settings:open-external",
  attemptAbandon: "attempt:abandon", sessionNextChallenge: "session:next-challenge"
} as const;

export const createSessionInput = z.object({ goal: z.string().trim().min(3).max(1000) });
export const workspacePathInput = z.object({ sessionId: z.string().uuid(), path: z.string().min(1).max(500) });
export const workspaceWriteInput = workspacePathInput.extend({ content: z.string().max(2_000_000) });
export const runInput = z.object({ sessionId: z.string().uuid(), language: z.enum(["javascript", "typescript", "cpp"]), command: z.enum(["test", "run"]), timeoutMs: z.number().int().min(100).max(20_000).default(8_000) });
// Ordering belongs to the authoritative local event store. Renderer processes
// supply event identity and content, but never a guessed stream sequence.
export const attemptAppendInput = attemptEventSchema.omit({ sequence: true });
export const providerSettingsInput = z.object({
  provider: z.enum(["openai", "anthropic", "google", "xai", "openrouter", "opencode", "opencode-go", "deepseek", "minimax", "moonshotai", "kimi-coding", "zai", "vercel-ai-gateway", "cloudflare-ai-gateway", "ollama", "lm-studio", "custom"]),
  model: z.string().trim().min(1).max(200),
  baseUrl: z.string().url().refine((value) => value.startsWith("https://") || value.startsWith("http://localhost:") || value.startsWith("http://127.0.0.1:"), "Provider URL must use HTTPS unless it is local"),
  secret: z.string().max(20_000),
});

export type ProviderId = "openai-codex" | "claude-code" | "github-copilot" | z.infer<typeof providerSettingsInput>["provider"];
export type ProviderInventory = {
  providers: Array<{
    id: ProviderId;
    name: string;
    description: string;
    kind: "subscription" | "api-key" | "local" | "custom";
    state: "connected" | "disconnected" | "auth-expired";
    selectedModel: string;
    baseUrl: string;
    keyUrl?: string;
    models: Array<{ id: string; name: string; reasoning: boolean }>;
  }>;
  defaultModel: { provider: ProviderId; model: string };
};
export type ProviderOAuthEvent = {
  flowId: string;
  provider: ProviderId;
  status: "starting" | "waiting" | "prompt" | "connected" | "cancelled" | "error";
  message: string;
  url?: string;
  placeholder?: string;
  allowEmpty?: boolean;
};

export type BootstrapData = { account: { id: string; displayName: string; email: string } | null; sessions: z.infer<typeof sessionSummarySchema>[]; theme: "system" | "light" | "dark"; syncState: "offline" | "synced" | "pending" };
/** One file a tool wrote, with the line counts the activity row reports. */
export type AgentActivityFile = { path: string; added: number; removed: number };
export type AgentStreamEvent = {
  runId: string;
  type: "text" | "tool" | "status" | "error" | "done";
  text?: string;
  tool?: string;
  detail?: string;
  /** Correlates a tool's start and end events so a row updates in place. */
  callId?: string;
  phase?: "start" | "end";
  ok?: boolean;
  /** Short human summary of the tool's input, e.g. the search query or title. */
  label?: string;
  files?: AgentActivityFile[];
};
/** Native menu items are routed to the renderer so the macOS menu bar drives the same UI as the in-app controls. */
export type MenuCommand = "settings" | "new-session" | "command-palette";
export type SyncState = BootstrapData["syncState"];

export interface PracticeApi {
  bootstrap(): Promise<BootstrapData>;
  createSession(input: z.infer<typeof createSessionInput>): Promise<{ sessionId: string }>;
  openSession(sessionId: string): Promise<SessionDetail | null>;
  saveCheckpoint(input: z.infer<typeof sessionCheckpointSchema>): Promise<void>;
  appendAttemptEvent(input: z.infer<typeof attemptAppendInput>): Promise<z.infer<typeof attemptEventSchema>>;
  readWorkspaceFile(input: z.infer<typeof workspacePathInput>): Promise<string>;
  writeWorkspaceFile(input: z.infer<typeof workspaceWriteInput>): Promise<void>;
  run(input: z.infer<typeof runInput>): Promise<{ id: string }>;
  submitAttempt(input:{sessionId:string;attemptId:string}):Promise<{outcome:"passed"|"failed";exitCode:number;summary:string}>;
  sendAgentMessage(input: { sessionId: string; message: string }): Promise<{ runId: string }>;
  /** Give up on the active challenge; the session returns to general chat. */
  abandonAttempt(input: { sessionId: string; attemptId: string; reason: string }): Promise<void>;
  /** Ask the agent to choose and compile the next challenge for this session. */
  requestNextChallenge(input: { sessionId: string }): Promise<{ runId: string }>;
  passwordAuth(mode: "sign-in" | "sign-up", email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  saveProviderSecret(input: z.infer<typeof providerSettingsInput>): Promise<void>;
  listProviders(): Promise<ProviderInventory>;
  disconnectProvider(provider: ProviderId): Promise<void>;
  setDefaultProvider(provider: ProviderId, model: string): Promise<void>;
  startProviderOAuth(provider: Extract<ProviderId, "openai-codex" | "claude-code" | "github-copilot">): Promise<{ flowId: string }>;
  submitProviderOAuth(flowId: string, value: string): Promise<void>;
  cancelProviderOAuth(flowId: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  onProviderOAuthEvent(listener: (event: ProviderOAuthEvent) => void): () => void;
  onAgentEvent(listener: (event: AgentStreamEvent) => void): () => void;
  onRunnerEvent(listener: (event: { id: string; stream: "stdout" | "stderr" | "exit"; data: string; exitCode?: number }) => void): () => void;
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
  onSyncState(listener: (state: SyncState) => void): () => void;
}
