import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLeetCodeCookie } from "@spar/practice";
import type { AuthService } from "./auth.js";
import { PracticeService } from "./practice.js";
import { LocalStore } from "./store.js";

const parsed = parseLeetCodeCookie("csrftoken=csrf; LEETCODE_SESSION=session", "global");
if ("error" in parsed) throw new Error(parsed.error);
const SESSION = JSON.stringify(parsed.session);

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function service(store: LocalStore, emit = vi.fn()) {
  const secrets = new Map([["practice:leetcode:global", SESSION]]);
  const auth = {
    readSecret: vi.fn(async (account: string) => secrets.get(account) ?? null),
    saveSecret: vi.fn(async (account: string, value: string) => { secrets.set(account, value); }),
    deleteSecret: vi.fn(async (account: string) => { secrets.delete(account); }),
  } as unknown as AuthService;
  return { practice: new PracticeService(auth, store, () => null, emit), emit };
}

afterEach(() => vi.unstubAllGlobals());

describe("practice connection state", () => {
  it("makes a rejected session sticky and emits expiry only once", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ data: { userStatus: { isSignedIn: false } } }))
      .mockResolvedValue(response({ data: { userStatus: { isSignedIn: true, username: "learner" } } }));
    vi.stubGlobal("fetch", fetcher);
    const store = new LocalStore(":memory:");
    const { practice, emit } = service(store);
    try {
      expect(await practice.state("leetcode")).toBe("expired");
      expect(await practice.state("leetcode")).toBe("expired");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledTimes(1);

      // The tombstone belongs to durable host state, not to this service object.
      const restarted = service(store, emit).practice;
      expect(await restarted.state("leetcode")).toBe("expired");
      expect(fetcher).toHaveBeenCalledTimes(1);
      restarted.stop();
    } finally {
      practice.stop();
      store.close();
    }
  });

  it("does not relabel a reachability failure as an expired credential", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const store = new LocalStore(":memory:");
    const { practice, emit } = service(store);
    try {
      await expect(practice.state("leetcode")).rejects.toThrow(/could not reach/i);
      expect(emit).not.toHaveBeenCalled();
      expect(store.getSetting("practice-session-expired:leetcode:global", false)).toBe(false);
    } finally {
      practice.stop();
      store.close();
    }
  });
});
