import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicUsage, codexUsageFromHeaders } from "./subscriptionUsage.js";

const NOW = 1_800_000_000_000;

describe("codex rate-limit headers", () => {
  it("reads both windows and resolves a relative reset to an absolute one", () => {
    const usage = codexUsageFromHeaders({
      "x-codex-primary-used-percent": "37.5",
      "x-codex-primary-window-minutes": "300",
      "x-codex-primary-reset-after-seconds": "600",
      "x-codex-secondary-used-percent": "100",
      "x-codex-secondary-window-minutes": "10080",
      "x-codex-secondary-reset-at": "1800001234",
    }, NOW);
    expect(usage).toEqual({
      capturedAt: NOW,
      windows: [
        { kind: "five-hour", usedPercent: 37.5, resetsAt: NOW / 1_000 + 600 },
        { kind: "weekly", usedPercent: 100, resetsAt: 1_800_001_234 },
      ],
    });
  });

  /* A window Spar has no row for must not be filed as one it does. Codex has
     shipped windows other than the two before, and mislabelling a 24-hour
     window as the weekly one would misreport what is actually left. */
  it("drops windows it cannot name and reports nothing when none remain", () => {
    expect(codexUsageFromHeaders({ "x-codex-primary-used-percent": "10", "x-codex-primary-window-minutes": "1440" }, NOW)).toBeNull();
    expect(codexUsageFromHeaders({}, NOW)).toBeNull();
  });

  it("reads the same headers off a real Headers object", () => {
    const headers = new Headers({ "x-codex-primary-used-percent": "12", "x-codex-primary-window-minutes": "300" });
    expect(codexUsageFromHeaders(headers, NOW)?.windows).toEqual([{ kind: "five-hour", usedPercent: 12, resetsAt: null }]);
  });
});

describe("anthropic oauth usage", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const respond = (body: unknown, ok = true) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) }));

  it("maps the five-hour and seven-day windows, converting ISO resets to epoch seconds", async () => {
    respond({
      five_hour: { utilization: 42, resets_at: "2027-01-15T09:33:00.000Z" },
      seven_day: { utilization: 0, resets_at: null },
      seven_day_opus: { utilization: 90, resets_at: null },
    });
    expect(await anthropicUsage("token", undefined, NOW)).toEqual({
      capturedAt: NOW,
      windows: [
        { kind: "five-hour", usedPercent: 42, resetsAt: Date.parse("2027-01-15T09:33:00.000Z") / 1_000 },
        { kind: "weekly", usedPercent: 0, resetsAt: null },
      ],
    });
  });

  it("reports nothing rather than a guess when the endpoint fails or says nothing", async () => {
    respond({}, false);
    expect(await anthropicUsage("token", undefined, NOW)).toBeNull();
    respond({ five_hour: null, seven_day: null });
    expect(await anthropicUsage("token", undefined, NOW)).toBeNull();
  });

  it("sends the OAuth bearer and the beta header the endpoint requires", async () => {
    respond({ five_hour: { utilization: 1, resets_at: null } });
    await anthropicUsage("secret-access-token", undefined, NOW);
    const [, init] = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(init.headers).toMatchObject({ authorization: "Bearer secret-access-token", "anthropic-beta": "oauth-2025-04-20" });
  });
});
