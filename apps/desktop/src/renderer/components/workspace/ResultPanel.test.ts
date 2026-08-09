import { describe, expect, it } from "vitest";
import { ungradedReason } from "./ResultPanel";

describe("ungraded result explanation", () => {
  it("recognizes provider exception class names as pre-verdict failures", () => {
    expect(ungradedReason("PracticeSourceError: Codeforces refused the submit page.", true)).toBe(
      "The run never reached the cases — it failed before they could be checked. The output says why.",
    );
  });
});
