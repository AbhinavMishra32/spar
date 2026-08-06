import type { BrowserWindow } from "electron";
import {
  buildHarness, effectiveCapabilities, judgeDescription, LeetCodeGateway, practiceSource, submittableCode,
  type LeetCodeSession, type PracticeAccount, type PracticeCase, type PracticeConnectionState,
  type PracticeGateway, type PracticeProblem, type PracticeProblemBundle, type PracticeRegion, type PracticeVerdict,
} from "@spar/practice";
import { connectPracticeMcp, PRACTICE_READ_TOOLS, type PracticeMcpConnection } from "@spar/practice/mcp";
import { practiceProblemSchema, practiceRegionSchema } from "@spar/practice";
import type { ChallengeSource, Language, QuestionDesign } from "@spar/domain";
import { clearLeetCodeSignIn, signInToLeetCode } from "./practiceSignIn.js";
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
  source: "leetcode";
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

const CACHE_KEY = (region: PracticeRegion) => `practice-problem-cache:leetcode:${region}`;
/** A statement is good for a fortnight; the learner's status on it is not, which
 *  is why a mount re-reads and a browse does not. */
const PROBLEM_CACHE_MS = 14 * 24 * 60 * 60 * 1_000;
const ACCOUNT_CACHE_MS = 5 * 60 * 1_000;

