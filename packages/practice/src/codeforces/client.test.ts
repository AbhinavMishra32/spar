import { describe, expect, it, vi } from "vitest";
import { CodeforcesClient } from "./client.js";
import type { CodeforcesSession } from "./session.js";

const SESSION: CodeforcesSession = { region: "global", handle: "learner", cookie: "JSESSIONID=secret", csrfToken: "csrf", capturedAt: "2026-08-08T00:00:00.000Z" };
const PROBLEM = { contestId: 4, index: "A", name: "Watermelon", rating: 800, tags: ["brute force", "math"] };
const problemset = { status: "OK", result: { problems: [PROBLEM, { contestId: 1, index: "A", name: "Theatre Square", rating: 1000, tags: ["math"] }], problemStatistics: [{ contestId: 4, index: "A", solvedCount: 100 }] } };

describe("CodeforcesClient", () => {
  it("searches the public problemset and overlays the learner's real status", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("problemset.problems")) return json(problemset);
      if (href.includes("user.status")) return json({ status: "OK", result: [{ id: 7, contestId: 4, creationTimeSeconds: 1_700_000_000, programmingLanguage: "GNU C++20", verdict: "OK", passedTestCount: 10, problem: PROBLEM }] });
      throw new Error(`unexpected ${href}`);
    }) as typeof fetch;
    const client = new CodeforcesClient(async () => SESSION, fetcher);
    const result = await client.search({ query: "water", tags: [], status: "solved", limit: 10, offset: 0 });
    expect(result.problems).toEqual([expect.objectContaining({ slug: "4/A", status: "solved" })]);
  });

  it("builds account difficulty counts, skills and accepted history from official API data", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("user.info")) return json({ status: "OK", result: [{ handle: "learner", avatar: "https://example/avatar.png" }] });
      if (href.includes("user.status")) return json({ status: "OK", result: [{ id: 7, contestId: 4, creationTimeSeconds: 1_700_000_000, programmingLanguage: "GNU C++20", verdict: "OK", problem: PROBLEM }] });
      if (href.includes("problemset.problems")) return json(problemset);
      throw new Error(`unexpected ${href}`);
    }) as typeof fetch;
    const account = await new CodeforcesClient(async () => SESSION, fetcher).account();
    expect(account).toMatchObject({ source: "codeforces", username: "learner", solved: { total: 1, easy: 1 }, available: { total: 2, easy: 2 } });
    expect(account?.skills.map((skill) => skill.name)).toEqual(expect.arrayContaining(["brute force", "math"]));
  });

  it("posts the source only after reading Codeforces' current CSRF and compiler ids, then polls the official verdict", async () => {
    let statusReads = 0;
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/problemset/submit") && !init?.method) return html(`<meta name="X-Csrf-Token" content="fresh"><input name="ftaa" value="f"><input name="bfaa" value="b"><select><option value="73">GNU C++20 (64)</option></select>`);
      if (href.endsWith("/problemset/submit") && init?.method === "POST") {
        expect(String(init.body)).toContain("submittedProblemCode=4A");
        expect(String(init.body)).toContain("programTypeId=73");
        expect(String(init.body)).toContain("source=int+main");
        return html("submitted");
      }
      if (href.includes("user.status")) {
        statusReads += 1;
        return json({ status: "OK", result: [{ id: 99, contestId: 4, creationTimeSeconds: Math.floor(Date.now() / 1000), programmingLanguage: "GNU C++20", verdict: statusReads === 1 ? "TESTING" : "OK", passedTestCount: 12, problem: PROBLEM }] });
      }
      throw new Error(`unexpected ${href}`);
    }) as typeof fetch;
    const verdict = await new CodeforcesClient(async () => SESSION, fetcher).submit({ problem: { slug: "4/A", externalId: "4/A" }, language: "cpp", code: "int main(){}", timeoutMs: 5_000 });
    expect(verdict).toMatchObject({ outcome: "passed", status: "Accepted", submitted: true, submissionId: "99" });
  });
});

function json(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
function html(value: string): Response { return new Response(value, { status: 200, headers: { "content-type": "text/html" } }); }
