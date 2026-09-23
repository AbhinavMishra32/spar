import { describe, expect, it } from "vitest";
import { challengeDraft } from "./challengeDraft.js";

const design = {
  title: "Nearest occluder",
  language: "python",
  statement: "Return the nearest occluder along a scanline.",
  starterFiles: { "solution.py": "def nearest(xs):\n    pass\n" },
  visibleTests: { "test_visible.py": "assert nearest([]) == []\n" },
  referenceFiles: { "solution.py": "SECRET_REFERENCE_BODY\n" },
  hiddenTests: { "test_hidden.py": "SECRET_HIDDEN_CASE\n" },
  knownIncorrectFiles: [{ "solution.py": "SECRET_WRONG_BODY\n" }],
};

describe("challenge draft", () => {
  it("shows the learner's files and only names the answer", () => {
    const draft = challengeDraft("0-0", JSON.stringify(design));
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toContain("SECRET_REFERENCE_BODY");
    expect(serialized).not.toContain("SECRET_HIDDEN_CASE");
    expect(serialized).not.toContain("SECRET_WRONG_BODY");
    expect(draft.files.find((file) => file.group === "starter")?.content).toContain("def nearest");
    expect(draft.files.find((file) => file.group === "visible")?.content).toContain("assert nearest");
    expect(draft.files.find((file) => file.group === "hidden")).toMatchObject({ path: "test_hidden.py", lines: 1 });
    expect(draft.files.find((file) => file.group === "hidden")).not.toHaveProperty("content");
    expect(draft.files.filter((file) => file.group === "incorrect")).toHaveLength(1);
  });

  it("reads a design that is still being written", () => {
    const json = JSON.stringify(design);
    const draft = challengeDraft("0-0", json.slice(0, json.indexOf("pass")));
    expect(draft.title).toBe("Nearest occluder");
    expect(draft.files[0]).toMatchObject({ group: "starter", path: "solution.py" });
    expect(draft.files[0]?.content).toContain("def nearest");
  });
});
