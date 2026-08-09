import { z } from "zod";
import { languageSchema } from "@spar/domain";

/**
 * A practice source is somewhere real problems come from.
 *
 * Deliberately not called a "provider": in Spar that word already means the
 * model a turn runs on, and confusing the two would put "LeetCode" in the same
 * list as "Anthropic". A source answers a different question — not *what thinks*
 * but *what the learner is asked to solve*.
 *
 * The abstraction exists because sources differ in exactly one interesting way:
 * how much of the loop they can close. LeetCode can search, describe, judge and
 * record a solve. A scraped corpus can only describe. Everything downstream —
 * the workspace, the verdict path, what the agent is told it may promise —
 * follows from `PracticeSourceCapabilities` rather than from the source's name.
 */
export const practiceSourceIdSchema = z.enum(["leetcode", "codeforces"]);
export type PracticeSourceId = z.infer<typeof practiceSourceIdSchema>;

/** Which LeetCode. The two are separate services with separate accounts, separate
 *  problem ids and, in places, separate response shapes — so the region is part
 *  of a problem's identity rather than a preference applied on the way out. */
export const practiceRegionSchema = z.enum(["global", "cn"]);
export type PracticeRegion = z.infer<typeof practiceRegionSchema>;

export const practiceDifficultySchema = z.enum(["easy", "medium", "hard"]);
export type PracticeDifficulty = z.infer<typeof practiceDifficultySchema>;

/**
 * What a source can actually do, which is what decides how a challenge from it
 * behaves. Read as a contract by the host, never as a hint:
 *
 * - `remoteJudge` — the source will run a submission and return a verdict. When
 *   this is true the source is the grading authority and Spar records what it
 *   said; when it is false the local runner grades against the cases we hold.
 * - `officialTestcases` — the problem ships its own inputs. When false, cases
 *   have to be recovered from the statement or written by the agent, and the
 *   host must say so rather than implying the problem came with them.
 * - `search`, `progress`, `submissionHistory` — whether the source answers
 *   "what should they do next", "what have they already done", and "how did
 *   they do it last time". Each one the agent can rely on is one fewer thing
 *   it has to guess about the learner.
 */
export type PracticeSourceCapabilities = {
  remoteJudge: boolean;
  /** Whether the remote judge offers a non-recording sample run. Codeforces does
   *  not: its Run button must stay local while Submit reaches the remote judge. */
  scratchRun: boolean;
  officialTestcases: boolean;
  search: boolean;
  progress: boolean;
  submissionHistory: boolean;
};

/** One language a problem can be solved in, with the source's own starter code.
 *  `slug` is the source's identifier for it — LeetCode wants "javascript" and
 *  "cpp" back exactly as it gave them, and a run posted with the wrong slug is
 *  a compile error with no useful message in it. */
export const practiceLanguageSchema = z.object({
  language: languageSchema,
  slug: z.string().min(1),
  starter: z.string(),
});
export type PracticeLanguage = z.infer<typeof practiceLanguageSchema>;

/** A worked example, as the statement states it. The input lines are per-argument
 *  and in signature order, so a case can be replayed against the real function
 *  rather than only read. */
export const practiceExampleSchema = z.object({
  input: z.array(z.string()),
  output: z.string(),
  explanation: z.string().default(""),
});
export type PracticeExample = z.infer<typeof practiceExampleSchema>;

/**
 * One case Spar can actually run locally: arguments in signature order and the
 * value the function must return. `origin` is load-bearing rather than
 * decorative — a case recovered from the statement and a case the agent invented
 * are different kinds of evidence, and a failing generated case has to be
 * readable as possibly-wrong-case rather than certainly-wrong-code.
 */
export const practiceCaseSchema = z.object({
  name: z.string().min(1),
  input: z.array(z.string()),
  expected: z.string(),
  origin: z.enum(["source", "statement", "generated"]),
});
export type PracticeCase = z.infer<typeof practiceCaseSchema>;

/** How one problem relates to another, in the source's own words. This is what
 *  makes "you failed this, so try the one it is a variation of" possible, and
 *  it is stored rather than followed immediately: the graph is worth more than
 *  any single hop through it. */
