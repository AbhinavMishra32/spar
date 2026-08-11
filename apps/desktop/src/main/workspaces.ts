import path from "node:path";
import { mkdir, readFile, writeFile, readdir, rename, rm } from "node:fs/promises";
import { canonicalWorkspacePath } from "../shared/workspacePath.js";

export class WorkspaceService {
  /**
   * A challenge replacement removes the old live tree before publishing the new
   * one. Reads and saves must not observe that intermediate state: otherwise the
   * editor can ask for a perfectly valid file while its parent directory is
   * between removal and recreation and surface a raw ENOENT.
   */
  private readonly replacements = new Map<string, Promise<void>>();

  constructor(private readonly root: string) {}
  async read(sessionId: string, relativePath: string) {
    await this.waitForReplacement(sessionId);
    return readFile(this.resolve(sessionId, relativePath), "utf8");
  }
  async write(sessionId: string, relativePath: string, content: string) {
    await this.waitForReplacement(sessionId);
    await this.writeDirect(sessionId, relativePath, content);
  }
  async writeAll(sessionId: string, files: Record<string,string>) {
    await this.waitForReplacement(sessionId);
    await this.writeAllDirect(sessionId, files);
  }
  /** Restore the persisted challenge invariant without overwriting learner work. */
  async ensureFiles(sessionId: string, files: Record<string,string>) {
    await this.waitForReplacement(sessionId);
    for (const [relativePath, content] of this.canonicalEntries(files)) {
      const target = this.resolve(sessionId, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, { encoding: "utf8", flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    }
  }
  /** Replace only live challenge files. Validation sandboxes stay isolated under .spar. */
  async replaceAll(sessionId:string,files:Record<string,string>){
    /* Publish the barrier before the first await. If barrier installation itself
       yielded, a read started in the same tick could still slip through and see
       the old file or the deletion gap. Chaining also serializes two competing
       replacements for the same session. */
    const previous = this.replacements.get(sessionId) ?? Promise.resolve();
    const replacement = previous.catch(() => undefined).then(async () => {
      const base=this.sessionRoot(sessionId);
      const entries=await readdir(base,{withFileTypes:true}).catch(()=>[]);
      for(const entry of entries){if(entry.name===".spar")continue;await rm(path.join(base,entry.name),{recursive:true,force:true});}
      await this.writeAllDirect(sessionId,files);
    });
    this.replacements.set(sessionId, replacement);
    try { await replacement; }
    finally { if (this.replacements.get(sessionId) === replacement) this.replacements.delete(sessionId); }
  }
  async list(sessionId: string) { await this.waitForReplacement(sessionId);const base=this.sessionRoot(sessionId);await this.reconcileAliases(base);return this.walk(base,base); }
  /** Collapse identical separator aliases before a compiler sees the tree. */
  async prepareForExecution(sessionId:string){await this.waitForReplacement(sessionId);await this.reconcileAliases(this.sessionRoot(sessionId));}
  /* ---- Practice sandboxes -------------------------------------------------
     Re-opening a challenge from history is rehearsal, not an attempt: it earns
     no evidence and it must never disturb the live challenge the session is on.
     So it gets its own directory under .spar, which `replaceAll` and `list`
     already skip — the session's own workspace is untouched by anything the
     learner does in here, and the sandbox survives the app being closed. */
  practiceRoot(sessionId:string,questionId:string){if(!/^[0-9a-f-]{36}$/i.test(questionId))throw new Error("Invalid challenge identifier");return this.resolve(sessionId,path.join(".spar","practice",questionId));}
  /** Seeds the sandbox from the generated files the first time, then leaves it
   *  alone: after that the directory is the learner's, edits included. */
  async ensurePractice(sessionId:string,questionId:string,seed:Record<string,string>){const root=this.practiceRoot(sessionId,questionId);const existing=await readdir(root).catch(()=>null);if(!existing?.length)await this.writePractice(sessionId,questionId,seed);return root;}
  async writePractice(sessionId:string,questionId:string,files:Record<string,string>){const root=this.practiceRoot(sessionId,questionId);for(const [relativePath,content] of this.canonicalEntries(files)){const target=this.resolveWithin(root,relativePath);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content,"utf8");}return root;}
  /** The sandbox's copy of one file, or null when it was never seeded. */
  async readPractice(sessionId:string,questionId:string,relativePath:string){const root=this.practiceRoot(sessionId,questionId);return readFile(this.resolveWithin(root,relativePath),"utf8").catch(()=>null);}
  async resetPractice(sessionId:string,questionId:string,seed:Record<string,string>){await rm(this.practiceRoot(sessionId,questionId),{recursive:true,force:true});return this.writePractice(sessionId,questionId,seed);}

  validationRoot(sessionId:string,validationId:string){return this.resolve(sessionId,path.join(".spar","validation",validationId));}
  async writeValidation(sessionId:string,validationId:string,files:Record<string,string>){const root=this.validationRoot(sessionId,validationId);await rm(root,{recursive:true,force:true});for(const [relativePath,content] of this.canonicalEntries(files)){const target=this.resolveWithin(root,relativePath);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content,"utf8");}return root;}
  async removeValidation(sessionId:string,validationId:string){await rm(this.validationRoot(sessionId,validationId),{recursive:true,force:true});}
  /** Everything on disk for one deleted session, validation sandboxes included. */
  async remove(sessionId:string){await rm(this.sessionRoot(sessionId),{recursive:true,force:true});}
  async clear(){await rm(this.root,{recursive:true,force:true});await mkdir(this.root,{recursive:true});}
  sessionRoot(sessionId: string) { return this.resolve(sessionId, "."); }
  private async waitForReplacement(sessionId: string) { await this.replacements.get(sessionId); }
  private async writeDirect(sessionId: string, relativePath: string, content: string) { const target = this.resolve(sessionId, canonicalWorkspacePath(relativePath)); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, { encoding: "utf8", flag: "w" }); }
  private async writeAllDirect(sessionId: string, files: Record<string,string>) { for (const [relativePath, content] of this.canonicalEntries(files)) await this.writeDirect(sessionId, relativePath, content); }
  private canonicalEntries(files:Record<string,string>){const seen=new Map<string,string>();return Object.entries(files).map(([original,content])=>{const canonical=canonicalWorkspacePath(original);const previous=seen.get(canonical);if(previous&&previous!==original)throw new Error(`Workspace path collision: ${previous} and ${original} both identify ${canonical}`);seen.set(canonical,original);return[canonical,content] as const;});}
  private resolveWithin(root:string,relativePath:string){const target=path.resolve(root,...canonicalWorkspacePath(relativePath).split("/"));if(!target.startsWith(`${root}${path.sep}`))throw new Error("Workspace path escapes workspace root");return target;}
  private async walk(root:string,dir:string):Promise<string[]>{const entries=await readdir(dir,{withFileTypes:true}).catch(()=>[]);const nested=await Promise.all(entries.filter(entry=>entry.name!==".spar"&&entry.name!=="node_modules").map(entry=>entry.isDirectory()?this.walk(root,path.join(dir,entry.name)):Promise.resolve([canonicalWorkspacePath(path.relative(root,path.join(dir,entry.name)))])));return [...new Set(nested.flat())];}
  private async reconcileAliases(root:string){const physical=await this.walkPhysical(root,root);const groups=new Map<string,string[]>();for(const relative of physical){const canonical=canonicalWorkspacePath(relative);groups.set(canonical,[...(groups.get(canonical)??[]),relative]);}for(const[canonical,aliases]of groups){const distinct=[...new Set(aliases.map(relative=>path.resolve(root,relative)))];const target=this.resolveWithin(root,canonical);if(distinct.length===1)continue;const contents=await Promise.all(distinct.map(file=>readFile(file)));if(contents.some(content=>!content.equals(contents[0]!)))throw new Error(`Workspace path conflict: ${aliases.map(value=>JSON.stringify(value)).join(" and ")} both identify ${canonical} but contain different content`);await mkdir(path.dirname(target),{recursive:true});if(!distinct.includes(target))await rename(distinct[0]!,target);for(const file of distinct)if(file!==target)await rm(file,{force:true});}}
  private async walkPhysical(root:string,dir:string):Promise<string[]>{const entries=await readdir(dir,{withFileTypes:true}).catch(()=>[]);const nested=await Promise.all(entries.filter(entry=>entry.name!==".spar"&&entry.name!=="node_modules").map(entry=>entry.isDirectory()?this.walkPhysical(root,path.join(dir,entry.name)):Promise.resolve([path.relative(root,path.join(dir,entry.name))])));return nested.flat();}
  private resolve(sessionId: string, relativePath: string) {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error("Invalid session identifier");
    const base = path.resolve(this.root, sessionId); const canonical=relativePath==="."?".":canonicalWorkspacePath(relativePath);const target = path.resolve(base,...canonical.split("/"));
    if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error("Workspace path escapes session root");
    return target;
  }
}
