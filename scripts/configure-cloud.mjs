import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Writable } from "node:stream";
import { ensureLocalEnvironment, readLocalEnvironment, updateLocalEnvironment } from "./lib.mjs";

ensureLocalEnvironment();
const current = readLocalEnvironment();
const prompt = createInterface({ input: stdin, output: stdout });
const ask = async (label, previous = "") => {
  const safePrevious = previous.includes("localhost") ? "" : previous;
  const suffix = safePrevious ? ` [${safePrevious}]` : "";
  const answer = (await prompt.question(`${label}${suffix}: `)).trim();
  return answer || safePrevious;
};
const askSecret = async (label, previous = "") => {
  stdout.write(`${label}${previous ? " [stored; press Enter to keep]" : ""}: `);
  const mutedOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const hiddenPrompt = createInterface({ input: stdin, output: mutedOutput, terminal: true });
  const answer = (await hiddenPrompt.question("")).trim();
  hiddenPrompt.close();
  stdout.write("\n");
  return answer || previous;
};

console.log(`
Configure managed PostgreSQL and S3-compatible storage.

Recommended: create one Supabase project, enable the vector extension, then copy:
  1. Database > Connect > connection string
  2. Storage > S3 > endpoint, region, access key, and secret key
`);

const values = {
  DATABASE_URL: await ask("PostgreSQL connection URL", current.DATABASE_URL),
  OBJECT_STORAGE_ENDPOINT: await ask("S3 endpoint URL", current.OBJECT_STORAGE_ENDPOINT),
  OBJECT_STORAGE_REGION: await ask("S3 region", current.OBJECT_STORAGE_REGION || "auto"),
  OBJECT_STORAGE_BUCKET: await ask("S3 bucket name", current.OBJECT_STORAGE_BUCKET || "spar"),
  OBJECT_STORAGE_ACCESS_KEY: await ask("S3 access key ID", current.OBJECT_STORAGE_ACCESS_KEY),
  OBJECT_STORAGE_SECRET_KEY: await askSecret("S3 secret access key", current.OBJECT_STORAGE_SECRET_KEY)
};
prompt.close();

if (!values.DATABASE_URL.startsWith("postgres") || values.DATABASE_URL.includes("localhost")) throw new Error("A remote PostgreSQL URL is required.");
if (!values.OBJECT_STORAGE_ENDPOINT.startsWith("https://")) throw new Error("A secure S3 endpoint is required.");
if (!values.OBJECT_STORAGE_ACCESS_KEY || !values.OBJECT_STORAGE_SECRET_KEY) throw new Error("S3 credentials are required.");
updateLocalEnvironment(values);
console.log("Saved cloud configuration to the git-ignored .env.local file (mode 0600).\n");
