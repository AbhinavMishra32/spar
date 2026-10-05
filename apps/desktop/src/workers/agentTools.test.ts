import { describe, expect, it } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { agentToolSchemas, internalToolDefinitions, setChallengeInputSchema } from "./agentTools.js";
import contract from "./agentTools.contract.json" with { type: "json" };

/**
 * The contract the model is handed, pinned.
 *
 * The migration off Mastra had one hard constraint: the agent keeps behaving
 * exactly as it did, which starts with the tools being the same tools. Mastra
 * compiled Spar's zod schemas to draft-07 JSON Schema and sent that; this file
 * is what it sent, captured from a live Mastra request while it was still the
 * runtime, and every tool now goes to the provider through a different path.
 *
 * So this started as the older implementation's output rather than a snapshot of
 * this code's own, and it stays the reference. A failure here means the model is
 * being told something different from what it was told before — which is either
 * accidental drift, and the bug this file exists to catch, or a deliberate
 * change to a tool, in which case that tool's entry is regenerated in the same
 * commit as the schema and the diff is the review.
 *
 * Deliberate changes so far: `read_ability` and `search_learner_model` now
 * return the learner's patterns and behavioural evidence beside the documents,
 * `propose_ability_update` requires at least one interpreted evidence entry.
 * Challenge tools state the difficulty prices while leaving the teaching choice
 * with the agent, and the four
 * tools that read an attempt became one — `inspect_current_attempt` and the old
 * `read_attempt` were the same host handler under two names, `evaluate_attempt`
 * was that handler with the files left off, and `replay_attempt` was the same
 * attempt with its log folded, so a turn asked how the learner was doing spent a
 * round trip on each of them in turn. `read_attempt` now returns all of it at
 * once and the other three are gone from the table. `read_submissions` is new:
 * a submission became a thing with an id the reply can cite, so there is a call
 * that lists them and returns the code and cases of one. `read_attempt` gained
 * a turning-points section and can read every segment across resets, and
 * `record_insight` is new: after a pass the agent files what made it click as a
 * spaced-review card, and it takes `targets` — what later reviews ask about — and `remember`, the learner's own words when they chose what to remember. The two authoring tools no longer require `runCommand`,
 * `accidentalDifficulty` or `expectedFailureSignatures`: leaving one out
 * bounced the whole call and cost a full re-send of the design. They also say
 * that a known-incorrect implementation must be genuinely wrong and must pass
 * every visible case, which the visible-tests text used to contradict.
 *
 * The v0.7 coach rewrite replaced the phase table with one fixed tool set:
 * fourteen retrieval tools became `search_record` and `read_record`, the two
 * ability writes became `update_ability`, `update_notebook` is new, and the
 * coach sets challenges with a brief to `set_challenge` while the builder's
 * `create_question` / `replace_current_question` became host-only. The whole
 * file was regenerated from agentToolSchemas() in that change. `edit_challenge`
 * is new: exact-passage edits to the open challenge in place, so a figure or a
 * clarified sentence no longer goes through the builder; `set_challenge`'s
 * revise mode now points at it. `update_notebook` takes `notebook`, so the
 * coach can also write the learner notebook every Track reads; `set_challenge`'s
 * aim asks for an existing ability's exact title, and `update_ability`'s
 * evidence says contradictory counts as much as supporting. The learner
 * notebook is now called user.md, and `notebook` takes "user" for it, with
 * "learner" kept for threads that still use the old name. Review sessions
 * added `file_review` — the coach's own judgement of a review card — a
 * `review` kind for `read_record`, and a `review` link on `set_challenge` and
 * `assign_practice_problem` that ties a challenge to the card it reviews;
 * that link's `purpose` says whether it is the review or practice going
 * deeper on the weak spot a review found, and its `forLearner` is the note
 * shown above the problem. `reopen_challenge` sets a past challenge again. `set_challenge_mix` is new, and `set_challenge`, `review_solution` and `teach_lesson` gained a lens field each:
 * the learner's choice of when to use real problems and which side quests to
 * weave in, changed by the coach only when they ask in chat.
 *
 * The coach-v11 pass moved rules out of the tool descriptions and into the
 * coach's judgement: `set_challenge` lost `skipLens` (a lens is no longer
 * required), its brief asks for the problem rather than the method, and
 * `solutionRequirements` caps at 160 characters to match the stored design;
 * `assign_practice_problem` no longer refuses out-of-window problems; and
 * `ask_user_question`, `review_solution`, `set_challenge_mix`, `update_ability`
 * and `update_notebook` dropped rules the prompt already says once.
 */
