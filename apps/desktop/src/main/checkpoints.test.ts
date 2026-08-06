import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CHECKPOINT_FILE_LIMIT, type QuestionDesign } from "@spar/domain";
import { CheckpointService } from "./checkpoints.js";
import { LocalStore } from "./store.js";
import { WorkspaceService } from "./workspaces.js";

const design = (title: string): QuestionDesign => ({ title, language: "javascript", kind: "function", statement: "Implement the target behavior while preserving the declared invariant through every transition.", starterFiles: { "src/index.js": "export function solve(){ throw new Error(\"implement\") }" }, referenceFiles: { "src/index.js": "export function solve(){ return true }" }, visibleTests: { "tests/visible.test.js": "// visible" }, hiddenTests: { "tests/hidden.test.js": "// hidden" }, knownIncorrectFiles: [{ "src/index.js": "export function solve(){ return false }" }], runCommand: "node --test", accidentalDifficulty: [], expectedFailureSignatures: ["returns before restoring the invariant"] });

/** A store and a workspace on a real temporary directory, since the whole point
 *  of a checkpoint is what it reads off disk. */
function harness(work: (kit: { store: LocalStore; workspaces: WorkspaceService; checkpoints: CheckpointService; sessionId: string }) => Promise<void>) {
  return async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "spar-checkpoint-"));
    const store = new LocalStore(":memory:");
    try {
      const workspaces = new WorkspaceService(directory);
      const checkpoints = new CheckpointService(store, workspaces);
      const { sessionId } = store.createSession("Practise sliding windows");
      store.setTrainingTarget(sessionId, { ability: "Invariant restoration", specificGap: "Repeated restoration", desiredEvidence: "Loops until valid", avoidTesting: [] });
      store.createQuestion(sessionId, design("Restore the window"), { valid: true });
      await work({ store, workspaces, checkpoints, sessionId });
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

/* Checkpoints had never actually been written before this service existed: the
   IPC channel was wired from the beginning and no caller ever used it, so the
   local table was empty on every install and the cloud's copy was empty with it.
   A session could round-trip through the server and still reopen blank. */
describe("checkpoints", () => {
  it("captures the workspace so a session can be reopened elsewhere", harness(async ({ store, workspaces, checkpoints, sessionId }) => {
    await workspaces.writeAll(sessionId, { "src/index.js": "export function solve(){ return 42 }", "tests/visible.test.js": "// visible" });
    await checkpoints.writeNow(sessionId);

    const saved = store.latestCheckpoint(sessionId);
    expect(saved?.version).toBe(1);
    expect(saved?.sessionId).toBe(sessionId);
    /* The contents, not just the paths. A checkpoint that names files it cannot
       produce restores a session to an empty editor, which is the failure this
       whole feature exists to prevent. */
    expect(saved?.workspaceFiles.find((file) => file.path === "src/index.js")?.content).toBe("export function solve(){ return 42 }");
    expect(saved?.omittedFiles).toEqual([]);
    // And it is queued for the server, which is how it reaches another machine.
    expect(store.pendingSync().map((item) => item.kind)).toContain("checkpoint");
  }));

  it("versions each checkpoint so the newer one wins a reconcile", harness(async ({ store, workspaces, checkpoints, sessionId }) => {
    await workspaces.writeAll(sessionId, { "src/index.js": "first" });
    await checkpoints.writeNow(sessionId);
    await workspaces.writeAll(sessionId, { "src/index.js": "second" });
    await checkpoints.writeNow(sessionId);

    const saved = store.latestCheckpoint(sessionId);
    expect(saved?.version).toBe(2);
    expect(saved?.workspaceFiles[0]?.content).toBe("second");
  }));

  /* The bound exists because a checkpoint is a jsonb row and a sync payload, not
     a backup format. What matters is that going over it is reported rather than
     silently truncated — half a source file restored without a word is worse than
     a gap the app can name. */
  it("names an oversized file instead of truncating it", harness(async ({ store, workspaces, checkpoints, sessionId }) => {
    await workspaces.writeAll(sessionId, { "src/index.js": "small", "src/generated.js": "x".repeat(CHECKPOINT_FILE_LIMIT + 1) });
    await checkpoints.writeNow(sessionId);

    const saved = store.latestCheckpoint(sessionId);
    expect(saved?.omittedFiles).toEqual(["src/generated.js"]);
    const oversized = saved?.workspaceFiles.find((file) => file.path === "src/generated.js");
    // Still named and still hashed, so a restore can say what is missing.
    expect(oversized?.content).toBeUndefined();
    expect(oversized?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(saved?.workspaceFiles.find((file) => file.path === "src/index.js")?.content).toBe("small");
  }));

  it("does nothing for a session that has been deleted underneath it", harness(async ({ store, checkpoints, sessionId }) => {
    store.deleteSession(sessionId);
    await checkpoints.writeNow(sessionId);
    expect(store.latestCheckpoint(sessionId)).toBeNull();
  }));
});
