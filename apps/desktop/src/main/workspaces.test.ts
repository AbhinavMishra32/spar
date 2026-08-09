import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceService } from "./workspaces.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "spar-workspaces-"));
  roots.push(root);
  return { service: new WorkspaceService(root), sessionId: randomUUID(), root };
}

describe("WorkspaceService recovery", () => {
  it("recreates missing declared files without overwriting learner work", async () => {
    const { service, sessionId } = await workspace();
    await service.write(sessionId, "src/solution.ts", "learner edit");

    await service.ensureFiles(sessionId, {
      "src/solution.ts": "starter",
      "tests/examples.test.ts": "visible tests",
    });

    expect(await service.read(sessionId, "src/solution.ts")).toBe("learner edit");
    expect(await service.read(sessionId, "tests/examples.test.ts")).toBe("visible tests");
  });

  it("does not let a read observe the empty middle of a replacement", async () => {
    const { service, sessionId, root } = await workspace();
    await service.write(sessionId, "src/solution.ts", "old");

    const replacement = service.replaceAll(sessionId, { "src/solution.ts": "new" });
    const read = service.read(sessionId, "src/solution.ts");
    await replacement;

    expect(await read).toBe("new");
    expect(await readFile(path.join(root, sessionId, "src/solution.ts"), "utf8")).toBe("new");
  });
});
