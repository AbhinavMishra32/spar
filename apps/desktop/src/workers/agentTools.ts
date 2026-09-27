import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { askUserQuestionInputSchema, languageSchema, lessonInputSchema } from "@spar/domain";
import { PRACTICE_READ_TOOLS } from "@spar/practice/mcp";
import { ACTION_TITLE_KEY } from "./toolPayload.js";

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
const questionInputSchema=z.object({ concepts:z.array(conceptTagInputSchema).min(1).max(5).describe("What this challenge is about, most specific first. Exactly one entry has role primary: the concept the challenge is aimed at."),title:z.string().min(3).describe("A concise, professional problem title naming the operation or result; never an agent action, lesson, file, or bug category."),language:languageSchema,kind:z.enum(["function","module","repair","extension","repository"]),difficulty:z.enum(["foundation","developing","proficient","advanced"]).describe("How hard to write it, as an absolute price rather than a feeling: foundation is rated 900, developing 1200, proficient 1500, advanced 1800, on the same scale as the learner's own rating. Chosen by the coach from the learner's rating and the step it wants."),requiresComplexityAnalysis:z.boolean().describe("Choose true only when asymptotic time and auxiliary-space reasoning is part of what this challenge trains: algorithms, data structures, or scaling-sensitive implementation. Choose false for syntax, API use, debugging, UI, refactoring, repository mechanics, and semantic behavior where Big-O adds no useful evidence."),statement:z.string().min(30).describe("The complete learner-facing problem page, in this order and nothing else: one paragraph saying what to implement; one line per rule it must satisfy; then `Examples`, and under it each example as `Input:` / `Output:` / `Explanation:` lines, the explanation being why that answer is the answer; then `Constraints`. Do not write a heading over the description or number the examples yourself — the app draws that hierarchy and your own headings and numbering appear on top of it. No agent commentary, selection rationale, validation notes, or hidden-test details."),starterFiles:z.record(z.string()),referenceFiles:z.record(z.string()),visibleTests:z.record(z.string()).describe("The contract the learner reads. At least four cases, each named and written by hand: the ordinary one and each boundary. Every known-incorrect implementation must pass all of them, so the case that exposes the plausible wrong idea belongs in hiddenTests, not here. No generated sweep here."),hiddenTests:z.record(z.string()).describe("The grader. It must run at least twenty-four cases, which means a generated sweep and not a longer list typed out: loop over inputs from a seeded pseudo-random generator, compute each expected answer with a brute-force oracle written inside the test file itself, and emit one verdict line per case whose name contains the actual input. Keep your targeted cases for the known misconceptions alongside it. On failure every case must print its input, expected and actual — the learner cannot see this file, so a failure that does not say what it ran leaves them guessing."),knownIncorrectFiles:z.array(z.record(z.string())).min(1).describe("Plausible wrong implementations at the reference's own path. Each must be genuinely wrong: it returns a different answer from the reference on at least one input the statement allows, which a hidden case contains, and it passes every visible case. A change that cannot alter any allowed answer is not a misconception, for example a shrinking `while` turned into `if` in a sliding window over non-negative values. The host executes each one beside the reference and replaces one that never disagrees."),runCommand:z.string().min(1).optional(),accidentalDifficulty:z.array(z.string()).max(3).default([]),expectedFailureSignatures:z.array(z.string()).default([]).describe("Observable ways the known-incorrect implementations fail."),solutionRequirements:z.array(z.string().min(4).max(400)).max(4).optional().describe("How the solution must be written, when the point of the challenge depends on it: \"linear time, one pass\", \"recursive\", \"no built-in sort\". Shown to the learner with the problem, and checked by review_solution after the tests pass — a solution that passes but ignores these is sent back. State a requirement only when a different approach would defeat the exercise; a challenge with nothing to insist on omits this entirely.") });
const authoredQuestionInputSchema = questionInputSchema.extend({
  why: z.string().min(10).max(1_500).describe("Why this particular question is useful for this learner now: the evidence or request behind it and what the attempt should reveal. A deliberate repeat, transfer, or topic switch is fine when justified. Stored with the published question for later turns."),
  runCommand: z.string().min(1).optional().describe("A descriptive command for the challenge. The host uses its fixed language runner for validation and learner tests; this value cannot select pytest or change execution. Python test files execute directly with python3 and must call any defined test functions themselves."),
  hiddenTests: z.record(z.string()).describe("The unseen grading contract. For a function, execute at least twenty-four cases, preferably a seeded sweep checked against a simple oracle. For a module, execute at least twelve cases. For a repair, extension, or repository task, execute at least eight meaningful scenarios covering the defect, boundaries, and interactions. Emit one verdict per case and show input, expected, and actual on failure. Choose the tests that prove this task, rather than padding case counts."),
  trainingTarget: z.object({
    ability: z.string().min(2),
    specificGap: z.string().min(8),
    desiredEvidence: z.string().min(8),
    avoidTesting: z.array(z.string()),
  }).optional().describe("Only when this candidate changes what the learner is practicing: persist a corrected evidence target with the question. Use this when the previous target is stale or contradicted by a passed challenge. Omit it to retain the current target."),
});
/**
 * What turns an ability document into an Ability the learner has. The markdown is
 * the agent's working notes; these three are the claim it supports — one sentence
 * they can read, the concepts it reaches history through, and the drills for going
 * deeper. Shared by both ability tools so the two cannot support different halves
 * of the same object.
 */
