import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { ensureLocalEnvironment, root, runLongLived } from "./lib.mjs";

/* The desktop app from source, against the deployed API instead of a local one:
   signing up sends a real verification email, and a new account goes through
   the whole onboarding exactly as a download would. No local API or database is
   started. The app keeps its own data folder and keychain entries for this host
   (see apps/desktop/src/main/devProfile.ts), so it never touches the installed
   Spar or the usual localhost setup.

   SPAR_PROD_API_ORIGIN points it at another deployment. SPAR_ONBOARDING=1
   replays onboarding for an account that has already finished it. */

const origin = process.env.SPAR_PROD_API_ORIGIN?.trim() || "https://spar.abhinavmishra.in";
ensureLocalEnvironment();
// Set after .env.local is loaded, which may name the localhost API.
process.env.SPAR_API_ORIGIN = origin;
rmSync(resolve(root, "apps/desktop/dist/.main-ready"), { force: true });

console.log(`\nStarting the desktop app against ${origin}. Press Ctrl+C to stop.\n`);
runLongLived("corepack", ["pnpm", "exec", "turbo", "run", "dev",
  "--filter=@spar/domain", "--filter=@spar/database", "--filter=@spar/provider", "--filter=@spar/practice",
  "--filter=@spar/visualizer", "--filter=@spar/training", "--filter=@spar/desktop",
  "--parallel", "--ui=stream"]);
