import { describe,expect,it } from "vitest";
import { envSchema, objectStorageConfigured } from "./env.js";
describe("API environment",()=>{
  it("rejects weak auth secrets",()=>{expect(()=>envSchema.parse({DATABASE_URL:"postgresql://localhost/db",AUTH_SECRET:"short",OBJECT_STORAGE_ENDPOINT:"http://localhost:9000",OBJECT_STORAGE_BUCKET:"x",OBJECT_STORAGE_ACCESS_KEY:"",OBJECT_STORAGE_SECRET_KEY:""})).toThrow();});
  /* Object storage backs one route — `/v1/storage/upload` — that nothing in the
     desktop app calls; challenge artifacts and workspace files both ride inline
     as jsonb instead. A deployment should not have to stand up a bucket it has
     no use for yet just to boot. */
  it("boots with neither Supabase nor S3 storage configured",()=>{const env=envSchema.parse({DATABASE_URL:"postgresql://localhost/db",AUTH_SECRET:"x".repeat(32)});expect(objectStorageConfigured(env)).toBe(false);});
  it("still refuses to boot in production without a mailer",()=>{expect(()=>envSchema.parse({NODE_ENV:"production",DATABASE_URL:"postgresql://localhost/db",AUTH_SECRET:"x".repeat(32)})).toThrow(/RESEND_API_KEY/);});
  it("recognises either storage pair as configured",()=>{
    const supabase=envSchema.parse({DATABASE_URL:"postgresql://localhost/db",AUTH_SECRET:"x".repeat(32),SUPABASE_URL:"https://example.supabase.co",SUPABASE_SECRET_KEY:"x".repeat(20)});
    expect(objectStorageConfigured(supabase)).toBe(true);
    const s3=envSchema.parse({DATABASE_URL:"postgresql://localhost/db",AUTH_SECRET:"x".repeat(32),OBJECT_STORAGE_ENDPOINT:"http://localhost:9000",OBJECT_STORAGE_ACCESS_KEY:"a",OBJECT_STORAGE_SECRET_KEY:"b"});
    expect(objectStorageConfigured(s3)).toBe(true);
  });
});