const abilityClaimShape = {
  summary: z.string().min(10).max(800).optional().describe("One sentence in plain words: what the learner can now do. Written to them, not about them."),
  concepts: z.array(conceptTagInputSchema).max(6).optional().describe("The concepts this ability covers, which is how the learner reaches the challenges behind it."),
  practice: z.array(z.string().min(10).max(600)).max(4).optional().describe("Drills for going further on this exact ability, each phrased as the learner's own goal because each one starts a session. Vary the transfer context, not just the difficulty."),
  status: z.enum(["uncertain","developing","independent","stale"]).optional().describe("Omit to let the evidence count decide. Set it only to say something the count cannot, such as marking a long-untouched ability stale."),
  evidence: z.array(z.object({ eventId:z.string().uuid(),statement:z.string().min(8).max(300),polarity:z.enum(["supporting","contradictory","neutral"]),independence:z.enum(["independent","assisted","unknown"]),strength:z.number().min(0).max(1) })).max(8).optional().describe("Nuanced interpretations of exact durable events. Describe the behavior observed, not a score. Contradictory is as much evidence as supporting: a long struggle or an idea they had to be walked to counts against the ability, and a pass after heavy hints is assisted."),
  pattern: z.object({title:z.string().min(3).max(200),description:z.string().min(10).max(400),status:z.enum(["observation","hypothesis","pattern","monitoring","resolved"]),evidenceEventIds:z.array(z.string().uuid()).max(12)}).optional().describe("A mistake lifecycle update. The host will refuse to promote a pattern unless evidence links span at least two attempts."),
} as const;

/**
 * What the coach hands the builder.
 *
 * The coach owns the teaching decision — what this challenge is for, what is new
 * in it, how hard, how it is filed — and the builder owns the craft of writing a
 * statement, starter, reference and tests that agree. Splitting them is what let
 * the coach stop spending its own context on forty kilobytes of test harness,
 * and what gives every challenge in a Track one consistent code shape: the
 * builder is shown the Track's recent starters, the coach is not asked to
 * remember them.
 */
