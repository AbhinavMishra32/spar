import { app } from "electron";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Where this copy of Spar talks to the Spar API.
 *
 *  A packaged build cannot default to localhost. Someone who downloads Spar has
 *  no API running on their machine, so every sign-in fails with a refused
 *  connection that reads as the app being broken. Release builds are therefore
 *  stamped with the deployed origin.
 *
 *  Stamped through electron-builder's `extraMetadata`, which writes the value
 *  into the packaged `package.json`, rather than through the build environment: a
 *  packaged app does not inherit the environment of the machine that built it, so
 *  a `process.env` value set in CI would simply be undefined by the time anyone
 *  ran the app.
 *
 *  Precedence is override, then stamp, then localhost — so self-hosting is one
 *  environment variable, and a build cut before anything was deployed still runs
 *  against a local API instead of a dead URL. */

const DEV_API_ORIGIN = "http://localhost:4318";

let cached: string | undefined;

export function apiOrigin(): string {
  if (cached) return cached;
  cached = resolve();
  return cached;
}

function resolve(): string {
  const override = process.env.SPAR_API_ORIGIN?.trim();
  if (override) return trimSlash(override);
  const stamped = stampedOrigin();
  if (stamped) return trimSlash(stamped);
  return DEV_API_ORIGIN;
}

function stampedOrigin(): string | null {
  try {
    // Readable inside the asar as well as beside an unpackaged checkout.
    const manifest = readFileSync(path.join(app.getAppPath(), "package.json"), "utf8");
    const value = (JSON.parse(manifest) as { sparHostedApiOrigin?: unknown }).sparHostedApiOrigin;
    if (typeof value !== "string" || !value.trim()) return null;
    // A malformed stamp must not take the app down on launch.
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** True when a packaged build has nowhere real to talk to, so sign-in can explain
 *  that rather than reporting a refused connection. */
export function apiOriginIsUnconfigured(): boolean {
  return app.isPackaged && apiOrigin() === DEV_API_ORIGIN;
}

function trimSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
