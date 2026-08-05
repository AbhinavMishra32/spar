import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Language } from "@spar/domain";
import type { PracticeGateway, PracticeProblemBundle } from "../gateway.js";
import { practiceSource } from "../sources.js";
import { PracticeAuthError, type PracticeCase } from "../types.js";
import { PRACTICE_TOOLS, type PracticeToolDefinition } from "./tools.js";

/**
 * The practice source, as an MCP server.
 *
 * MCP is the right shape for this even inside one process. The tools are a
 * bounded, described, schema-validated surface over somebody else's service —
 * which is exactly what the protocol is for — and expressing it this way means
 * the same registry serves Spar's own agent (over an in-memory transport) and any
 * other MCP client the learner points at it (over stdio) with no second
 * implementation to keep in step.
 *
 * Two conventions run through every handler:
 *
 * **A failure is a result, not an exception.** A disconnected source, an expired
 * cookie, a rate limit — each comes back as a payload the caller can read and
 * carry on from. An agent mid-turn has plenty of other ways to make progress, and
 * a thrown tool call ends the turn instead of informing it.
 *
 * **Nothing is silently summarised.** Where a reply is trimmed it says so and
 * says how, because a truncated statement that looks complete is how an agent
 * assigns a problem whose second half it never read.
 */
export function createPracticeMcpServer(deps: {
  gateway: PracticeGateway;
  /** Whether the two tools that spend something at the source are registered.
   *  Off for Spar's own agent — the learner submits their own work. */
  allowJudging?: boolean;
  /** Told about every call, so the host can show the learner what the agent did
   *  with their account. Failures included. */
  onCall?: (event: { tool: string; ok: boolean; detail: string }) => void;
}): McpServer {
  const { gateway, allowJudging = false, onCall } = deps;
  const sourceName = practiceSource(gateway.sourceId).name;
  const server = new McpServer(
    { name: "spar-practice", version: "0.1.1" },
    {
      instructions: `Real problems from ${sourceName}. Search for one that lands on the target you have chosen, read it before you use it, and remember that the learner's own record in Spar is the stronger evidence — this source knows what they were exposed to, not how well they understood it.`,
    },
  );

  const tools = PRACTICE_TOOLS.filter((tool) => allowJudging || !tool.judging);
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.shape },
      (async (args: Record<string, unknown>) => {
        const result = await run(tool, args ?? {}, gateway).catch((error: unknown) => failure(error, sourceName));
        onCall?.({ tool: tool.name, ok: !("error" in result), detail: describe(tool.name, result) });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }) as never,
    );
  }
  return server;
}

type Payload = Record<string, unknown>;

