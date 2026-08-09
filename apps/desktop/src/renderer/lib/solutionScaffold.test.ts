import { describe, expect, it } from "vitest";
import { splitSolutionScaffold, withSolutionBody } from "../../shared/solutionScaffold";

const CPP = `#pragma once
#include <vector>
using namespace std;

// spar:solution:start
class Solution {
public:
  int answer() { return 42; }
};
// spar:solution:end
`;

describe("solution scaffold projection", () => {
  it("shows only the provider body in the clean editor", () => {
    const scaffold = splitSolutionScaffold(CPP);
    expect(scaffold?.body).toBe("class Solution {\npublic:\n  int answer() { return 42; }\n};");
    expect(scaffold?.body).not.toContain("#pragma once");
    expect(scaffold?.body).not.toContain("spar:solution");
  });

  it("recomposes edits into the untouched durable envelope", () => {
    const scaffold = splitSolutionScaffold(CPP)!;
    const updated = withSolutionBody(scaffold, "class Solution {};");
    expect(updated).toContain("#include <vector>");
    expect(updated).toContain("// spar:solution:start\nclass Solution {};\n// spar:solution:end");
  });

  it("refuses a projection when either marker is missing", () => {
    expect(splitSolutionScaffold("class Solution {};" )).toBeNull();
    expect(splitSolutionScaffold("// spar:solution:start\nclass Solution {};" )).toBeNull();
  });
});
