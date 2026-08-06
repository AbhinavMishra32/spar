import { z } from "zod";
import { askUserQuestionRequestSchema, id, isoDate, trainingTargetSchema } from "./model.js";

export const workspaceFileSchema = z.object({
  path: z.string().min(1),
  contentHash: z.string().min(16),
  /** What is on disk. Carried in the checkpoint rather than uploaded separately:
   *  a challenge workspace is a handful of small source files, and a checkpoint
   *  that names files it cannot produce restores a session to an empty editor.
   *  Absent when the file was too large to carry — see `omittedFiles`. */
  content: z.string().optional(),
  /** An editor buffer that has not been saved yet. Distinct from `content`,
   *  which is the saved state: restoring has to put both back. */
  dirtyContent: z.string().optional()
});

/** How much of a workspace a checkpoint will carry. A checkpoint is a jsonb row
 *  and a sync payload, not a backup format, so it takes the source files and
 *  leaves anything that has clearly stopped being one. */
export const CHECKPOINT_FILE_LIMIT = 256 * 1024;
export const CHECKPOINT_TOTAL_LIMIT = 2 * 1024 * 1024;

export const sessionCheckpointSchema = z.object({
  id,
  sessionId: id,
  attemptId: id.nullable(),
  version: z.number().int().positive(),
  savedAt: isoDate,
  eventSequence: z.number().int().nonnegative(),
  workspaceSnapshotId: id.nullable(),
  workspaceFiles: z.array(workspaceFileSchema),
  /** Files that exist in the workspace but whose contents were left out of this
   *  checkpoint for size. Named rather than dropped silently, so a restore can
   *  say what it could not bring back instead of presenting a partial workspace
   *  as a whole one. */
  omittedFiles: z.array(z.string()).default([]),
  openFiles: z.array(z.string()),
  activeFile: z.string().nullable(),
  layout: z.object({ sidebarWidth: z.number(), editorRatio: z.number(), bottomPanelHeight: z.number(), agentPanelOpen: z.boolean() }),
  terminalRecipe: z.array(z.string()),
  visibleTestRunIds: z.array(id),
  objective: z.string(),
  trainingTarget: trainingTargetSchema.nullable(),
  agent: z.object({
    lastDecision: z.string().nullable(),
    pendingLearnerQuestion: askUserQuestionRequestSchema.nullable(),
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
