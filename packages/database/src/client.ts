import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

/* One long-lived server can hold a real pool. A serverless instance cannot: it
   handles one request at a time and there may be hundreds of instances, so a pool
   of ten per instance is a hundredfold overcount of the connections the database
   is actually being asked for, and Postgres runs out of them long before the
   traffic justifies it. `prepare: false` is for the same environment — Supabase's
   transaction-mode pooler rejects prepared statements outright. */
export function createDatabase(url: string, options: { maxConnections?: number } = {}) {
  const serverless = Boolean(process.env.VERCEL ?? process.env.AWS_LAMBDA_FUNCTION_NAME);
  const max = options.maxConnections ?? (serverless ? 1 : 10);
  return withClient(postgres(url, { max, prepare: false }));
}

function withClient(client: ReturnType<typeof postgres>) {
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
export type Database = ReturnType<typeof createDatabase>["db"];
