import { z } from "zod";
import { attemptEventSchema, languageSchema, learnerProfileSchema, sessionCheckpointSchema, sessionSummarySchema, type AbilityHistorySummary, type ChallengeHistorySummary, type Language, type LearnerProfile, type SessionDetail, type SessionSuggestion } from "@spar/domain";

export const ipc = {
  bootstrap: "app:bootstrap", sessionsCreate: "sessions:create", sessionsOpen: "sessions:open",
  checkpointSave: "checkpoint:save", attemptAppend: "attempt:append", workspaceRead: "workspace:read",
  workspaceWrite: "workspace:write", runnerRun: "runner:run", agentSend: "agent:send", attemptSubmit: "attempt:submit",
  authPassword: "auth:password", authSignOut: "auth:sign-out", authDeleteAccount: "auth:delete-account", settingsSaveSecret: "settings:save-secret",
  settingsProviders: "settings:providers", settingsProviderDisconnect: "settings:provider-disconnect",
  settingsProviderDefault: "settings:provider-default", settingsProviderOauthStart: "settings:provider-oauth-start",
  settingsProviderOauthSubmit: "settings:provider-oauth-submit", settingsProviderOauthCancel: "settings:provider-oauth-cancel",
  settingsOpenExternal: "settings:open-external", settingsTheme: "settings:theme", settingsReasoningEffort: "settings:reasoning-effort",
  attemptAbandon: "attempt:abandon", sessionNextChallenge: "session:next-challenge",
  profileSave: "profile:save", profileLanguage: "profile:language", sessionsSuggest: "sessions:suggest",
  sessionsRename: "sessions:rename", sessionsPin: "sessions:pin", sessionsArchive: "sessions:archive",
  sessionsStatus: "sessions:status", sessionsDelete: "sessions:delete"
} as const;

export const createSessionInput = z.object({ goal: z.string().trim().min(3).max(1000) });
/* Sidebar housekeeping. Titles are capped where the generated one is capped, so a
   renamed session cannot outgrow the row it has to fit in. */
export const sessionRenameInput = z.object({ sessionId: z.string().uuid(), title: z.string().trim().min(1).max(80) });
export const sessionFlagInput = z.object({ sessionId: z.string().uuid(), value: z.boolean() });
/* Only the two the learner can mean by hand. `planning` and `active` are the
   agent's to set — they promise a turn or a live challenge behind them. */
export const sessionStatusInput = z.object({ sessionId: z.string().uuid(), status: z.enum(["completed", "paused"]) });
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
/** What onboarding sends back. `completedAt` is stamped in the main process so a
 *  renderer clock can never decide whether onboarding happened. */
export const profileInput = learnerProfileSchema.omit({ completedAt: true });
export const themePreferenceSchema = z.enum(["system", "light", "dark"]);
/** Mirrors pi-ai's `ModelThinkingLevel`: "off" sends no reasoning directive at all, so it reproduces today's behavior exactly. */
export const reasoningEffortSchema = z.enum(["off", "low", "medium", "high", "xhigh"]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
/** The translucent material the OS paints behind the window, if any. */
export type NativeSurface = "liquid-glass" | "vibrancy" | "mica" | "none";
/** Which edge must reserve room for the OS window buttons; "none" = native frame. */
export type WindowControls = "left" | "right" | "none";
/** `process.platform`, narrowed to what the renderer branches on. */
export type HostPlatform = "darwin" | "win32" | "linux" | (string & {});
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

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
  /** Whether a turn can run right now. The main process decides it the same way
   *  it resolves credentials, so the composer never has to infer runnability
   *  from `defaultModel` — which names a provider even before one is connected. */
  ready: boolean;
  defaultModel: { provider: ProviderId; model: string; reasoningEffort: ReasoningEffort };
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

export type BootstrapData = { account: { id: string; displayName: string; email: string } | null; profile: LearnerProfile | null; sessions: z.infer<typeof sessionSummarySchema>[]; challenges: ChallengeHistorySummary[]; abilities: AbilityHistorySummary[]; theme: ThemePreference; syncState: "offline" | "synced" | "pending" };
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

export interface SparApi {
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
  /** Sidebar housekeeping. Each resolves once the local store is authoritative;
   *  the caller re-reads the bootstrap rather than patching its own copy. */
  renameSession(input: z.infer<typeof sessionRenameInput>): Promise<{ title: string }>;
  setSessionPinned(input: z.infer<typeof sessionFlagInput>): Promise<void>;
  setSessionArchived(input: z.infer<typeof sessionFlagInput>): Promise<void>;
  setSessionStatus(input: z.infer<typeof sessionStatusInput>): Promise<void>;
  /** Permanent: the session, its challenges, its attempt evidence and its workspace. */
  deleteSession(sessionId: string): Promise<void>;
  passwordAuth(mode: "sign-in" | "sign-up", email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Finish onboarding; resolves with the stored profile. */
  saveProfile(input: z.infer<typeof profileInput>): Promise<LearnerProfile>;
  /** Change the language new sessions start in, without touching the rest of the profile. */
  setPreferredLanguage(language: Language): Promise<void>;
  /** Sparring sessions drafted from the intake. `source` is "starter" when no
   *  provider answered, so the caller can say so rather than imply a reading. */
  suggestSessions(): Promise<{ source: "agent" | "starter"; suggestions: SessionSuggestion[] }>;
  /** Permanently removes the authenticated account and all cloud-backed learner data. */
  deleteAccount(): Promise<void>;
  saveProviderSecret(input: z.infer<typeof providerSettingsInput>): Promise<void>;
  listProviders(): Promise<ProviderInventory>;
  disconnectProvider(provider: ProviderId): Promise<void>;
  setDefaultProvider(provider: ProviderId, model: string): Promise<void>;
  setReasoningEffort(effort: ReasoningEffort): Promise<void>;
  startProviderOAuth(provider: Extract<ProviderId, "openai-codex" | "claude-code" | "github-copilot">): Promise<{ flowId: string }>;
  submitProviderOAuth(flowId: string, value: string): Promise<void>;
  cancelProviderOAuth(flowId: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  setTheme(theme: ThemePreference): Promise<void>;
  onProviderOAuthEvent(listener: (event: ProviderOAuthEvent) => void): () => void;
  onAgentEvent(listener: (event: AgentStreamEvent) => void): () => void;
  onRunnerEvent(listener: (event: { id: string; stream: "stdout" | "stderr" | "exit"; data: string; exitCode?: number }) => void): () => void;
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
  /** Chrome the OS owns: the material behind us, and where its buttons sit. */
  chrome: { platform: HostPlatform; surface: NativeSurface; controls: WindowControls };
  onNativeSurface(listener: (surface: NativeSurface) => void): () => void;
  onSyncState(listener: (state: SyncState) => void): () => void;
}
