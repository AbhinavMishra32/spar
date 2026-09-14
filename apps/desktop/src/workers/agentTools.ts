import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { askUserQuestionInputSchema, languageSchema } from "@spar/domain";
import { PRACTICE_READ_TOOLS } from "@spar/practice/mcp";
import { ACTION_TITLE_KEY } from "./toolPayload.js";
import { syntheticChallengeAuthoringDoctrine } from "./challengeAuthoring.js";

/*
 * Every tool the Training Agent can call, and the exact arguments each one
 * takes.
 *
 * Lifted out of agent.ts unchanged so that something other than a running
 * utility process can read them: agent.ts throws on import outside Electron,
 * which meant the one part of the agent worth pinning in a test — the contract
 * the model is handed — was the one part no test could reach.
 */

/**
 * How a challenge is filed. The slug is the identity, so a concept already in the
 * vocabulary needs nothing else; `title`, `kind` and `parentSlug` are only read
 * when the slug is new, which is what lets the agent extend the taxonomy for a
 * learner working on something it never anticipated instead of forcing the
 * nearest wrong tag.
 *
 * Deliberately fine-grained: "arrays" is a shelf, and a shelf is not a finding.
 * The first tag is the aim; the rest are what the challenge also touches.
 */
const conceptTagInputSchema=z.object({
  slug:z.string().min(2).max(60).describe("kebab-case, as specific as the challenge really is: prefer window-invariant-restoration over sliding-window, or aliasing over references-and-mutation"),
  title:z.string().min(2).max(80).optional().describe("only needed for a concept Spar has not seen before"),
  kind:z.enum(["dsa","engineering","craft"]).optional(),
  parentSlug:z.string().min(2).max(60).optional().describe("the area a new sub-concept belongs under, e.g. sliding-window"),
  role:z.enum(["primary","supporting"]).default("supporting"),
});
const questionInputSchema=z.object({ concepts:z.array(conceptTagInputSchema).min(1).max(5).describe("What this challenge is about, most specific first. Exactly one entry has role primary: the concept the challenge is aimed at."),title:z.string().min(3).describe("A concise, professional problem title naming the operation or result; never an agent action, lesson, file, or bug category."),language:languageSchema,kind:z.enum(["function","module","repair","extension","repository"]),difficulty:z.enum(["foundation","developing","proficient","advanced"]),statement:z.string().min(30).describe("The complete learner-facing problem page, in this order and nothing else: one paragraph saying what to implement; one line per rule it must satisfy; then `Examples`, and under it each example as `Input:` / `Output:` / `Explanation:` lines, the explanation being why that answer is the answer; then `Constraints`. Do not write a heading over the description or number the examples yourself — the app draws that hierarchy and your own headings and numbering appear on top of it. No agent commentary, selection rationale, validation notes, or hidden-test details."),starterFiles:z.record(z.string()),referenceFiles:z.record(z.string()),visibleTests:z.record(z.string()).describe("The contract the learner reads. At least four cases, each named and written by hand: the ordinary one, each boundary, and the one that separates the right idea from the plausible wrong one. No generated sweep here."),hiddenTests:z.record(z.string()).describe("The grader. It must run at least twenty-four cases, which means a generated sweep and not a longer list typed out: loop over inputs from a seeded pseudo-random generator, compute each expected answer with a brute-force oracle written inside the test file itself, and emit one verdict line per case whose name contains the actual input. Keep your targeted cases for the known misconceptions alongside it. On failure every case must print its input, expected and actual — the learner cannot see this file, so a failure that does not say what it ran leaves them guessing."),knownIncorrectFiles:z.array(z.record(z.string())).min(1),runCommand:z.string().min(1),accidentalDifficulty:z.array(z.string()).max(3),expectedFailureSignatures:z.array(z.string()).min(1),solutionRequirements:z.array(z.string().min(4).max(160)).max(4).optional().describe("How the solution must be written, when the point of the challenge depends on it: \"linear time, one pass\", \"recursive\", \"no built-in sort\". Shown to the learner with the problem, and checked by review_solution after the tests pass — a solution that passes but ignores these is sent back. State a requirement only when a different approach would defeat the exercise; a challenge with nothing to insist on omits this entirely.") });
/**
 * What turns an ability document into an Ability the learner has. The markdown is
 * the agent's working notes; these three are the claim it supports — one sentence
 * they can read, the concepts it reaches history through, and the drills for going
 * deeper. Shared by both ability tools so the two cannot support different halves
 * of the same object.
 */