async function run(tool: PracticeToolDefinition, args: Record<string, unknown>, gateway: PracticeGateway): Promise<Payload> {
  const source = practiceSource(gateway.sourceId);
  switch (tool.name) {
    case "read_practice_source": {
      const state = await gateway.state();
      const capabilities = await gateway.capabilities();
      const account = state === "connected" ? await gateway.account().catch(() => null) : null;
      return {
        source: gateway.sourceId,
        name: source.name,
        region: gateway.region,
        state,
        capabilities,
        /* Said explicitly rather than left to be inferred from `capabilities`,
           because this is the fact that decides whether a challenge from here can
           carry a real verdict. */
        note: state === "connected"
          ? `${source.name} is connected as ${account?.username ?? "this learner"}. Submissions are judged by ${source.name} and count on their account there.`
          : state === "expired"
            ? `${source.name}'s session has expired, so nothing about this learner is readable and it cannot judge anything until they reconnect it in Settings. Its problem statements are still public and Spar can grade them locally against the cases each problem publishes.`
            : `${source.name} is not connected. Its problems are still readable and Spar can grade them locally against published cases, but there is no remote judge and nothing about this learner's history there.`,
        ...(account
          ? {
            account: {
              username: account.username,
              premium: account.premium,
              solved: account.solved,
              available: account.available,
              streak: account.streak,
              /* Only the tags they have actually solved something under, most
                 first. The full list is ninety rows of zero. */
              topSkills: account.skills.filter((skill) => skill.solved > 0).sort((left, right) => right.solved - left.solved).slice(0, 12),
            },
          }
          : {}),
      };
    }

    case "search_practice_problems": {
      const found = await gateway.search({
        query: String(args.query ?? ""),
        tags: [],
        ...(args.difficulty ? { difficulty: args.difficulty as "easy" | "medium" | "hard" } : {}),
        status: (args.status as "any" | "todo" | "attempted" | "solved") ?? "todo",
        limit: Number(args.limit ?? 8),
        offset: Number(args.offset ?? 0),
        concepts: Array.isArray(args.concepts) ? args.concepts.map(String) : [],
      });
      const capabilities = await gateway.capabilities();
      return {
        total: found.total,
        returned: found.problems.length,
        problems: found.problems.map((problem) => ({
          slug: problem.slug,
          id: problem.displayId,
          title: problem.title,
          difficulty: problem.difficulty,
          acceptanceRate: problem.acceptanceRate,
          concepts: problem.concepts,
          sourceTags: problem.topicTags,
          learnerStatus: problem.status,
          paidOnly: problem.paidOnly,
        })),
        ...(found.problems.some((problem) => problem.paidOnly)
          ? { warning: "Some results are subscription-only at the source. Reading or judging one of those will fail unless this account has that subscription." }
          : {}),
        note: capabilities.progress
          ? "`learnerStatus` is the source's own record: solved, attempted, or todo. Do not assign something already solved unless you mean to compare against how they solved it."
          : "`learnerStatus` is unknown for every result because the source is not connected, so this list cannot tell you what they have already done.",
      };
    }

    case "read_practice_problem": {
      const bundle = await gateway.problem(String(args.slug ?? ""));
      return problemPayload(bundle, { includeStatement: args.includeStatement !== false });
    }

    case "read_daily_practice_problem":
      return problemPayload(await gateway.daily(), { includeStatement: true });

    case "read_practice_progress": {
      const rows = await gateway.progress({
        status: args.status === "solved" ? "SOLVED" : "ATTEMPTED",
        limit: Number(args.limit ?? 20),
        offset: Number(args.offset ?? 0),
      });
      return {
        status: args.status === "solved" ? "solved" : "attempted",
        count: rows.length,
        problems: rows,
        note: args.status === "solved"
          ? "Solved at the source. Evidence of exposure, not of understanding — they may have read a solution."
          : "Attempted and not solved at the source. Each of these is a gap this learner has already met and walked away from, which makes it a strong candidate for a target.",
      };
    }

    case "read_practice_submissions": {
      const slugValue = String(args.slug ?? "");
      const submissions = await gateway.submissions(slugValue, Number(args.limit ?? 5));
      const wantsCode = args.includeCode === true && submissions.length > 0;
      const detail = wantsCode ? await gateway.submissionDetail(submissions[0]!.id).catch(() => null) : null;
      return {
        slug: slugValue,
        count: submissions.length,
        submissions: submissions.map((submission) => ({
          id: submission.id,
          verdict: submission.verdict,
          accepted: submission.accepted,
          language: submission.language,
          runtime: submission.runtime,
          memory: submission.memory,
          submittedAt: submission.submittedAt,
        })),
        ...(detail?.code ? { latestCode: { id: detail.id, language: detail.language, accepted: detail.accepted, code: detail.code } } : {}),
        ...(wantsCode && !detail?.code ? { note: "The source did not return the code for the most recent submission." } : {}),
      };
    }

    case "run_practice_code":
    case "submit_practice_solution": {
      const bundle = await gateway.problem(String(args.slug ?? ""));
      const language = args.language as Language;
      const code = String(args.code ?? "");
      const verdict = tool.name === "submit_practice_solution"
        ? await gateway.submit({ slug: bundle.problem.slug, externalId: bundle.problem.externalId, language, code })
        : await gateway.run({
          slug: bundle.problem.slug,
          externalId: bundle.problem.externalId,
          language,
          code,
          ...(typeof args.testcases === "string" && args.testcases.trim() ? { dataInput: args.testcases } : {}),
        });
      return { slug: bundle.problem.slug, verdict };
    }

    default:
      return { error: `Unsupported practice tool: ${tool.name}` };
  }
}

