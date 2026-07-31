import { describe,expect,it } from "vitest";
import { envSchema } from "./env.js";
describe("API environment",()=>{it("rejects weak auth secrets",()=>{expect(()=>envSchema.parse({DATABASE_URL:"postgresql://localhost/db",AUTH_SECRET:"short",OBJECT_STORAGE_ENDPOINT:"http://localhost:9000",OBJECT_STORAGE_BUCKET:"x",OBJECT_STORAGE_ACCESS_KEY:"",OBJECT_STORAGE_SECRET_KEY:""})).toThrow();});});
