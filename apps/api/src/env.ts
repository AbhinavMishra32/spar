import { z } from "zod";
export const envSchema = z.object({ NODE_ENV: z.enum(["development","test","production"]).default("development"), PORT: z.coerce.number().int().positive().default(4318), DATABASE_URL: z.string().url(), SUPABASE_URL:z.string().url().optional(),SUPABASE_SECRET_KEY:z.string().min(20).optional(), AUTH_SECRET: z.string().min(32), OBJECT_STORAGE_ENDPOINT: z.string().url().optional(), OBJECT_STORAGE_BUCKET: z.string().min(1).default("spar"), OBJECT_STORAGE_REGION: z.string().min(1).default("auto"), OBJECT_STORAGE_ACCESS_KEY: z.string().min(1).optional(), OBJECT_STORAGE_SECRET_KEY: z.string().min(1).optional(), GOOGLE_CLIENT_ID: z.string().optional(), GOOGLE_CLIENT_SECRET: z.string().optional(), GITHUB_CLIENT_ID: z.string().optional(), GITHUB_CLIENT_SECRET: z.string().optional(),
  /* Where this API answers from the outside. Better Auth signs and checks against
     it, so it has to be the origin the desktop app actually calls — not the port
     the process happens to have bound. */
  AUTH_BASE_URL: z.string().url().optional(),
  /* Email delivery. Verification and password-reset codes are the whole of it, so
     one provider key and one verified sender is the whole configuration. */
  RESEND_API_KEY: z.string().min(10).optional(), EMAIL_FROM: z.string().min(3).optional() }).superRefine((value,context)=>{
/* Object storage is deliberately not required. Nothing calls `/v1/storage/upload`
   today — challenge artifacts and workspace files both ride inline as jsonb — so
   a deployment with neither Supabase nor S3 configured is a deployment that just
   doesn't offer that one route yet; `storage.ts`'s caller checks for that and
   answers 503 rather than the API refusing to boot over a route nobody uses. */
/* A deployment that cannot send email cannot verify an address or reset a
   password, and both are load-bearing once anyone but the author has an account.
   Running from source is allowed to skip it — see `createMailer`. */
if(value.NODE_ENV==="production"&&!(value.RESEND_API_KEY&&value.EMAIL_FROM))context.addIssue({code:z.ZodIssueCode.custom,message:"Set RESEND_API_KEY and EMAIL_FROM so the API can send verification and password-reset codes"});});
export type Env = z.infer<typeof envSchema>;
/** Whether enough is configured to actually build an `ObjectStorage`. Kept next
 *  to the schema rather than inside `storage.ts`, so the one decision of "is
 *  storage usable" is made in one place instead of duplicated between whoever
 *  constructs it and whoever calls it. */
export function objectStorageConfigured(env: Env) {
  return Boolean((env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) || (env.OBJECT_STORAGE_ENDPOINT && env.OBJECT_STORAGE_ACCESS_KEY && env.OBJECT_STORAGE_SECRET_KEY));
}
