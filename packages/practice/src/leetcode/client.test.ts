import { describe, expect, it, vi } from "vitest";
import { LeetCodeClient } from "./client.js";
import { parseLeetCodeCookie } from "./session.js";
import { PracticeAuthError, PracticeSourceError } from "../types.js";

const RAW_COOKIE = "csrftoken=csrf-abc; LEETCODE_SESSION=session-xyz; gr_user_id=1";
const session = (() => {
  const parsed = parseLeetCodeCookie(RAW_COOKIE, "global");
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed.session;
})();

type Call = { url: string; init: RequestInit };

/** A fetch stub that answers a queue of bodies and records what it was asked. */
function stubFetch(responses: Array<{ status?: number; body: unknown; contentType?: string }>) {
  const calls: Call[] = [];
  const fetcher = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift() ?? { body: {} };
    const text = typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      headers: new Headers({ "content-type": next.contentType ?? "application/json" }),
      text: async () => text,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("parseLeetCodeCookie", () => {
  it("keeps every cookie, not only the two it checks for", () => {
    // LeetCode reads region and A/B cookies on some endpoints, and dropping them
    // turns a working session into an intermittent one.
    expect(session.cookie).toContain("gr_user_id=1");
    expect(session.session).toBe("session-xyz");
    expect(session.csrfToken).toBe("csrf-abc");
  });

  it("says which of the two load-bearing cookies is missing", () => {
    expect(parseLeetCodeCookie("csrftoken=abc", "global")).toEqual({ error: expect.stringContaining("LEETCODE_SESSION") });
    expect(parseLeetCodeCookie("LEETCODE_SESSION=abc", "global")).toEqual({ error: expect.stringContaining("csrftoken") });
    expect(parseLeetCodeCookie("", "global")).toEqual({ error: expect.stringContaining("No cookies") });
  });
});

describe("LeetCodeClient — transport", () => {
  it("sends the session, the csrf header and the problem's own referer", async () => {
    const { fetcher, calls } = stubFetch([{ body: { interpret_id: "runcode_1" } }, { body: { state: "SUCCESS", status_code: 10, compare_result: "1" } }]);
    const client = new LeetCodeClient("global", async () => session, fetcher);
    await client.run({ problem: { slug: "two-sum", externalId: "1" }, language: "javascript", code: "var twoSum = () => [];" });

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(calls[0]?.url).toBe("https://leetcode.com/problems/two-sum/interpret_solution/");
    expect(headers.cookie).toContain("LEETCODE_SESSION=session-xyz");
    expect(headers["x-csrftoken"]).toBe("csrf-abc");
    // Both of these are checked by LeetCode; a POST without them 403s with an
    // HTML body, which reads like a signed-out session rather than a bad header.
    expect(headers.referer).toBe("https://leetcode.com/problems/two-sum/");
    expect(headers.origin).toBe("https://leetcode.com");
  });

  it("posts the language slug and the problem's internal id, not its display number", async () => {
    const { fetcher, calls } = stubFetch([{ body: { submission_id: 7 } }, { body: { state: "SUCCESS", status_code: 10, status_msg: "Accepted", total_correct: 3, total_testcases: 3 } }]);
    const client = new LeetCodeClient("global", async () => session, fetcher);
    const verdict = await client.submit({ problem: { slug: "two-sum", externalId: "1" }, language: "cpp", code: "class Solution {};" });

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ lang: "cpp", question_id: "1", typed_code: "class Solution {};" });
    expect(verdict.outcome).toBe("passed");
    expect(verdict.submitted).toBe(true);
  });

  it("waits for the judge and stops as soon as it decides", async () => {
    const { fetcher, calls } = stubFetch([
      { body: { interpret_id: "runcode_2" } },
      { body: { state: "PENDING" } },
      { body: { state: "STARTED" } },
      { body: { state: "SUCCESS", status_code: 11, status_msg: "Wrong Answer", compare_result: "0", code_answer: ["[]"], expected_code_answer: ["[0,1]"] } },
    ]);
    const client = new LeetCodeClient("global", async () => session, fetcher);
    vi.useFakeTimers();
    const pending = client.run({ problem: { slug: "two-sum", externalId: "1" }, language: "javascript", code: "x" });
    await vi.runAllTimersAsync();
    const verdict = await pending;
    vi.useRealTimers();

    expect(verdict.outcome).toBe("failed");
    expect(calls).toHaveLength(4);
    expect(calls[3]?.url).toBe("https://leetcode.com/submissions/detail/runcode_2/check/");
  });

  it("reports a refused session as an auth failure and says so once", async () => {
    const { fetcher } = stubFetch([{ status: 403, body: "<!DOCTYPE html><html>sign in</html>", contentType: "text/html" }]);
    const expired = vi.fn();
    const client = new LeetCodeClient("global", async () => session, fetcher, expired);
    await expect(client.problem("two-sum")).rejects.toBeInstanceOf(PracticeAuthError);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("recognises an HTML body from a JSON endpoint as a signed-out session", async () => {
    const { fetcher } = stubFetch([{ status: 200, body: "<!doctype html><html>login</html>", contentType: "text/html" }]);
    const client = new LeetCodeClient("global", async () => session, fetcher);
    await expect(client.problem("two-sum")).rejects.toThrow(/not signed in/);
  });

  it("turns a 200 GraphQL error body into a real failure", async () => {
    // GraphQL answers 200 with an `errors` array, so a failed query otherwise
    // looks like a successful request holding nulls.
    const { fetcher } = stubFetch([{ body: { errors: [{ message: "That question does not exist." }] } }]);
    const client = new LeetCodeClient("global", async () => session, fetcher);
    await expect(client.problem("nope")).rejects.toBeInstanceOf(PracticeSourceError);
  });

  it("marks the session expired when GraphQL says it is not authenticated", async () => {
    const { fetcher } = stubFetch([{ body: { errors: [{ message: "You need to authenticate first." }] } }]);
    const expired = vi.fn();
    const client = new LeetCodeClient("global", async () => session, fetcher, expired);
    await expect(client.progress({})).rejects.toBeInstanceOf(PracticeAuthError);
    expect(expired).toHaveBeenCalled();
  });

  it("refuses to submit at all without a session, before spending a request", async () => {
    const { fetcher, calls } = stubFetch([]);
    const client = new LeetCodeClient("global", async () => null, fetcher);
    await expect(client.submit({ problem: { slug: "two-sum", externalId: "1" }, language: "javascript", code: "x" })).rejects.toBeInstanceOf(PracticeAuthError);
    expect(calls).toHaveLength(0);
  });

  it("reads the region from the client rather than the caller", async () => {
    const { fetcher, calls } = stubFetch([{ body: { data: { question: null } } }]);
    const client = new LeetCodeClient("cn", async () => session, fetcher);
    await client.problem("two-sum").catch(() => undefined);
    expect(calls[0]?.url).toBe("https://leetcode.cn/graphql/");
  });
});

describe("LeetCodeClient — reads", () => {
  it("answers whoami with null instead of throwing when nobody is signed in", async () => {
    const { fetcher, calls } = stubFetch([]);
    const client = new LeetCodeClient("global", async () => null, fetcher);
    expect(await client.whoami()).toBeNull();
    // Settings asks this to draw a row; it must not cost a request.
    expect(calls).toHaveLength(0);
  });

  it("treats a signed-out answer as an expiry", async () => {
    const { fetcher } = stubFetch([{ body: { data: { userStatus: { isSignedIn: false } } } }]);
    const expired = vi.fn();
    const client = new LeetCodeClient("global", async () => session, fetcher, expired);
    expect(await client.whoami()).toBeNull();
    expect(expired).toHaveBeenCalled();
  });

  it("survives a skills read failing without losing the account", async () => {
    const { fetcher } = stubFetch([
      { body: { data: { userStatus: { isSignedIn: true, username: "learner", userId: "9", isPremium: false, isVerified: true } } } },
      { body: { data: { allQuestionsCount: [{ difficulty: "All", count: 3000 }, { difficulty: "Easy", count: 800 }], matchedUser: { submitStatsGlobal: { acSubmissionNum: [{ difficulty: "All", count: 41 }, { difficulty: "Easy", count: 30 }] } } } } },
      { status: 500, body: "boom" },
      { body: { data: { streakCounter: { streakCount: 4 } } } },
    ]);
    const client = new LeetCodeClient("global", async () => session, fetcher);
    const account = await client.account();
    expect(account?.username).toBe("learner");
    expect(account?.solved.total).toBe(41);
    expect(account?.available.easy).toBe(800);
    expect(account?.skills).toEqual([]);
  });

  it("drops a status filter nobody is signed in to answer", async () => {
    // LeetCode answers an unauthenticated status filter with an unfiltered list,
    // so a silently unfiltered "problems you have never tried" would be a wrong
    // answer that looks right.
    const { fetcher, calls } = stubFetch([{ body: { data: { problemsetQuestionList: { total: 0, questions: [] } } } }]);
    const client = new LeetCodeClient("global", async () => null, fetcher);
    await client.search({ query: "", tags: [], status: "todo", limit: 5, offset: 0 });
    expect(JSON.parse(String(calls[0]?.init.body)).variables.filters).toEqual({});
  });

  it("translates Spar concepts into source tags on the way out", async () => {
    const { fetcher, calls } = stubFetch([{ body: { data: { problemsetQuestionList: { total: 1, questions: [] } } } }]);
    const client = new LeetCodeClient("global", async () => session, fetcher);
    await client.search({ query: "", tags: [], status: "any", limit: 5, offset: 0, concepts: ["window-invariant-restoration"] });
    expect(JSON.parse(String(calls[0]?.init.body)).variables.filters.tags).toContain("sliding-window");
  });
});
