import { cloudEnvironmentIsConfigured, ensureLocalEnvironment, probeDatabase, reportDatabaseProbe, run } from "./lib.mjs";

ensureLocalEnvironment();
if (!cloudEnvironmentIsConfigured()) {
  console.error("Cloud credentials are incomplete. Run `corepack pnpm cloud:configure` first.");
  process.exit(1);
}

/* Before the migration runner, so an unreachable database is reported as an
   unreachable database rather than as a failed migration. This command exists
   to answer "is the cloud working", and it should say why when the answer is
   no. */
const probe = await probeDatabase();
if (!probe.ok) {
  reportDatabaseProbe(probe);
  process.exit(1);
}
run("corepack", ["pnpm", "--filter", "@spar/database", "db:migrate"]);
run("corepack", ["pnpm", "--filter", "@spar/api", "storage:provision"]);
run("corepack", ["pnpm", "--filter", "@spar/api", "storage:verify"]);
console.log("Cloud PostgreSQL and object storage are reachable and provisioned.");
