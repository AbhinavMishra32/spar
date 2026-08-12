import { app, type BrowserWindow } from "electron";
import path from "node:path";
import {
  buildHarness, buildProgramHarness, CodeforcesGateway, effectiveCapabilities, judgeDescription, judgeInputBlock, LeetCodeGateway, practiceSource, submittableCode,
  type CodeforcesSession, type LeetCodeSession, type PracticeAccount, type PracticeCase, type PracticeConnectionState,
  type PracticeGateway, type PracticeProblem, type PracticeProblemBundle, type PracticeRegion, type PracticeSourceId, type PracticeVerdict,
} from "@spar/practice";
import { connectPracticeMcp, PRACTICE_READ_TOOLS, type PracticeMcpConnection } from "@spar/practice/mcp";
import { practiceProblemSchema, practiceRegionSchema, PRACTICE_SOURCES } from "@spar/practice";
import type { ChallengeSource, Language, QuestionDesign } from "@spar/domain";
import { clearCodeforcesSignIn, clearLeetCodeSignIn, signInToCodeforces, signInToLeetCode } from "./practiceSignIn.js";
import { launchCodeforcesSessionBrowser, type CodeforcesBrowser } from "./codeforcesBrowser.js";
import type { AuthService } from "./auth.js";
import type { LocalStore } from "./store.js";

/**
 * The practice source, as the rest of the app sees it.
 *
 * Everything that knows LeetCode exists ends here. Above this line the app deals
 * in a connection state, a problem, a verdict and a `ChallengeSource`; below it
 * there is a gateway, an MCP server and a cookie. The seam is worth the file: it
 * is what lets the agent reach the source over a real protocol, the workspace
 * mount a real problem, and Settings draw a row, without any of the three
 * learning what a csrftoken is.
 *
 * Two responsibilities are load-bearing enough to name.
 *
 * **The credential.** The session lives in the OS keychain beside the model
 * provider keys, keyed by region, and is never handed to the renderer or written
 * into the local database. The only thing that ever reads it is the gateway, one
 * call at a time.
 *
 * **Who grades.** `judgePreference` decides whether a solve goes to the source or
 * stays on this machine, and every mount stamps the answer onto the challenge as
 * a `ChallengeSource`. That stamp is what stops a local pass being reported later
 * as an acceptance the source never gave.
 */

export type PracticeInventory = {
  source: PracticeSourceId;
  name: string;
  description: string;
  authNote: string;
  region: PracticeRegion;
  regions: Array<{ id: PracticeRegion; label: string }>;
  state: PracticeConnectionState;
  capabilities: ReturnType<typeof effectiveCapabilities>;
  /** Null when disconnected, or when the source could not be reached. */
  account: PracticeAccount | null;
  judgePreference: JudgePreference;
  /** True when the source will decide verdicts for new challenges — the
   *  connection state and the preference, resolved into the one fact that
   *  matters. */
  judgesSubmissions: boolean;
  /** Set when the last read failed, so Settings can say what went wrong instead
   *  of showing a connected row that answers nothing. */
  problem?: string;
};

/** Where a solve is judged. `source` is the default and the stronger evidence;
 *  `local` keeps every line of the learner's code on their machine, which is a
 *  reason someone might genuinely prefer it. */
export type JudgePreference = "source" | "local";

const CACHE_KEY = (source: PracticeSourceId, region: PracticeRegion) => `practice-problem-cache:${source}:${region}`;
/** A rejected credential is a state transition, not a notification. Keeping the
 * tombstone outside the keychain lets Settings distinguish "never connected"
 * from "sign in again", while `readSession` prevents the rejected credential
 * from being sent again. It is region-specific because .com and .cn are separate
 * accounts. */
const EXPIRED_KEY = (source: PracticeSourceId, region: PracticeRegion) => `practice-session-expired:${source}:${region}`;
/** A statement is good for a fortnight; the learner's status on it is not, which
 *  is why a mount re-reads and a browse does not. */