const abilityClaimShape = {
  summary: z.string().min(10).max(220).optional().describe("One sentence in plain words: what the learner can now do. Written to them, not about them."),
  concepts: z.array(conceptTagInputSchema).max(6).optional().describe("The concepts this ability covers, which is how the learner reaches the challenges behind it."),
  practice: z.array(z.string().min(10).max(180)).max(4).optional().describe("Drills for going further on this exact ability, each phrased as the learner's own goal because each one starts a session. Vary the transfer context, not just the difficulty."),
  status: z.enum(["uncertain","developing","independent","stale"]).optional().describe("Omit to let the evidence count decide. Set it only to say something the count cannot, such as marking a long-untouched ability stale."),
  evidence: z.array(z.object({ eventId:z.string().uuid(),statement:z.string().min(8).max(300),polarity:z.enum(["supporting","contradictory","neutral"]),independence:z.enum(["independent","assisted","unknown"]),strength:z.number().min(0).max(1) })).max(8).optional().describe("Nuanced interpretations of exact durable events. Describe the behavior observed, not a score."),
  pattern: z.object({title:z.string().min(3).max(100),description:z.string().min(10).max(400),status:z.enum(["observation","hypothesis","pattern","monitoring","resolved"]),evidenceEventIds:z.array(z.string().uuid()).max(12)}).optional().describe("A mistake lifecycle update. The host will refuse to promote a pattern unless evidence links span at least two attempts."),
} as const;

