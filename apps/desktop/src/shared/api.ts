import { z } from "zod";
import { attemptEventSchema, sessionCheckpointSchema, sessionSummarySchema } from "@pracai/domain";

export const ipc = {
  bootstrap: "app:bootstrap", sessionsCreate: "sessions:create", sessionsOpen: "sessions:open",
  checkpointSave: "checkpoint:save", attemptAppend: "attempt:append", workspaceRead: "workspace:read",
  workspaceWrite: "workspace:write", runnerRun: "runner:run", agentSend: "agent:send",
  authStart: "auth:start", authSignOut: "auth:sign-out", settingsSaveSecret: "settings:save-secret"
} as const;

export const createSessionInput = z.object({ goal: z.string().trim().min(3).max(1000) });
export const workspacePathInput = z.object({ sessionId: z.string().uuid(), path: z.string().min(1).max(500) });
export const workspaceWriteInput = workspacePathInput.extend({ content: z.string().max(2_000_000) });
export const runInput = z.object({ sessionId: z.string().uuid(), language: z.enum(["javascript", "typescript", "cpp"]), command: z.enum(["test", "run"]), timeoutMs: z.number().int().min(100).max(20_000).default(8_000) });

export type BootstrapData = { account: { id: string; displayName: string; email: string } | null; sessions: z.infer<typeof sessionSummarySchema>[]; theme: "system" | "light" | "dark"; syncState: "offline" | "synced" | "pending" };
export type AgentStreamEvent = { runId: string; type: "text" | "tool" | "status" | "error" | "done"; text?: string; tool?: string; detail?: string };

export interface PracticeApi {
  bootstrap(): Promise<BootstrapData>;
  createSession(input: z.infer<typeof createSessionInput>): Promise<{ sessionId: string }>;
  openSession(sessionId: string): Promise<unknown>;
  saveCheckpoint(input: z.infer<typeof sessionCheckpointSchema>): Promise<void>;
  appendAttemptEvent(input: z.infer<typeof attemptEventSchema>): Promise<void>;
  readWorkspaceFile(input: z.infer<typeof workspacePathInput>): Promise<string>;
  writeWorkspaceFile(input: z.infer<typeof workspaceWriteInput>): Promise<void>;
  run(input: z.infer<typeof runInput>): Promise<{ id: string }>;
  sendAgentMessage(input: { sessionId: string; message: string }): Promise<{ runId: string }>;
  startAuth(provider: "email" | "google" | "github", email?: string): Promise<void>;
  signOut(): Promise<void>;
  saveProviderSecret(input: { account: string; secret: string }): Promise<void>;
  onAgentEvent(listener: (event: AgentStreamEvent) => void): () => void;
  onRunnerEvent(listener: (event: { id: string; stream: "stdout" | "stderr" | "exit"; data: string; exitCode?: number }) => void): () => void;
}

