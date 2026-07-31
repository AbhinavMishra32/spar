import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export class WorkspaceService {
  constructor(private readonly root: string) {}
  async read(sessionId: string, relativePath: string) { return readFile(this.resolve(sessionId, relativePath), "utf8"); }
  async write(sessionId: string, relativePath: string, content: string) { const target = this.resolve(sessionId, relativePath); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, { encoding: "utf8", flag: "w" }); }
  sessionRoot(sessionId: string) { return this.resolve(sessionId, "."); }
  private resolve(sessionId: string, relativePath: string) {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error("Invalid session identifier");
    const base = path.resolve(this.root, sessionId); const target = path.resolve(base, relativePath);
    if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error("Workspace path escapes session root");
    return target;
  }
}

