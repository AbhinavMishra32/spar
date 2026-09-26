import { describe, expect, it } from "vitest";
import { agentToolSchemas } from "./agentTools.js";
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
 */
describe("the tool contract, against what Mastra sent", () => {
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
     out reached the host as 4 under Mastra and would reach it as undefined
     under a validator alone. The wire contract is identical either way; this is
     about what the host is handed after it. */
  it("still fills in the defaults the schema only advertises", () => {
    const search = agentToolSchemas().search_learner_model;
    expect((search?.inputSchema as { properties: { limit: { default: number } } }).properties.limit.default).toBe(4);
    expect(search?.parse({ query: "arrays", actionTitle: "Checking arrays" })).toMatchObject({ query: "arrays", limit: 4 });
  });

  it("makes the author classify whether complexity is useful evidence", () => {
    const create = current.create_question?.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
    const replace = current.replace_current_question?.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
    expect(create.required).toContain("requiresComplexityAnalysis");
    expect(replace.required).toContain("requiresComplexityAnalysis");
    expect(create.properties).toHaveProperty("requiresComplexityAnalysis");
  });
});
