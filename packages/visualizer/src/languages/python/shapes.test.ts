import { describe, expect, it } from "vitest";
import { coerceValue, draftFromExample, emptyDraft, parseLiteral, type InputField } from "../../inputs.js";
import { composeSetup } from "./compose.js";
import { fieldFromAnnotation, pythonAnnotation, guessFromName, mergeSpecs, specFromAnalysis, specFromSignature, type PythonAnalysis } from "./shapes.js";

const NO_CLASSES: never[] = [];

describe("fieldFromAnnotation", () => {
  it("reads a parameterised list as a list of that element", () => {
    const field = fieldFromAnnotation("nums", "List[int]", NO_CLASSES);
    expect(field.type).toMatchObject({ kind: "list", of: { type: { kind: "int" } } });
    expect(field.optional).toBe(false);
  });

  it("reads a nested list as a grid", () => {
    const field = fieldFromAnnotation("grid", "List[List[str]]", NO_CLASSES);
    expect(field.type).toMatchObject({ kind: "list", of: { type: { kind: "list", of: { type: { kind: "string" } } } } });
  });

  it("treats Optional as nullability on the inner shape rather than a shape of its own", () => {
    const field = fieldFromAnnotation("head", "Optional[ListNode]", NO_CLASSES);
    expect(field.optional).toBe(true);
    expect(field.type.kind).toBe("linked");
  });

  it("reads the PEP 604 union the same way", () => {
    const field = fieldFromAnnotation("root", "TreeNode | None", NO_CLASSES);
    expect(field.optional).toBe(true);
    expect(field.type.kind).toBe("tree");
  });

  it("ignores the typing module prefix", () => {
    expect(fieldFromAnnotation("nums", "typing.List[int]", NO_CLASSES).type.kind).toBe("list");
  });

  it("turns a Literal into a choice", () => {
    const field = fieldFromAnnotation("mode", "Literal['asc', 'desc']", NO_CLASSES);
    expect(field.type).toEqual({ kind: "choice", options: ["asc", "desc"] });
  });

  it("falls back to a raw field for a type it cannot draw, keeping the annotation", () => {
    const field = fieldFromAnnotation("compare", "Callable[[int], int]", NO_CLASSES);
    expect(field.type.kind).toBe("raw");
    expect(field.declared).toBe("Callable[[int], int]");
  });

  it("draws a mapping as key/value pairs of the declared types", () => {
    const field = fieldFromAnnotation("lookup", "Dict[str, List[int]]", NO_CLASSES);
    expect(field.type).toMatchObject({ kind: "dict", flavour: "dict", key: { type: { kind: "string" } }, value: { type: { kind: "list" } } });
    expect(field.declared).toBe("Dict[str, List[int]]");
  });

  it("keeps a Counter a Counter, and knows its values are counts", () => {
    const field = fieldFromAnnotation("freq", "Counter[str]", NO_CLASSES);
    expect(field.type).toMatchObject({ kind: "dict", flavour: "Counter", key: { type: { kind: "string" } }, value: { type: { kind: "int" } } });
  });

  it("tells the standard containers apart rather than making everything a list", () => {
    expect(fieldFromAnnotation("xs", "Set[int]", NO_CLASSES).type).toMatchObject({ kind: "list", container: "set" });
    expect(fieldFromAnnotation("xs", "Deque[int]", NO_CLASSES).type).toMatchObject({ kind: "list", container: "deque" });
    expect(fieldFromAnnotation("xs", "FrozenSet[int]", NO_CLASSES).type).toMatchObject({ kind: "list", container: "frozenset" });
    expect(fieldFromAnnotation("xs", "List[int]", NO_CLASSES).type).toMatchObject({ kind: "list", container: "list" });
  });

  it("reads a fixed tuple as one control per position and a variadic one as a row", () => {
    expect(fieldFromAnnotation("pair", "Tuple[int, str]", NO_CLASSES).type).toMatchObject({
      kind: "tuple",
      fields: [{ type: { kind: "int" } }, { type: { kind: "string" } }],
    });
    expect(fieldFromAnnotation("xs", "Tuple[int, ...]", NO_CLASSES).type).toMatchObject({ kind: "list", container: "tuple" });
  });

  it("recognises a learner's own class by its fields rather than its name", () => {
    const classes = [{ name: "Node", fields: [{ name: "val", annotation: null, hasDefault: true }, { name: "next", annotation: null, hasDefault: true }], shape: "linked" as const, constructible: true }];
    expect(fieldFromAnnotation("head", "Node", classes).type).toMatchObject({ kind: "linked", typeName: "Node" });
  });

  it("enters a plain class field by field", () => {
    const classes = [{ name: "Point", fields: [{ name: "x", annotation: "int", hasDefault: false }, { name: "y", annotation: "int", hasDefault: false }], shape: "record" as const, constructible: true }];
    const field = fieldFromAnnotation("start", "Point", classes);
    expect(field.type).toMatchObject({ kind: "record", typeName: "Point", fields: [{ name: "x" }, { name: "y" }] });
  });
});

