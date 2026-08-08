import type { Language } from "@spar/domain";
import { PracticeAuthError, PracticeSourceError, type PracticeAccount, type PracticeProblem, type PracticeSearchInput, type PracticeSubmission, type PracticeVerdict } from "../types.js";
import { casesForCodeforcesProblem, codeforcesDifficulty, codeforcesSlug, normalizeCodeforcesProblem, normalizeCodeforcesSummary, parseCodeforcesSlug, type CodeforcesProblemStatWire, type CodeforcesProblemWire } from "./normalize.js";
import { CODEFORCES_ORIGIN, codeforcesHeaders, verifyCodeforcesSession, type CodeforcesSession } from "./session.js";

type SubmissionWire = {
  id?: number; contestId?: number; creationTimeSeconds?: number; programmingLanguage?: string; verdict?: string;
  passedTestCount?: number; timeConsumedMillis?: number; memoryConsumedBytes?: number;
  problem?: CodeforcesProblemWire;
};

export class CodeforcesClient {
  private problemsetCache: { at: number; problems: CodeforcesProblemWire[]; stats: Map<string, CodeforcesProblemStatWire> } | null = null;
  constructor(
    private readonly readSession: () => Promise<CodeforcesSession | null>,
    private readonly fetcher: typeof fetch = fetch,
    private readonly onExpired: () => void = () => undefined,
  ) {}

  async whoami(): Promise<string | null> {
    const session = await this.readSession();
    if (!session) return null;
    if (await verifyCodeforcesSession(session, this.fetcher)) return session.handle;
    this.onExpired();
    return null;
  }

