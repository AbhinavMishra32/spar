import path from "node:path";
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";

export class WorkspaceService {
  constructor(private readonly root: string) {}
  async read(sessionId: string, relativePath: string) { return readFile(this.resolve(sessionId, relativePath), "utf8"); }
  async write(sessionId: string, relativePath: string, content: string) { const target = this.resolve(sessionId, relativePath); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, { encoding: "utf8", flag: "w" }); }
  async writeAll(sessionId: string, files: Record<string,string>) { for (const [relativePath, content] of Object.entries(files)) await this.write(sessionId, relativePath, content); }
  /** Replace only live challenge files. Validation sandboxes stay isolated under .spar. */
  async replaceAll(sessionId:string,files:Record<string,string>){const base=this.sessionRoot(sessionId);const entries=await readdir(base,{withFileTypes:true}).catch(()=>[]);for(const entry of entries){if(entry.name===".spar")continue;await rm(path.join(base,entry.name),{recursive:true,force:true});}await this.writeAll(sessionId,files);}
  async list(sessionId: string) { const base=this.sessionRoot(sessionId);const walk=async(dir:string):Promise<string[]>=>{const entries=await readdir(dir,{withFileTypes:true}).catch(()=>[]);const nested=await Promise.all(entries.filter(entry=>entry.name!==".spar"&&entry.name!=="node_modules").map(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):Promise.resolve([path.relative(base,path.join(dir,entry.name))])));return nested.flat();};return walk(base); }
  validationRoot(sessionId:string,validationId:string){return this.resolve(sessionId,path.join(".spar","validation",validationId));}
  async writeValidation(sessionId:string,validationId:string,files:Record<string,string>){const root=this.validationRoot(sessionId,validationId);await rm(root,{recursive:true,force:true});for(const [relativePath,content] of Object.entries(files)){const target=path.resolve(root,relativePath);if(!target.startsWith(`${root}${path.sep}`))throw new Error("Validation path escapes workspace");await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content,"utf8");}return root;}
  async removeValidation(sessionId:string,validationId:string){await rm(this.validationRoot(sessionId,validationId),{recursive:true,force:true});}
  /** Everything on disk for one deleted session, validation sandboxes included. */
  async remove(sessionId:string){await rm(this.sessionRoot(sessionId),{recursive:true,force:true});}
  async clear(){await rm(this.root,{recursive:true,force:true});await mkdir(this.root,{recursive:true});}
  sessionRoot(sessionId: string) { return this.resolve(sessionId, "."); }
  private resolve(sessionId: string, relativePath: string) {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error("Invalid session identifier");
    const base = path.resolve(this.root, sessionId); const target = path.resolve(base, relativePath);
    if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error("Workspace path escapes session root");
    return target;
  }
}
