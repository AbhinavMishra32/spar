import type { Language } from "@spar/domain";
import { casesForProblem } from "./leetcode/normalize.js";
import { LeetCodeClient } from "./leetcode/client.js";
import type { LeetCodeSession } from "./leetcode/session.js";
import { CodeforcesClient } from "./codeforces/client.js";
import { casesForCodeforcesProblem } from "./codeforces/normalize.js";
import type { CodeforcesSession } from "./codeforces/session.js";
import { effectiveCapabilities, judgeDescription, practiceSource } from "./sources.js";
import type {
  PracticeAccount, PracticeCase, PracticeConnectionState, PracticeProblem, PracticeProblemSummary,
  PracticeRegion, PracticeSearchInput, PracticeSourceCapabilities, PracticeSourceId, PracticeSubmission,
  PracticeVerdict,
} from "./types.js";
import { PracticeAuthError } from "./types.js";

/**
 * One source, behind the operations everything else needs from it.
 *
 * The gateway exists so that the MCP server, the desktop host and the stdio
 * binary all talk to a source through the same seam — and so that adding a second
 * source means writing one of these rather than touching any of them. It is
 * deliberately thin: it resolves capabilities, attaches the two facts that must
 * travel with every problem (who judges it, and where its cases came from), and
 * otherwise forwards.
 */
export type PracticeProblemBundle = {
  problem: PracticeProblem;
  /** Cases Spar could actually run locally, which may be none. */
  cases: PracticeCase[];
  capabilities: PracticeSourceCapabilities;
  /** One sentence naming the grading authority, in the learner's words. Carried
   *  rather than derived at each call site, because getting it wrong means
   *  telling someone the source accepted an answer it never saw. */
  judge: string;
};

export interface PracticeGateway {
  readonly sourceId: PracticeSourceId;
  readonly region: PracticeRegion;
  state(): Promise<PracticeConnectionState>;
  capabilities(): Promise<PracticeSourceCapabilities>;
  account(): Promise<PracticeAccount | null>;
  /** `appliedTags` is what the source was actually filtered by, and `droppedTags`
   *  what had to be given up to find anything — a source that intersects its tags
   *  cannot honour every concept at once, and a caller told only "no results"
   *  cannot tell that apart from a broken search. */
  search(input: PracticeSearchInput & { concepts?: string[] }): Promise<{ total: number; problems: PracticeProblemSummary[]; appliedTags: string[]; droppedTags: string[] }>;
  problem(slug: string): Promise<PracticeProblemBundle>;
  daily(): Promise<PracticeProblemBundle>;
  random(input: { tags?: string[]; difficulty?: string }): Promise<string | null>;
  progress(input: { status?: "ATTEMPTED" | "SOLVED"; limit?: number; offset?: number }): Promise<Array<{ slug: string; title: string; difficulty: string; status: string; lastResult: string; lastSubmittedAt: string; topicTags: string[] }>>;
  submissions(slug: string, limit?: number): Promise<PracticeSubmission[]>;
  submissionDetail(id: string): Promise<PracticeSubmission | null>;
  /** A scratch run against the source's judge. Costs nothing on the learner's
   *  record, which is why it is the one the UI's Run button reaches for. */
  run(input: { slug: string; externalId: string; language: Language; code: string; dataInput?: string }): Promise<PracticeVerdict>;
  /** A real submission. Appears on the learner's account at the source. */
  submit(input: { slug: string; externalId: string; language: Language; code: string }): Promise<PracticeVerdict>;
}

/** LeetCode, as a gateway. The session is read per call rather than held, so a
 *  reconnect or an expiry takes effect on the next operation. */
export class LeetCodeGateway implements PracticeGateway {
  readonly sourceId = "leetcode" as const;
  private readonly client: LeetCodeClient;

  constructor(
    readonly region: PracticeRegion,
    private readonly readSession: () => Promise<LeetCodeSession | null>,
    options: { fetcher?: typeof fetch; onExpired?: () => void } = {},
  ) {
    this.client = new LeetCodeClient(region, readSession, options.fetcher ?? fetch, options.onExpired ?? (() => undefined));
  }

