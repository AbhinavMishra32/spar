import { z } from "zod";
import { attemptEventSchema, languageSchema, learnerProfileSchema, sessionCheckpointSchema, sessionSummarySchema, type AbilityDetail, type AbilityHistorySummary, type ChallengeCodePreview, type ChallengeDetail, type ChallengeHistorySummary, type ConceptDetail, type ConceptSummary, type Language, type LearnerProfile, type SessionDetail, type SessionSuggestion } from "@spar/domain";

export const ipc = {
  bootstrap: "app:bootstrap", sessionsCreate: "sessions:create", sessionsOpen: "sessions:open",
  checkpointSave: "checkpoint:save", attemptAppend: "attempt:append", workspaceRead: "workspace:read",
  workspaceWrite: "workspace:write", runnerRun: "runner:run", agentSend: "agent:send", attemptSubmit: "attempt:submit",
  authPassword: "auth:password", authSignOut: "auth:sign-out", authDeleteAccount: "auth:delete-account", settingsSaveSecret: "settings:save-secret",
  settingsProviders: "settings:providers", settingsProviderDisconnect: "settings:provider-disconnect",
  settingsProviderDefault: "settings:provider-default", settingsProviderUsage: "settings:provider-usage", settingsProviderOauthStart: "settings:provider-oauth-start",
  settingsProviderOauthSubmit: "settings:provider-oauth-submit", settingsProviderOauthCancel: "settings:provider-oauth-cancel",
  settingsOpenExternal: "settings:open-external", settingsTheme: "settings:theme", settingsReasoningEffort: "settings:reasoning-effort",
  attemptAbandon: "attempt:abandon", sessionNextChallenge: "session:next-challenge",
  profileSave: "profile:save", profileLanguage: "profile:language", sessionsSuggest: "sessions:suggest",
  sessionsRename: "sessions:rename", sessionsPin: "sessions:pin", sessionsArchive: "sessions:archive",
  sessionsStatus: "sessions:status", sessionsDelete: "sessions:delete",
  challengePreviews: "challenges:previews", challengeRead: "challenges:read", challengeWrite: "challenges:write",
  challengeRun: "challenges:run", challengeCheck: "challenges:check", challengeReset: "challenges:reset",
  conceptRead: "concepts:read", abilityRead: "abilities:read", practiceStart: "practice:start"
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
/* Practising a challenge out of history is addressed by challenge id alone. The
   session it came from is looked up rather than passed, so a renderer can never
   name one challenge and a different session's sandbox. */
export const challengePathInput = z.object({ challengeId: z.string().uuid(), path: z.string().min(1).max(500) });
export const challengeWriteInput = challengePathInput.extend({ content: z.string().max(2_000_000) });
export const challengeIdInput = z.object({ challengeId: z.string().uuid() });
/* Starting a session from something the learner already has. Named by id rather
   than carrying a goal string, so the phrasing of a practice session is decided
   once in the main process — which is also the only side that can look up what
   the evidence under that ability or concept currently says. `drill` is one of
   the ability's own suggestions, passed verbatim because the learner picked it. */
export const practiceInput = z.object({
  abilityId: z.string().uuid().optional(),
  conceptSlug: z.string().trim().min(1).max(60).optional(),
  drill: z.string().trim().min(3).max(400).optional(),
}).refine((value) => Boolean(value.abilityId ?? value.conceptSlug), "A practice session needs an ability or a concept to aim at");
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
/** Which copy of Spar this is. Resolved once in the main process — see main/build.ts. */
export type BuildInfo = {
  /** From package.json. Identifies a release; says nothing useful about a build from source. */
  version: string;
  /** Full SHA this build came from, when it can be established at all. */
  commit: string | null;
  /** Branch HEAD pointed at, or null when detached or unknown. */
  branch: string | null;
  /** False when running from source, where the commit is the real identity. */
  packaged: boolean;
};
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
/** One rate-limit window of a subscription. `usedPercent` is how much of the
 *  window has been spent (0–100) — the same direction both upstreams report it
 *  in — and `resetsAt` is epoch seconds, or null when the upstream omitted it. */
export type UsageWindow = { kind: "five-hour" | "weekly"; usedPercent: number; resetsAt: number | null };
/** What Spar currently knows about a subscription's quota. Null, rather than an
 *  empty reading, whenever nothing has told it — see `subscriptionUsage`. */
export type SubscriptionUsage = { windows: UsageWindow[]; capturedAt: number };
export type ProviderOAuthEvent = {
  flowId: string;
  provider: ProviderId;
  status: "starting" | "waiting" | "prompt" | "connected" | "cancelled" | "error";
  message: string;
  url?: string;
  placeholder?: string;
  allowEmpty?: boolean;
};

export type BootstrapData = { account: { id: string; displayName: string; email: string } | null; profile: LearnerProfile | null; sessions: z.infer<typeof sessionSummarySchema>[]; challenges: ChallengeHistorySummary[]; abilities: AbilityHistorySummary[]; concepts: ConceptSummary[]; theme: ThemePreference; syncState: "offline" | "synced" | "pending" };
/** One file a tool wrote, with the line counts the activity row reports. */
export type AgentActivityFile = { path: string; added: number; removed: number };
export type AgentStreamEvent = {
  runId: string;
  /** Which session this turn is working on. Stamped in the main process, because
   *  the utility process only knows its own request id — and a card the learner
   *  is not looking at still has to be able to say "the agent is on this one". */
  sessionId?: string;
  type: "text" | "reasoning" | "tool" | "status" | "error" | "done";
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
  /** `output` is the runner's own stdout+stderr, so the result panel can read the
      submission as test cases instead of only reporting the verdict. */
  submitAttempt(input:{sessionId:string;attemptId:string}):Promise<{outcome:"passed"|"failed";exitCode:number;durationMs:number;output:string;summary:string}>;
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
  /* ---- Practising a challenge from history ------------------------------
     Every one of these runs against a per-challenge sandbox. None of them
     records an attempt event, changes a question's status, or starts an agent
     turn: re-opening finished work is rehearsal, and rehearsal is not evidence. */
  listChallengePreviews(): Promise<Record<string, ChallengeCodePreview>>;
  readChallenge(challengeId: string): Promise<ChallengeDetail | null>;
  writeChallengeFile(input: z.infer<typeof challengeWriteInput>): Promise<void>;
  /** Runs the visible cases; output streams over `onRunnerEvent` under this id. */
  runChallenge(input: z.infer<typeof challengeIdInput>): Promise<{ id: string }>;
  /** Visible plus hidden, in a throwaway copy of the sandbox. Awaited, not streamed. */
  checkChallenge(input: z.infer<typeof challengeIdInput>): Promise<{ outcome: "passed" | "failed"; exitCode: number; durationMs: number; output: string; summary: string }>;
  /** Throws the learner's practice edits away and re-seeds from the generated files. */
  resetChallenge(input: z.infer<typeof challengeIdInput>): Promise<ChallengeDetail | null>;
  /* ---- Concepts and abilities -------------------------------------------
     Both are reads over the learner's own history, so both are cheap and both
     are fetched on demand rather than carried in the bootstrap: the concept
     summaries are, because chips need them everywhere, but the challenge lists
     behind a chip are only wanted once someone looks. */
  readConcept(slug: string): Promise<ConceptDetail | null>;
  readAbility(abilityId: string): Promise<AbilityDetail | null>;
  /** Opens a new session aimed at an ability or a concept, and returns it so the
   *  caller can go straight there. Starting the turn is the point: practice that
   *  did not reach the agent would be a link, not a drill. */
  startPractice(input: z.infer<typeof practiceInput>): Promise<{ sessionId: string }>;
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
  /** What a connected subscription's quota looks like right now, or null when
   *  the provider has none to report or nothing has reported one yet. */
  providerUsage(provider: ProviderId): Promise<SubscriptionUsage | null>;
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
  /** Version and commit of this copy, fixed for the life of the window. */
  build: BuildInfo;
  onNativeSurface(listener: (surface: NativeSurface) => void): () => void;
  onSyncState(listener: (state: SyncState) => void): () => void;
}
