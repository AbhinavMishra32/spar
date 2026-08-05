import { z } from "zod";

/**
 * The practice-source tools, declared once.
 *
 * One table, three consumers: the MCP server registers these, Spar's agent
 * worker builds its own tool objects from the same shapes, and the host routes a
 * call from either one through the MCP client. Declaring them twice is how a
 * schema drifts from the thing that validates it — and a tool the agent can call
 * with arguments the server rejects is a turn that fails for a reason no log
 * explains.
 *
 * `judging` marks the two tools that spend something on the learner's account at
 * the source. They are deliberately *not* offered to Spar's agent: the learner
 * solves the problem and the learner decides when to submit it, and an agent that
 * could submit would be putting its own code on their record. They exist for
 * external MCP clients, where the human driving the client is the one asking.
 */
export type PracticeToolName =
  | "search_practice_problems"
  | "read_practice_problem"
  | "read_practice_source"
  | "read_practice_progress"
  | "read_practice_submissions"
  | "read_daily_practice_problem"
  | "run_practice_code"
  | "submit_practice_solution";

export type PracticeToolDefinition = {
  name: PracticeToolName;
  description: string;
  shape: z.ZodRawShape;
  /** True when the tool changes something at the source. */
  judging?: boolean;
};

const slug = z.string().trim().min(1).max(120).describe("The problem's URL slug, e.g. \"two-sum\". Never its number or its title.");

export const PRACTICE_TOOLS: PracticeToolDefinition[] = [
  {
    name: "search_practice_problems",
    description:
      "Search the connected practice source for real problems. This is how you find something the world already asks that lands on the target you have chosen — prefer it over writing a challenge whenever a real problem fits, because a real problem carries a real judge, a real difficulty and the learner's own history with it. Search by Spar concept slug (translated to the source's tags for you) and narrow by difficulty. When the source knows who is asking, `status` filters by what this learner has already done: `todo` is the useful one when you want something new, and every result says whether they have solved it before.",
    shape: {
      concepts: z.array(z.string().min(2).max(60)).max(5).optional().describe("Spar concept slugs, e.g. [\"window-invariant-restoration\"]. Translated to the source's own tags, walking up to the area when the sub-concept has no tag of its own."),
      query: z.string().trim().max(200).optional().describe("Free text, for when the concept vocabulary does not reach what you mean."),
      difficulty: z.enum(["easy", "medium", "hard"]).optional(),
      status: z.enum(["any", "todo", "attempted", "solved"]).default("todo").describe("`todo` for something they have not tried, `attempted` to return to something they left unfinished, `solved` to look at how they did it before."),
      limit: z.number().int().min(1).max(25).default(8),
      offset: z.number().int().min(0).max(2_000).default(0),
    },
  },
  {
    name: "read_practice_problem",
    description:
      "Read one problem in full: its statement, its signature, the languages it publishes starters for, the cases Spar can run locally, the concepts it maps onto, and the problems the source says it is related to. Read this before assigning a problem — the statement is the only way to know whether it actually exercises the gap you are aiming at, and the reply says plainly who will grade it.",
    shape: {
      slug,
      includeStatement: z.boolean().default(true).describe("Set false when you only need the shape and the tags, which is most of a fit decision."),
    },
  },
  {
    name: "read_practice_source",
    description:
      "What the connected practice source can do right now, and who it thinks the learner is: the account, how many problems they have solved at each difficulty, and the source's own per-topic solve counts. Read the solve counts as weak prior evidence beside Spar's own ledger — they say what the learner has been exposed to, never how well they understood it. Call this before relying on anything else here, because every learner-specific answer is empty while the source is not connected.",
    shape: {},
  },
  {
    name: "read_practice_progress",
    description:
      "Problems this learner has already touched at the source, newest first. This is the one thing the source knows that Spar's own record cannot: what they attempted elsewhere and never finished. An unfinished attempt is a strong candidate for a target — it is a gap they have already met and walked away from.",
    shape: {
      status: z.enum(["attempted", "solved"]).default("attempted"),
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).max(2_000).default(0),
    },
  },
  {
    name: "read_practice_submissions",
    description:
      "This learner's own past submissions for one problem, and optionally the code of one of them. An accepted solution they wrote themselves is the strongest possible statement about what they can do, and a rejected one shows exactly where they stalled. Use it when their history with a specific problem is what you are reasoning about.",
    shape: {
      slug,
      limit: z.number().int().min(1).max(20).default(5),
      includeCode: z.boolean().default(false).describe("Fetches the source of the most recent submission. Costs an extra request, so ask for it only when the code itself is what you need."),
    },
  },
  {
    name: "read_daily_practice_problem",
    description: "The source's problem of the day, in full. Worth offering when the learner has no particular direction, and worth ignoring when they do — it is chosen for everybody, so it is unlikely to land on their gap.",
    shape: {},
  },
  {
    name: "run_practice_code",
    description:
      "Run code against the source's own interpreter without submitting it. Costs nothing on the learner's record. Returns the judge's per-case answers, including what it expected — which is the fastest way to see why something fails on a case that is hidden locally.",
    shape: {
      slug,
      language: z.enum(["javascript", "typescript", "cpp"]),
      code: z.string().min(1).max(200_000).describe("The whole solution, as the source expects to receive it."),
      testcases: z.string().max(20_000).optional().describe("Custom input in the source's own format: one argument per line, cases concatenated. Omit to run the problem's published samples."),
    },
    judging: true,
  },
  {
    name: "submit_practice_solution",
    description:
      "Submit a solution for official judging. This appears on the learner's account at the source and counts there. Returns the verdict, the failing case when there is one, and the runtime and memory percentiles when it is accepted.",
    shape: {
      slug,
      language: z.enum(["javascript", "typescript", "cpp"]),
      code: z.string().min(1).max(200_000),
    },
    judging: true,
  },
];

/** The tools that only read. This is the set Spar's own agent is given: it may
 *  learn anything the source knows and change nothing there. */
export const PRACTICE_READ_TOOLS = PRACTICE_TOOLS.filter((tool) => !tool.judging);

export function practiceTool(name: string): PracticeToolDefinition | undefined {
  return PRACTICE_TOOLS.find((tool) => tool.name === name);
}
