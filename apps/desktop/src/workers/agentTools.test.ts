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
 * So this is not a snapshot of the current code's own output — it is the older
 * implementation's output, kept as the reference. A diff here means the model
 * is being told something different from what it was told before the
 * migration, which is the one thing the migration promised not to do.
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
});
