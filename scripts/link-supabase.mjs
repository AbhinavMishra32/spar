import { spawnSync } from "node:child_process";
import { ensureLocalEnvironment, readLocalEnvironment, root } from "./lib.mjs";

ensureLocalEnvironment();
const environment = readLocalEnvironment();
const projectRef = environment.SUPABASE_PROJECT_REF;
const databaseUrl = environment.DATABASE_URL;
if (!projectRef || !databaseUrl) throw new Error("Supabase project configuration is missing.");
const databasePassword = decodeURIComponent(new URL(databaseUrl).password);

const result = spawnSync("corepack", [
  "pnpm", "exec", "supabase", "link",
  "--project-ref", projectRef,
  "--password", databasePassword,
  "--output-format", "text"
], { cwd: root, env: process.env, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
