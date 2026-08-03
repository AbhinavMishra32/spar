import type { SubscriptionUsage, UsageWindow } from "../shared/api.js";

/** The two windows both subscriptions are actually rationed by. Anything else
 *  either upstream reports (per-model weeklies, overage credits) is dropped
 *  rather than shown, because a row the learner cannot act on is noise. */
const FIVE_HOUR_MINUTES = 300;
const WEEKLY_MINUTES = 7 * 24 * 60;

/**
 * ChatGPT publishes a Codex subscription's remaining quota only on the headers
 * of the turn that spent it — there is no endpoint to ask. So this reads the
 * headers Spar already receives, and the caller keeps the last snapshot: until
 * a ChatGPT turn has actually run, Spar genuinely does not know the numbers and
 * says so rather than showing a full ring it made up.
 */
export function codexUsageFromHeaders(headers: Headers | Record<string, string>, now = Date.now()): SubscriptionUsage | null {
  const read = (name: string) => {
    const value = headers instanceof Headers ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()];
    return value === null || value === undefined || value === "" ? null : value;
  };
  const windows = (["primary", "secondary"] as const).flatMap((slot): UsageWindow[] => {
    const usedPercent = number(read(`x-codex-${slot}-used-percent`));
    const kind = windowKind(number(read(`x-codex-${slot}-window-minutes`)));
    if (usedPercent === null || !kind) return [];
    const resetAt = number(read(`x-codex-${slot}-reset-at`));
    const resetAfter = number(read(`x-codex-${slot}-reset-after-seconds`));
    const resetsAt = resetAt ?? (resetAfter === null ? null : Math.round(now / 1_000) + resetAfter);
    return [{ kind, usedPercent: clampPercent(usedPercent), resetsAt }];
  });
  return windows.length ? { windows, capturedAt: now } : null;
}

/**
 * Claude's OAuth session, unlike Codex, can be asked directly, so its numbers
 * are current without the learner having had to run a turn first. `utilization`
 * comes back as whole percent and `resets_at` as an ISO timestamp, but both are
 * normalized defensively — this is an unversioned endpoint, and a ring drawn
 * from a misread field is worse than no ring.
 */
export async function anthropicUsage(accessToken: string, signal?: AbortSignal, now = Date.now()): Promise<SubscriptionUsage | null> {
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: { authorization: `Bearer ${accessToken}`, "anthropic-beta": "oauth-2025-04-20", "content-type": "application/json" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) return null;
  const body = await response.json() as Record<string, unknown>;
  const windows = ([["five_hour", "five-hour"], ["seven_day", "weekly"]] as const).flatMap(([key, kind]): UsageWindow[] => {
    const value = body[key];
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const usedPercent = number(record.utilization);
    if (usedPercent === null) return [];
    return [{ kind, usedPercent: clampPercent(usedPercent), resetsAt: epochSeconds(record.resets_at) }];
  });
  return windows.length ? { windows, capturedAt: now } : null;
}

function windowKind(minutes: number | null): UsageWindow["kind"] | null {
  if (minutes === FIVE_HOUR_MINUTES) return "five-hour";
  if (minutes === WEEKLY_MINUTES) return "weekly";
  return null;
}

function number(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Anthropic reports whole percent and Codex reports whole percent; a value
 *  that arrives as a 0–1 fraction is a changed contract, not 1% used. */
function clampPercent(value: number) {
  const percent = value > 0 && value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, percent));
}

function epochSeconds(value: unknown): number | null {
  const numeric = number(value);
  if (numeric !== null) return numeric > 1e11 ? Math.round(numeric / 1_000) : Math.round(numeric);
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.round(parsed / 1_000);
}
