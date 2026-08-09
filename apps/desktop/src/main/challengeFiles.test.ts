import { describe, expect, it } from "vitest";
import type { QuestionDesign } from "@spar/domain";
import { challengeFileEntries, challengeFiles, codePreview } from "./challengeFiles.js";

function design(over: Partial<QuestionDesign> = {}): QuestionDesign {
  return {
    title: "Watermelon",
    language: "cpp",
    kind: "repository",
    difficulty: "foundation",
    statement: "",
    starterFiles: {},
    referenceFiles: {},
    visibleTests: {},
    hiddenTests: {},
    knownIncorrectFiles: [],
    runCommand: "./build/main",
    accidentalDifficulty: [],
    expectedFailureSignatures: [],
    ...over,
  };
}

/* The shape `PracticeService.mount` produces for a Codeforces C++ problem. Only
   the entry point goes into `starterFiles`; everything else the harness needs
   lands in `visibleTests`, because a design has nowhere else to put a file. That
   includes the vendored `bits/stdc++.h` shim, which is not under `tests/` — the
   case the old prefix rule got wrong. */
const cppMount = design({
  starterFiles: { "src/main.cpp": "int main() {}" },
  visibleTests: {
    "include/bits/stdc++.h": "#pragma once\n#include <algorithm>",
    "tests/examples.test.cpp": "// the published example",
  },
});

describe("challengeFileEntries", () => {
  it("treats a harness support file outside tests/ as read-only", () => {
    const shim = challengeFileEntries(cppMount).find((file) => file.path === "include/bits/stdc++.h");
    expect(shim?.readOnly).toBe(true);
    expect(shim?.role).toBe("test");
  });

  it("lands the learner in their own file, not in a vendored header", () => {
    // Alphabetically `include/…` sorts before `src/…`, so ordering by path alone
    // opened a Codeforces challenge on a copy of the standard library.
    expect(challengeFileEntries(cppMount)[0]?.path).toBe("src/main.cpp");
  });

  it("leaves exactly one editable file for a sourced C++ problem", () => {
    // Which is what keeps the workspace's file chooser consistent with every
    // other challenge: one solution file needs no tree and no popup.
    expect(challengeFileEntries(cppMount).filter((file) => !file.readOnly).map((file) => file.path)).toEqual(["src/main.cpp"]);
  });

  it("still keeps several starter files editable when a challenge really has them", () => {
    const generated = design({
      starterFiles: { "src/solution.ts": "", "src/helpers.ts": "" },
      visibleTests: { "tests/solution.test.ts": "" },
    });
    expect(challengeFileEntries(generated).filter((file) => !file.readOnly).map((file) => file.path).sort())
      .toEqual(["src/helpers.ts", "src/solution.ts"]);
  });

  it("puts every test after every solution", () => {
    const roles = challengeFileEntries(cppMount).map((file) => file.role);
    expect(roles.indexOf("test")).toBeGreaterThan(roles.lastIndexOf("solution"));
  });
});

describe("challengeFiles", () => {
  it("carries what is on disk, and empty string for a file that is not", () => {
    const files = challengeFiles(cppMount, { "src/main.cpp": "int main() { return 0; }" });
    expect(files.find((file) => file.path === "src/main.cpp")?.content).toBe("int main() { return 0; }");
    expect(files.find((file) => file.path === "include/bits/stdc++.h")?.content).toBe("");
  });

  it("agrees with the entries it is built from", () => {
    expect(challengeFiles(cppMount, {}).map((file) => file.path)).toEqual(challengeFileEntries(cppMount).map((file) => file.path));
  });
});

describe("codePreview", () => {
  it("shows only the learner-owned region from an old LeetCode scaffold", () => {
    const preview = codePreview(design({
      starterFiles: {
        "solution.h": "#pragma once\n/* host explanation */\n#include <vector>\n// spar:solution:start\nclass Solution {};\n// spar:solution:end\n",
      },
    }));
    expect(preview?.code).toBe("class Solution {};");
    expect(preview?.remainingLines).toBe(0);
  });

  it("removes Codeforces markers but keeps submitted program infrastructure", () => {
    const preview = codePreview(design({
      starterFiles: {
        "main.cpp": "// host explanation\n// spar:solution:start\n#include <bits/stdc++.h>\nusing namespace std;\nint main() { return 0; }\n// spar:solution:end\n",
      },
    }));
    expect(preview?.code).toBe("#include <bits/stdc++.h>\nusing namespace std;\nint main() { return 0; }");
    expect(preview?.code).not.toContain("spar:solution");
  });
});