const PROBLEM_CACHE_MS = 14 * 24 * 60 * 60 * 1_000;
const ACCOUNT_CACHE_MS = 5 * 60 * 1_000;

export class PracticeService {
  private connections = new Map<PracticeSourceId, PracticeMcpConnection>();
  private gatewayCache = new Map<string, PracticeGateway>();
  private accountCache = new Map<PracticeSourceId, { at: number; account: PracticeAccount | null }>();
  /** Sign-in is a long-lived browser operation owned by the host. Retaining its
   *  cancellation handle here lets a region change close the obsolete site's
   *  window before the new selection becomes authoritative. */
  private connectionAttempts = new Map<PracticeSourceId, AbortController>();
  private codeforcesBrowser: Promise<CodeforcesBrowser> | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly store: LocalStore,
    private readonly window: () => BrowserWindow | null,
    /** Told whenever the source's connection state changes, so Settings and the
     *  workspace both re-read rather than showing a stale row. */
    private readonly emit: (event: { source: PracticeSourceId; state: PracticeConnectionState; message: string }) => void,
  ) {}

  /* ---- Connection -------------------------------------------------------- */

  region(source: PracticeSourceId): PracticeRegion {
    if (source === "codeforces") return "global";
    return practiceRegionSchema.catch("global").parse(this.store.getSetting(`practice-region:${source}`, "global"));
  }

  async setRegion(source: PracticeSourceId, region: PracticeRegion) {
    if (region === this.region(source)) return;
    this.cancelConnection(source);
    this.store.setSetting(`practice-region:${source}`, region);
    /* The two LeetCodes are separate services with separate accounts and separate
       problem ids, so nothing about the old one survives the switch. */
    this.reset(source);
  }

  judgePreference(source: PracticeSourceId): JudgePreference {
    return this.store.getSetting<JudgePreference>(`practice-judge:${source}`, "source") === "local" ? "local" : "source";
  }

  setJudgePreference(source: PracticeSourceId, preference: JudgePreference) {
    this.store.setSetting(`practice-judge:${source}`, preference);
  }

  /** Whether a new challenge from this source can carry a source verdict. Both
   *  halves have to hold: the learner has to have connected it, and they have to
   *  want their code sent there. */
  async judgesSubmissions(source: PracticeSourceId, region: PracticeRegion = this.region(source)): Promise<boolean> {
    return this.judgePreference(source) === "source" && await this.stateFor(source, region) === "connected";
  }

  async state(source: PracticeSourceId): Promise<PracticeConnectionState> {
    return this.stateFor(source, this.region(source));
  }

  /** Everything Settings draws, in one read. Failures are reported rather than
   *  thrown: a source that cannot be reached is a row that says so. */
  async inventory(): Promise<PracticeInventory[]> {
    return Promise.all(PRACTICE_SOURCES.map(({ id }) => this.inventoryFor(id)));
  }

  private async inventoryFor(source: PracticeSourceId): Promise<PracticeInventory> {
    const descriptor = practiceSource(source);
    const region = this.region(source);
    const base = {
      source,
      name: descriptor.name,
      description: descriptor.description,
      authNote: descriptor.authNote,
      region,
      regions: descriptor.regions.map((id) => ({ id, label: descriptor.regionLabel[id] })),
      judgePreference: this.judgePreference(source),
    };
    try {
      const state = await this.state(source);
      const account = state === "connected" ? await this.account(source) : null;
      return {
        ...base,
        state,
        capabilities: effectiveCapabilities(source, state === "connected"),
        account,
        judgesSubmissions: state === "connected" && this.judgePreference(source) === "source",
      };
    } catch (error) {
      return {
        ...base,
        state: "disconnected",
        capabilities: effectiveCapabilities(source, false),
        account: null,
        judgesSubmissions: false,
        problem: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Connects, by opening the source's own sign-in page.
   *
   * The session is verified before it is kept: a cookie jar can hold a
   * `LEETCODE_SESSION` that LeetCode no longer honours, and storing one of those
   * produces a Settings row that says connected and an agent that cannot read
   * anything.
   */
  async connect(source: PracticeSourceId): Promise<{ status: "connected"; username: string } | { status: "cancelled" } | { status: "failed"; message: string }> {
    this.cancelConnection(source);
    const controller = new AbortController();
    this.connectionAttempts.set(source, controller);
    const region = this.region(source);
    try {
      const result = source === "leetcode"
        ? await signInToLeetCode({ region, parent: this.window(), signal: controller.signal, onProgress: (message) => this.emit({ source, state: "disconnected", message }) })
        : await signInToCodeforces({ parent: this.window(), signal: controller.signal, onProgress: (message) => this.emit({ source, state: "disconnected", message }) });
      if (result.status !== "connected") return result;

      /* The sign-in already asked LeetCode who is signed in and only finished when
         it answered with a name — so the session is known good before it is stored,
         and nothing here re-litigates that. Reading the solve counts is a separate,
         optional step: they are decoration, and letting one of them decide whether
         the sign-in worked is how a perfectly good session gets thrown away. */
      await this.saveSession(source, region, result.session);
      this.reset(source);
      const account = await this.account(source).catch(() => null);
      this.emit({ source, state: "connected", message: `Connected as ${result.username}.` });
      return { status: "connected", username: account?.username ?? result.username };
    } finally {
      if (this.connectionAttempts.get(source) === controller) this.connectionAttempts.delete(source);
    }
  }

  async disconnect(source: PracticeSourceId): Promise<void> {
    this.cancelConnection(source);
    const region = this.region(source);
    await this.clearSession(source, region);
    this.setSessionExpired(source, region, false);
    /* The browser partition too. Leaving a live session in a jar the learner
       believes they disconnected would be the app lying to them. */
    if (source === "leetcode") await clearLeetCodeSignIn(region); else await clearCodeforcesSignIn();
    this.reset(source);
    this.emit({ source, state: "disconnected", message: `Disconnected from ${practiceSource(source).name}.` });
  }

  /** Removes every source credential when the Spar account leaves this device.
   * Selection is irrelevant here: an inactive source still holds a live browser
   * session and keychain secret. */
  async clearAllCredentials(): Promise<void> {
    await Promise.all([
      this.clearSession("leetcode", "global"), this.clearSession("leetcode", "cn"), this.clearSession("codeforces", "global"),
      clearLeetCodeSignIn("global"), clearLeetCodeSignIn("cn"), clearCodeforcesSignIn(),
    ]);
    this.setSessionExpired("leetcode", "global", false);
    this.setSessionExpired("leetcode", "cn", false);
    this.setSessionExpired("codeforces", "global", false);
    this.reset();
  }

  async account(source: PracticeSourceId): Promise<PracticeAccount | null> {
    const cached = this.accountCache.get(source);
    if (cached && Date.now() - cached.at < ACCOUNT_CACHE_MS) return cached.account;
    const account = await this.gatewayFor(source, this.region(source)).account().catch(() => null);
    this.accountCache.set(source, { at: Date.now(), account });
    return account;
  }

  /* ---- Problems ---------------------------------------------------------- */

  /**
   * One problem, from the cache when it is fresh enough and from the source
   * otherwise.
   *
   * `fresh` is for the paths where the learner's own status on the problem is
   * part of the answer — assigning one, or showing whether they have solved it.
   * Everything else reads the cache, because a statement does not change and a
   * request to somebody else's service is not free.
   */
  async problem(source: PracticeSourceId, slug: string, options: { fresh?: boolean } = {}): Promise<PracticeProblemBundle> {
    const region = this.region(source);
    if (!options.fresh) {
      const cached = this.store.readCachedPracticeProblem(source, region, slug, PROBLEM_CACHE_MS);
      const parsed = cached ? practiceProblemSchema.safeParse(cached.payload) : null;
      if (parsed?.success) return this.bundleFor(parsed.data);
    }
    const bundle = await this.gatewayFor(source, region).problem(slug);
    this.store.cachePracticeProblem({
      source,
      region,
      slug: bundle.problem.slug,
      title: bundle.problem.title,
      difficulty: bundle.problem.difficulty,
      payload: bundle.problem,
      references: bundle.problem.references.map((reference) => ({ slug: reference.slug, title: reference.title, difficulty: reference.difficulty, relation: reference.relation })),
    });
    return this.bundleFor(bundle.problem);
  }

  /** What the source says this problem is related to, from what has been read so
   *  far. Both directions, because "a harder version of the one you just failed"
   *  and "what that one leads to" are the same edge read from opposite ends. */
  references(source: PracticeSourceId, slug: string) {
    return this.store.practiceProblemLinks(source, this.region(source), slug);
  }

  /** Search, for the learner browsing rather than the agent choosing. Same call
   *  underneath, so a problem they find and a problem it finds are the same
   *  object with the same tags.
   *
   *  A source that throws is dropped rather than allowed to reject the whole
   *  search. The home page browses on every visit and asks every source at once,
   *  so one of them rate-limiting or going offline would otherwise empty a page
   *  the other source could have filled. `failed` says which ones did, because a
   *  short list with no explanation is the same lie as an empty one. */
  async search(input: { query?: string; concepts?: string[]; difficulty?: "easy" | "medium" | "hard" | undefined; status?: "any" | "todo" | "attempted" | "solved"; limit?: number; offset?: number }) {
    const limit = input.limit ?? 10;
    const offset = input.offset ?? 0;
    const replies = await Promise.all(PRACTICE_SOURCES.map(async ({ id: source }) => {
      try {
        const found = await this.gatewayFor(source, this.region(source)).search({
          query: input.query ?? "",
          tags: [],
          ...(input.difficulty ? { difficulty: input.difficulty } : {}),
          status: input.status ?? "any",
          limit,
          offset,
          ...(input.concepts?.length ? { concepts: input.concepts } : {}),
        });
        return { source, total: found.total, problems: found.problems.map((problem) => ({ ...problem, source })) };
      } catch (cause) {
        return { source, total: 0, problems: [], failure: cause instanceof Error ? cause.message : String(cause) };
      }
    }));
    const problems = interleaveProviderResults(replies.map((reply) => reply.problems)).slice(0, limit);
    return {
      total: replies.reduce((count, reply) => count + reply.total, 0),
      problems,
      failed: replies.flatMap((reply) => ("failure" in reply && reply.failure ? [{ source: reply.source, message: reply.failure }] : [])),
    };
  }

  /**
   * The problem's own example inputs, in the wire format its judge accepts.
   *
   * Read from the source rather than from the challenge, and it exists because a
   * challenge mounted before its cases travelled on it carries none — every one
   * of those would otherwise post an empty case block, which LeetCode answers by
   * running nothing and calling it Accepted. `exampleTestcaseList` is the last
   * resort and the most literal one: it is the exact text the site puts in its own
   * testcase box, so it works even where the statement could not be parsed into
   * cases at all.
   */
  async judgeInput(source: PracticeSourceId, slug: string): Promise<string> {
    const bundle = await this.problem(source, slug);
    return judgeInputBlock(bundle.cases) || bundle.problem.sampleTestcases.join("\n").trim();
  }

  /* ---- Mounting a problem as a challenge ---------------------------------- */

  /**
   * A real problem, as a Spar challenge.
   *
   * The output is an ordinary `QuestionDesign`, which is the point: once mounted,
   * a sourced challenge is opened, edited, run and replayed by exactly the code
   * that handles a generated one. Three fields are deliberately empty and it is
   * worth saying why rather than leaving it to be discovered:
   *
   * - `referenceFiles` — there is no reference solution. Solving it is the
   *   learner's job and nobody has published the answer to Spar.
   * - `hiddenTests` — the hidden cases exist, but they are the source's and stay
   *   there. That is exactly what makes a submission to the source worth more
   *   than a local pass.
   * - `knownIncorrectFiles` — the deterministic compiler's proof that a visible
   *   suite is incomplete does not apply here: this problem was not generated, so
   *   there is nothing to prove about how it was written.
   *
   * The compiler is therefore never run over a sourced design. The guarantee that
   * replaces it is the source's own judge, and where that is unavailable the
   * `ChallengeSource` stamp says so in plain words.
   */
  async mount(input: { source: PracticeSourceId; slug: string; language: Language; problem?: PracticeProblem }): Promise<{ problem: PracticeProblem; design: QuestionDesign; source: ChallengeSource; files: Record<string, string>; cases: PracticeCase[]; harnessNote: string }> {
    const bundle = input.problem ? this.bundleFor(input.problem) : await this.problem(input.source, input.slug, { fresh: true });
    const { problem, cases } = bundle;
    const language = this.languageFor(problem, input.language);
    const harness = problem.source === "codeforces" ? buildProgramHarness({ problem, language, cases }) : buildHarness({ problem, language, cases });
    const remoteJudge = await this.judgesSubmissions(problem.source, problem.region);
    const sourceLanguage = problem.languages.find((entry) => entry.language === language);

    const source: ChallengeSource = {
      source: problem.source,
      region: problem.region,
      slug: problem.slug,
      externalId: problem.externalId,
      displayId: problem.displayId,
      url: problem.url,
      difficulty: problem.difficulty,
      languageSlug: sourceLanguage?.slug ?? language,
      remoteJudge,
      scratchRun: problem.source === "leetcode" && remoteJudge,
      localCaseCount: harness.supported ? harness.cases.length : 0,
      judge: judgeDescription(problem.source, { ...effectiveCapabilities(problem.source, remoteJudge), remoteJudge }),
      entryName: problem.signature?.name ?? "",
      hints: problem.hints,
      localRunNote: harness.supported ? "" : harness.reason,
      /* Every case the problem publishes, not only the ones the local harness could
         wire up: a case Spar cannot run is still the contract the learner is being
         asked to satisfy, and it is the source's own statement of it. */
      cases: cases.map((entry) => ({ name: entry.name, input: entry.input, expected: entry.expected })),
      references: problem.references.map((reference) => ({ slug: reference.slug, title: reference.title, difficulty: reference.difficulty, relation: reference.relation })),
    };

    const tests = Object.fromEntries(Object.entries(harness.files).filter(([path]) => path !== harness.entryPath));
    const design: QuestionDesign = {
      title: problem.title,
      language,
      kind: problem.source === "codeforces" ? "repository" : "function",
      difficulty: DIFFICULTY[problem.difficulty],
      statement: problem.statement.trim(),
      starterFiles: { [harness.entryPath]: harness.files[harness.entryPath] ?? "" },
      referenceFiles: {},
      visibleTests: tests,
      hiddenTests: {},
      knownIncorrectFiles: [],
      runCommand: RUN_COMMAND[language],
      accidentalDifficulty: [],
      expectedFailureSignatures: [],
    };

    return {
      problem,
      design,
      source,
      files: harness.files,
      cases: harness.supported ? harness.cases : [],
      harnessNote: harness.supported ? "" : harness.reason,
    };
  }

  /** The language to mount in: the learner's, when the source publishes a starter
   *  for it, and otherwise whatever it does publish. Silently mounting a language
   *  with no starter gives the learner an empty file and no signature. */
  languageFor(problem: PracticeProblem, preferred: Language): Language {
    if (problem.languages.some((entry) => entry.language === preferred)) return preferred;
    return problem.languages[0]?.language ?? preferred;
  }

  /* ---- Judging ------------------------------------------------------------ */

  /** A scratch run at the source. Costs nothing on the learner's record. */
  async run(input: { source: ChallengeSource; code: string; language: Language; testcases?: string }): Promise<PracticeVerdict> {
    return this.gatewayFor(input.source.source, input.source.region).run({
      slug: input.source.slug,
      externalId: input.source.externalId,
      language: input.language,
      code: submittableCode(input.code),
      ...(input.testcases ? { dataInput: input.testcases } : {}),
    });
  }

  /**
   * A real submission, on the learner's own account at the source.
   *
   * Only ever reached from the learner pressing submit. Nothing the agent can do
   * arrives here — its tool list does not contain a judging tool — because a
   * coding gym whose tutor can submit on your behalf is not measuring you.
   */
  async submit(input: { source: ChallengeSource; code: string; language: Language }): Promise<PracticeVerdict> {
    return this.gatewayFor(input.source.source, input.source.region).submit({
      slug: input.source.slug,
      externalId: input.source.externalId,
      language: input.language,
      code: submittableCode(input.code),
    });
  }

  /* ---- The agent's connection -------------------------------------------- */

  /**
   * Calls one of the source's MCP tools.
   *
   * The agent's tools reach the source through here, over the real protocol —
   * arguments validated by the server's own schemas, results parsed from its own
   * content blocks. The connection is built on first use and torn down whenever
   * the credential changes, so a reconnect is picked up without a restart.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!PRACTICE_READ_TOOLS.some((tool) => tool.name === name)) {
      /* Not a lookup failure — a refusal. The judging tools exist on the server
         for external clients; Spar's agent is not one of them. */
      throw new Error(`"${name}" is not a practice tool Spar's agent may call.`);
    }
    if (name === "search_practice_problems") {
      const replies = await Promise.all(PRACTICE_SOURCES.map(async ({ id: source }) => {
        const result = await (await this.mcp(source)).call(name, args) as Record<string, unknown>;
        const problems = Array.isArray(result.problems)
          ? result.problems.map((problem) => ({ ...(problem as Record<string, unknown>), source, sourceName: practiceSource(source).name }))
          : [];
        return { source, result, problems };
      }));
      const limit = Number(args.limit ?? 8);
      const problems = interleaveProviderResults(replies.map((reply) => reply.problems)).slice(0, limit);
      return {
        total: replies.reduce((count, reply) => count + Number(reply.result.total ?? 0), 0),
        returned: problems.length,
        problems,
        sources: replies.map(({ source, result }) => ({ source, name: practiceSource(source).name, returned: Number(result.returned ?? 0), note: result.note })),
        note: problems.length
          ? "Results come from every registered problem provider; a connection adds account history and remote judging. Preserve `source` with the slug when reading or assigning one."
          : "No provider matched. Loosen one filter or write the challenge yourself.",
      };
    }
    const source = args.source;
    if (source !== "leetcode" && source !== "codeforces") throw new Error(`"${name}" needs the result's \`source\` (leetcode or codeforces).`);
    return (await this.mcp(source)).call(name, args);
  }

  private async mcp(source: PracticeSourceId): Promise<PracticeMcpConnection> {
    const cached = this.connections.get(source);
    if (cached) return cached;
    const connection = await connectPracticeMcp({
      gateway: this.gatewayFor(source, this.region(source)),
      /* Read-only, deliberately. See `callTool`. */
      allowJudging: false,
    });
    this.connections.set(source, connection);
    return connection;
  }

  /* ---- Internals ---------------------------------------------------------- */

  private gatewayFor(source: PracticeSourceId, region: PracticeRegion): PracticeGateway {
    const key = `${source}:${region}`;
    const cached = this.gatewayCache.get(key);
    if (cached) return cached;
    const options = {
      onExpired: () => {
        this.markSessionExpired(source, region);
      },
    };
    const gateway = source === "leetcode"
      ? new LeetCodeGateway(region, () => this.readSession(source, region) as Promise<LeetCodeSession | null>, options)
      : new CodeforcesGateway(() => this.readSession(source, region) as Promise<CodeforcesSession | null>, {
          ...options,
          fetcher: (input, init) => this.codeforcesFetch(input, init),
        });
    this.gatewayCache.set(key, gateway);
    return gateway;
  }

  /** Drops everything derived from the credential. Called on connect, disconnect
   *  and a region change, so nothing keeps answering from the last account. */
  private reset(source?: PracticeSourceId) {
    if (source) {
      void this.connections.get(source)?.close();
      this.connections.delete(source);
      this.accountCache.delete(source);
      for (const key of this.gatewayCache.keys()) if (key.startsWith(`${source}:`)) this.gatewayCache.delete(key);
      this.store.setSetting(CACHE_KEY(source, this.region(source)), Date.now());
      if (source === "codeforces") this.closeCodeforcesBrowser();
      return;
    }
    for (const connection of this.connections.values()) void connection.close();
    this.connections.clear();
    this.gatewayCache.clear();
    this.accountCache.clear();
    this.closeCodeforcesBrowser();
  }

  /** Stops the real-browser transport before Electron exits. Chrome is a child
   * process, not an Electron window, so closing the app does not close it for us. */
  stop(): void {
    for (const source of this.connectionAttempts.keys()) this.cancelConnection(source);
    this.reset();
  }

  private cancelConnection(source: PracticeSourceId): void {
    this.connectionAttempts.get(source)?.abort();
    this.connectionAttempts.delete(source);
  }

  private async codeforcesFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = input instanceof Request ? input.url : String(input);
    const parsed = new URL(url);
    if (parsed.hostname !== "codeforces.com" || parsed.pathname !== "/problemset/submit") return fetch(input, init);
    let browser = await this.codeforcesBrowserInstance();
    if (browser.closed) {
      this.codeforcesBrowser = null;
      browser = await this.codeforcesBrowserInstance();
    }
    const posting = (init?.method ?? "GET").toUpperCase() === "POST";
    try {
      return await browser.request(url, init);
    } finally {
      /* GET and POST must share one verified browser. Once the POST response is
         back, verdict polling uses Codeforces' public API and the temporary
         Chrome window has no reason to remain open. */
      if (posting) this.closeCodeforcesBrowser();
    }
  }

  private codeforcesBrowserInstance(): Promise<CodeforcesBrowser> {
    if (!this.codeforcesBrowser) {
      const profile = path.join(app.getPath("userData"), "codeforces-browser");
      this.codeforcesBrowser = launchCodeforcesSessionBrowser(profile).catch((error) => {
        this.codeforcesBrowser = null;
        throw error;
      });
    }
    return this.codeforcesBrowser;
  }

  private closeCodeforcesBrowser(): void {
    const browser = this.codeforcesBrowser;
    this.codeforcesBrowser = null;
    if (browser) void browser.then((value) => value.close()).catch(() => undefined);
  }

  private bundleFor(problem: PracticeProblem): PracticeProblemBundle {
    const connected = Boolean(this.accountCache.get(problem.source)?.account);
    const capabilities = effectiveCapabilities(problem.source, connected);
    return { problem, cases: casesFor(problem), capabilities, judge: judgeDescription(problem.source, capabilities) };
  }

  private keychainAccount(source: PracticeSourceId, region: PracticeRegion) {
    return `practice:${source}:${region}`;
  }

  private async readSession(source: PracticeSourceId, region: PracticeRegion): Promise<LeetCodeSession | CodeforcesSession | null> {
    /* Once rejected, do not keep presenting the same credential to the source.
       Reconnect verifies and overwrites it; disconnect removes it. */
    if (this.sessionExpired(source, region)) return null;
    const raw = await this.auth.readSecret(this.keychainAccount(source, region));
    if (!raw) return null;
    try { return JSON.parse(raw) as LeetCodeSession | CodeforcesSession; } catch { return null; }
  }

  private async saveSession(source: PracticeSourceId, region: PracticeRegion, session: LeetCodeSession | CodeforcesSession) {
    await this.auth.saveSecret(this.keychainAccount(source, region), JSON.stringify(session));
    this.setSessionExpired(source, region, false);
  }

  private async clearSession(source: PracticeSourceId, region: PracticeRegion) {
    await this.auth.deleteSecret(this.keychainAccount(source, region));
  }

  private sessionExpired(source: PracticeSourceId, region: PracticeRegion): boolean {
    return this.store.getSetting<boolean>(EXPIRED_KEY(source, region), false);
  }

  private setSessionExpired(source: PracticeSourceId, region: PracticeRegion, expired: boolean): void {
    this.store.setSetting(EXPIRED_KEY(source, region), expired);
  }

  /** Makes expiry monotonic until an explicit reconnect or disconnect. The guard
   * is what breaks the event -> inventory -> event feedback loop in Settings. */
  private markSessionExpired(source: PracticeSourceId, region: PracticeRegion): void {
    if (this.sessionExpired(source, region)) return;
    this.setSessionExpired(source, region, true);
    this.accountCache.set(source, { at: Date.now(), account: null });
    this.emit({ source, state: "expired", message: `${practiceSource(source).name} refused the stored session. Reconnect it in Settings.` });
  }

  private async stateFor(source: PracticeSourceId, region: PracticeRegion): Promise<PracticeConnectionState> {
    if (this.sessionExpired(source, region)) return "expired";
    const state = await this.gatewayFor(source, region).state();
    /* A concurrent identity read may have marked the session while this one was
       awaiting the network. Never let its older answer resurrect "connected". */
    return this.sessionExpired(source, region) ? "expired" : state;
  }
}