describe("guessFromName", () => {
  it("guesses the shapes that are the same in every problem that uses those names", () => {
    expect(guessFromName("nums").type.kind).toBe("list");
    expect(guessFromName("head").type.kind).toBe("linked");
    expect(guessFromName("root").type.kind).toBe("tree");
    expect(guessFromName("target").type.kind).toBe("int");
    expect(guessFromName("s").type.kind).toBe("string");
    expect(guessFromName("grid").type).toMatchObject({ kind: "list", of: { type: { kind: "list" } } });
  });

  it("numbers do not break a guess, so nums1 is still a list", () => {
    expect(guessFromName("nums1").type.kind).toBe("list");
    expect(guessFromName("l2").type.kind).toBe("linked");
  });

  it("marks every guess as a guess so the form can say so", () => {
    expect(guessFromName("nums").declared).toBeNull();
  });

  it("gives up rather than guessing a name it does not recognise", () => {
    expect(guessFromName("frobnicator").type.kind).toBe("raw");
  });
});

describe("specFromAnalysis", () => {
  const analysis: PythonAnalysis = {
    entryPoints: [
      { name: "twoSum", receiver: "Solution", params: [{ name: "nums", annotation: "List[int]", hasDefault: false }, { name: "target", annotation: "int", hasDefault: false }], returnType: "List[int]", unsupported: null },
      { name: "helper", receiver: null, params: [{ name: "mystery", annotation: null, hasDefault: false }], returnType: null, unsupported: null },
    ],
    classes: [],
    preferred: "Solution.twoSum",
    error: null,
  };

  it("identifies each entry point by its receiver and name", () => {
    const spec = specFromAnalysis(analysis);
    expect(spec.entryPoints.map((entry) => entry.id)).toEqual(["Solution.twoSum", "helper"]);
    expect(spec.preferred).toBe("Solution.twoSum");
    expect(spec.origin).toBe("source");
  });

  it("labels an entry point the way it would be called", () => {
    expect(specFromAnalysis(analysis).entryPoints[0]?.label).toBe("Solution().twoSum(nums, target)");
  });

  it("warns about the parameters it had to guess", () => {
    expect(specFromAnalysis(analysis).warnings.join(" ")).toContain("guessed");
  });

  it("reports a syntax error as a warning with no entry points, not as a throw", () => {
    const spec = specFromAnalysis({ entryPoints: [], classes: [], preferred: null, error: "Line 3: invalid syntax" });
    expect(spec.entryPoints).toEqual([]);
    expect(spec.warnings).toEqual(["Line 3: invalid syntax"]);
    expect(spec.origin).toBe("none");
  });
});

