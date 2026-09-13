import { describe, expect, it } from "vitest";
import { growthFromComplexity } from "./ComplexityCheckpoint";

describe("complexity growth preview",()=>{
  it.each([
    ["O(1)","constant"],["O(log n)","logarithmic"],["O(n + m)","linear"],
    ["O(n log n)","linearithmic"],["O(n^2)","quadratic"],["O(2^n)","exponential"],["O(n!)","factorial"],
  ] as const)("classifies %s",(value,expected)=>expect(growthFromComplexity(value)).toBe(expected));
});
