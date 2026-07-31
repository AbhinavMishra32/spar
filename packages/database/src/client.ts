import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export function createDatabase(url: string) {
  const client = postgres(url, { max: 10, prepare: false });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
export type Database = ReturnType<typeof createDatabase>["db"];