describe("specFromSignature", () => {
  /**
   * The bug this exists to prevent: LeetCode states a signature in its own
   * vocabulary, so `k: int` arrives as the word "integer". Read as Python that
   * is an unknown class, and every number on every problem became a box asking
   * the learner to type an expression — in the one place the whole feature is
   * supposed to be typing-free.
   */
  it("reads LeetCode's own type names rather than treating them as Python", () => {
    const spec = specFromSignature({
      name: "rotateRight",
      params: [{ name: "head", type: "ListNode" }, { name: "k", type: "integer" }],
      returnType: "ListNode",
      classBased: false,
    });
    const params = spec.entryPoints[0]!.params;
    expect(params.map((param) => param.type.kind)).toEqual(["linked", "int"]);
    // A nullable head, because every linked-list problem accepts an empty list.
    expect(params[0]!.optional).toBe(true);
    // And the learner is shown what the problem said, not our translation.
    expect(params.map((param) => param.declared)).toEqual(["ListNode", "integer"]);
  });

  it("reads LeetCode's two spellings of a sequence", () => {
    const spec = specFromSignature({
      name: "solve",
      params: [{ name: "nums", type: "list<integer>" }, { name: "board", type: "character[][]" }, { name: "words", type: "list<string>" }],
      returnType: "boolean",
      classBased: false,
    });
    const [nums, board, words] = spec.entryPoints[0]!.params;
    expect(nums!.type).toMatchObject({ kind: "list", of: { type: { kind: "int" } } });
    expect(board!.type).toMatchObject({ kind: "list", of: { type: { kind: "list", of: { type: { kind: "string" } } } } });
    expect(words!.type).toMatchObject({ kind: "list", of: { type: { kind: "string" } } });
  });

  it("leaves a real Python annotation alone", () => {
    expect(pythonAnnotation("Optional[ListNode]")).toBe("Optional[ListNode]");
    expect(pythonAnnotation("List[List[int]]")).toBe("List[List[int]]");
    expect(pythonAnnotation("Dict[str, int]")).toBe("Dict[str, int]");
  });

  it("builds the LeetCode shape: a Solution method with the declared types", () => {
    const spec = specFromSignature({ name: "twoSum", params: [{ name: "nums", type: "List[int]" }, { name: "target", type: "int" }], returnType: "List[int]", classBased: false });
    expect(spec.origin).toBe("signature");
    expect(spec.entryPoints[0]?.receiver).toBe("Solution");
    expect(spec.entryPoints[0]?.params.map((param) => param.type.kind)).toEqual(["list", "int"]);
    expect(spec.warnings).toEqual([]);
  });

  it("marks a design problem unsupported rather than hiding it", () => {
    const spec = specFromSignature({ name: "LRUCache", params: [], returnType: "", classBased: true });
    expect(spec.entryPoints[0]?.unsupported).toContain("design a class");
  });
});

describe("mergeSpecs", () => {
  const declared = specFromSignature({ name: "twoSum", params: [{ name: "nums", type: "List[int]" }, { name: "target", type: "int" }], returnType: "List[int]", classBased: false });

  it("keeps the declared types but takes the receiver from the learner's actual file", () => {
    const parsed = specFromAnalysis({
      entryPoints: [{ name: "twoSum", receiver: "Answer", params: [{ name: "nums", annotation: null, hasDefault: false }, { name: "target", annotation: null, hasDefault: false }], returnType: null, unsupported: null }],
      classes: [], preferred: "Answer.twoSum", error: null,
    });
    const merged = mergeSpecs(declared, parsed);
    expect(merged.entryPoints[0]?.receiver).toBe("Answer");
    expect(merged.entryPoints[0]?.params[0]?.declared).toBe("List[int]");
    expect(merged.preferred).toBe("Answer.twoSum");
  });

  it("keeps the learner's other functions behind the declared one", () => {
    const parsed = specFromAnalysis({
      entryPoints: [
        { name: "twoSum", receiver: "Solution", params: [], returnType: null, unsupported: null },
        { name: "debugHelper", receiver: null, params: [], returnType: null, unsupported: null },
      ],
      classes: [], preferred: "Solution.twoSum", error: null,
    });
    expect(mergeSpecs(declared, parsed).entryPoints.map((entry) => entry.name)).toEqual(["twoSum", "debugHelper"]);
  });

  it("says so when the learner's code no longer has the method the problem expects", () => {
    const parsed = specFromAnalysis({ entryPoints: [{ name: "somethingElse", receiver: null, params: [], returnType: null, unsupported: null }], classes: [], preferred: "somethingElse", error: null });
    expect(mergeSpecs(declared, parsed).warnings.join(" ")).toContain("could not find");
  });

  it("falls back to the parse when there is no declared signature", () => {
    const parsed = specFromAnalysis({ entryPoints: [], classes: [], preferred: null, error: null });
    expect(mergeSpecs(null, parsed)).toBe(parsed);
  });
});