  async account(): Promise<PracticeAccount | null> {
    const session = await this.requireSession("read your Codeforces record");
    const [users, submissions, set] = await Promise.all([
      this.api<Array<Record<string, unknown>>>("user.info", { handles: session.handle }),
      this.userSubmissions(session.handle, 10_000),
      this.problemset(),
    ]);
    const user = users[0] ?? {};
    const accepted = uniqueAccepted(submissions);
    const solved = counts([...accepted.values()].map((entry) => codeforcesDifficulty(entry.problem?.rating)));
    const available = counts(set.problems.map((entry) => codeforcesDifficulty(entry.rating)));
    const byTag = new Map<string, number>();
    for (const submission of accepted.values()) for (const tag of submission.problem?.tags ?? []) byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
    return {
      source: "codeforces", region: "global", username: String(user.handle ?? session.handle), userId: String(user.handle ?? session.handle),
      premium: false, verified: true, avatarUrl: String(user.avatar ?? user.titlePhoto ?? ""), solved, available,
      skills: [...byTag].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([name, solved], index) => ({ slug: slugify(name), name, solved, band: index < 8 ? "fundamental" as const : index < 16 ? "intermediate" as const : "advanced" as const })),
      streak: streak(submissions), capturedAt: new Date().toISOString(),
    };
  }

  async search(input: PracticeSearchInput & { concepts?: string[] }) {
    const set = await this.problemset();
    const session = await this.readSession();
    const statuses = session ? statusIndex(await this.userSubmissions(session.handle, 10_000)) : new Map<string, "solved" | "attempted">();
    const query = input.query.toLowerCase();
    const requested = [...input.tags.map(slugify), ...(input.concepts ?? []).flatMap(codeforcesTagsForConcept)].filter(Boolean);
    const matches = set.problems.flatMap((problem) => {
      const slug = codeforcesSlug(problem);
      const status = statuses.get(slug) ?? (session ? "todo" : "unknown");
      const tags = (problem.tags ?? []).map(slugify);
      if (query && !`${slug} ${problem.name ?? ""} ${tags.join(" ")}`.toLowerCase().includes(query)) return [];
      if (requested.length && !requested.every((tag) => tags.includes(tag))) return [];
      if (input.difficulty && codeforcesDifficulty(problem.rating) !== input.difficulty) return [];
      if (input.status !== "any" && status !== input.status) return [];
      const summary = normalizeCodeforcesSummary(problem, set.stats.get(slug), status);
      return summary ? [summary] : [];
    });
    const problems = matches.slice(input.offset, input.offset + input.limit);
    return { total: matches.length, problems, appliedTags: requested, droppedTags: [] };
  }

  async problem(slug: string): Promise<PracticeProblem> {
    const identity = parseCodeforcesSlug(slug);
    if (!identity) throw new PracticeSourceError(`"${slug}" is not a Codeforces problem id. Use contest/index, for example 4/A.`);
    const set = await this.problemset();
    const wire = set.problems.find((entry) => entry.contestId === identity.contestId && entry.index === identity.index);
    if (!wire) throw new PracticeSourceError(`Codeforces has no problem ${slug}.`, 404);
    const session = await this.readSession();
    const response = await this.fetcher(`${CODEFORCES_ORIGIN}/problemset/problem/${identity.contestId}/${identity.index}`, { headers: codeforcesHeaders(session) });
    if (!response.ok) throw new PracticeSourceError(`Codeforces answered ${response.status} while reading ${slug}.`, response.status);
    const statuses = session ? statusIndex(await this.userSubmissions(session.handle, 10_000)) : new Map<string, "solved" | "attempted">();
    const normalized = normalizeCodeforcesProblem(wire, await response.text(), statuses.get(slug) ?? (session ? "todo" : "unknown"));
    if (!normalized) throw new PracticeSourceError(`Codeforces returned ${slug}, but Spar could not normalize it.`);
    return normalized;
  }

  async daily(): Promise<PracticeProblem> {
    const slug = await this.random({});
    if (!slug) throw new PracticeSourceError("Codeforces returned no practice problems.");
    return this.problem(slug);
  }

  async random(input: { tags?: string[]; difficulty?: string }): Promise<string | null> {
    const result = await this.search({ query: "", tags: input.tags ?? [], ...(input.difficulty ? { difficulty: input.difficulty as "easy" | "medium" | "hard" } : {}), status: "any", limit: 50, offset: 0 });
    return result.problems.length ? result.problems[Math.floor(Math.random() * result.problems.length)]!.slug : null;
  }

  async progress(input: { status?: "ATTEMPTED" | "SOLVED"; limit?: number; offset?: number }) {
    const session = await this.requireSession("read your Codeforces progress");
    const rows = await this.userSubmissions(session.handle, 10_000);
    const latest = new Map<string, SubmissionWire>();
    for (const row of rows) { const slug = codeforcesSlug(row.problem ?? {}); if (slug && !latest.has(slug)) latest.set(slug, row); }
    return [...latest.entries()]
      .filter(([, row]) => !input.status || (input.status === "SOLVED") === (row.verdict === "OK"))
      .slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 20))
      .map(([slug, row]) => ({ slug, title: row.problem?.name ?? "", difficulty: codeforcesDifficulty(row.problem?.rating), status: row.verdict === "OK" ? "SOLVED" : "ATTEMPTED", lastResult: verdictName(row.verdict), lastSubmittedAt: iso(row.creationTimeSeconds), topicTags: row.problem?.tags ?? [] }));
  }

  async submissions(slug: string, limit = 10): Promise<PracticeSubmission[]> {
    const session = await this.requireSession("read your Codeforces submissions");
    return (await this.userSubmissions(session.handle, 10_000)).filter((row) => codeforcesSlug(row.problem ?? {}) === slug).slice(0, limit).map(normalizeSubmission);
  }

  async submissionDetail(id: string): Promise<PracticeSubmission | null> {
    const session = await this.requireSession("read a Codeforces submission");
    const row = (await this.userSubmissions(session.handle, 10_000)).find((entry) => String(entry.id) === id);
    if (!row) return null;
    const contestId = row.contestId ?? row.problem?.contestId;
    if (!contestId) return normalizeSubmission(row);
    const response = await this.fetcher(`${CODEFORCES_ORIGIN}/contest/${contestId}/submission/${id}`, { headers: codeforcesHeaders(session) });
    const html = response.ok ? await response.text() : "";
    const code = decodeHtml(/<pre[^>]+id=["']program-source-text["'][^>]*>([\s\S]*?)<\/pre>/i.exec(html)?.[1] ?? "");
    return { ...normalizeSubmission(row), code };
  }

  async run(): Promise<PracticeVerdict> {
    throw new PracticeSourceError("Codeforces has no non-recording scratch judge. Run the published examples locally, then submit when you want a Codeforces verdict.");
  }

  async submit(input: { problem: Pick<PracticeProblem, "slug" | "externalId">; language: Language; code: string; timeoutMs?: number }): Promise<PracticeVerdict> {
    const session = await this.requireSession("submit to Codeforces");
    const identity = parseCodeforcesSlug(input.problem.slug);
    if (!identity) throw new PracticeSourceError(`Invalid Codeforces problem id: ${input.problem.slug}`);
    const pageUrl = `${CODEFORCES_ORIGIN}/problemset/submit`;
    const page = await this.fetcher(pageUrl, { headers: codeforcesHeaders(session) });
    const html = await page.text();
    const csrf = /name=["']csrf_token["'][^>]+value=["']([^"']+)/i.exec(html)?.[1] ?? session.csrfToken;
    const programTypeId = languageId(html, input.language);
    if (!programTypeId) throw new PracticeSourceError(`Codeforces did not offer a supported ${input.language} compiler on its submit page.`);
    const submittedAfter = Math.floor(Date.now() / 1000) - 5;
    const form = new URLSearchParams({
      csrf_token: csrf, action: "submitSolutionFormSubmitted", submittedProblemCode: `${identity.contestId}${identity.index}`,
      contestId: String(identity.contestId), submittedProblemIndex: identity.index, programTypeId,
      source: input.code, tabSize: "4", _tta: "176",
      ...(hidden(html, "ftaa") ? { ftaa: hidden(html, "ftaa") } : {}),
      ...(hidden(html, "bfaa") ? { bfaa: hidden(html, "bfaa") } : {}),
    });
    const response = await this.fetcher(pageUrl, { method: "POST", redirect: "follow", headers: { ...codeforcesHeaders(session, pageUrl), "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
    if (response.status === 401 || response.status === 403 || /enter\?back=|handleOrEmail/i.test(response.url)) { this.onExpired(); throw new PracticeAuthError("Codeforces refused this session. Reconnect Codeforces in Settings."); }
    if (!response.ok) throw new PracticeSourceError(`Codeforces answered ${response.status} while submitting.`, response.status);
    const deadline = Date.now() + (input.timeoutMs ?? 120_000);
    let submission: SubmissionWire | undefined;
    while (Date.now() < deadline) {
      const rows = await this.userSubmissions(session.handle, 20);
      submission = rows.find((row) => codeforcesSlug(row.problem ?? {}) === input.problem.slug && (row.creationTimeSeconds ?? 0) >= submittedAfter);
      if (submission && submission.verdict && submission.verdict !== "TESTING") break;
      await sleep(1000);
    }
    if (!submission?.id) throw new PracticeSourceError("Codeforces accepted the request but Spar could not find the new submission in your record.");
    if (!submission.verdict || submission.verdict === "TESTING") throw new PracticeSourceError("Codeforces is still judging the submission. It remains visible in your Codeforces submissions.");
    return normalizeVerdict(submission);
  }

  private async problemset() {
    if (this.problemsetCache && Date.now() - this.problemsetCache.at < 10 * 60_000) return this.problemsetCache;
    const result = await this.api<{ problems?: CodeforcesProblemWire[]; problemStatistics?: CodeforcesProblemStatWire[] }>("problemset.problems");
    const stats = new Map((result.problemStatistics ?? []).map((entry) => [`${entry.contestId}/${entry.index}`, entry]));
    return this.problemsetCache = { at: Date.now(), problems: result.problems ?? [], stats };
  }

  private userSubmissions(handle: string, count: number) { return this.api<SubmissionWire[]>("user.status", { handle, from: 1, count }); }

  private async api<T>(method: string, params: Record<string, string | number> = {}): Promise<T> {
    const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
    const response = await this.fetcher(`${CODEFORCES_ORIGIN}/api/${method}${query ? `?${query}` : ""}`, { headers: codeforcesHeaders(null) }).catch((error: unknown) => { throw new PracticeSourceError(`Spar could not reach Codeforces: ${error instanceof Error ? error.message : String(error)}`); });
    if (response.status === 429) throw new PracticeSourceError("Codeforces is rate-limiting this machine. Wait a few seconds and try again.", 429);
    const payload = await response.json().catch(() => null) as { status?: string; comment?: string; result?: T } | null;
    if (!response.ok || payload?.status !== "OK") throw new PracticeSourceError(payload?.comment || `Codeforces API answered ${response.status}.`, response.status);
    return payload.result as T;
  }

  private async requireSession(action: string): Promise<CodeforcesSession> {
    const session = await this.readSession();
    if (!session) throw new PracticeAuthError(`Connect Codeforces in Settings before Spar can ${action}.`);
    return session;
  }
}

function normalizeSubmission(row: SubmissionWire): PracticeSubmission {
  return { id: String(row.id ?? ""), slug: codeforcesSlug(row.problem ?? {}), title: row.problem?.name ?? "", verdict: verdictName(row.verdict), accepted: row.verdict === "OK", language: row.programmingLanguage ?? "", runtime: `${row.timeConsumedMillis ?? 0} ms`, memory: `${Math.round((row.memoryConsumedBytes ?? 0) / 1024)} KB`, submittedAt: iso(row.creationTimeSeconds), code: "" };
}
function normalizeVerdict(row: SubmissionWire): PracticeVerdict {
  const accepted = row.verdict === "OK";
  const id = String(row.id ?? "");
  const contest = row.contestId ?? row.problem?.contestId ?? 0;
  return { outcome: accepted ? "passed" : "failed", status: verdictName(row.verdict), statusCode: null, passedCases: row.passedTestCount ?? 0, totalCases: accepted ? row.passedTestCount ?? 0 : (row.passedTestCount ?? 0) + 1, runtime: `${row.timeConsumedMillis ?? 0} ms`, memory: `${Math.round((row.memoryConsumedBytes ?? 0) / 1024)} KB`, runtimePercentile: null, memoryPercentile: null, compileError: row.verdict === "COMPILATION_ERROR" ? "Open the Codeforces submission to read the compiler diagnostics." : "", runtimeError: row.verdict === "RUNTIME_ERROR" ? "Open the Codeforces submission to read the runtime diagnostics." : "", failedCase: null, caseAnswers: [], stdout: [], submitted: true, submissionId: id, submissionUrl: `${CODEFORCES_ORIGIN}/contest/${contest}/submission/${id}`, judgedAt: new Date().toISOString() };
}
function uniqueAccepted(rows: SubmissionWire[]) { const result = new Map<string, SubmissionWire>(); for (const row of rows) { const slug = codeforcesSlug(row.problem ?? {}); if (slug && row.verdict === "OK" && !result.has(slug)) result.set(slug, row); } return result; }
function statusIndex(rows: SubmissionWire[]) { const result = new Map<string, "solved" | "attempted">(); for (const row of rows) { const slug = codeforcesSlug(row.problem ?? {}); if (!slug) continue; if (row.verdict === "OK") result.set(slug, "solved"); else if (!result.has(slug)) result.set(slug, "attempted"); } return result; }
function counts(values: Array<"easy" | "medium" | "hard">) { return { total: values.length, easy: values.filter((v) => v === "easy").length, medium: values.filter((v) => v === "medium").length, hard: values.filter((v) => v === "hard").length }; }
function streak(rows: SubmissionWire[]) { const days = new Set(rows.filter((row) => row.verdict === "OK").map((row) => iso(row.creationTimeSeconds).slice(0, 10))); let count = 0; const cursor = new Date(); while (days.has(cursor.toISOString().slice(0, 10))) { count += 1; cursor.setUTCDate(cursor.getUTCDate() - 1); } return count; }
function iso(seconds?: number) { return seconds ? new Date(seconds * 1000).toISOString() : ""; }
function slugify(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9+#]+/g, "-").replace(/^-|-$/g, ""); }
function codeforcesTagsForConcept(value: string) { const slug = slugify(value); return ({ "dynamic-programming": ["dp"], "depth-first-search": ["dfs-and-similar"], "bit-masking": ["bitmasks"], "modular-arithmetic": ["number-theory"], "arrays": ["data-structures", "sortings"], "state-management": ["implementation"], "recursive-decomposition": ["brute-force"], "strings": ["strings"] } as Record<string, string[]>)[slug] ?? [slug]; }
function verdictName(value?: string) { return ({ OK: "Accepted", WRONG_ANSWER: "Wrong Answer", TIME_LIMIT_EXCEEDED: "Time Limit Exceeded", MEMORY_LIMIT_EXCEEDED: "Memory Limit Exceeded", RUNTIME_ERROR: "Runtime Error", COMPILATION_ERROR: "Compilation Error", IDLENESS_LIMIT_EXCEEDED: "Idleness Limit Exceeded", TESTING: "Judging" } as Record<string, string>)[value ?? ""] ?? (value ? value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "Unknown"); }
function languageId(html: string, language: Language) { const options = [...html.matchAll(/<option[^>]+value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi)].map((match) => ({ id: match[1]!, name: decodeHtml(match[2]!).replace(/<[^>]+>/g, "") })); const pattern = language === "cpp" ? /GNU C\+\+2[03]|GNU C\+\+17|GNU C\+\+14/i : language === "typescript" ? /TypeScript/i : /JavaScript|Node\.js/i; return options.find((option) => pattern.test(option.name))?.id ?? ""; }
function hidden(html: string, name: string) { return new RegExp(`name=["']${name}["'][^>]+value=["']([^"']*)`, "i").exec(html)?.[1] ?? ""; }
function decodeHtml(value: string) { return value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&").trim(); }
function sleep(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }

export { casesForCodeforcesProblem };
