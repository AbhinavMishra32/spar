import { describe, expect, it } from "vitest";

import { plainMath } from "./tex";

describe("plainMath", () => {
  it("unwraps the inline delimiters the model writes complexity in", () => {
    expect(plainMath("Let \\(n\\) denote the number of inputs; the cost is \\(O(1)\\)."))
      .toBe("Let n denote the number of inputs; the cost is O(1).");
  });

  it("unwraps a display block", () => {
    expect(plainMath("worst case \\[T(n) = 2T(n/2) + n\\]")).toBe("worst case T(n) = 2T(n/2) + n");
  });

  it("draws exponents as exponents", () => {
    expect(plainMath("\\(O(n^2)\\) and \\(O(n^{10})\\)")).toBe("O(n²) and O(n¹⁰)");
  });

  it("keeps a caret it cannot letter", () => {
    /* Losing the exponent is worse than showing the caret: the reader can read
       `n^k`, and `n` alone says something false. */
    expect(plainMath("\\(O(n^k)\\)")).toBe("O(n^k)");
  });

  it("spells the commands that have a character", () => {
    expect(plainMath("\\(n \\le 2 \\cdot m\\)")).toBe("n ≤ 2 · m");
    expect(plainMath("\\(\\Theta(n \\log n)\\)")).toBe("Θ(n log n)");
  });

  it("leaves an unknown command as its own name rather than dropping it", () => {
    expect(plainMath("\\(\\weird x\\)")).toBe("weird x");
  });

  it("returns prose with no maths in it unchanged", () => {
    const prose = "Both right. The function performs a fixed number of operations.";
    expect(plainMath(prose)).toBe(prose);
  });

  it("leaves a lone backslash alone", () => {
    expect(plainMath("the path C:\\Users is not maths")).toBe("the path C:\\Users is not maths");
  });
});
