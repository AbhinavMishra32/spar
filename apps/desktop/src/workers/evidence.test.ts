import { describe, expect, it } from "vitest";
import { stableJson } from "./evidence.js";

describe("stableJson", () => {
  it("renders equal values identically whatever the key order", () => {
    expect(stableJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(stableJson({ a: [{ c: 3, d: 2 }], b: 1 }));
    expect(stableJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
