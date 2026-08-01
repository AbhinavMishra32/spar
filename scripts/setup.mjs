import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { cloudEnvironmentIsConfigured, ensureLocalEnvironment, loadLocalEnvironment, root, run } from "./lib.mjs";

console.log("\nSpar setup\n");
ensureLocalEnvironment();

const turboBinary = resolve(root, "node_modules/.bin/turbo");
if (!existsSync(turboBinary) || process.argv.includes("--install")) {
  console.log("Installing workspace dependencies…");
  run("corepack", ["pnpm", "install"]);
}

if (!cloudEnvironmentIsConfigured()) {
  if (!process.stdin.isTTY) {
    console.error("Cloud credentials are missing. Run `corepack pnpm cloud:configure` in an interactive terminal.");
    process.exit(1);
  }
  run("node", [resolve(root, "scripts/configure-cloud.mjs")]);
  loadLocalEnvironment();
}

console.log("Applying committed migrations to cloud PostgreSQL…");
run("corepack", ["pnpm", "--filter", "@spar/database", "db:migrate"]);

console.log("Ensuring the cloud artifact bucket exists…");
run("corepack", ["pnpm", "--filter", "@spar/api", "storage:provision"]);

console.log("\nSetup complete. Run `corepack pnpm dev` to start Spar.\n");
