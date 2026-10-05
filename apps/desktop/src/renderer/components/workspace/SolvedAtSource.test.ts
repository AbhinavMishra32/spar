import { describe, expect, it } from "vitest";
import { proseMath } from "./SolvedAtSource";

describe("maths in LeetCode write-ups", () => {
  it("draws display and inline maths as characters", () => {
    expect(proseMath("Time complexity: $$O(n * \\log_2 {n})$$")).toBe("Time complexity: O(n * log₂ n)");
    expect(proseMath("Space complexity: $$O(n)$$")).toBe("Space complexity: O(n)");
    expect(proseMath("each step is $O(1)$, so $O(n^2)$ overall")).toBe("each step is O(1), so O(n²) overall");
  });

  it("joins a display block written across lines", () => {
    expect(proseMath("$$\nO(n \\log n)\n$$")).toBe("O(n log n)");
  });

  it("keeps a subscript out of reach of the emphasis rule", () => {
    expect(proseMath("$x_i + y_j$")).not.toContain("_");
  });

  it("leaves prices and code spans alone", () => {
    expect(proseMath("costs $5 and $10")).toBe("costs $5 and $10");
    expect(proseMath("run `echo $HOME $PATH` first")).toBe("run `echo $HOME $PATH` first");
  });
});