  async state(): Promise<PracticeConnectionState> {
    if (!await this.readSession()) return "disconnected";
    /* An identity read is the only honest connection check: a stored cookie says
       nothing about whether LeetCode still accepts it. A failure here is reported
       as expired rather than thrown, because the caller is usually drawing a row
       in Settings and an exception would read as the source being down. */
    try { return await this.client.whoami() ? "connected" : "expired"; }
    catch (error) {
      /* A transport failure is not evidence that a credential expired. Let the
         host surface the reachability error instead of turning one flaky read
         into a false auth transition. */
      if (error instanceof PracticeAuthError) return "expired";
      throw error;
    }
  }

  async capabilities(): Promise<PracticeSourceCapabilities> {
    return effectiveCapabilities(this.sourceId, await this.state() === "connected");
  }

  account() { return this.client.account(); }
  search(input: PracticeSearchInput & { concepts?: string[] }) { return this.client.search(input); }
  random(input: { tags?: string[]; difficulty?: string }) { return this.client.random(input); }
  progress(input: { status?: "ATTEMPTED" | "SOLVED"; limit?: number; offset?: number }) { return this.client.progress(input); }
  submissions(slug: string, limit?: number) { return this.client.submissions(slug, limit); }
  submissionDetail(id: string) { return this.client.submissionDetail(id); }

  async problem(slug: string): Promise<PracticeProblemBundle> {
    return this.bundle(await this.client.problem(slug));
  }

  async daily(): Promise<PracticeProblemBundle> {
    return this.bundle(await this.client.daily());
  }

  run(input: { slug: string; externalId: string; language: Language; code: string; dataInput?: string }) {
    return this.client.run({
      problem: { slug: input.slug, externalId: input.externalId },
      language: input.language,
      code: input.code,
      ...(input.dataInput === undefined ? {} : { dataInput: input.dataInput }),
    });
  }

  submit(input: { slug: string; externalId: string; language: Language; code: string }) {
    return this.client.submit({ problem: { slug: input.slug, externalId: input.externalId }, language: input.language, code: input.code });
  }

  private async bundle(problem: PracticeProblem): Promise<PracticeProblemBundle> {
    const capabilities = await this.capabilities();
    return { problem, cases: casesForProblem(problem), capabilities, judge: judgeDescription(this.sourceId, capabilities) };
  }
}

/** Codeforces behind the same source seam. Its public API handles discovery and
 * history; authenticated browser requests are reserved for explicit submits. */
export class CodeforcesGateway implements PracticeGateway {
  readonly sourceId = "codeforces" as const;
  readonly region = "global" as const;
  private readonly client: CodeforcesClient;

  constructor(
    private readonly readSession: () => Promise<CodeforcesSession | null>,
    options: { fetcher?: typeof fetch; onExpired?: () => void } = {},
  ) { this.client = new CodeforcesClient(readSession, options.fetcher ?? fetch, options.onExpired ?? (() => undefined)); }

  async state(): Promise<PracticeConnectionState> {
    if (!await this.readSession()) return "disconnected";
    try { return await this.client.whoami() ? "connected" : "expired"; }
    catch (error) {
      if (error instanceof PracticeAuthError) return "expired";
      throw error;
    }
  }
  async capabilities() { return effectiveCapabilities(this.sourceId, await this.state() === "connected"); }
  account() { return this.client.account(); }
  search(input: PracticeSearchInput & { concepts?: string[] }) { return this.client.search(input); }
  random(input: { tags?: string[]; difficulty?: string }) { return this.client.random(input); }
  progress(input: { status?: "ATTEMPTED" | "SOLVED"; limit?: number; offset?: number }) { return this.client.progress(input); }
  submissions(slug: string, limit?: number) { return this.client.submissions(slug, limit); }
  submissionDetail(id: string) { return this.client.submissionDetail(id); }
  async problem(slug: string) { return this.bundle(await this.client.problem(slug)); }
  async daily() { return this.bundle(await this.client.daily()); }
  run(_input: { slug: string; externalId: string; language: Language; code: string; dataInput?: string }) { return this.client.run(); }
  submit(input: { slug: string; externalId: string; language: Language; code: string }) { return this.client.submit({ problem: { slug: input.slug, externalId: input.externalId }, language: input.language, code: input.code }); }
  private async bundle(problem: PracticeProblem): Promise<PracticeProblemBundle> { const capabilities = await this.capabilities(); return { problem, cases: casesForCodeforcesProblem(problem), capabilities, judge: judgeDescription(this.sourceId, capabilities) }; }
}

/** The source's own name, for a message that has to say who is being talked to. */
export function gatewayName(gateway: PracticeGateway): string {
  return practiceSource(gateway.sourceId).name;
}