export const setChallengeInputSchema = z.object({
  mode: z.enum(["new", "revise", "replace"]).describe("new: no challenge is open. revise: rebuild the open challenge around the same task when its contract or code shape changes (typed starters, another language); for a few passages, edit_challenge is faster and keeps the learner's code. replace: swap the open challenge for a different problem, because the learner asked or it is clearly wrong for them."),
  aim: z.object({
    ability: z.string().min(2).max(200).describe("The ability this trains, in a few words. Use the exact title of an ability in the journey when this trains it; a new title starts a new ability."),
    gap: z.string().min(8).max(1_500).describe("The specific thing still uncertain about this learner that this challenge probes."),
    evidence: z.string().min(8).max(1_500).describe("What a pass or a fail will tell you."),
  }).describe("What this challenge should reveal. It becomes the session's training target, replacing the previous one."),
  stretch: z.string().min(10).max(1_500).describe("What is new relative to the learner's last challenge — the one step up. For revise, say what changes."),
  brief: z.string().min(40).max(4_000).describe("The task for the builder: the contract (inputs, outputs, rules), the idea it exercises, anything the learner asked for, and the code-shape convention to keep (for example: LeetCode-style TreeNode with a typed class Solution method, as in their previous challenges). Plain prose; no code needed."),
  language: languageSchema,
  kind: z.enum(["function", "module", "repair", "extension", "repository"]),
  difficulty: z.enum(["foundation", "developing", "proficient", "advanced"]).describe("An absolute price on the learner's rating scale: foundation 900, developing 1200, proficient 1500, advanced 1800."),
  concepts: z.array(conceptTagInputSchema).min(1).max(5).describe("What this challenge is about, most specific first. Exactly one entry has role primary."),
  requiresComplexityAnalysis: z.boolean().describe("True only when asymptotic time and space reasoning is part of what this trains."),
  solutionRequirements: z.array(z.string().min(4).max(400)).max(4).optional().describe("How the solution must be written when a different approach would defeat the exercise (\"recursive\", \"one pass\"). Shown to the learner and checked by review_solution. Omit when there is nothing to insist on."),
  skills: z.array(z.string().min(1).max(48)).max(3).optional().describe("Skills from the skills list the builder should follow for this challenge, for example one about figures in statements."),
  why: z.string().min(10).max(1_500).describe("Why this challenge for this learner now. Stored with the challenge for later turns."),
  reason: z.string().min(3).max(1_500).optional().describe("For revise or replace: what the learner asked for, or why the open challenge has to change."),
});
export type SetChallengeInput = z.infer<typeof setChallengeInputSchema>;

const RECORD_KINDS = ["abilities", "patterns", "attempts", "challenges", "concepts", "lessons"] as const;

/**
 * The tools the coach is offered, the same set on every turn of a session.
 *
 * Fourteen retrieval tools became two — `search_record` and `read_record` — and
 * two ability writes became one. The table stays fixed for the whole turn: a
 * tool that does not apply right now answers with why, rather than vanishing,
 * because a tool list that changes between model requests throws away the
 * provider's prompt cache and teaches the model nothing.
 */