/** How much of a statement a single tool result carries. Long enough for every
 *  problem statement that exists in practice; a limit at all because a handful of
 *  contest problems ship an essay and would otherwise fill the turn's context. */
const STATEMENT_LIMIT = 8_000;

function problemPayload(bundle: PracticeProblemBundle, options: { includeStatement: boolean }): Payload {
  const { problem, cases, capabilities, judge } = bundle;
  const statement = problem.statement.length > STATEMENT_LIMIT
    ? `${problem.statement.slice(0, STATEMENT_LIMIT)}\n\n…statement truncated after ${STATEMENT_LIMIT} characters.`
    : problem.statement;
  return {
    slug: problem.slug,
    id: problem.displayId,
    title: problem.title,
    url: problem.url,
    difficulty: problem.difficulty,
    paidOnly: problem.paidOnly,
    learnerStatus: problem.status,
    concepts: problem.concepts,
    sourceTags: problem.topicTags.map((tag) => tag.slug),
    ...(options.includeStatement ? { statement } : {}),
    hints: problem.hints.length,
    signature: problem.signature,
    languages: problem.languages.map((entry) => entry.language),
    examples: problem.examples.length,
    /* Only the first few, and only their shape: the point is to show what a case
       looks like, and pasting every case into the turn buys nothing. */
    sampleCases: cases.slice(0, 3).map((entry) => ({ name: entry.name, input: entry.input, expected: entry.expected, origin: entry.origin })),
    localCaseCount: cases.length,
    references: problem.references.map((reference) => ({ slug: reference.slug, title: reference.title, difficulty: reference.difficulty, relation: reference.relation })),
    judge,
    grading: gradingNote(capabilities, cases),
  };
}

/**
 * What will actually decide whether a solution to this problem is correct.
 *
 * The most important sentence in the payload. A locally-graded problem and a
 * source-judged one produce evidence of different strengths, and an agent that
 * cannot tell them apart will describe a local pass as having been accepted.
 */
function gradingNote(capabilities: PracticeProblemBundle["capabilities"], cases: PracticeCase[]): string {
  if (capabilities.remoteJudge) {
    return cases.length
      ? `The source judges a submission against every hidden case it has. Spar can also run the ${cases.length} published case${cases.length === 1 ? "" : "s"} locally, which is a check and not a verdict.`
      : "The source judges a submission against every hidden case it has. Spar has no locally runnable case for this problem, so every run goes to the source.";
  }
  return cases.length
    ? `The source cannot judge this right now, so Spar grades it locally against the ${cases.length} case${cases.length === 1 ? "" : "s"} published with the problem. Passing those is weaker evidence than an acceptance at the source, and must not be described as one.`
    : "The source cannot judge this right now and Spar has no runnable case for it either, so this problem cannot be graded at all until the source is reconnected. Do not assign it.";
}

/** A failure, as a payload. `retryable` is the field a caller should branch on:
 *  an expired session needs the learner, a rate limit needs a moment. */
function failure(error: unknown, sourceName: string): Payload {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof PracticeAuthError) {
    return {
      error: "not-connected",
      retryable: false,
      message,
      note: `${sourceName} cannot answer anything about this learner until they reconnect it in Settings. Carry on without it: Spar's own record is the stronger evidence anyway, and you can still write a challenge yourself.`,
    };
  }
  return {
    error: "source-failed",
    retryable: true,
    message,
    note: `${sourceName} did not answer. Do not treat this as a fact about the learner or about the problem; either try once more or carry on without it.`,
  };
}

/** One line for the host's own log of what was done with the learner's account. */
function describe(name: string, result: Payload): string {
  if (typeof result.error === "string") return `${result.error}: ${String(result.message ?? "").slice(0, 120)}`;
  if (name === "search_practice_problems") return `${Number(result.returned ?? 0)} of ${Number(result.total ?? 0)} problems`;
  if (name === "read_practice_progress") return `${Number(result.count ?? 0)} problems`;
  if (typeof result.title === "string") return `${result.title} (${String(result.difficulty ?? "")})`;
  if (result.verdict && typeof result.verdict === "object") return String((result.verdict as { status?: unknown }).status ?? "judged");
  if (typeof result.state === "string") return String(result.state);
  return "ok";
}
