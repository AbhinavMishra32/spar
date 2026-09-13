import { describe, expect, it } from "vitest";
import { fitEvidence, nextEvidenceBudget, stableJson } from "./evidence.js";
import { turnOverflowed } from "./piAgent.js";
import type { PiProviderInput } from "./piProvider.js";

/* Spar's context is not a conversation. Every phase rebuilds the transcript and
   restates what the earlier phases found, so the only thing that grows is this
   block — and the only thing that can be done about it is cutting the block. */
describe("the evidence block, when the prompt stops fitting", () => {
  const big = (chars: number) => ({ input: null, result: { note: "x".repeat(chars) } });

  it("leaves the evidence exactly alone while there is no budget", () => {
    const evidence = { read_ability: big(50_000) };
    expect(fitEvidence(evidence, Number.POSITIVE_INFINITY)).toBe(evidence);
  });

  it("cuts to fit, and says in the evidence itself that it cut", () => {
    const fitted = fitEvidence({ visualize_read_step: big(40_000) }, 2_000);
    expect(stableJson(fitted).length).toBeLessThanOrEqual(2_000);
    expect(JSON.stringify(fitted)).toContain("truncated to fit the context window");
  });

  /* The shape of a real overflow here is one enormous result beside a dozen
     small ones. A proportional cut would clip all twelve to save a fraction of
     the one, so the small findings are kept whole and the giant pays. */
  it("keeps the small findings whole and takes it out of the large one", () => {
    const evidence = { set_training_target: big(120), read_ability: big(180), visualize_read_step: big(60_000) };
    const fitted = fitEvidence(evidence, 4_000);
    expect(fitted.set_training_target).toEqual(evidence.set_training_target);
    expect(fitted.read_ability).toEqual(evidence.read_ability);
    expect(typeof fitted.visualize_read_step).toBe("string");
  });

  /* Which phases have run is how the controller plans the next one. An entry
     trimmed out of existence would re-plan work that is already done. */
  it("never cuts an entry down to nothing", () => {
    const evidence = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`tool_${index}`, big(9_000)]));
    const fitted = fitEvidence(evidence, 500);
    expect(Object.keys(fitted)).toHaveLength(12);
    for (const value of Object.values(fitted)) expect(String(value).length).toBeGreaterThan(100);
  });

  it("halves what was actually sent, not what was allowed", () => {
    expect(nextEvidenceBudget(80_000, Number.POSITIVE_INFINITY, 4)).toBe(40_000);
    expect(nextEvidenceBudget(80_000, 20_000, 4)).toBe(10_000);
  });

  /* Three halvings is a sixteenth of what first overflowed. Past that the
     prompt is not what is too long, and the turn should say so rather than
     spend another round trip finding out. */
  it("gives up rather than cutting past the floor", () => {
    expect(nextEvidenceBudget(900, 900, 2)).toBeNull();
  });
});

describe("the overflow itself, as each provider reports it", () => {
  const provider: PiProviderInput = { provider: "anthropic", model: "claude-sonnet-4-5", api: "anthropic-messages", baseUrl: "", apiKey: "k" };
  const message = (over: Partial<Record<string, unknown>>) => ({
    role: "assistant", content: [], timestamp: Date.now(), stopReason: "stop",
    usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11 }, ...over,
  }) as never;

  it("reads the error the provider actually returned", () => {
    expect(turnOverflowed(message({ stopReason: "error", errorMessage: "prompt is too long: 250000 tokens > 200000 maximum" }), provider)).toBe(true);
    expect(turnOverflowed(message({ stopReason: "error", errorMessage: "overloaded_error" }), provider)).toBe(false);
  });

  /* The case Spar could not have caught itself: the request is accepted, the
     answer comes back, and the only evidence is a token count past the window. */
  it("catches a provider that answered from a truncated prompt without saying so", () => {
    expect(turnOverflowed(message({ usage: { input: 9_000_000, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 9_000_005 } }), provider)).toBe(true);
  });

  it("says nothing about an ordinary turn", () => {
    expect(turnOverflowed(message({}), provider)).toBe(false);
    expect(turnOverflowed(null, provider)).toBe(false);
  });
});