describe("the tool contract, against the pinned reference", () => {
  const frozen = contract as Record<string, { description: string; inputSchema: unknown }>;
  const current = agentToolSchemas();

  it("offers the same tools", () => {
    expect(Object.keys(current).sort()).toEqual(Object.keys(frozen).sort());
  });

  it.each(Object.keys(contract as object).sort())("sends %s unchanged", (name) => {
    expect(current[name]?.description).toBe(frozen[name]?.description);
    expect(current[name]?.inputSchema).toEqual(frozen[name]?.inputSchema);
  });

  /* The one thing the JSON Schema cannot carry. zod applies `.default()` when it
     parses, and a JSON Schema validator does not — so a `limit` the model left
     out reached the host as 6 under zod and would reach it as undefined under a
     validator alone. The wire contract is identical either way; this is about
     what the host is handed after it. */
  it("still fills in the defaults the schema only advertises", () => {
    const search = current.search_record;
    expect((search?.inputSchema as { properties: { limit: { default: number } } }).properties.limit.default).toBe(6);
    expect(search?.parse({ query: "arrays", actionTitle: "Checking arrays" })).toMatchObject({ query: "arrays", limit: 6 });
  });

  it("offers every tool an optional action title", () => {
    for (const [name, tool] of Object.entries(current)) {
      const schema = tool.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
      expect(schema.properties, name).toHaveProperty("actionTitle");
      expect(schema.required ?? [], name).not.toContain("actionTitle");
    }
  });

  it("does not offer the host-only publishing tools to the coach", () => {
    for (const name of Object.keys(internalToolDefinitions)) expect(current).not.toHaveProperty(name);
  });
});

describe("set_challenge", () => {
  const current = agentToolSchemas();
  const brief = {
    mode: "new",
    aim: { ability: "Sliding window", gap: "Whether they shrink only on violation", evidence: "A pass shows the invariant is held" },
    stretch: "Variable-size window instead of fixed-size",
    brief: "Given an array of non-negative ints and a target, return the length of the shortest contiguous subarray whose sum is at least target, or 0.",
    language: "python",
    kind: "function",
    difficulty: "developing",
    concepts: [{ slug: "window-invariant-restoration", role: "primary" }],
    requiresComplexityAnalysis: true,
    why: "They passed the fixed window cleanly last time.",
    actionTitle: "Setting a variable window challenge",
  };

  it("hands the coach the teaching decision, not the test harness", () => {
    const schema = current.set_challenge?.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
    expect(schema.required).toEqual(expect.arrayContaining(["mode", "aim", "brief", "language", "kind", "difficulty", "concepts"]));
    for (const optional of ["stretch", "requiresComplexityAnalysis", "why", "solutionRequirements", "skills", "reason", "actionTitle"]) expect(schema.required).not.toContain(optional);
    for (const harness of ["starterFiles", "referenceFiles", "visibleTests", "hiddenTests", "knownIncorrectFiles"]) expect(schema.properties).not.toHaveProperty(harness);
  });

  it("parses a brief and fills concept roles", () => {
    expect(setChallengeInputSchema.parse(brief).concepts[0]).toMatchObject({ slug: "window-invariant-restoration", role: "primary" });
    expect(current.set_challenge?.parse(brief)).toMatchObject({ mode: "new", actionTitle: "Setting a variable window challenge" });
    expect(setChallengeInputSchema.parse({ ...brief, concepts: [{ slug: "window-invariant-restoration" }] }).concepts[0]?.role).toBe("supporting");
  });

  it("rejects an unknown mode and a brief with no concepts", () => {
    expect(() => setChallengeInputSchema.parse({ ...brief, mode: "append" })).toThrow();
    expect(() => setChallengeInputSchema.parse({ ...brief, concepts: [] })).toThrow();
  });
});

describe("the host-only publishing schemas", () => {
  it("make the builder classify whether complexity is useful evidence", () => {
    for (const schema of Object.values(internalToolDefinitions)) {
      const json = zodToJsonSchema(schema) as { required?: string[] };
      expect(json.required).toContain("requiresComplexityAnalysis");
    }
    expect((zodToJsonSchema(internalToolDefinitions.replace_current_question) as { required?: string[] }).required).toContain("reason");
  });
});