export class PracticeService {
  private connection: PracticeMcpConnection | null = null;
  private gatewayCache: PracticeGateway | null = null;
  private accountCache: { at: number; account: PracticeAccount | null } | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly store: LocalStore,
    private readonly window: () => BrowserWindow | null,
    /** Told whenever the source's connection state changes, so Settings and the
     *  workspace both re-read rather than showing a stale row. */
    private readonly emit: (event: { source: "leetcode"; state: PracticeConnectionState; message: string }) => void,
  ) {}

  /* ---- Connection -------------------------------------------------------- */

  region(): PracticeRegion {
    return practiceRegionSchema.catch("global").parse(this.store.getSetting("practice-region:leetcode", "global"));
  }

  async setRegion(region: PracticeRegion) {
    if (region === this.region()) return;
    this.store.setSetting("practice-region:leetcode", region);
    /* The two LeetCodes are separate services with separate accounts and separate
       problem ids, so nothing about the old one survives the switch. */
    this.reset();
  }

  judgePreference(): JudgePreference {
    return this.store.getSetting<JudgePreference>("practice-judge:leetcode", "source") === "local" ? "local" : "source";
  }

  setJudgePreference(preference: JudgePreference) {
    this.store.setSetting("practice-judge:leetcode", preference);
  }

  /** Whether a new challenge from this source can carry a source verdict. Both
   *  halves have to hold: the learner has to have connected it, and they have to
   *  want their code sent there. */
  async judgesSubmissions(): Promise<boolean> {
    return this.judgePreference() === "source" && await this.state() === "connected";
  }

  async state(): Promise<PracticeConnectionState> {
    return this.gateway().state();
  }

  /** Everything Settings draws, in one read. Failures are reported rather than
   *  thrown: a source that cannot be reached is a row that says so. */
  async inventory(): Promise<PracticeInventory> {
    const descriptor = practiceSource("leetcode");
    const region = this.region();
    const base = {
      source: "leetcode" as const,
      name: descriptor.name,
      description: descriptor.description,
      authNote: descriptor.authNote,
      region,
      regions: descriptor.regions.map((id) => ({ id, label: descriptor.regionLabel[id] })),
      judgePreference: this.judgePreference(),
    };
    try {
      const state = await this.state();
      const account = state === "connected" ? await this.account() : null;
      return {
        ...base,
        state,
        capabilities: effectiveCapabilities("leetcode", state === "connected"),
        account,
        judgesSubmissions: state === "connected" && this.judgePreference() === "source",
      };
    } catch (error) {
      return {
        ...base,
        state: "disconnected",
        capabilities: effectiveCapabilities("leetcode", false),
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
  async connect(): Promise<{ status: "connected"; username: string } | { status: "cancelled" } | { status: "failed"; message: string }> {
    const region = this.region();
    const result = await signInToLeetCode({
      region,
      parent: this.window(),
      onProgress: (message) => this.emit({ source: "leetcode", state: "disconnected", message }),
    });
    if (result.status !== "connected") return result;

    await this.saveSession(region, result.session);
    this.reset();
    const identity = await this.gateway().account().catch(() => null);
    if (!identity) {
      await this.clearSession(region);
      this.reset();
      const message = `${practiceSource("leetcode").name} did not accept the session from that sign-in. Try again, and finish on a page that shows you signed in.`;
      this.emit({ source: "leetcode", state: "disconnected", message });
      return { status: "failed", message };
    }
    this.accountCache = { at: Date.now(), account: identity };
    this.emit({ source: "leetcode", state: "connected", message: `Connected as ${identity.username}.` });
    return { status: "connected", username: identity.username };
  }

  async disconnect(): Promise<void> {
    const region = this.region();
    await this.clearSession(region);
    /* The browser partition too. Leaving a live session in a jar the learner
       believes they disconnected would be the app lying to them. */
    await clearLeetCodeSignIn(region);
    this.reset();
    this.emit({ source: "leetcode", state: "disconnected", message: `Disconnected from ${practiceSource("leetcode").name}.` });
  }

  async account(): Promise<PracticeAccount | null> {
    if (this.accountCache && Date.now() - this.accountCache.at < ACCOUNT_CACHE_MS) return this.accountCache.account;
    const account = await this.gateway().account().catch(() => null);
    this.accountCache = { at: Date.now(), account };
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
  async problem(slug: string, options: { fresh?: boolean } = {}): Promise<PracticeProblemBundle> {
    const region = this.region();
    if (!options.fresh) {
      const cached = this.store.readCachedPracticeProblem("leetcode", region, slug, PROBLEM_CACHE_MS);
      const parsed = cached ? practiceProblemSchema.safeParse(cached.payload) : null;
      if (parsed?.success) return this.bundleFor(parsed.data);
    }
    const bundle = await this.gateway().problem(slug);
    this.store.cachePracticeProblem({
      source: "leetcode",
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
  references(slug: string) {
    return this.store.practiceProblemLinks("leetcode", this.region(), slug);
  }

  /** Search, for the learner browsing rather than the agent choosing. Same call
   *  underneath, so a problem they find and a problem it finds are the same
   *  object with the same tags. */
  search(input: { query?: string; concepts?: string[]; difficulty?: "easy" | "medium" | "hard" | undefined; status?: "any" | "todo" | "attempted" | "solved"; limit?: number }) {
    return this.gateway().search({
      query: input.query ?? "",
      tags: [],
      ...(input.difficulty ? { difficulty: input.difficulty } : {}),
      status: input.status ?? "any",
      limit: input.limit ?? 10,
      offset: 0,
      ...(input.concepts?.length ? { concepts: input.concepts } : {}),
    });
  }

  sourceName(): string {
    return practiceSource("leetcode").name;
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
  async mount(input: { slug: string; language: Language; problem?: PracticeProblem }): Promise<{ design: QuestionDesign; source: ChallengeSource; files: Record<string, string>; cases: PracticeCase[]; harnessNote: string }> {
    const bundle = input.problem ? this.bundleFor(input.problem) : await this.problem(input.slug, { fresh: true });
    const { problem, cases } = bundle;
    const language = this.languageFor(problem, input.language);
    const harness = buildHarness({ problem, language, cases });
    const remoteJudge = await this.judgesSubmissions();
    const sourceLanguage = problem.languages.find((entry) => entry.language === language);

    const source: ChallengeSource = {
      source: "leetcode",
      region: problem.region,
      slug: problem.slug,
      externalId: problem.externalId,
      displayId: problem.displayId,
      url: problem.url,
      difficulty: problem.difficulty,
      languageSlug: sourceLanguage?.slug ?? language,
      remoteJudge,
      localCaseCount: harness.supported ? harness.cases.length : 0,
      judge: judgeDescription("leetcode", { ...effectiveCapabilities("leetcode", remoteJudge), remoteJudge }),
      references: problem.references.map((reference) => ({ slug: reference.slug, title: reference.title, difficulty: reference.difficulty, relation: reference.relation })),
    };

    const tests = Object.fromEntries(Object.entries(harness.files).filter(([path]) => path !== harness.entryPath));
    const design: QuestionDesign = {
      title: problem.title,
      language,
      kind: "function",
      difficulty: DIFFICULTY[problem.difficulty],
      statement: statementFor(problem, source, harness.supported ? "" : harness.reason),
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
    return this.gateway().run({
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
    return this.gateway().submit({
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
    return (await this.mcp()).call(name, args);
  }

  private async mcp(): Promise<PracticeMcpConnection> {
    if (this.connection) return this.connection;
    this.connection = await connectPracticeMcp({
      gateway: this.gateway(),
      /* Read-only, deliberately. See `callTool`. */
      allowJudging: false,
    });
    return this.connection;
  }

  /* ---- Internals ---------------------------------------------------------- */

  private gateway(): PracticeGateway {
    if (this.gatewayCache) return this.gatewayCache;
    const region = this.region();
    this.gatewayCache = new LeetCodeGateway(region, () => this.readSession(region), {
      onExpired: () => {
        /* One place decides the session is dead, and everything downstream reads
           it from the connection state rather than from its own failure. */
        this.accountCache = { at: Date.now(), account: null };
        this.emit({ source: "leetcode", state: "expired", message: `${practiceSource("leetcode").name} refused the stored session. Reconnect it in Settings.` });
      },
    });
    return this.gatewayCache;
  }

  /** Drops everything derived from the credential. Called on connect, disconnect
   *  and a region change, so nothing keeps answering from the last account. */
  private reset() {
    void this.connection?.close();
    this.connection = null;
    this.gatewayCache = null;
    this.accountCache = null;
    this.store.setSetting(CACHE_KEY(this.region()), Date.now());
  }

  private bundleFor(problem: PracticeProblem): PracticeProblemBundle {
    const connected = Boolean(this.accountCache?.account) || this.judgePreference() === "source";
    const capabilities = effectiveCapabilities("leetcode", connected);
    return { problem, cases: casesFor(problem), capabilities, judge: judgeDescription("leetcode", capabilities) };
  }

  private keychainAccount(region: PracticeRegion) {
    return `practice:leetcode:${region}`;
  }

  private async readSession(region: PracticeRegion): Promise<LeetCodeSession | null> {
    const raw = await this.auth.readSecret(this.keychainAccount(region));
    if (!raw) return null;
    try { return JSON.parse(raw) as LeetCodeSession; } catch { return null; }
  }

  private async saveSession(region: PracticeRegion, session: LeetCodeSession) {
    await this.auth.saveSecret(this.keychainAccount(region), JSON.stringify(session));
  }

  private async clearSession(region: PracticeRegion) {
    await this.auth.deleteSecret(this.keychainAccount(region));
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
  cpp: "clang++ && run tests",
};

/** Re-derived here rather than carried, so a problem read from the cache and one
 *  read from the source produce the same cases. */
function casesFor(problem: PracticeProblem): PracticeCase[] {
  const params = problem.signature?.params.length ?? 0;
  return problem.examples.flatMap((example, index) =>
    example.input.length === params && example.output.trim()
      ? [{ name: `Example ${index + 1}`, input: example.input, expected: example.output, origin: "statement" as const }]
      : []);
}

/**
 * The statement the learner reads.
 *
 * The source's own text, with a footer Spar adds. The footer is not decoration:
 * it names where the problem came from, links to it, and states who will decide
 * whether the answer is right. A learner looking at a problem in a practice app
 * is entitled to know all three without asking.
 */
function statementFor(problem: PracticeProblem, source: ChallengeSource, harnessNote: string): string {
  const name = practiceSource("leetcode").name;
  const lines = [
    problem.statement.trim(),
    "",
    "---",
    "",
    `**${name} ${source.displayId} · ${TITLE_CASE[problem.difficulty]}** — [open on ${name}](${problem.url})`,
    "",
    source.judge,
  ];
  if (harnessNote) lines.push("", `Spar cannot run this one locally: ${harnessNote}`);
  else if (source.localCaseCount) lines.push("", `Running the tests here checks the ${source.localCaseCount} example${source.localCaseCount === 1 ? "" : "s"} published with the problem. ${source.remoteJudge ? `Submitting sends your solution to ${name}, which runs every hidden case it has.` : ""}`.trim());
  if (problem.hints.length) lines.push("", `<details><summary>${problem.hints.length} hint${problem.hints.length === 1 ? "" : "s"} from ${name}</summary>`, "", ...problem.hints.map((hint, index) => `${index + 1}. ${hint}`), "", "</details>");
  return lines.join("\n");
}

const TITLE_CASE: Record<PracticeProblem["difficulty"], string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
