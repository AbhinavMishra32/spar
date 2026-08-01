import { existsSync } from "node:fs";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { cloudEnvironmentIsConfigured, ensureLocalEnvironment, root, run, runLongLived } from "./lib.mjs";

const turboBinary = resolve(root, "node_modules/.bin/turbo");
ensureLocalEnvironment();
if (!existsSync(turboBinary) || !cloudEnvironmentIsConfigured()) run("node", [resolve(root, "scripts/setup.mjs")]);
rmSync(resolve(root, "apps/desktop/dist/.main-ready"), { force: true });
console.log("\nStarting API and macOS desktop application. Press Ctrl+C to stop both.\n");
runLongLived("corepack", ["pnpm", "dev:apps"]);
