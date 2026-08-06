import { z } from "zod";
export const envSchema = z.object({ NODE_ENV: z.enum(["development","test","production"]).default("development"), PORT: z.coerce.number().int().positive().default(4318), DATABASE_URL: z.string().url(), SUPABASE_URL:z.string().url().optional(),SUPABASE_SECRET_KEY:z.string().min(20).optional(), AUTH_SECRET: z.string().min(32), OBJECT_STORAGE_ENDPOINT: z.string().url().optional(), OBJECT_STORAGE_BUCKET: z.string().min(1).default("spar"), OBJECT_STORAGE_REGION: z.string().min(1).default("auto"), OBJECT_STORAGE_ACCESS_KEY: z.string().min(1).optional(), OBJECT_STORAGE_SECRET_KEY: z.string().min(1).optional(), GOOGLE_CLIENT_ID: z.string().optional(), GOOGLE_CLIENT_SECRET: z.string().optional(), GITHUB_CLIENT_ID: z.string().optional(), GITHUB_CLIENT_SECRET: z.string().optional(),
  /* Where this API answers from the outside. Better Auth signs and checks against
     it, so it has to be the origin the desktop app actually calls — not the port
     the process happens to have bound. */
  AUTH_BASE_URL: z.string().url().optional(),
  /* Email delivery. Verification and password-reset codes are the whole of it, so
     one provider key and one verified sender is the whole configuration. */
  RESEND_API_KEY: z.string().min(10).optional(), EMAIL_FROM: z.string().min(3).optional() }).superRefine((value,context)=>{const supabase=Boolean(value.SUPABASE_URL&&value.SUPABASE_SECRET_KEY);const s3=Boolean(value.OBJECT_STORAGE_ENDPOINT&&value.OBJECT_STORAGE_ACCESS_KEY&&value.OBJECT_STORAGE_SECRET_KEY);if(!supabase&&!s3)context.addIssue({code:z.ZodIssueCode.custom,message:"Configure Supabase Storage or a complete S3-compatible provider"});
/* A deployment that cannot send email cannot verify an address or reset a
   password, and both are load-bearing once anyone but the author has an account.
   Running from source is allowed to skip it — see `createMailer`. */
if(value.NODE_ENV==="production"&&!(value.RESEND_API_KEY&&value.EMAIL_FROM))context.addIssue({code:z.ZodIssueCode.custom,message:"Set RESEND_API_KEY and EMAIL_FROM so the API can send verification and password-reset codes"});});
export type Env = z.infer<typeof envSchema>;