/** LeetCode's three bands against Spar's four. `developing` has no counterpart:
 *  it describes a learner's position on a challenge Spar wrote for them, and a
 *  public problem does not know who is attempting it. */
const DIFFICULTY: Record<PracticeProblem["difficulty"], NonNullable<QuestionDesign["difficulty"]>> = {
  easy: "foundation",
  medium: "proficient",
  hard: "advanced",
};

const RUN_COMMAND: Record<Language, string> = {
  javascript: "node --test",
  typescript: "node --test",
  python:"python3 tests",java:"javac && java tests",c:"clang && run tests",
  cpp: "clang++ && run tests",
  go:"go test ./...",rust:"rustc --test",swift:"swiftc && run tests",ruby:"ruby tests",
};

/** Re-derived here rather than carried, so a problem read from the cache and one
 *  read from the source produce the same cases. */
function casesFor(problem: PracticeProblem): PracticeCase[] {
  if (problem.source === "codeforces") return problem.examples.flatMap((example, index) => example.input.length === 1 && example.output.trim() ? [{ name: `Example ${index + 1}`, input: example.input, expected: example.output, origin: "source" as const }] : []);
  const params = problem.signature?.params.length ?? 0;
  return problem.examples.flatMap((example, index) =>
    example.input.length === params && example.output.trim()
      ? [{ name: `Example ${index + 1}`, input: example.input, expected: example.output, origin: "statement" as const }]
      : []);
}

/** Round-robin rather than concatenation: when each provider returns a full page,
 * concatenating and trimming would make the registry's first provider the only
 * one the agent ever sees. Provider order is configuration, not relevance. */
export function interleaveProviderResults<T>(groups: T[][]): T[] {
  const rows: T[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < longest; index += 1) {
    for (const group of groups) if (group[index] !== undefined) rows.push(group[index]!);
  }
  return rows;
}
