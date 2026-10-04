import { describe, expect, it } from "vitest";
import { growthFromComplexity, splitBound } from "./ComplexityCheckpoint";

describe("complexity growth preview",()=>{
  it.each([
    ["O(1)","constant"],["O(log n)","logarithmic"],["O(n + m)","linear"],
    ["O(n log n)","linearithmic"],["O(n^2)","quadratic"],["O(2^n)","exponential"],["O(n!)","factorial"],
  ] as const)("classifies %s",(value,expected)=>expect(growthFromComplexity(value)).toBe(expected));
});

describe("reviewed bound",()=>{
  it("separates the bound from its variable gloss",()=>{
    expect(splitBound("O(n log n), where n = len(score)")).toEqual({bound:"O(n log n)",where:"n = len(score)"});
    expect(splitBound("O(n) auxiliary space, where n = len(score)")).toEqual({bound:"O(n)",where:"n = len(score)"});
    expect(splitBound("O(1)")).toEqual({bound:"O(1)",where:""});
  });
});
