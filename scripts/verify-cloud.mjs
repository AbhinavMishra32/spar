import { cloudEnvironmentIsConfigured, ensureLocalEnvironment, run } from "./lib.mjs";

ensureLocalEnvironment();
if (!cloudEnvironmentIsConfigured()) {
  console.error("Cloud credentials are incomplete. Run `corepack pnpm cloud:configure` first.");
  process.exit(1);
}
run("corepack", ["pnpm", "--filter", "@spar/database", "db:migrate"]);
run("corepack", ["pnpm", "--filter", "@spar/api", "storage:provision"]);
run("corepack", ["pnpm", "--filter", "@spar/api", "storage:verify"]);
console.log("Cloud PostgreSQL and object storage are reachable and provisioned.");