export const toolDefinitions = {
  search_learner_model: ["Search this learner's memory at three resolutions at once: the ability documents (`passages`, the standing claims), the mistake patterns open under them, and the individual behavioural observations recorded from past attempts. The last two are your own earlier readings of this person — find the hypothesis you wrote before, and one matching observation now promotes it to a pattern instead of being written down a second time.", z.object({ query: z.string(), limit: z.number().int().min(1).max(8).default(4) })],
  read_ability: ["Read one versioned ability document, with the mistake patterns filed under it and its most recent behavioural evidence. The markdown is the claim; the patterns are what is still open about it. Read both before proposing an update — an update written from the document alone can only restate it.", z.object({ abilityId: z.string().uuid() })],
  search_attempt_history: ["Search attempts by ability or failure signature.", z.object({ query: z.string(), limit: z.number().int().min(1).max(10).default(5) })],
  search_challenge_history: ["Search the learner's durable challenge library, including outcomes and replacement lineage.", z.object({ query:z.string(),limit:z.number().int().min(1).max(12).default(6) })],
  read_challenge: ["Read one stored challenge design, validation report, attempts, and test history.", z.object({ questionId:z.string().uuid() })],
  /* The one pair of tools that reads anything outside the learner's own record.
     Named for what they are for: grounding a goal in what the world actually
     asks — a company's real interview surface, a language's current idiom — not
     for looking up answers, which the host compiler decides anyway. */
  web_search: ["Search the web for current, external information: what a company's interviews actually cover, what a library's current API is, what a topic's standard formulation is. Returns titles, URLs, and short extracts. Use it to ground a goal in reality when the learner's own record cannot answer the question, and prefer one focused query over several vague ones.", z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(10).default(5) })],
  web_fetch: ["Read one or more web pages in full, by URL. Use it after web_search has told you which page is worth reading. http and https only.", z.object({ urls: z.array(z.string().url()).min(1).max(5) })],
  read_attempt: ["Read a focused attempt trace.", z.object({ attemptId: z.string().uuid() })],
  read_session: ["Read the current session summary and decisions.", z.object({ sessionId: z.string().uuid() })],
  read_concept_graph: ["Read the concept vocabulary near a topic, with this learner's evidence against each one. Use it to choose what to tag and what to test next.", z.object({ query: z.string().optional(), limit: z.number().int().min(1).max(24).default(14) })],
  search_concept_evidence: ["Read how this learner behaves under one concept, broken down by sub-concept, with the recent challenges and outcomes behind it. This is the tool for finding which specific sub-concept is failing inside an area that looks fine on average.", z.object({ concept: z.string().min(2).describe("a concept slug or a topic in words"), limit: z.number().int().min(1).max(6).default(3) })],
  ask_user_question: ["Suspend the session for one focused learner answer. Offer 2-3 mutually exclusive choices. Each option is one self-contained line the learner can scan — no subtitle, no second sentence — so write the whole choice into the label. Always allow a custom answer.", askUserQuestionInputSchema],
  set_session_objective: ["Persist a lightweight session objective.", z.object({ objective: z.string() })],
  set_training_target: ["Persist one primary evidence target.", z.object({ ability: z.string(), specificGap: z.string(), desiredEvidence: z.string(), avoidTesting: z.array(z.string()) })],
  create_question: ["Compile and validate a complete question from the active target. All paths are relative and the reference implementation must replace starter implementation files.", questionInputSchema],
  replace_current_question: ["Compile a validated replacement for the active challenge while preserving its attempt, tests, and replacement lineage in history.", questionInputSchema.extend({reason:z.string().min(3).max(500)})],
  inspect_current_attempt: ["Read the learner's code as it stands right now, with the attempt's events, diffs, test runs and submission evidence. This is the cheap first look: when the question is what they wrote or why a case fails, read this before reaching for the tracer — a trace is a whole program run and costs far more than a file that already says it.", z.object({ attemptId: z.string().uuid() })],
  replay_attempt: [
    "Read the attempt's own log: every recorded event in order — edits, runs, submissions, verdicts — with its offset from when the attempt opened, plus one line per test case inside every run with its expected/actual values. Nothing in it is summarised or interpreted; it is what was recorded. Two derived sections come with it because a log in order cannot show them: each case's verdict across every run (a transpose) and each run's newly-passing and newly-failing cases (a diff). Take the whole log when the attempt is small — that is the default — and use the parameters to narrow it when it is long or when you only need one metric. This is the sharpest instrument you have for aiming the next question: a 6/7 reached by fixing one case in ninety seconds and a 6/7 reached by breaking two others are different learners.",
    z.object({
      attemptId: z.string().uuid(),
      sections: z.array(z.enum(["log", "cases", "runs", "timings"])).min(1).max(4).optional()
        .describe("log: every event, in order, with its payload and per-case lines. cases: each case's verdict in every run, with pass and failure counts. runs: each run's score and which cases newly passed or newly failed against the last run that saw them. timings: totals, the gap before the first run, the longest gap between events, and each edit stretch. Defaults to log, cases and runs."),
      eventTypes: z.array(z.string().min(3).max(40)).max(12).optional()
        .describe("Keep only these event types in the log, e.g. [\"test_run\"] for nothing but the runs, or [\"file_changed\",\"test_run\"] for the edit-and-run rhythm. Omit for every type. Recorded types: attempt_started, file_changed, command_executed, test_run, submission_created, submission_evaluated, attempt_completed, hint_requested, learner_remark, agent_message."),
      cases: z.enum(["all", "failed-ever", "still-failing", "fixed"]).optional()
        .describe("Narrow the case history. `still-failing` is what is wrong now; `fixed` is what they repaired themselves, which is evidence of learning inside one attempt."),
      scope: z.enum(["all", "since-last-submission"]).optional()
        .describe("`since-last-submission` keeps only what happened after the last graded run, which is often the whole question on a follow-up turn."),
      caseDetail: z.enum(["brief", "full"]).optional().describe("`brief` drops the expected/actual pair from each failing case line in the log. Default full."),
      maxLines: z.number().int().min(20).max(2_000).optional().describe("Cap on log lines, newest kept, and it says how many it dropped. Default 400. Raise it rather than guessing at what a truncated log left out."),
    }),
  ],
  evaluate_attempt: ["Read the already-recorded deterministic runner outcome and evidence. Never judge correctness with the model.", z.object({ attemptId: z.string().uuid() })],
  /**
   * The one judgement about the solution that the tests cannot make.
   *
   * Correctness is settled by the runner before this is ever called — this is
   * not a second opinion on whether the code works. It answers the different
   * question of whether it was solved the way the challenge required, which is
   * the only thing standing between "passed" and "practised the thing they came
   * here to practise".
   */
  review_solution: ["Judge HOW the passing solution was written, after the runner has already settled that it works. Send it back only for a requirement the challenge actually stated, or for a solution that defeats the point of the exercise — hardcoding the test inputs, calling a library that does the whole thing being taught, or a complexity class the challenge ruled out. A different-but-legitimate approach is not grounds for rework.", z.object({
    attemptId: z.string().uuid(),
    verdict: z.enum(["accepted", "rework"]).describe("`rework` reopens the challenge for the learner and ends your turn here — no ability update and no next challenge. Use it only when you can name the stated requirement it misses."),
    observedComplexity: z.string().min(2).max(80).describe("The time complexity of what they actually wrote, e.g. \"O(n)\" or \"O(n log n) from the sort\"."),
    approach: z.string().min(10).max(300).describe("What they actually did, in one sentence, in their own terms."),
    reasons: z.array(z.string().min(8).max(220)).max(4).describe("For `rework`, the requirement missed and what to change — no solution, still only the nudge. For `accepted`, what made it a good use of the idea. Written to the learner."),
  })],
  /**
   * `evidence` is required here and optional on `upsert_ability`, and the
   * difference is the turn each one runs on.
   *
   * This is the attempt-complete write: there is a graded attempt behind it, so
   * there is always something specific to say about what the learner actually
   * did. Left optional, the host fell back to synthesising one row per linked
   * event with the outcome as its polarity and a generic sentence as its
   * statement — which is the whole finding flattened back to passed or failed,
   * on the one turn that had the replay in hand to say better.
   */
  propose_ability_update: ["Propose a versioned markdown ability change backed by evidence. Include summary, concepts and practice whenever the evidence now supports naming this as something the learner can do.", z.object({ abilityId: z.string().uuid(), markdown: z.string(), evidenceEventIds: z.array(z.string().uuid()), ...abilityClaimShape, evidence: abilityClaimShape.evidence.unwrap().min(1).describe("Nuanced interpretations of exact durable events, at least one. Describe the behavior observed, not a score: which step of the idea held and which did not, and whether it held again on the second occasion. \"Failed the window question\" is not an interpretation of anything.") })],
  upsert_ability: ["Introduce an uncertain ability, or grant one: append an evidence-backed version and give it the summary, concepts and practice drills that make it something the learner can see and train.", z.object({title:z.string().min(2).max(120),markdown:z.string().min(20),evidenceEventIds:z.array(z.string().uuid()).default([]), ...abilityClaimShape})],
  commit_session_decision: ["Commit exactly one next pedagogical action.", z.object({ action: z.enum(["diagnose", "teach", "practise", "transfer", "advance", "retain"]), reason: z.string() })],
  /**
   * The execution visualiser, behind one door.
   *
   * This tool's whole job is to cost almost nothing until it is wanted. Its
   * result is the briefing on using the visualiser well plus the four tools that
   * do the work — which is several hundred words the agent does not carry on a
   * turn that only sets a challenge. Call it the moment a turn turns out to be
   * about what the code is actually doing.
   */
  open_visualizer: ["Load the execution visualiser: Spar can run code under a real tracer and draw every variable, structure and pointer at any step, inline in this conversation. Call this whenever the learner is confused about what their code is actually doing at some point in the run — a value that is not what they expect, a loop that ends early, a pointer somewhere surprising, an off-by-one — or when a small idea would land better shown than described. Returns instructions and the visualiser's tools.", z.object({})],
  visualize_run: [
    "Trace one run. Either the learner's own file (from: \"attempt\") to explain why THEIR code does what it does, or a short snippet you write yourself (`code`) to illustrate an idea that is not in their file — a two-line snippet traced and drawn is a good answer to \"why does this give 4 and not 5\". Returns a compact digest of the run: which lines ran and how often, which way every branch went, what each variable started and ended as. Never trace a working solution to the challenge the learner is currently on.",
    z.object({
      from: z.enum(["attempt", "code"]).default("code").describe("attempt reads the learner's own implementation file in this session; code traces what you pass below."),
      code: z.string().max(4_000).optional().describe("The source to trace, when from is code. Keep it to the smallest program that shows the idea."),
      setup: z.string().min(1).max(400).describe("The single call to trace, e.g. `search([1,3,9], 9)`. Without this nothing runs."),
      maxSteps: z.number().int().min(1).max(6_000).optional().describe("Step budget. The default is ample; raise it only for a run you know is long."),
    }),
  ],
  visualize_find: [
    "Find the step that matters in a traced run. Every filter given must hold. Use this instead of guessing a step index or walking steps from zero — the interesting step in a 400-step run is never step 3.",
    z.object({
      runId: z.string().min(1).describe("From visualize_run."),
      variable: z.string().optional().describe("Steps where this local changed value, including where it first appeared."),
      line: z.number().int().optional().describe("Steps executing this source line."),
      branch: z.boolean().optional().describe("Steps whose branch test evaluated this way — false is how you find where a loop stopped."),
      event: z.enum(["call", "step", "return", "exception", "condition"]).optional().describe("Steps of this kind."),
      value: z.string().optional().describe("Steps where some local reads as this, matched as a substring of the formatted value."),
      limit: z.number().int().min(1).max(24).optional(),
    }),
  ],
  visualize_read_step: [
    "Read one instant of a traced run exactly: every local in scope, the objects those locals point at, the branch decision if there was one, and what changed since the step before. Read the steps that carry the explanation, not the run — visualize_find names them, and a digest plus two or three read steps is a finished answer.",
    z.object({ runId: z.string().min(1), step: z.number().int().min(0).describe("The step index, from visualize_find or the digest.") }),
  ],
  visualize_explain: [
    "Direct the animation the learner sees. Pick the two to five steps that carry the explanation; for each, write one plain sentence, name what to draw, and say how long to hold on it. It plays inline in your reply at the pace you set, and they can pause and step through it. Afterwards write the one thing it is evidence for — do not describe the frames again in prose.",
    z.object({
      runId: z.string().min(1),
      title: z.string().min(3).max(90).describe("What this shows, in the learner's language. Not the tool's name for it."),
      steps: z.array(z.object({
        step: z.number().int().min(0),
        caption: z.string().min(3).max(200).describe("What to notice in this step, addressed to the learner. One sentence, no preamble."),
        focus: z.array(z.string()).max(6).optional().describe("Draw only these: local names like \"counts\", or heap ids like \"@n2\". Use it — a picture of the two things your sentence is about lands, and a picture of every object in scope does not. Omit only when the whole state genuinely is the point."),
        hold: z.number().min(0.6).max(6).optional().describe("Seconds to stay on this step while it plays. Give the step where the thing goes wrong longer than the ones setting it up. Defaults to the caption's reading time."),
      })).min(1).max(8),
      autoplay: z.boolean().optional().describe("Defaults to true for more than one step. Set false when the sequence is meant to be read rather than watched."),
      takeaway: z.string().max(400).optional().describe("Optional: the one sentence the whole sequence adds up to, shown under it."),
    }),
  ],
  /**
   * Setting a real problem instead of writing one.
   *
   * The counterpart to `create_question`, and the reason the source exists. What
   * it takes is deliberately not the problem — the host reads that from the
   * source itself — but the *aim*: which concept this is being set for and what
   * the agent expects it to show. A slug alone would mount a problem with no
   * statement about why, and the ledger would gain a challenge nobody can explain.
   */
  assign_practice_problem: [
    "Set a real problem from any available provider as this session's challenge. Use the exact `source` and `slug` returned by search. Prefer this over create_question whenever a real problem genuinely lands on the target you chose: it carries the provider's judge, calibrated difficulty, and the learner's history when that provider is connected. Read it first, and check its rating against the context's learnerStanding.setProblemsRated — the host refuses a problem priced outside that range, and says what the range was. The host mounts it, tags it with the concepts you name, and returns the challenge; do not describe its contents in your reply because the learner is about to read it.",
    z.object({
      source: z.enum(["leetcode", "codeforces"]).describe("The provider identity returned by search. A slug is only unique inside its provider."),
      slug: z.string().min(1).max(120).describe("The problem's URL slug, exactly as the source gave it."),
      concepts: z.array(conceptTagInputSchema).min(1).max(5).describe("What this challenge is about, in Spar's vocabulary, most specific first. Exactly one entry has role primary and it must name the gap the target describes — not merely the topic the source files the problem under."),
      why: z.string().min(20).max(400).describe("One or two sentences: why this specific problem discriminates what is still uncertain about this learner. This is stored with the challenge and is what a later turn reads to know what you were testing."),
      language: languageSchema.optional().describe("The language to write this challenge in. Omit only when the context's preferredLanguage is already right; name one whenever the learner has asked for a different language in this session, because that is what makes their request stick beyond this turn."),
      replaceReason: z.string().min(3).max(500).optional().describe("Required only when a challenge is already open and this problem is to take its place — say what the learner asked for. Their attempt is closed as replaced and this problem records it as its predecessor. Never set it to move someone off a challenge they did not ask to leave."),
    }),
  ],
} as const;

