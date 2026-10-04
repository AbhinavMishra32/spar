import { describe, expect, it, vi } from "vitest";
import { LeetCodeClient } from "./client.js";
import { leetCodeHeaders, parseLeetCodeCookie } from "./session.js";
import { PracticeAuthError, PracticeChallengeError, PracticeSourceError } from "../types.js";

const RAW_COOKIE = "csrftoken=csrf-abc; LEETCODE_SESSION=session-xyz; gr_user_id=1";
const session = (() => {
  const parsed = parseLeetCodeCookie(RAW_COOKIE, "global");
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed.session;
})();

type Call = { url: string; init: RequestInit };

/** A fetch stub that answers a queue of bodies and records what it was asked. */
function stubFetch(responses: Array<{ status?: number; body: unknown; contentType?: string; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const fetcher = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift() ?? { body: {} };
    const text = typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      headers: new Headers({ "content-type": next.contentType ?? "application/json", ...next.headers }),
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

  it("sends the cookies with the User-Agent of the browser that earned them", () => {
    const ua = "Mozilla/5.0 (Macintosh) Chrome/141.0.0.0 Safari/537.36";
    const parsed = parseLeetCodeCookie(RAW_COOKIE, "global", ua);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(leetCodeHeaders(parsed.session, "global")["user-agent"]).toBe(ua);
    expect(leetCodeHeaders(session, "global")["user-agent"]).toContain("Chrome/");
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

  /* Both responses below are what leetcode.com actually answered a run with:
     the first for a LEETCODE_SESSION it does not accept, the second from
     Cloudflare in front of it for a request it wanted to check. */
  it("reports a refused session as an auth failure and says so once", async () => {
    const { fetcher } = stubFetch([{ status: 403, body: { error: "User is not authenticated" } }]);
    const expired = vi.fn();
    const client = new LeetCodeClient("global", async () => session, fetcher, expired);
    await expect(client.problem("two-sum")).rejects.toBeInstanceOf(PracticeAuthError);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("does not treat Cloudflare's bot check as a signed-out session", async () => {
    const { fetcher } = stubFetch([{ status: 403, body: "<!DOCTYPE html><html><head><title>Just a moment...</title>", contentType: "text/html", headers: { "cf-mitigated": "challenge" } }]);
    const expired = vi.fn();
    const client = new LeetCodeClient("global", async () => session, fetcher, expired);
    await expect(client.run({ problem: { slug: "two-sum", externalId: "1" }, language: "python", code: "x" })).rejects.toBeInstanceOf(PracticeChallengeError);
    expect(expired).not.toHaveBeenCalled();
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

  it("sends one tag per concept, because the source intersects them", async () => {
    // `arrays` maps to five LeetCode tags. Sent together they mean "tagged array
    // AND sorting AND counting-sort AND bucket-sort AND matrix", which matches
    // nothing at all — every array search came back empty.
    const { fetcher, calls } = stubFetch([{ body: { data: { problemsetQuestionList: { total: 1, questions: [] } } } }]);
    const client = new LeetCodeClient("global", async () => session, fetcher);
    await client.search({ query: "", tags: [], status: "any", limit: 5, offset: 0, concepts: ["arrays"] });
    expect(JSON.parse(String(calls[0]?.init.body)).variables.filters.tags).toEqual(["array"]);
  });

  it("relaxes an intersection that found nothing, and says what it dropped", async () => {
    const { fetcher, calls } = stubFetch([
      { body: { data: { problemsetQuestionList: { total: 0, questions: [] } } } },
      { body: { data: { problemsetQuestionList: { total: 2196, questions: [problemSummaryNode] } } } },
    ]);
    const client = new LeetCodeClient("global", async () => session, fetcher);
    const found = await client.search({ query: "", tags: [], status: "any", limit: 5, offset: 0, concepts: ["arrays", "dynamic-programming"] });
    expect(JSON.parse(String(calls[0]?.init.body)).variables.filters.tags).toEqual(["array", "dynamic-programming"]);
    expect(JSON.parse(String(calls[1]?.init.body)).variables.filters.tags).toEqual(["array"]);
    expect(found.problems).toHaveLength(1);
    expect(found.appliedTags).toEqual(["array"]);
    expect(found.droppedTags).toEqual(["dynamic-programming"]);
  });

  it("does not retry a search that found something", async () => {
    const { fetcher, calls } = stubFetch([{ body: { data: { problemsetQuestionList: { total: 1, questions: [problemSummaryNode] } } } }]);
    const client = new LeetCodeClient("global", async () => session, fetcher);
    const found = await client.search({ query: "", tags: [], status: "any", limit: 5, offset: 0, concepts: ["arrays", "dynamic-programming"] });
    expect(calls).toHaveLength(1);
    expect(found.droppedTags).toEqual([]);
  });
});

const problemSummaryNode = {
  questionId: "121",
  questionFrontendId: "121",
  title: "Best Time to Buy and Sell Stock",
  titleSlug: "best-time-to-buy-and-sell-stock",
  difficulty: "Easy",
  isPaidOnly: false,
  acRate: 55.1,
  status: null,
  topicTags: [{ slug: "array" }, { slug: "dynamic-programming" }],
};

describe("LeetCodeClient — after an accepted submission", () => {
  it("reads both distributions out of their JSON strings, sorted by bucket", async () => {
    const { fetcher, calls } = stubFetch([{ body: { data: { submissionDetails: {
      runtime: 3, runtimeDisplay: "3 ms", runtimePercentile: 87.4,
      runtimeDistribution: JSON.stringify({ lang: "python3", distribution: [["5", 20.5], ["3", 40.1], ["1", 9.2]] }),
      memory: 17400000, memoryDisplay: "17.4 MB", memoryPercentile: null, memoryDistribution: null,
      statusCode: 10, timestamp: 1_700_000_000, totalCorrect: 63, totalTestcases: 63,
      lang: { name: "python3", verboseName: "Python3" }, question: { questionId: "1", titleSlug: "two-sum" },
    } } } }]);
    const client = new LeetCodeClient("global", async () => session, fetcher);
    const stats = await client.submissionStats("123");
    expect(JSON.parse(String(calls[0]!.init.body)).variables).toEqual({ submissionId: 123 });
    expect(stats).toMatchObject({
      submissionId: "123", questionId: "1", language: "python3", languageName: "Python3", accepted: true, passedCases: 63,
      runtime: { display: "3 ms", value: 3, percentile: 87.4, distribution: [{ value: 1, percent: 9.2 }, { value: 3, percent: 40.1 }, { value: 5, percent: 20.5 }] },
      memory: { display: "17.4 MB", percentile: null, distribution: [] },
    });
  });

  it("maps a solutions page to authors, votes and language tags", async () => {
    const { fetcher, calls } = stubFetch([{ body: { data: { ugcArticleSolutionArticles: {
      totalNum: 3000, pageInfo: { hasNextPage: true },
      edges: [{ node: {
        title: "Hash map, one pass", slug: "hash-map-one-pass", summary: "Intuition\\nKeep what you have seen", createdAt: "2023-06-09T18:17:24Z",
        hitCount: 2_438_380, isLeetcode: false, topicId: 3619262,
        author: { realName: "Rahul Varma", userAvatar: "https://assets.leetcode.com/a.png", userName: "rahulvarma5297", activeBadge: { icon: "/static/b.png", displayName: "Annual Badge 2023" } },
        reactions: [{ count: 12209, reactionType: "UPVOTE" }, { count: 15, reactionType: "THUMBS_DOWN" }],
        tags: [{ name: "Hash Table", slug: "hash-table", tagType: "TOPIC" }, { name: "Python3", slug: "python3", tagType: null }],
        topic: { id: 3619262, topLevelCommentCount: 292 },
      } }],
    } } } }]);
    const client = new LeetCodeClient("global", async () => session, fetcher);
    const page = await client.solutions({ slug: "two-sum", order: "votes", language: "python3", skip: 0, first: 12 });
    expect(JSON.parse(String(calls[0]!.init.body)).variables).toMatchObject({ questionSlug: "two-sum", orderBy: "MOST_VOTES", tagSlugs: ["python3"] });
    expect(page).toMatchObject({ total: 3000, hasMore: true });
    expect(page.solutions[0]).toMatchObject({
      topicId: "3619262", title: "Hash map, one pass", summary: "Intuition\nKeep what you have seen",
      author: { name: "Rahul Varma", username: "rahulvarma5297", badge: { name: "Annual Badge 2023", iconUrl: "https://leetcode.com/static/b.png" } },
      upvotes: 12209, views: 2_438_380, comments: 292, topics: ["Hash Table"], languages: ["Python3"],
      url: "https://leetcode.com/problems/two-sum/solutions/3619262/hash-map-one-pass/",
    });
  });

  it("unescapes an article body without breaking escapes inside its code", async () => {
    const content = "# Intuition\\n<!-- template -->\\n```C++ []\\nprintf(\\\"\\\\n\\\");\\n```";
    const { fetcher } = stubFetch([{ body: { data: { ugcArticleSolutionArticle: { topicId: 1, title: "t", slug: "t", content, author: { userName: "a" } } } } }]);
    const client = new LeetCodeClient("global", async () => session, fetcher);
    const solution = await client.solution({ slug: "two-sum", topicId: "1" });
    expect(solution?.content).toBe('# Intuition\n\n```C++ []\nprintf("\\n");\n```');
  });
});