describe("parseLiteral", () => {
  it("reads the forms a statement states arguments in", () => {
    expect(parseLiteral("[2,7,11,15]")).toEqual([2, 7, 11, 15]);
    expect(parseLiteral("nums = [2,7]")).toEqual([2, 7]);
    expect(parseLiteral('"abc"')).toBe("abc");
    expect(parseLiteral("9")).toBe(9);
  });

  it("repairs the language's own spellings", () => {
    expect(parseLiteral("[1,null,3]")).toEqual([1, null, 3]);
    expect(parseLiteral("[1,None,3]")).toEqual([1, null, 3]);
    expect(parseLiteral("True")).toBe(true);
    expect(parseLiteral("['a','b']")).toEqual(["a", "b"]);
  });

  it("returns nothing rather than guessing at something it cannot read", () => {
    expect(parseLiteral("")).toBeUndefined();
    expect(parseLiteral("<binary tree [1,2]>")).toBeUndefined();
  });
});

describe("coerceValue", () => {
  const listField: InputField = { name: "nums", type: { kind: "list", of: { name: "value", type: { kind: "int" }, optional: false, declared: null } }, optional: false, declared: "List[int]" };

  it("keeps a tree's holes, because an absent child is not a zero", () => {
    const treeField: InputField = { name: "root", type: { kind: "tree", typeName: "TreeNode", of: { name: "value", type: { kind: "int" }, optional: false, declared: null } }, optional: true, declared: "TreeNode" };
    expect(coerceValue(treeField, [3, 9, 20, null, null, 15, 7])).toEqual([3, 9, 20, null, null, 15, 7]);
  });

  it("wraps a scalar arriving at a list rather than dropping it", () => {
    expect(coerceValue(listField, 4)).toEqual([4]);
  });

  it("does not invent a value for a field it was given nothing for", () => {
    expect(coerceValue(listField, undefined)).toEqual([]);
  });
});

describe("draftFromExample", () => {
  const entry = specFromSignature({ name: "twoSum", params: [{ name: "nums", type: "List[int]" }, { name: "target", type: "int" }], returnType: "List[int]", classBased: false }).entryPoints[0]!;

  it("fills the form from a worked example, positionally", () => {
    expect(draftFromExample(entry, ["nums = [2,7,11,15]", "target = 9"]).values).toEqual({ nums: [2, 7, 11, 15], target: 9 });
  });

  it("fills in what it can when the example is short", () => {
    expect(draftFromExample(entry, ["[1,2]"]).values).toEqual({ nums: [1, 2], target: 0 });
  });
});

