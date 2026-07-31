import { z } from "zod";
export const envSchema = z.object({ NODE_ENV: z.enum(["development","test","production"]).default("development"), PORT: z.coerce.number().int().positive().default(4318), DATABASE_URL: z.string().url(), AUTH_SECRET: z.string().min(32), OBJECT_STORAGE_ENDPOINT: z.string().url(), OBJECT_STORAGE_BUCKET: z.string().min(1), OBJECT_STORAGE_ACCESS_KEY: z.string(), OBJECT_STORAGE_SECRET_KEY: z.string(), GOOGLE_CLIENT_ID: z.string().optional(), GOOGLE_CLIENT_SECRET: z.string().optional(), GITHUB_CLIENT_ID: z.string().optional(), GITHUB_CLIENT_SECRET: z.string().optional() });
export type Env = z.infer<typeof envSchema>;

