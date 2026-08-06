import type { Language } from "@spar/domain";
import { sourceTagsForConcept } from "../concepts.js";
import {
  PracticeAuthError, PracticeSourceError,
  type PracticeAccount, type PracticeProblem, type PracticeProblemSummary, type PracticeRegion,
  type PracticeSearchInput, type PracticeSubmission, type PracticeVerdict,
} from "../types.js";
import { normalizeProblem, normalizeProblemSummary, SOURCE_LANGUAGE_SLUG } from "./normalize.js";
import {
  DAILY_QUESTION_QUERY, PROBLEM_QUERY, PROBLEM_QUERY_CN, PROGRESS_QUESTIONS_QUERY, RANDOM_QUESTION_QUERY,
  SEARCH_PROBLEMS_QUERY, SKILL_STATS_QUERY, SOLVED_COUNTS_QUERY, STREAK_QUERY, SUBMISSION_DETAIL_QUERY,
  SUBMISSION_LIST_QUERY, USER_STATUS_QUERY, USER_STATUS_QUERY_CN,
} from "./queries.js";
import { LEETCODE_ORIGIN, leetCodeHeaders, type LeetCodeSession } from "./session.js";
import { isJudgePending, normalizeLeetCodeVerdict } from "./verdict.js";

/**
 * Everything Spar does against LeetCode.
 *
 * One class rather than a service interface per region: the two LeetCodes differ
 * in three documents and one response shape, which is a parameter, not a
 * subclass. `region` is fixed at construction because it is part of a problem's
 * identity — the same slug is a different problem with a different id on the two
 * services, and a client that could switch mid-flight would let a solution be
 * submitted against the wrong one.
 *
 * The session is read through a function rather than held, because it can be
 * replaced while the app is open: a sign-in refreshes it, an expiry clears it,
 * and a client holding a stale copy would keep sending a dead cookie. Every
 * authenticated call therefore asks for the current one, and a 401/403 is
 * reported as `PracticeAuthError` so the host can mark the connection expired in
 * exactly one place.
 */
export class LeetCodeClient {
  private readonly origin: string;

  constructor(
    readonly region: PracticeRegion,
    private readonly readSession: () => Promise<LeetCodeSession | null>,
    private readonly fetcher: typeof fetch = fetch,
    /** Told whenever LeetCode refuses the stored cookie, so the host can mark the
     *  connection expired without every caller having to remember to. */
    private readonly onExpired: () => void = () => undefined,
  ) {
    this.origin = LEETCODE_ORIGIN[region];
  }

  /* ---- Reads ------------------------------------------------------------- */

  /**
   * Who LeetCode thinks is asking, or null when nobody is.
   *
   * This is the connection check as well as the identity read, and it is the only
   * call that treats "not signed in" as an ordinary answer rather than an error:
   * Settings asks it to draw a row, and a thrown error there would read as
   * LeetCode being down.
   */
  async whoami(): Promise<{ username: string; userId: string; premium: boolean; verified: boolean; avatarUrl: string } | null> {
    if (!await this.readSession()) return null;
    const data = await this.graphql(this.region === "cn" ? USER_STATUS_QUERY_CN : USER_STATUS_QUERY, {});
    const status = record(record(data).userStatus);
    if (status.isSignedIn !== true) {
      this.onExpired();
      return null;
    }
    return {
      username: text(status.username) || text(status.userSlug),
      userId: text(status.userId) || text(status.userSlug),
      premium: status.isPremium === true,
      /* Not asked for. `avatar` is decoration and asking for a field the schema
         may not define fails the whole query — see the comment on the document. */
      /* CN omits `isVerified` for accounts verified by phone rather than email,
         so an absent flag is treated as verified. Refusing to work would strand
         a perfectly good account. */
      verified: status.isVerified !== false,
      avatarUrl: "",
    };
  }