describe("composeSetup", () => {
  it("builds each standard container as itself, not as a list", () => {
    const entry = specFromSignature({
      name: "solve",
      params: [
        { name: "seen", type: "Set[int]" },
        { name: "window", type: "Deque[int]" },
        { name: "pair", type: "Tuple[int, str]" },
        { name: "freq", type: "Counter[str]" },
        { name: "groups", type: "DefaultDict[str, List[int]]" },
      ],
      returnType: "int",
      classBased: false,
    }).entryPoints[0]!;
    const setup = composeSetup(entry, {
      ...emptyDraft(entry),
      values: { seen: [1, 2], window: [3], pair: [4, "x"], freq: [["a", 2]], groups: [["k", [1, 2]]] },
    });
    expect(setup).toContain("{1, 2}");
    expect(setup).toContain("deque([3])");
    expect(setup).toContain("(4, \"x\")");
    expect(setup).toContain("Counter({\"a\": 2})");
    expect(setup).toContain("defaultdict(list, {\"k\": [1, 2]})");
  });

  it("spells the empty forms that are not just empty brackets", () => {
    const entry = specFromSignature({
      name: "solve",
      params: [{ name: "seen", type: "Set[int]" }, { name: "frozen", type: "FrozenSet[int]" }, { name: "one", type: "Tuple[int, ...]" }],
      returnType: "int",
      classBased: false,
    }).entryPoints[0]!;
    const setup = composeSetup(entry, { ...emptyDraft(entry), values: { seen: [], frozen: [], one: [7] } });
    // `{}` would be an empty dictionary, and `(7)` would be the number seven.
    expect(setup).toContain("set()");
    expect(setup).toContain("frozenset()");
    expect(setup).toContain("(7,)");
  });

  const entry = specFromSignature({ name: "twoSum", params: [{ name: "nums", type: "List[int]" }, { name: "target", type: "int" }], returnType: "List[int]", classBased: false }).entryPoints[0]!;

  it("writes the call a learner would have written", () => {
    const draft = { ...emptyDraft(entry), values: { nums: [2, 7, 11, 15], target: 9 } };
    expect(composeSetup(entry, draft)).toBe("print(show(Solution().twoSum([2, 7, 11, 15], 9)))");
  });

  it("binds a long argument to its own name so the call stays readable", () => {
    const draft = { ...emptyDraft(entry), values: { nums: [10, 20, 30, 40, 50, 60, 70, 80], target: 90 } };
    expect(composeSetup(entry, draft)).toBe("nums = [10, 20, 30, 40, 50, 60, 70, 80]\nprint(show(Solution().twoSum(nums, 90)))");
  });

  it("builds a chain through the helper rather than by nesting constructors, and names it so the canvas can label it", () => {
    const listEntry = specFromSignature({ name: "reverseList", params: [{ name: "head", type: "Optional[ListNode]" }], returnType: "Optional[ListNode]", classBased: false }).entryPoints[0]!;
    const draft = { ...emptyDraft(listEntry), values: { head: [3, 2, 0, -4] } };
    expect(composeSetup(listEntry, draft)).toBe("head = linked_list([3, 2, 0, -4])\nprint(show(Solution().reverseList(head)))");
  });

  it("names a tree for the same reason, however small it is", () => {
    const treeEntry = specFromSignature({ name: "maxDepth", params: [{ name: "root", type: "Optional[TreeNode]" }], returnType: "int", classBased: false }).entryPoints[0]!;
    expect(composeSetup(treeEntry, { ...emptyDraft(treeEntry), values: { root: [1, null, 2] } })).toBe("root = tree([1, None, 2])\nprint(show(Solution().maxDepth(root)))");
  });

  it("reads an empty chain as the null pointer", () => {
    const listEntry = specFromSignature({ name: "reverseList", params: [{ name: "head", type: "Optional[ListNode]" }], returnType: "", classBased: false }).entryPoints[0]!;
    expect(composeSetup(listEntry, { ...emptyDraft(listEntry), values: { head: [] } })).toBe("print(show(Solution().reverseList(None)))");
  });

  it("spells the literals Python's way, not JSON's", () => {
    const boolEntry = specFromSignature({ name: "check", params: [{ name: "flag", type: "bool" }, { name: "note", type: "Optional[str]" }], returnType: "bool", classBased: false }).entryPoints[0]!;
    expect(composeSetup(boolEntry, { ...emptyDraft(boolEntry), values: { flag: true, note: null } })).toBe("print(show(Solution().check(True, None)))");
  });

  it("renders a returned structure through show, so the console can be read against the expected output", () => {
    // The bare `print` this replaced emitted `<ListNode object at 0x...>`.
    expect(composeSetup(entry, { ...emptyDraft(entry), values: { nums: [1], target: 1 } })).toContain("print(show(");
  });

  it("hands the raw source through untouched when the form is abandoned", () => {
    const draft = { ...emptyDraft(entry), mode: "raw" as const, source: "print(Solution().twoSum(list(range(5)), 7))" };
    expect(composeSetup(entry, draft)).toBe("print(Solution().twoSum(list(range(5)), 7))");
  });
});