export const practiceReferenceSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  difficulty: practiceDifficultySchema.nullable(),
  relation: z.enum(["similar", "prerequisite", "follow-up"]).default("similar"),
  paidOnly: z.boolean().default(false),
});
export type PracticeReference = z.infer<typeof practiceReferenceSchema>;

/** The signature, as the source declares it. Without this a statement is prose:
 *  the parameter names and types are what let a case be turned into a call. */
export const practiceSignatureSchema = z.object({
  name: z.string().min(1),
  params: z.array(z.object({ name: z.string(), type: z.string() })),
  returnType: z.string(),
  /** LeetCode's class-based problems (design questions) have no single entry
   *  point, so they cannot be driven by a generated harness at all. */
  classBased: z.boolean().default(false),
});
export type PracticeSignature = z.infer<typeof practiceSignatureSchema>;

/**
 * A real problem, normalised. Everything a host needs to mount it as a challenge
 * and nothing about how it is displayed: the statement is markdown because that
 * is what Spar's problem pane renders, and the tags are already mapped onto
 * Spar's own concept vocabulary because a challenge that is not in the ledger's
 * language is invisible to every later turn.
 */
export const practiceProblemSchema = z.object({
  source: practiceSourceIdSchema,
  region: practiceRegionSchema,
  slug: z.string().min(1),
  /** The source's internal id, which is what a run or submit has to be posted
   *  with — distinct from the number the learner sees. */
  externalId: z.string().min(1),
  displayId: z.string(),
  title: z.string().min(1),
  url: z.string().url(),
  difficulty: practiceDifficultySchema,
  paidOnly: z.boolean().default(false),
  statement: z.string(),
  hints: z.array(z.string()).default([]),
  topicTags: z.array(z.object({ slug: z.string(), name: z.string() })).default([]),
  /** Spar concept slugs, primary first — the same shape `create_question` takes,
   *  so a sourced challenge is tagged exactly like a generated one. */
  concepts: z.array(z.object({ slug: z.string(), role: z.enum(["primary", "supporting"]) })).default([]),
  references: z.array(practiceReferenceSchema).default([]),
  languages: z.array(practiceLanguageSchema).default([]),
  signature: practiceSignatureSchema.nullable(),
  examples: z.array(practiceExampleSchema).default([]),
  /** The source's own sample inputs, verbatim, in the format its run endpoint
   *  expects them back in. Newline-separated arguments per case. */
  sampleTestcases: z.array(z.string()).default([]),
  acceptanceRate: z.number().nullable(),
  /** Whether the learner has already solved this one, when the source says. */
  status: z.enum(["solved", "attempted", "todo", "unknown"]).default("unknown"),
});
export type PracticeProblem = z.infer<typeof practiceProblemSchema>;

/** A search hit. Deliberately smaller than a problem: a list of forty of these
 *  is a normal thing to ask for, and forty statements is not. */
export const practiceProblemSummarySchema = z.object({
  source: practiceSourceIdSchema,
  slug: z.string().min(1),
  displayId: z.string(),
  title: z.string().min(1),
  difficulty: practiceDifficultySchema,
  paidOnly: z.boolean().default(false),
  acceptanceRate: z.number().nullable(),
  topicTags: z.array(z.string()).default([]),
  concepts: z.array(z.string()).default([]),
  status: z.enum(["solved", "attempted", "todo", "unknown"]).default("unknown"),
});
export type PracticeProblemSummary = z.infer<typeof practiceProblemSummarySchema>;

export const practiceSearchInputSchema = z.object({
  query: z.string().trim().max(200).default(""),
  /** Source tag slugs. Spar concept slugs are translated to these by the caller,
   *  so the agent can search in the vocabulary it tags challenges in. */
  tags: z.array(z.string()).max(8).default([]),
  difficulty: practiceDifficultySchema.optional(),
  /** Narrow to what the learner has or has not done. Only honoured while the
   *  source knows who is asking. */
  status: z.enum(["any", "todo", "attempted", "solved"]).default("any"),
  limit: z.number().int().min(1).max(50).default(10),
  offset: z.number().int().min(0).max(5_000).default(0),
});
export type PracticeSearchInput = z.infer<typeof practiceSearchInputSchema>;

/** Who the source thinks is asking, and what it says they have done. `solved` is
 *  the reading the ledger cares about; the rest is for Settings to be honest
 *  about which account is connected. */
