import { describe, expect, it } from "vitest";

import { parse, type Block } from "./markdownBlocks";

const kinds = (source: string) => parse(source).map((block) => block.kind);
const first = <K extends Block["kind"]>(source: string, kind: K) =>
  parse(source).find((block): block is Extract<Block, { kind: K }> => block.kind === kind);

describe("tables", () => {
  /* The agent reaches for a table constantly to lay out a procedure, and
     without a rule for them they arrived as a paragraph of pipes and dashes. */
  const table = ["| step | what it is |", "|---|---|", "| 1 | install torch |", "| 2 | create tensors |"].join("\n");

  it("reads a header and its rows", () => {
    expect(first(table, "table")).toEqual({
      kind: "table",
      header: ["step", "what it is"],
      rows: [
        ["1", "install torch"],
        ["2", "create tensors"],
      ],
    });
  });

  it("accepts a table written without outer pipes", () => {
    const bare = ["step | what", "--- | ---", "1 | go"].join("\n");
    expect(first(bare, "table")?.rows).toEqual([["1", "go"]]);
  });

  it("accepts alignment colons in the rule", () => {
    const aligned = ["| a | b |", "|:--|--:|", "| 1 | 2 |"].join("\n");
    expect(first(aligned, "table")?.header).toEqual(["a", "b"]);
  });

  it("pads a row that is short a column rather than dropping it", () => {
    /* A model that miscounts a column should cost an empty cell, not the whole
       table. */
    const ragged = ["| a | b |", "|---|---|", "| 1 |"].join("\n");
    expect(first(ragged, "table")?.rows).toEqual([["1", ""]]);
  });

  it("does not treat a line with a pipe in it as a table", () => {
    /* A single line of pipes is far more often prose — `a || b`, or a shell
       pipeline — than a table, which is why the rule is what identifies one. */
    expect(kinds("Use `cat x | grep y` for that.")).toEqual(["paragraph"]);
  });

  it("ends the table at the first line without a pipe", () => {
    const after = [table, "", "And then run it."].join("\n");
    expect(kinds(after)).toEqual(["table", "paragraph"]);
  });

  it("keeps a paragraph above the table separate", () => {
    expect(kinds(["Quick map:", "", table].join("\n"))).toEqual(["paragraph", "table"]);
  });
});

describe("the blocks that were already there", () => {
  it("still reads fences, headings, lists, quotes and rules", () => {
    const source = [
      "# Title",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "- one",
      "- two",
      "",
      "> quoted",
      "",
      "---",
      "",
      "Just prose.",
    ].join("\n");
    expect(kinds(source)).toEqual(["heading", "code", "list", "quote", "rule", "paragraph"]);
  });

  it("keeps a fenced block's body verbatim, pipes and all", () => {
    /* The table rule must not reach inside a fence: a shell pipeline in a code
       block is not a table. */
    const source = ["```bash", "cat x | grep y", "--- | ---", "```"].join("\n");
    expect(first(source, "code")?.body).toBe("cat x | grep y\n--- | ---");
  });
});
