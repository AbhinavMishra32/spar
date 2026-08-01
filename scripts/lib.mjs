import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const envFile = resolve(root, ".env.local");
const exampleEnvFile = resolve(root, ".env.example");

export function ensureLocalEnvironment() {
  if (!existsSync(envFile)) {
    const example = readFileSync(exampleEnvFile, "utf8");
    const secret = randomBytes(32).toString("hex");
    writeFileSync(envFile, example.replace("AUTH_SECRET=generated-by-pnpm-setup", `AUTH_SECRET=${secret}`), { mode: 0o600 });
    console.log("Created .env.local with a generated authentication secret.");
  }
  loadLocalEnvironment();
}

export function readLocalEnvironment() {
  if (!existsSync(envFile)) return {};
  return Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) return [];
    const [, key, rawValue] = match;
    const value = rawValue.startsWith('"') && rawValue.endsWith('"') ? rawValue.slice(1, -1) : rawValue;
    return [[key, value]];
  }));
}

export function loadLocalEnvironment() {
  Object.assign(process.env, readLocalEnvironment());
}

export function cloudEnvironmentIsConfigured() {
  const environment = readLocalEnvironment();
  return Boolean(
    environment.DATABASE_URL?.startsWith("postgres") &&
    !environment.DATABASE_URL.includes("localhost") &&
    ((environment.SUPABASE_URL?.startsWith("https://") && environment.SUPABASE_SECRET_KEY) ||
      (environment.OBJECT_STORAGE_ENDPOINT?.startsWith("https://") && environment.OBJECT_STORAGE_ACCESS_KEY && environment.OBJECT_STORAGE_SECRET_KEY))
  );
}

export function updateLocalEnvironment(updates) {
  const existing = readFileSync(envFile, "utf8");
  const seen = new Set();
  const lines = existing.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match || !(match[1] in updates)) return line;
    seen.add(match[1]);
    return `${match[1]}=${updates[match[1]]}`;
  });
  for (const [key, value] of Object.entries(updates)) if (!seen.has(key)) lines.push(`${key}=${value}`);
  writeFileSync(envFile, `${lines.filter((line, index) => line || index < lines.length - 1).join("\n")}\n`, { mode: 0o600 });
  loadLocalEnvironment();
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function runLongLived(command, args) {
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: "inherit" });
  const forward = (signal) => child.kill(signal);
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.removeListener("SIGINT", forward);
    process.removeListener("SIGTERM", forward);
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

export function requireCommand(command, help) {
  const result = spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
  if (result.status !== 0) {
    console.error(`${command} is required. ${help}`);
    process.exit(1);
  }
}