export const practiceAccountSchema = z.object({
  source: practiceSourceIdSchema,
  region: practiceRegionSchema,
  username: z.string(),
  userId: z.string().default(""),
  premium: z.boolean().default(false),
  verified: z.boolean().default(true),
  avatarUrl: z.string().default(""),
  solved: z.object({
    total: z.number().int().nonnegative(),
    easy: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    hard: z.number().int().nonnegative(),
  }),
  available: z.object({
    total: z.number().int().nonnegative(),
    easy: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    hard: z.number().int().nonnegative(),
  }),
  /** Solve counts per source tag, which is the closest thing a source has to an
   *  opinion about what the learner is good at. Read as weak evidence beside
   *  Spar's own ledger, never instead of it. */
  skills: z.array(z.object({ slug: z.string(), name: z.string(), solved: z.number().int().nonnegative(), band: z.enum(["fundamental", "intermediate", "advanced"]) })).default([]),
  streak: z.number().int().nonnegative().default(0),
  capturedAt: z.string(),
});
export type PracticeAccount = z.infer<typeof practiceAccountSchema>;

/** One of the learner's own past submissions at a problem. The code is what
 *  makes this worth having: "you solved this six weeks ago, like this" is a far
 *  stronger prompt than "you solved this". */
export const practiceSubmissionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string().default(""),
  verdict: z.string(),
  accepted: z.boolean(),
  language: z.string(),
  runtime: z.string().default(""),
  memory: z.string().default(""),
  submittedAt: z.string(),
  code: z.string().default(""),
});
export type PracticeSubmission = z.infer<typeof practiceSubmissionSchema>;

/**
 * A judged run, normalised across every way a judge can answer.
 *
 * `outcome` is the only field the rest of Spar branches on, and it has exactly
 * three values on purpose: `passed` and `failed` are the graded ones, and
 * `errored` is the judge itself failing — a rate limit, an internal error, a
 * dead session. An `errored` run must never be recorded as evidence about the
 * learner, which is the whole reason it is not just `failed`.
 */
export const practiceVerdictSchema = z.object({
  outcome: z.enum(["passed", "failed", "errored"]),
  /** The judge's own words: "Accepted", "Wrong Answer", "Time Limit Exceeded". */
  status: z.string(),
  /** The judge's numeric status where it has one, kept so a later reader can
   *  tell a wrong answer from a compile error without parsing prose. */
  statusCode: z.number().int().nullable(),
  passedCases: z.number().int().nonnegative(),
  totalCases: z.number().int().nonnegative(),
  runtime: z.string().default(""),
  memory: z.string().default(""),
  runtimePercentile: z.number().nullable(),
  memoryPercentile: z.number().nullable(),
  compileError: z.string().default(""),
  runtimeError: z.string().default(""),
  /** The first case that failed, when the judge names it. This is the line the
   *  learner actually needs, and the one the replay quotes back later. */
  failedCase: z.object({ input: z.string(), expected: z.string(), actual: z.string(), stdout: z.string().default("") }).nullable(),
  /** Per-case answers for a non-submitting run, where the judge returns them. */
  caseAnswers: z.array(z.object({ input: z.string(), expected: z.string(), actual: z.string(), passed: z.boolean() })).default([]),
  stdout: z.array(z.string()).default([]),
  /** True when this was an official submission rather than a scratch run, which
   *  is what decides whether it counts on the source's own record. */
  submitted: z.boolean(),
  submissionId: z.string().default(""),
  submissionUrl: z.string().default(""),
  judgedAt: z.string(),
});
export type PracticeVerdict = z.infer<typeof practiceVerdictSchema>;

/** Every source's authenticated state, in the two words the UI needs. `expired`
 *  is separated from `disconnected` because they call for different sentences:
 *  one asks the learner to sign in, the other tells them their session lapsed. */
export type PracticeConnectionState = "connected" | "expired" | "disconnected";

export class PracticeAuthError extends Error {
  constructor(message: string) { super(message); this.name = "PracticeAuthError"; }
}

/** A source refusing to answer, as opposed to answering "no". Kept distinct so a
 *  rate limit never reads as a problem that does not exist. */
export class PracticeSourceError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = "PracticeSourceError"; }
}