export const toolDefinitions = {
  search_record: ["Search this learner's record on this Track: abilities (standing claims), patterns (your open hypotheses about how they go wrong, with observations), attempts (by failure signature), challenges (with outcomes and replacement lineage), concepts (the tag vocabulary with their evidence under each, split by sub-concept), and lessons you have taught. Use it to find what the journey document does not already show.", z.object({
    query: z.string().min(2).describe("Words or a concept slug."),
    kinds: z.array(z.enum(RECORD_KINDS)).min(1).max(6).optional().describe("Which parts of the record to search. Omit for all."),
    limit: z.number().int().min(1).max(12).default(6),
  })],
  read_record: ["Read one record in full: a challenge (design, validation, attempts and test history), an ability (versioned document with its patterns and recent evidence), a lesson (its pages), or a concept (this learner's evidence under it, by sub-concept, with the challenges behind it).", z.object({
    kind: z.enum(["challenge", "ability", "lesson", "concept"]),
    id: z.string().min(2).describe("The challenge, ability or lesson id, or the concept slug."),
  })],
  read_attempt: [
    "Read an attempt's current code, deterministic runner verdict, and recorded solve history. The runner is the authority on correctness. Returns the complete report and source files, plus a sequence-to-event-ID index for ability evidence. Payloads are represented once in the report instead of duplicated as raw events. Start with one call and work from that evidence. Use sections, eventTypes, cases or scope when you want a focused view.",
    z.object({
      attemptId: z.string().uuid().optional()
        .describe("Omit for the attempt the learner has open right now, which is almost always the one you mean. Name one only to read a different attempt out of their history."),
      sections: z.array(z.enum(["log", "cases", "runs", "code", "timings", "turning-points"])).min(1).max(6).optional()
        .describe("log: every event, in order, with its payload and per-case lines, including what the learner asked the agent and what it replied while the attempt was open. cases: each case's verdict in every run, with pass and failure counts. runs: each run's score and which cases newly passed or newly failed against the last run that saw them. code: the diff of what the learner changed before each run, against the code the previous run executed, beside that run's newly passing and failing cases — read this before asking what change made something pass, because it usually already says. turning-points: the runs where the score moved most — the breakthrough that first passed everything after failing, and large jumps — each with the diff just before it and anything asked or said in between, which is the evidence for what made it click and whether the idea was theirs. timings: totals, the gap before the first run, the longest gap between events, and each edit stretch. Defaults to log, cases, runs, code and turning-points."),
      segments: z.enum(["latest", "all"]).optional()
        .describe("`latest` (the default) reads from the most recent reset or reopen onward. `all` includes the segments before it — for a learner who reset and started over, the approach they abandoned is often the contrast that explains the one that worked."),
      eventTypes: z.array(z.string().min(3).max(40)).max(12).optional()
        .describe("Keep only these event types in the log, e.g. [\"test_run\"] for nothing but the runs, or [\"file_changed\",\"test_run\"] for the edit-and-run rhythm. Omit for every type. Recorded types: attempt_started, file_changed, command_executed, test_run, submission_created, submission_evaluated, attempt_completed, hint_requested, learner_remark, agent_message."),
      cases: z.enum(["all", "failed-ever", "still-failing", "fixed"]).optional()
        .describe("Narrow the case history. `still-failing` is what is wrong now; `fixed` is what they repaired themselves, which is evidence of learning inside one attempt."),
      scope: z.enum(["all", "since-last-submission"]).optional()
        .describe("`since-last-submission` keeps only what happened after the last graded run, which is often the whole question on a follow-up turn."),
      caseDetail: z.enum(["brief", "full"]).optional().describe("`brief` drops the expected/actual pair from each failing case line in the log. Default full."),
      maxLines: z.number().int().min(20).max(2_000).optional().describe("Cap on log lines, newest kept, and it says how many it dropped. Omit to return all log lines. Only applies when explicitly requested."),
    }),
  ],
  read_submissions: [
    "Read what the learner actually submitted at a challenge, in order. Without `submissionId` it returns every submission's verdict and case counts — this is the tool for \"what have they tried\", for seeing whether they converged or thrashed, and for finding which submission a question is about. With `submissionId` it returns that one in full: the exact code that was sent and every case it was graded on, including the inputs and expected/actual values of the ones that failed. Cite any submission you refer to as [[submission:<id>|a few words]] so the learner can open it — never quote its id in your prose.",
    z.object({
      challengeId: z.string().uuid().optional()
        .describe("The challenge whose submissions to list. Omit for the one the learner has open right now."),
      submissionId: z.string().uuid().optional()
        .describe("One submission, in full, with its code and cases. Take the id from a previous listing."),
      outcome: z.enum(["all", "passed", "failed"]).optional()
        .describe("Narrow the listing. `failed` is the record of what they tried and why it was wrong, which is usually the interesting half."),
      limit: z.number().int().min(1).max(40).default(20).describe("How many submissions to return. The list reads oldest first and a longer history is cut from the front, so the cap keeps the most recent and the ordinals stay absolute."),
    }),
  ],
  review_solution: ["Judge HOW the passing solution was written, after the runner has already settled that it works. Send it back only for a requirement the challenge actually stated, or for a solution that defeats the point of the exercise — hardcoding the test inputs, calling a library that does the whole thing being taught, or a complexity class the challenge ruled out. A different-but-legitimate approach is not grounds for rework.", z.object({
    attemptId: z.string().uuid(),
    verdict: z.enum(["accepted", "rework"]).describe("`rework` reopens the challenge for the learner and ends your turn here — no ability update and no next challenge. Use it only when you can name the stated requirement it misses."),
    observedComplexity: z.string().min(2).max(500).describe("The time complexity of what they actually wrote, e.g. \"O(n)\" or \"O(n log n) from the sort\"."),
    approach: z.string().min(10).max(1_500).describe("What they actually did, in one sentence, in their own terms."),
    reasons: z.array(z.string().min(8).max(1_000)).max(6).describe("For `rework`, the requirement missed and what to change — no solution, still only the nudge. For `accepted`, what made it a good use of the idea. Written to the learner."),
  })],
  update_ability: ["Introduce an ability as uncertain when you start training it, or append an evidence-backed version to one. Give it the summary, concepts and practice drills that make it something the learner can see and train once the evidence supports it. Never grant from one pass or from a challenge they walked away from.", z.object({
    abilityId: z.string().uuid().optional().describe("The ability to update. Omit to introduce one by title (an existing ability with the same title is updated)."),
    title: z.string().min(2).max(200).optional().describe("Required when introducing an ability."),
    markdown: z.string().min(20).describe("The ability document: what the learner can and cannot yet do, with the evidence."),
    evidenceEventIds: z.array(z.string().uuid()).default([]),
    ...abilityClaimShape,
  })],
  update_notebook: ["Change one of your notebooks, your primary memory of this learner: the one for this Track, or the learner notebook every Track reads. Usually with edits: exact replacements of the passages that changed, so everything else stays as it was. Send the whole markdown instead to start the notebook or to reorganise it. The learner can read and edit both; keep each under about 1,200 words and delete what is no longer true.", z.object({
    notebook: z.enum(["track", "learner"]).default("track").describe("track: their progress on this Track. learner: the person across every Track — who they are, how they like to be taught, what helps them, habits seen wherever they work."),
    edits: z.array(z.object({
      find: z.string().min(1).max(4_000).describe("Text copied exactly from the current notebook, long enough to occur only once."),
      replace: z.string().max(6_000).describe("What it becomes. Empty to delete it."),
    })).min(1).max(20).optional().describe("Replacements applied in order to the current notebook."),
    markdown: z.string().min(1).max(12_000).optional().describe("The whole notebook, replacing the current one. Only to start it or reorganise it; otherwise use edits."),
    note: z.string().min(3).max(300).describe("One line saying what changed, shown to the learner."),
  })],
  edit_challenge: ["Change the open Spar-written challenge in place: reword a sentence that confused them, add or fix a figure, add an example, fix a typo, add a visible test case, adjust a type in the starter. Each edit replaces one exact passage — copied from the current text, occurring once — in one part of the challenge. Nothing is rebuilt and the learner keeps their place and their code: a statement or title edit is checked for its figures, and an edit to the starter, reference or tests reruns the full validation before it lands. The journey shows the open challenge's statement and starter; read_record the challenge for its reference and tests. Use set_challenge revise instead when the task, its contract or its code shape changes.", z.object({
    edits: z.array(z.object({
      part: z.enum(["statement", "title", "starter", "reference", "visibleTests"]).describe("Which part of the challenge the passage is in."),
      path: z.string().min(1).max(200).optional().describe("The file, for starter, reference and test edits. May be omitted when that part has one file."),
      find: z.string().min(1).max(4_000).describe("The exact text to replace, copied from the current version; it must occur exactly once. To add something, find the passage it goes next to and repeat that passage in replace with the addition."),
      replace: z.string().max(8_000).describe("What the passage becomes."),
    })).min(1).max(20),
    note: z.string().min(3).max(300).describe("What changed and why, in one sentence. Stored with the challenge."),
  })],
  set_challenge: ["Set the learner's next challenge from a brief. A builder writes the statement, starter, reference, tests and plausible wrong solutions; the host compiles and validates them and repairs recoverable failures before anything is published. Returns the published challenge, or the failed checks when it could not be validated — then adjust the brief (often simpler) and call again.", setChallengeInputSchema],
  record_insight: [
    "File the core idea that solved this challenge as an insight card for spaced review. Write it from the replay — especially read_attempt's turning-points — not from the problem statement: what made it click for THIS learner, the cue they should have spotted, the invariant that makes it correct, and the mistakes they actually made on the way. Spar schedules the card with FSRS and later writes fresh review prompts from it (a new problem needing the same idea, a what-if, their own earlier bug to spot), so every field must be about the transferable pattern, never about this problem's specific inputs or code. Call it once per solved challenge; a challenge solved again refines its existing card.",
    z.object({
      attemptId: z.string().uuid().optional().describe("The solved attempt. Omit for the one this turn is about."),
      title: z.string().min(4).max(160).describe("The pattern as a short handle the learner can recognise later, in plain words: \"Shrink the window only when the invariant breaks\", not \"Sliding window\" and not the problem's title."),
      trigger: z.string().min(10).max(1_200).describe("What in a problem statement should make someone reach for this: the shape of the input, the question asked, the constraint. Written so it would still apply to a problem with a different story."),
      insight: z.string().min(20).max(2_000).describe("The key realisation itself, in two to four sentences, as the learner would need to say it to themselves. Why it works, not just what to do."),
      invariant: z.string().min(8).max(800).optional().describe("The condition the solution maintains, when there is one — the loop invariant, the recurrence, what the data structure guarantees."),
      click: z.object({
        summary: z.string().min(8).max(1_500).describe("What changed between stuck and solved, from the turning points: the realisation behind the change, in their terms. If they passed first try, say what they recognised immediately."),
        runOrdinal: z.number().int().min(1).optional().describe("The run the breakthrough landed on, as read_attempt numbers them."),
        diff: z.string().max(4_000).optional().describe("The few changed lines that carried it, quoted from the turning-point diff. Omit when the change was a rewrite."),
      }),
      independence: z.enum(["independent", "assisted", "unknown"]).describe("Whether the breakthrough was theirs. `assisted` when the log shows the agent explaining the idea, or a lesson on it, shortly before the change that made it pass."),
      pitfalls: z.array(z.object({ mistake: z.string().min(4).max(600), fix: z.string().min(4).max(600) })).max(4).describe("Mistakes the replay shows they actually made, each with the correction, phrased so they generalise. Empty when there were none; never invent them."),
      rubric: z.array(z.string().min(4).max(500)).min(2).max(5).describe("What a correct recall of this idea must contain, point by point. The grader checks review answers against exactly this list, so each point must be checkable from a free-text answer."),
      transfer: z.array(z.string().min(8).max(600)).min(1).max(4).describe("Variations where the same idea applies or must bend: changed constraints, a different story with the same structure, the case where it breaks. Seeds for future review prompts."),
      concepts: z.array(z.string().min(2).max(60)).max(4).optional().describe("Concept slugs the idea belongs to, the pattern itself first. Omit to use the challenge's own tags. Cards sharing the first concept share review credit."),
      targets: z.array(z.enum(["problem", "pattern", "concept", "turning-point", "pitfall"])).min(1).max(5).optional().describe("What later reviews should make them recall — each review rehearses one: `problem` — this exact challenge again, worth it for a classic they will meet in interviews; `pattern` — spotting and applying the technique in a new story; `concept` — the invariant or property that makes it correct; `turning-point` — the realisation that got them unstuck, the default when there was a real struggle; `pitfall` — the mistake they kept making, when it cost them several runs. Pick the ones this solve earned, usually two or three. If the learner said what they want to remember, follow that. The learner can change these on the card. Omit to use turning-point and pattern."),
      remember: z.string().min(3).max(1_500).optional().describe("What the learner said they want to remember from this problem, when you asked them — their words, lightly cleaned up, not your summary. Reviews aim at it, so the card's insight, click and targets must be about what they pointed at. Required for a new card when they have chosen to decide what their reviews ask about; omit otherwise."),
      firstGrade: z.enum(["again", "hard", "good", "easy"]).describe("How well the idea is held right now, as a first spaced-review grade, judged from the whole solve: `again` — solved only after being walked to it; `hard` — got there with real struggle, help, or several wrong turns; `good` — worked it out themselves with ordinary friction; `easy` — clean and fast from the first draft. This decides when the first review comes due (roughly 1, 1, 2 and 8 days)."),
    }),
  ],
  ask_user_question: ["Suspend the session for one focused learner answer. Offer 2-3 mutually exclusive choices. Each option is one self-contained line the learner can scan — no subtitle, no second sentence — so write the whole choice into the label. Always allow a custom answer.", askUserQuestionInputSchema],
  teach_lesson: [
    "Write the learner a lesson and put it in this conversation. Use it when the useful thing to hand them is an idea rather than a problem. Scale it to what is being taught: one or two pages for a single misconception, more only when the idea has that many parts. For a new mechanism start with a tiny input, show each state change and why, then name the invariant. Each page is one idea, markdown, may use fenced code and [[concept:slug|words]] or [[lesson:id|words]]. Every reference says why it is worth their time: url only for a page you actually fetched or know exists, reading for a book or chapter named from memory. Tag concepts in the same vocabulary as challenges. Point at it in your reply as [[lesson:<the id this returns>|its title]].",
    lessonInputSchema,
  ],
  load_skill: ["Load one of the skills listed under Skills in the journey document: returns that skill's full instructions. Load a skill before doing the work it describes, the first time in a turn you need it — its instructions are not in your context until you do. Loading the same skill twice in one turn returns the same text.", z.object({ name: z.string().min(1).max(48).describe("The skill's name exactly as listed under SKILLS.") })],
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
      title: z.string().min(3).max(160).describe("What this shows, in the learner's language. Not the tool's name for it."),
      steps: z.array(z.object({
        step: z.number().int().min(0),
        caption: z.string().min(3).max(400).describe("What to notice in this step, addressed to the learner. One sentence, no preamble."),
        focus: z.array(z.string()).max(6).optional().describe("Draw only these: local names like \"counts\", or heap ids like \"@n2\". Use it — a picture of the two things your sentence is about lands, and a picture of every object in scope does not. Omit only when the whole state genuinely is the point."),
        hold: z.number().min(0.6).max(6).optional().describe("Seconds to stay on this step while it plays. Give the step where the thing goes wrong longer than the ones setting it up. Defaults to the caption's reading time."),
      })).min(1).max(8),
      autoplay: z.boolean().optional().describe("Defaults to true for more than one step. Set false when the sequence is meant to be read rather than watched."),
      takeaway: z.string().max(1_000).optional().describe("Optional: the one sentence the whole sequence adds up to, shown under it."),
    }),
  ],
  web_search: ["Search the web for current, external information: what a company's interviews actually cover, what a library's current API is, what a topic's standard formulation is. Returns titles, URLs, and short extracts. Use it to ground a goal in reality when the learner's own record cannot answer the question, and prefer one focused query over several vague ones.", z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(10).default(5) })],
  web_fetch: ["Read one or more web pages in full, by URL. Use it after web_search has told you which page is worth reading. http and https only.", z.object({ urls: z.array(z.string().url()).min(1).max(5) })],
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
    "Set a real problem from any available provider as this session's challenge. Use the exact `source` and `slug` returned by search. Read it before assigning it. Its judge, difficulty, and the learner's earlier attempts can help you choose a direct exercise, prerequisite, transfer, or deliberate repeat. Use the learner's rating in the journey document to decide what level serves this step. The host checks availability and grading, mounts the problem, and records the concepts and reason you provide.",
    z.object({
      source: z.enum(["leetcode", "codeforces"]).describe("The provider identity returned by search. A slug is only unique inside its provider."),
      slug: z.string().min(1).max(120).describe("The problem's URL slug, exactly as the source gave it."),
      concepts: z.array(conceptTagInputSchema).min(1).max(5).describe("What this challenge is about, in Spar's vocabulary, most specific first. Exactly one entry has role primary and names what this problem actually exercises. A prerequisite or transfer problem can use a different concept from the current target; explain the connection in your reply."),
      why: z.string().min(20).max(1_500).describe("One or two sentences explaining why this problem is useful now, including its relationship to the current target if it is a prerequisite, transfer, or repeat. Stored with the challenge for later turns."),
      language: languageSchema.optional().describe("The language to write this challenge in. Omit only when the context's preferredLanguage is already right; name one whenever the learner has asked for a different language in this session, because that is what makes their request stick beyond this turn."),
      replaceReason: z.string().min(3).max(1_500).optional().describe("Required only when a challenge is already open and this problem is to take its place — say what the learner asked for. Their attempt is closed as replaced and this problem records it as its predecessor. Never set it to move someone off a challenge they did not ask to leave."),
    }),
  ],
} as const;


/**
 * The host's own names for publishing a built design. Not offered to the coach:
 * the worker calls them after the builder has written a design from a
 * set_challenge brief, and the schema is what that design is checked against.
 */
export const internalToolDefinitions = {
  create_question: authoredQuestionInputSchema,
  replace_current_question: authoredQuestionInputSchema.extend({ reason: z.string().min(3).max(1_500) }),
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
 * agentTools.test.ts holds Mastra's own output and checks every one of them.
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
