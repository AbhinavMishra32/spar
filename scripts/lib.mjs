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

/**
 * Can the configured database actually be reached?
 *
 * `cloudEnvironmentIsConfigured` checks the *shape* of the credentials, which is
 * a different question and was the only one being asked. A `DATABASE_URL`
 * pointing at a Supabase project that has since been paused or deleted is
 * perfectly well-formed, so `pnpm dev` started an API that could not serve a
 * single request — and the first sign of it was a wall of Better Auth stack
 * traces with `ENOTFOUND` buried in the middle of one.
 *
 * DNS first, then a TCP connect. Between them they separate the three failures
 * that need three different responses: a host that does not resolve is a
 * project that is gone, a refused connection is a database that is down, and a
 * timeout is usually a network or an allow-list. Deliberately not a real
 * connection — no password leaves this process, and "is anything listening"
 * is the whole question.
 *
 * Returns a diagnosis rather than throwing, because the caller decides whether
 * an unreachable cloud is fatal. Working on the desktop app offline is
 * legitimate; being told about it in one line is not optional.
 */
export async function probeDatabase(timeoutMs = 4000) {
  const url = readLocalEnvironment().DATABASE_URL ?? "";
  let host = "";
  let port = 5432;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    if (parsed.port) port = Number(parsed.port);
  } catch {
    return { ok: false, host: "", port, reason: "unset", detail: "DATABASE_URL is missing or is not a URL." };
  }
  if (!host) return { ok: false, host, port, reason: "unset", detail: "DATABASE_URL names no host." };

  const { lookup } = await import("node:dns/promises");
  try {
    await lookup(host, { all: true });
  } catch (cause) {
    const code = cause?.code === "ENOTFOUND" || cause?.code === "EAI_AGAIN" ? cause.code : "DNS";
    return { ok: false, host, port, reason: code === "ENOTFOUND" ? "missing" : "dns", detail: `DNS lookup for ${host} failed (${code}).` };
  }

  const { connect } = await import("node:net");
  return await new Promise((settle) => {
    const socket = connect({ host, port });
    const finish = (result) => { socket.destroy(); settle(result); };
    socket.setTimeout(timeoutMs, () => finish({ ok: false, host, port, reason: "timeout", detail: `No answer from ${host}:${port} within ${timeoutMs / 1000}s.` }));
    socket.once("connect", () => finish({ ok: true, host, port, reason: "ok", detail: "" }));
    socket.once("error", (cause) => finish({ ok: false, host, port, reason: "refused", detail: `${host}:${port} refused the connection (${cause.code ?? cause.message}).` }));
  });
}

/** The diagnosis, and what to do about it. One block, at the top of the run,
 *  where it is still readable — not per request, interleaved with traffic.
 *  `closing` is the caller's own consequence: `pnpm dev` carries on without the
 *  cloud, `pnpm cloud:verify` stops, and saying which is the difference between
 *  a warning and an error. */
export function reportDatabaseProbe(probe, closing = []) {
  if (probe.ok) return;
  const advice = {
    unset: ["Run `corepack pnpm cloud:configure` to point Spar at a database."],
    missing: [
      `The host \`${probe.host}\` has no DNS record at all, which means the project behind it`,
      "no longer exists — a Supabase project that was deleted, or paused long enough to be removed.",
      "",
      "Create a new one with `corepack pnpm cloud:create`, or point DATABASE_URL at an existing",
      "database with `corepack pnpm cloud:configure`. Then `corepack pnpm cloud:verify`.",
    ],
    dns: ["DNS is not answering. If you are offline, the desktop app still runs; the cloud API will not."],
    refused: ["The host exists but nothing is listening on that port. The database may be paused or still starting."],
    timeout: [`Check that this machine is allowed to reach ${probe.host} — a database allow-list is the usual cause.`],
  }[probe.reason] ?? [];

  console.error("\n  Spar cannot reach its database.");
  console.error(`  ${probe.detail}`);
  for (const line of advice) console.error(`  ${line}`);
  if (closing.length) console.error("");
  for (const line of closing) console.error(`  ${line}`);
  console.error("");
}