  /** The account, with the progress numbers Settings shows and the agent reads as
   *  weak prior evidence. Every part after the identity is optional: a skills
   *  read that fails must not make a connected account look disconnected. */
  async account(): Promise<PracticeAccount | null> {
    const identity = await this.whoami();
    if (!identity?.username) return null;
    const [counts, skills, streak] = await Promise.all([
      this.graphql(SOLVED_COUNTS_QUERY, { username: identity.username }).catch(() => null),
      this.graphql(SKILL_STATS_QUERY, { username: identity.username }).catch(() => null),
      this.region === "global" ? this.graphql(STREAK_QUERY, {}).catch(() => null) : Promise.resolve(null),
    ]);
    const solved = difficultyCounts(record(record(record(counts).matchedUser).submitStatsGlobal).acSubmissionNum);
    const available = difficultyCounts(record(counts).allQuestionsCount);
    return {
      source: "leetcode",
      region: this.region,
      username: identity.username,
      userId: identity.userId,
      premium: identity.premium,
      verified: identity.verified,
      avatarUrl: identity.avatarUrl,
      solved,
      available,
      skills: parseSkills(record(record(record(skills).matchedUser).tagProblemCounts)),
      streak: Math.max(0, Number(record(record(streak).streakCounter).streakCount ?? 0) || 0),
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * Problem search.
   *
   * Concept slugs are translated to LeetCode tags by the caller passing them
   * through `sourceTagsForConcept`; this method takes source tags only, so the
   * translation happens once and is testable on its own. A status filter is
   * dropped when nobody is signed in, because LeetCode answers it with an
   * unfiltered list rather than an error and a silently unfiltered "problems you
   * have never tried" is a wrong answer that looks right.
   */
  async search(input: PracticeSearchInput & { concepts?: string[] }): Promise<{ total: number; problems: PracticeProblemSummary[] }> {
    const authenticated = Boolean(await this.readSession());
    const tags = [...input.tags, ...(input.concepts ?? []).flatMap((concept) => sourceTagsForConcept(concept))];
    const filters: Record<string, unknown> = {};
    if (input.query.trim()) filters.searchKeywords = input.query.trim();
    if (input.difficulty) filters.difficulty = input.difficulty.toUpperCase();
    if (tags.length) filters.tags = [...new Set(tags)].slice(0, 8);
    if (authenticated && input.status !== "any") filters.status = STATUS_FILTER[input.status];
    const data = await this.graphql(SEARCH_PROBLEMS_QUERY, {
      categorySlug: "",
      limit: input.limit,
      skip: input.offset,
      filters,
    });
    const list = record(record(data).problemsetQuestionList);
    const questions = Array.isArray(list.questions) ? list.questions : [];
    return {
      total: Number(list.total ?? questions.length) || 0,
      problems: questions.flatMap((node) => {
        const summary = normalizeProblemSummary(node);
        return summary ? [summary] : [];
      }),
    };
  }

  async problem(slug: string): Promise<PracticeProblem> {
    const data = await this.graphql(this.region === "cn" ? PROBLEM_QUERY_CN : PROBLEM_QUERY, { titleSlug: slug });
    const problem = normalizeProblem(record(data).question, this.region);
    if (!problem) throw new PracticeSourceError(`LeetCode has no problem at "${slug}".`, 404);
    return problem;
  }

  /** Today's problem. Its own method because it is the one problem every learner
   *  is offered in common, and because it is a two-step read the caller should
   *  not have to know about. */
  async daily(): Promise<PracticeProblem> {
    const data = await this.graphql(DAILY_QUESTION_QUERY, {});
    const slug = text(record(record(record(data).activeDailyCodingChallengeQuestion).question).titleSlug);
    if (!slug) throw new PracticeSourceError("LeetCode did not name a daily problem.");
    return this.problem(slug);
  }

  /** A random problem inside a filter, for novelty rather than a specific aim. */
  async random(input: { tags?: string[]; difficulty?: string }): Promise<string | null> {
    const filters: Record<string, unknown> = {};
    if (input.difficulty) filters.difficulty = input.difficulty.toUpperCase();
    if (input.tags?.length) filters.tags = input.tags.slice(0, 8);
    const data = await this.graphql(RANDOM_QUESTION_QUERY, { categorySlug: "algorithms", filters });
    const node = record(data).randomQuestion;
    /* CN answers with the slug as a bare string where global answers with a node. */
    return typeof node === "string" ? node : text(record(node).titleSlug) || null;
  }

  /** The learner's own submissions at one problem, newest first. Authenticated
   *  only, and about the signed-in account only — there is no way to ask this
   *  about anyone else, which is the correct amount of ability to have. */
  async submissions(slug: string, limit = 10): Promise<PracticeSubmission[]> {
    await this.requireSession("read your submission history");
    const data = await this.graphql(SUBMISSION_LIST_QUERY, { offset: 0, limit, questionSlug: slug, lang: null, status: null });
    const rows = record(record(data).questionSubmissionList).submissions;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((entry) => {
      const raw = record(entry);
      const id = text(raw.id);
      if (!id) return [];
      const verdict = text(raw.statusDisplay);
      return [{
        id,
        slug: text(raw.titleSlug) || slug,
        title: text(raw.title),
        verdict,
        accepted: verdict.toLowerCase() === "accepted",
        language: text(raw.lang),
        runtime: text(raw.runtime),
        memory: text(raw.memory),
        submittedAt: isoFromEpoch(raw.timestamp),
        code: "",
      }];
    });
  }

  /**
   * One submission in full, including the code.
   *
   * This is what makes "you solved this in March — here is what you wrote" work,
   * and it is the read leetcode.nvim uses to restore a buffer. Spar uses it for
   * the same purpose and for one more: an accepted solution the learner wrote
   * themselves is the strongest possible statement about what they can do, and
   * the agent is allowed to read it.
   */
  async submissionDetail(id: string): Promise<PracticeSubmission | null> {
    await this.requireSession("read a submission");
    const numeric = Number(id);
    if (!Number.isFinite(numeric)) return null;
    const data = await this.graphql(SUBMISSION_DETAIL_QUERY, { submissionId: numeric });
    const detail = record(record(data).submissionDetails);
    if (!Object.keys(detail).length) return null;
    const statusCode = Number(detail.statusCode ?? -1);
    return {
      id,
      slug: text(record(detail.question).titleSlug),
      title: text(record(detail.question).title),
      verdict: statusCode === 10 ? "Accepted" : `Status ${statusCode}`,
      accepted: statusCode === 10,
      language: text(record(detail.lang).name),
      runtime: text(detail.runtimeDisplay),
      memory: text(detail.memoryDisplay),
      submittedAt: isoFromEpoch(detail.timestamp),
      code: text(detail.code),
    };
  }

  /** Problems the learner has touched, by status. The one thing this source knows
   *  that Spar's own record cannot: what they tried elsewhere and abandoned. */
  async progress(input: { status?: "ATTEMPTED" | "SOLVED"; limit?: number; offset?: number }): Promise<Array<{ slug: string; title: string; difficulty: string; status: string; lastResult: string; lastSubmittedAt: string; topicTags: string[] }>> {
    await this.requireSession("read your LeetCode progress");
    const data = await this.graphql(PROGRESS_QUESTIONS_QUERY, {
      filters: {
        skip: input.offset ?? 0,
        limit: Math.min(100, input.limit ?? 20),
        ...(input.status ? { questionStatus: input.status } : {}),
      },
    });
    const rows = record(record(data).userProgressQuestionList).questions;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((entry) => {
      const raw = record(entry);
      const slug = text(raw.titleSlug);
      if (!slug) return [];
      return [{
        slug,
        title: text(raw.title),
        difficulty: text(raw.difficulty).toLowerCase(),
        status: text(raw.questionStatus),
        lastResult: text(raw.lastResult),
        lastSubmittedAt: isoFromEpoch(raw.lastSubmittedAt),
        topicTags: Array.isArray(raw.topicTags) ? raw.topicTags.flatMap((tag) => { const slugText = text(record(tag).slug); return slugText ? [slugText] : []; }) : [],
      }];
    });
  }

  /* ---- Judging ----------------------------------------------------------- */

  /**
   * A scratch run against LeetCode's own interpreter.
   *
   * Two POSTs and a poll, which is the shape LeetCode's site itself uses: the
   * first returns an `interpret_id`, and the verdict is collected from
   * `/submissions/detail/<id>/check/` until it stops saying PENDING. Nothing
   * about this counts on the learner's record, which is exactly why it exists —
   * it is the "does this compile and pass the examples" button, and the learner
   * gets to press it as often as they like.
   *
   * `dataInput` is the case block in LeetCode's own format: arguments one per
   * line, cases concatenated. Omitting it runs the problem's own samples.
   */
  async run(input: { problem: Pick<PracticeProblem, "slug" | "externalId">; language: Language; code: string; dataInput?: string; timeoutMs?: number }): Promise<PracticeVerdict> {
    return this.judge({ ...input, submitted: false });
  }

  /**
   * A real submission. Counts on LeetCode, appears in the learner's history
   * there, and — when it is accepted — is the strongest verdict Spar can record,
   * because it was reached against every hidden case the problem has rather than
   * against anything Spar wrote.
   */
  async submit(input: { problem: Pick<PracticeProblem, "slug" | "externalId">; language: Language; code: string; timeoutMs?: number }): Promise<PracticeVerdict> {
    return this.judge({ ...input, submitted: true });
  }

  private async judge(input: { problem: Pick<PracticeProblem, "slug" | "externalId">; language: Language; code: string; dataInput?: string; submitted: boolean; timeoutMs?: number }): Promise<PracticeVerdict> {
    await this.requireSession(input.submitted ? "submit to LeetCode" : "run code on LeetCode");
    const slug = input.problem.slug;
    const path = input.submitted ? `/problems/${slug}/submit/` : `/problems/${slug}/interpret_solution/`;
    const body = {
      lang: SOURCE_LANGUAGE_SLUG[input.language],
      question_id: input.problem.externalId,
      typed_code: input.code,
      ...(input.submitted ? {} : { data_input: input.dataInput ?? "" }),
    };
    const start = record(await this.request("POST", path, { slug, body }));
    /* The two endpoints name the id differently, and both have been seen as a
       string and as a number, so it is coerced rather than trusted. */
    const id = text(input.submitted ? start.submission_id : start.interpret_id);
    if (!id) {
      throw new PracticeSourceError(
        input.submitted
          ? "LeetCode accepted the submission request but returned no submission id, so there is no verdict to wait for."
          : "LeetCode accepted the run request but returned no interpret id, so there is no result to wait for.",
      );
    }
    const raw = record(await this.poll(`/submissions/detail/${id}/check/`, slug, input.timeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS));
    /* The id is carried over from the start response: the check body has it on a
       submission and not on a run, and the verdict's link is built from it. */
    return normalizeLeetCodeVerdict({ ...raw, submission_id: id }, { submitted: input.submitted, region: this.region, slug });
  }

  /**
   * Waits for the judge.
   *
   * Backs off the way leetcode.nvim does — roughly half a second between checks,
   * doubling once the judge says it has STARTED — because a tighter loop earns a
   * 429 and a 429 in the middle of a submission is indistinguishable to the
   * learner from a lost solve. The deadline is a hard stop: a judge that never
   * answers has to surface as an error, not as a hung submission.
   */
  private async poll(path: string, slug: string, timeoutMs: number): Promise<unknown> {
    const deadline = Date.now() + timeoutMs;
    let waitMs = 500;
    for (;;) {
      const raw = await this.request("GET", path, { slug }).catch((error: unknown) => {
        if (error instanceof PracticeSourceError && error.status === 429) return { state: "PENDING" };
        throw error;
      });
      if (!isJudgePending(raw)) return raw;
      if (Date.now() + waitMs > deadline) {
        throw new PracticeSourceError(`LeetCode's judge did not return a verdict within ${Math.round(timeoutMs / 1_000)}s. The submission may still complete on the site.`);
      }
      await sleep(waitMs);
      waitMs = Math.min(2_000, Math.round(waitMs * 1.5));
    }
  }

  /* ---- Transport --------------------------------------------------------- */

  async graphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const payload = record(await this.request("POST", "/graphql/", { body: { query, variables } }));
    /* GraphQL answers 200 with an `errors` array, so a failed query looks like a
       successful request holding nulls. Reported as an error here rather than
       returned, because every caller would otherwise have to check. */
    if (Array.isArray(payload.errors) && payload.errors.length) {
      const messages = payload.errors.map((entry) => text(record(entry).message)).filter(Boolean);
      const detail = messages.join("; ") || "LeetCode rejected the query.";
      if (/authenticat|permission|login/i.test(detail)) {
        this.onExpired();
        throw new PracticeAuthError("LeetCode says this session is no longer signed in. Reconnect LeetCode in Settings.");
      }
      throw new PracticeSourceError(detail);
    }
    return payload.data ?? {};
  }

  private async request(method: "GET" | "POST", path: string, options: { slug?: string; body?: unknown } = {}): Promise<unknown> {
    const session = await this.readSession();
    const response = await this.fetcher(`${this.origin}${path}`, {
      method,
      headers: leetCodeHeaders(session, this.region, options.slug),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }).catch((error: unknown) => {
      throw new PracticeSourceError(`Spar could not reach ${this.origin}: ${error instanceof Error ? error.message : String(error)}`);
    });

    if (response.status === 401 || response.status === 403) {
      this.onExpired();
      throw new PracticeAuthError("LeetCode refused this session. It has either expired or LeetCode is rate-limiting this machine — reconnect LeetCode in Settings.");
    }
    if (response.status === 429) throw new PracticeSourceError("LeetCode is rate-limiting this machine. Wait a few seconds and try again.", 429);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      /* An HTML body from a JSON endpoint means an interstitial or a sign-in
         page, which is a different problem from a server error and is worth
         saying plainly rather than reporting as "unexpected token <". */
      throw new PracticeSourceError(
        looksLikeHtml(detail)
          ? `LeetCode answered ${response.status} with a web page rather than data, which usually means the session is not signed in.`
          : `LeetCode answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}.`,
        response.status,
      );
    }
    const text_ = await response.text();
    if (looksLikeHtml(text_)) throw new PracticeAuthError("LeetCode returned a web page instead of data, which means this session is not signed in.");
    try { return text_ ? JSON.parse(text_) : {}; }
    catch { throw new PracticeSourceError("LeetCode returned a response Spar could not read as JSON."); }
  }

