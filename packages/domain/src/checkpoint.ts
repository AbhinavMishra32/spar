import { z } from "zod";
import { id, isoDate, trainingTargetSchema } from "./model.js";

export const workspaceFileSchema = z.object({
  path: z.string().min(1),
  contentHash: z.string().min(16),
  dirtyContent: z.string().optional()
});

export const sessionCheckpointSchema = z.object({
  id,
  sessionId: id,
  attemptId: id.nullable(),
  version: z.number().int().positive(),
  savedAt: isoDate,
  eventSequence: z.number().int().nonnegative(),
  workspaceSnapshotId: id.nullable(),
  workspaceFiles: z.array(workspaceFileSchema),
  openFiles: z.array(z.string()),
  activeFile: z.string().nullable(),
  layout: z.object({ sidebarWidth: z.number(), editorRatio: z.number(), bottomPanelHeight: z.number(), agentPanelOpen: z.boolean() }),
  terminalRecipe: z.array(z.string()),
  visibleTestRunIds: z.array(id),
  objective: z.string(),
  trainingTarget: trainingTargetSchema.nullable(),
  agent: z.object({
    lastDecision: z.string().nullable(),
    pendingLearnerQuestion: z.string().nullable(),
    relevantAbilityIds: z.array(id),
    messageCursor: z.number().int().nonnegative(),
    traceId: z.string().nullable(),
    nextAllowedActions: z.array(z.string())
  })
});
export type SessionCheckpoint = z.infer<typeof sessionCheckpointSchema>;

export function chooseCheckpoint(local: SessionCheckpoint | null, remote: SessionCheckpoint | null): SessionCheckpoint | null {
  if (!local) return remote;
  if (!remote) return local;
  if (local.sessionId !== remote.sessionId) throw new Error("Cannot reconcile checkpoints from different sessions");
  if (local.version !== remote.version) return local.version > remote.version ? local : remote;
  if (local.eventSequence !== remote.eventSequence) return local.eventSequence > remote.eventSequence ? local : remote;
  return Date.parse(local.savedAt) >= Date.parse(remote.savedAt) ? local : remote;
}
