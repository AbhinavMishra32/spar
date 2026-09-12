import { existsSync } from "node:fs";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { cloudEnvironmentIsConfigured, ensureLocalEnvironment, probeDatabase, reportDatabaseProbe, root, run, runLongLived } from "./lib.mjs";

const turboBinary = resolve(root, "node_modules/.bin/turbo");
ensureLocalEnvironment();
if (!existsSync(turboBinary) || !cloudEnvironmentIsConfigured()) run("node", [resolve(root, "scripts/setup.mjs")]);
rmSync(resolve(root, "apps/desktop/dist/.main-ready"), { force: true });
/* Asked once, here, rather than discovered per request. Credentials that are
   the right shape are not the same as a database that answers, and the gap
   between those two is a boot that looks fine followed by every request
   failing with the cause buried in a stack trace. */
reportDatabaseProbe(await probeDatabase(), [
  "Starting anyway: the desktop app works against its local store, but anything",
  "that needs the cloud API will fail until this is fixed.",
]);

console.log("\nStarting API and macOS desktop application. Press Ctrl+C to stop both.\n");
runLongLived("corepack", ["pnpm", "dev:apps"]);