/**
 * Tools that reach the practice source, declared from the MCP server's own
 * schemas rather than restated here.
 *
 * Restating them is how a tool the agent can call with arguments the server
 * rejects comes about — a turn that fails for a reason no log explains. The
 * descriptions come from the same place, so what the agent is told a tool does is
 * what the server documents it doing.
 */
export const sourceToolDefinitions = Object.fromEntries(
  PRACTICE_READ_TOOLS.map((tool) => [tool.name, [tool.description, z.object(tool.name === "search_practice_problems"
    ? tool.shape
    : { ...tool.shape, source: z.enum(["leetcode", "codeforces"]).describe("The provider identity returned by search. Keep it paired with the slug.") })] as const]),
) as Record<string, readonly [string, z.ZodTypeAny]>;

/**
 * The name of the row this call will draw in the transcript, written by the agent.
 *
 * Added to every tool uniformly rather than to each schema by hand, so no tool can
 * be added later with no way to say what it is doing. The host used to name these
 * rows from a fixed table — "Searched attempt history" for every search, whatever
 * was searched for — which is accurate and says nothing. The agent knows why it is
 * making the call; this is where it says so.
 *
 * It is a label and never an instruction: shown, stored, and otherwise ignored.
 */
export function withActionTitle(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (!(schema instanceof z.ZodObject)) return schema;
  return schema.extend({
    [ACTION_TITLE_KEY]: z.string().min(3).max(70).describe(
      "A short, specific title for this step, in the learner's language, shown as the row for this call in the transcript. Say what this particular call is for — \"Checking whether arrays have been tested\", \"Reading how you solved the window repair\" — not the tool's generic purpose. Sentence case, no trailing period, present participle while it runs.",
    ),
  });
}

/**
 * Every tool as the provider receives it: a name, a description, and the JSON
 * Schema for its arguments.
 *
 * Mastra used to do this compilation on the way out — zod in, draft-07 JSON
 * Schema on the wire — and it used `zod-to-json-schema` to do it. So does this,
 * at the version Mastra pinned, which is why the output is byte-identical to
 * what the agent sent before the migration rather than merely equivalent to it.
 * agentTools.test.ts holds Mastra's own output and checks all thirty-five.
 *
 * `parse` comes along because the schema cannot carry everything zod knows.
 * A JSON Schema validator checks a value; zod also *produces* one, filling in
 * `.default()`s the model left out. The provider sees the default advertised
 * either way; without this the host would stop receiving it.
 */
export function agentToolSchemas(): Record<string, { description: string; inputSchema: object; parse(value: unknown): unknown }> {
  return Object.fromEntries(Object.entries({ ...toolDefinitions, ...sourceToolDefinitions }).map(([name, [description, schema]]) => {
    const withTitle = withActionTitle(schema as z.ZodTypeAny);
    return [name, {
      description,
      inputSchema: zodToJsonSchema(withTitle) as object,
      parse: (value: unknown) => withTitle.parse(value),
    }];
  }));
}
