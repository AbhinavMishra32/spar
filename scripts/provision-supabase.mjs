import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ensureLocalEnvironment, root, updateLocalEnvironment } from "./lib.mjs";

const organizationId = process.env.SUPABASE_ORG_ID ?? "qvyfgnoiahdsulnumxov";
const region = process.env.SUPABASE_REGION ?? "ap-south-1";
const databasePassword = randomBytes(32).toString("base64url");

ensureLocalEnvironment();
const result = spawnSync("corepack", [
  "pnpm", "exec", "supabase", "projects", "create", "pracai",
  "--org-id", organizationId,
  "--db-password", databasePassword,
  "--region", region,
  "--output-format", "json"
], { cwd: root, encoding: "utf8", env: process.env });

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const response = JSON.parse(result.stdout);
const project = response.project ?? response;
const projectRef = project.ref ?? project.id;
if (!projectRef) throw new Error("Supabase did not return a project reference.");

const encodedPassword = encodeURIComponent(databasePassword);
updateLocalEnvironment({
  SUPABASE_PROJECT_REF: projectRef,
  DATABASE_URL: `postgresql://postgres:${encodedPassword}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
  OBJECT_STORAGE_ENDPOINT: `https://${projectRef}.storage.supabase.co/storage/v1/s3`,
  OBJECT_STORAGE_REGION: region,
  OBJECT_STORAGE_BUCKET: "pracai"
});

console.log(`Created Supabase project pracai (${projectRef}) in ${region}.`);
console.log("Its generated database credential was stored only in .env.local.");
