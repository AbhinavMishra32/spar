import { app } from "electron";
import path from "node:path";
import { apiOrigin, DEV_API_ORIGIN } from "./apiOrigin.js";

/* Running from source against a real deployment (`pnpm dev:prod`).

   A checkout pointed at production behaves like a fresh install of the released
   app: it signs up and signs in against the real API, restores from it and goes
   through onboarding for a new account. It must not share anything local with
   the installed Spar or with the usual dev setup against localhost. So it gets
   its own data folder (the local store, workspaces, the single-instance lock)
   and its own keychain entries, both named after the host.

   A packaged build, and a checkout on the default localhost API, are left
   exactly as they were. */

/** The deployment's host when this is a checkout pointed away from localhost. */
export function devApiHost(): string | null {
  // No `app` outside Electron proper: the main-process tests run as plain Node.
  if (!app || app.isPackaged) return null;
  const origin = apiOrigin();
  if (origin === DEV_API_ORIGIN) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/** Moves userData aside. Call before anything reads it, the single-instance lock included. */
export function isolateDevProfile() {
  const host = devApiHost();
  if (host) app.setPath("userData", path.join(app.getPath("appData"), `Spar Dev (${host})`));
}

/** The keychain service the sessions and secrets are stored under. Only the
 *  packaged app uses the plain name. Every source checkout is named after the
 *  API it talks to, localhost included: the installed Spar and a dev build on
 *  the same Mac used to share one set of entries, so each signed the other in
 *  and out, and a token issued by one server was sent to the other. */
export function credentialService() {
  if (!app || app.isPackaged) return "ai.spar.desktop";
  let host = "unknown";
  try { host = new URL(apiOrigin()).host; } catch { /* keep the fallback */ }
  return `ai.spar.desktop.dev.${host}`;
}

/* `SPAR_ONBOARDING=1` sends an account that already has a profile through
   onboarding once per launch, for working on it against real data. The saved
   profile is only hidden, never deleted, and finishing onboarding replaces it
   the way a first run would. Source checkouts only. */
let replaying = Boolean(app) && !app.isPackaged && process.env.SPAR_ONBOARDING === "1";

/** The profile as the gate sees it: none while onboarding is being replayed. */
export function gatedProfile<T>(profile: T | null): T | null {
  return replaying ? null : profile;
}

export function finishOnboardingReplay() {
  replaying = false;
}