  private async requireSession(action: string): Promise<LeetCodeSession> {
    const session = await this.readSession();
    if (!session) throw new PracticeAuthError(`Connect LeetCode in Settings before Spar can ${action}.`);
    return session;
  }
}

const DEFAULT_JUDGE_TIMEOUT_MS = 90_000;

/** LeetCode's own filter values for "what has the learner done with this". */
const STATUS_FILTER: Record<string, string> = { todo: "NOT_STARTED", attempted: "TRIED", solved: "AC" };

function difficultyCounts(value: unknown): { total: number; easy: number; medium: number; hard: number } {
  const counts = { total: 0, easy: 0, medium: 0, hard: 0 };
  if (!Array.isArray(value)) return counts;
  for (const entry of value) {
    const raw = record(entry);
    const level = text(raw.difficulty).toLowerCase();
    const count = Number(raw.count ?? 0) || 0;
    if (level === "all") counts.total = count;
    else if (level === "easy") counts.easy = count;
    else if (level === "medium") counts.medium = count;
    else if (level === "hard") counts.hard = count;
  }
  if (!counts.total) counts.total = counts.easy + counts.medium + counts.hard;
  return counts;
}

function parseSkills(value: Record<string, unknown>): PracticeAccount["skills"] {
  const bands: Array<PracticeAccount["skills"][number]["band"]> = ["fundamental", "intermediate", "advanced"];
  return bands.flatMap((band) => {
    const rows = value[band];
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((entry) => {
      const raw = record(entry);
      const slug = text(raw.tagSlug);
      if (!slug) return [];
      return [{ slug, name: text(raw.tagName) || slug, solved: Number(raw.problemsSolved ?? 0) || 0, band }];
    });
  });
}

function looksLikeHtml(body: string): boolean {
  const head = body.trimStart().slice(0, 60).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

/** LeetCode timestamps are epoch seconds, as strings about half the time. */
function isoFromEpoch(value: unknown): string {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1_000).toISOString() : "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}
