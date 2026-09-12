import type { DictFlavour, EntryPoint, InputField, InputFieldKind, InputSpec, ListContainer } from "../../inputs.js";
import type { DeclaredSignature } from "../../language.js";

/**
 * Turning a Python parameter into a control.
 *
 * Three sources of evidence, in descending order of trust:
 *
 *   1. An annotation. `List[List[int]]` is a grid and there is nothing to guess.
 *   2. A class the learner defined. A class with a `next` field is a chain and a
 *      class with `left`/`right` is a tree, whatever it is named — matching on
 *      `ListNode` alone would work for LeetCode and fail for everyone who typed
 *      `Node`.
 *   3. The parameter's name. Unannotated Python is the common case in a
 *      half-written solution, and a form of raw-expression boxes is no better
 *      than the editor it replaced. `nums` is a list of integers and `head` is a
 *      linked list in essentially every problem that uses those names, so the
 *      form guesses, marks the guess as a guess, and lets it be overridden.
 *
 * The third one is the only place this is willing to be wrong, which is why it
 * is the only one that reports `declared: null`: the UI draws a guessed control
 * differently and offers the type switcher next to it. A guess that announces
 * itself is a shortcut; a guess that does not is a trap.
 *
 * This mapping runs exactly once for both derivation paths — a source problem's
 * declared signature and a parse of the learner's own file both arrive here as
 * annotation strings — so the two can never disagree about what `List[int]`
 * means.
 */

/** A class the learner defined, as the tracer's analysis reported it. */
export type ClassShape = {
  name: string;
  fields: Array<{ name: string; annotation: string | null; hasDefault: boolean }>;
  shape: "linked" | "tree" | "record";
  constructible: boolean;
};

/** What the tracer's `analyze` mode returns. Raw facts only; every judgement
 *  about them is made here. */
export type PythonAnalysis = {
  entryPoints: Array<{
    name: string;
    receiver: string | null;
    params: Array<{ name: string; annotation: string | null; hasDefault: boolean }>;
    returnType: string | null;
    unsupported: string | null;
  }>;
  classes: ClassShape[];
  preferred: string | null;
  error: string | null;
};

const SCALARS: Record<string, InputFieldKind> = {
  int: { kind: "int" },
  float: { kind: "float" },
  complex: { kind: "float" },
  str: { kind: "string" },
  bool: { kind: "bool" },
};

/**
 * The standard containers, and which one each annotation names.
 *
 * All of them are entered as a row of values and only the encoding differs, but
 * the difference is not cosmetic — a `Set[int]` that arrives as a list is a bug
 * the learner will look for in their algorithm. `Iterable` and `Sequence` are
 * promises about reading, not about type, so a list satisfies both.
 */
const CONTAINERS: Record<string, ListContainer> = {
  list: "list",
  sequence: "list",
  mutablesequence: "list",
  iterable: "list",
  iterator: "list",
  collection: "list",
  tuple: "tuple",
  set: "set",
  mutableset: "set",
  abstractset: "set",
  frozenset: "frozenset",
  deque: "deque",
};

/** The standard mappings. `Counter` and `defaultdict` are separate flavours
 *  rather than plain dictionaries because a solution that calls `.most_common`
 *  or relies on a missing key defaulting needs the real thing. */
const MAPPINGS: Record<string, DictFlavour> = {
  dict: "dict",
  mapping: "dict",
  mutablemapping: "dict",
  counter: "Counter",
  ordereddict: "OrderedDict",
  defaultdict: "defaultdict",
};

/** Peel one layer of `Name[inner]`, respecting nesting so `Dict[str, List[int]]`
 *  does not split down the middle of its own argument list. */
function subscript(annotation: string): { head: string; args: string[] } {
  const open = annotation.indexOf("[");
  if (open < 0 || !annotation.endsWith("]")) return { head: annotation, args: [] };
  const head = annotation.slice(0, open).trim();
  const body = annotation.slice(open + 1, -1);
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "[" || character === "(") depth += 1;
    else if (character === "]" || character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      args.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(body.slice(start).trim());
  return { head, args: args.filter(Boolean) };
}

/** Drop the module path so `typing.List` and `List` are the same thing. */
function bare(annotation: string): string {
  const trimmed = annotation.trim().replace(/^['"]|['"]$/g, "");
  const dot = trimmed.lastIndexOf(".", trimmed.indexOf("[") < 0 ? trimmed.length : trimmed.indexOf("["));
  return dot < 0 ? trimmed : trimmed.slice(dot + 1);
}

/** Names that read as one thing across essentially every problem that uses
 *  them. Ordered longest-first at the point of use so `nums1` matches `nums`
 *  and `k` does not match `kth`. */
const NAME_HINTS: Array<[RegExp, InputFieldKind]> = [
  [/^(head|list1|list2|l1|l2|node)\d*$/i, { kind: "linked", typeName: "ListNode", of: scalarField("value", { kind: "int" }) }],
  [/^(root|tree|subroot|p|q)\d*$/i, { kind: "tree", typeName: "TreeNode", of: scalarField("value", { kind: "int" }) }],
  [/^(matrix|grid|board|image|graph|edges|intervals|points|mat)\d*$/i, { kind: "list", of: { name: "row", type: { kind: "list", of: scalarField("cell", { kind: "int" }) }, optional: false, declared: null } }],
  [/^(nums|arr|array|values|heights|prices|weights|coins|candidates|scores|ratings)\d*$/i, { kind: "list", of: scalarField("value", { kind: "int" }) }],
  [/^(words|strs|strings|names|tokens|paths|wordlist)\d*$/i, { kind: "list", of: scalarField("value", { kind: "string" }) }],
  [/^(seen|visited|used|banned|blocked|allowed|wordset|dictionary)\d*$/i, { kind: "list", of: scalarField("value", { kind: "int" }), container: "set" }],
  [/^(counts|freq|frequency|memo|cache|lookup|mapping|parents|indegree|adj|adjacency)\d*$/i, { kind: "dict", key: scalarField("key", { kind: "int" }), value: scalarField("value", { kind: "int" }) }],
  [/^(queue|q|stack|window|dq)\d*$/i, { kind: "list", of: scalarField("value", { kind: "int" }), container: "deque" }],
  [/^(s|t|text|word|pattern|str|string|needle|haystack|sentence|expression|path|digits)\d*$/i, { kind: "string" }],
  [/^(flag|is[A-Z_]|has[A-Z_])/, { kind: "bool" }],
  [/^(n|m|k|x|y|i|j|target|limit|capacity|count|size|length|index|amount|threshold|budget|start|end|left|right|low|high|val|value|rows|cols|columns)\d*$/i, { kind: "int" }],
];

function scalarField(name: string, type: InputFieldKind): InputField {
  return { name, type, optional: false, declared: null };
}

/**
 * Map one annotation onto a control.
 *
 * `Optional[X]` and `X | None` set the nullable flag on whatever X turns out to
 * be rather than becoming a kind of their own — a nullable tree is still a tree,
 * and a control that knows it may be absent is one checkbox different from one
 * that does not.
 */
export function fieldFromAnnotation(name: string, annotation: string | null, classes: readonly ClassShape[], depth = 0): InputField {
  if (annotation === null) return guessFromName(name);
  const text = bare(annotation);
  const { head, args } = subscript(text);
  const lowered = head.toLowerCase();

  // `X | None` is spelled as a union rather than as a subscript, so it is
  // handled before anything looks at the head.
  const union = text.split("|").map((part) => part.trim()).filter(Boolean);
  if (union.length > 1) {
    const nullable = union.some((part) => bare(part).toLowerCase() === "none");
    const rest = union.filter((part) => bare(part).toLowerCase() !== "none");
    const inner = rest.length === 1 && rest[0] ? fieldFromAnnotation(name, rest[0], classes, depth) : { ...guessFromName(name), declared: annotation };
    return { ...inner, name, optional: nullable || inner.optional, declared: annotation };
  }

  if (lowered === "optional" && args[0]) {
    const inner = fieldFromAnnotation(name, args[0], classes, depth);
    return { ...inner, name, optional: true, declared: annotation };
  }
  if (lowered === "union" && args.length) {
    const nullable = args.some((part) => bare(part).toLowerCase() === "none");
    const rest = args.filter((part) => bare(part).toLowerCase() !== "none");
    const inner = rest.length === 1 && rest[0] ? fieldFromAnnotation(name, rest[0], classes, depth) : { ...guessFromName(name), declared: annotation };
    return { ...inner, name, optional: nullable || inner.optional, declared: annotation };
  }
  if (lowered === "literal" && args.length) {
    const options = args.map((argument) => argument.replace(/^['"]|['"]$/g, ""));
    return { name, type: { kind: "choice", options }, optional: false, declared: annotation };
  }

  const scalar = SCALARS[lowered];
  if (scalar && !args.length) return { name, type: scalar, optional: false, declared: annotation };

  const mapping = MAPPINGS[lowered];
  if (mapping) {
    const nested = depth >= 3;
    const key = nested || !args[0] ? scalarField("key", { kind: "string" }) : fieldFromAnnotation("key", args[0], classes, depth + 1);
    /* A `Counter[str]` takes one argument — what it counts — and its values are
       always integers, so the second half is known rather than missing. */
    const declaredValue = lowered === "counter" ? null : args[1];
    const value = nested || !declaredValue ? scalarField("value", { kind: "int" }) : fieldFromAnnotation("value", declaredValue, classes, depth + 1);
    return { name, type: { kind: "dict", key, value, flavour: mapping }, optional: false, declared: annotation };
  }

  const shaped = CONTAINERS[lowered];
  if (shaped) {
    // Depth is capped because a form nested four deep is unreadable and a
    // recursive annotation would otherwise not terminate.
    const capped = depth >= 3;
    /* `Tuple[int, str]` is a fixed row of different things and `Tuple[int, ...]`
       is a variable row of one thing, and they are different controls. Every
       other container is homogeneous however many arguments it was given. */
    const fixed = shaped === "tuple" && args.length > 1 && !args.includes("...");
    if (fixed && !capped) {
      const fields = args.map((argument, position) => fieldFromAnnotation(`item${position + 1}`, argument, classes, depth + 1));
      return { name, type: { kind: "tuple", fields }, optional: false, declared: annotation };
    }
    const first = args.find((argument) => argument !== "...");
    const element = capped || !first ? scalarField("value", { kind: "int" }) : fieldFromAnnotation("value", first, classes, depth + 1);
    return { name, type: { kind: "list", of: element, container: shaped }, optional: false, declared: annotation };
  }

  const known = classes.find((entry) => entry.name === head);
  if (known) return { ...fieldFromClass(name, known, classes, depth), declared: annotation };
  if (head === "ListNode") return { name, type: { kind: "linked", typeName: "ListNode", of: scalarField("value", { kind: "int" }) }, optional: false, declared: annotation };
  if (head === "TreeNode") return { name, type: { kind: "tree", typeName: "TreeNode", of: scalarField("value", { kind: "int" }) }, optional: false, declared: annotation };

  // A mapping, a callable, a class we have never heard of: the annotation is
  // reported so the learner can see what Spar could not turn into a control,
  // and they type the value as source.
  return { name, type: { kind: "raw" }, optional: false, declared: annotation };
}

/** A learner's own class as a control: a chain, a tree, or its fields. */
export function fieldFromClass(name: string, shape: ClassShape, classes: readonly ClassShape[], depth: number): InputField {
  if (shape.shape === "linked") return { name, type: { kind: "linked", typeName: shape.name, of: scalarField("value", { kind: "int" }) }, optional: true, declared: shape.name };
  if (shape.shape === "tree") return { name, type: { kind: "tree", typeName: shape.name, of: scalarField("value", { kind: "int" }) }, optional: true, declared: shape.name };
  if (!shape.constructible || depth >= 2) return { name, type: { kind: "raw" }, optional: false, declared: shape.name };
  // A record's own fields are mapped by the same rules, one level down, so a
  // class holding a `List[int]` gets a list editor inside its card.
  const fields = shape.fields.map((field) => fieldFromAnnotation(field.name, field.annotation, classes.filter((entry) => entry.name !== shape.name), depth + 1));
  return { name, type: { kind: "record", typeName: shape.name, fields }, optional: false, declared: shape.name };
}

/** The last-resort guess, from the parameter's name alone. Always reports
 *  `declared: null` so the UI can mark it and offer the switcher. */
export function guessFromName(name: string): InputField {
  for (const [pattern, type] of NAME_HINTS) {
    if (pattern.test(name)) {
      const optional = type.kind === "linked" || type.kind === "tree";
      return { name, type, optional, declared: null };
    }
  }
  return { name, type: { kind: "raw" }, optional: false, declared: null };
}

function entryId(receiver: string | null, name: string): string {
  return receiver ? `${receiver}.${name}` : name;
}

function entryLabel(receiver: string | null, name: string, params: readonly InputField[]): string {
  return `${receiver ? `${receiver}().` : ""}${name}(${params.map((param) => param.name).join(", ")})`;
}

/** Build the form from a parse of the learner's own source. */
export function specFromAnalysis(analysis: PythonAnalysis): InputSpec {
  const warnings: string[] = [];
  if (analysis.error) warnings.push(analysis.error);
  const entryPoints: EntryPoint[] = analysis.entryPoints.map((entry) => {
    const params = entry.params.map((param) => fieldFromAnnotation(param.name, param.annotation, analysis.classes));
    return {
      id: entryId(entry.receiver, entry.name),
      label: entryLabel(entry.receiver, entry.name, params),
      name: entry.name,
      receiver: entry.receiver,
      params,
      returnType: entry.returnType,
      unsupported: entry.unsupported,
    };
  });
  const guessed = entryPoints.flatMap((entry) => entry.params).filter((param) => param.declared === null);
  if (guessed.length) {
    warnings.push(
      guessed.length === 1
        ? `\`${guessed[0]?.name}\` has no type annotation, so Spar guessed its shape from its name. Change it if the guess is wrong.`
        : `${guessed.length} parameters have no type annotation, so Spar guessed their shapes from their names. Change any that are wrong.`,
    );
  }
  return { entryPoints, preferred: analysis.preferred, origin: analysis.error ? "none" : "source", warnings };
}

/**
 * Build the form from a signature a source problem declared.
 *
 * Preferred over parsing whenever a problem carries one. LeetCode's declared
 * types are the contract its own judge enforces, whereas the starter code they
 * generated is only the shadow of that contract — and starter code the learner
 * has since edited is not even that.
 */
/**
 * LeetCode's type vocabulary, as Python.
 *
 * A problem's declared signature comes from LeetCode's `metaData`, which is
 * written in its own language-neutral names — `integer`, `list<integer>`,
 * `character[][]` — and not in any language it offers. Reading those as Python
 * annotations is how `k: int` in the starter code arrives here as the
 * unrecognised word "integer" and gets a raw expression box, on every problem
 * with a number in it. The C++ harness has needed the same translation since it
 * shipped; this is the Python half of it.
 *
 * Real Python spellings pass through untouched, so the merge with a parse of
 * the learner's own annotated code stays a comparison of like with like.
 */
const META_SCALAR: Record<string, string> = {
  integer: "int",
  int: "int",
  long: "int",
  "long long": "int",
  int64: "int",
  double: "float",
  float: "float",
  string: "str",
  str: "str",
  character: "str",
  char: "str",
  boolean: "bool",
  bool: "bool",
  void: "None",
  null: "None",
};

export function pythonAnnotation(declared: string | null): string | null {
  const type = (declared ?? "").trim();
  if (!type) return null;
  const scalar = META_SCALAR[type.toLowerCase()];
  if (scalar) return scalar;
  const wrapped = /^list<(.*)>$/is.exec(type);
  if (wrapped) return `List[${pythonAnnotation(wrapped[1] ?? "") ?? "int"}]`;
  const suffixed = /^(.*)\[\]$/s.exec(type);
  if (suffixed) return `List[${pythonAnnotation(suffixed[1] ?? "") ?? "int"}]`;
  /* A node type is the one place LeetCode's vocabulary and Python's agree, and
     it is also the one that is nullable in practice — every linked-list problem
     accepts an empty list, and the starter code says `Optional[ListNode]`. */
  if (/^(ListNode|TreeNode|Node)$/.test(type)) return `Optional[${type}]`;
  return type;
}

export function specFromSignature(signature: DeclaredSignature): InputSpec {
  if (signature.classBased) {
    return {
      entryPoints: [{
        id: signature.name,
        label: signature.name,
        name: signature.name,
        receiver: null,
        params: [],
        returnType: signature.returnType,
        unsupported: "This problem asks you to design a class, so there is no single call to visualise. Use raw input to drive it yourself.",
      }],
      preferred: signature.name,
      origin: "signature",
      warnings: [],
    };
  }
  const params = signature.params.map((param) => {
    const field = fieldFromAnnotation(param.name, pythonAnnotation(param.type), []);
    // The learner is shown what the problem declared, not our translation of it.
    return { ...field, declared: param.type || field.declared };
  });
  const receiver = "Solution";
  const entry: EntryPoint = {
    id: entryId(receiver, signature.name),
    label: entryLabel(receiver, signature.name, params),
    name: signature.name,
    receiver,
    params,
    returnType: signature.returnType,
    unsupported: null,
  };
  return { entryPoints: [entry], preferred: entry.id, origin: "signature", warnings: [] };
}

/**
 * Reconcile the two.
 *
 * A source problem gives the types; the learner's file gives what is actually
 * callable right now. Neither alone is enough: a learner who renamed the method
 * has a signature that no longer matches their code, and a learner who deleted
 * the annotations still has the source problem's types sitting there unused.
 *
 * So the declared signature wins on the entry point it names, and everything
 * else the file offers is kept behind it — which means the picker still lists
 * the helper they are actually debugging.
 */
export function mergeSpecs(declared: InputSpec | null, parsed: InputSpec): InputSpec {
  if (!declared || !declared.entryPoints.length) return parsed;
  const [primary] = declared.entryPoints;
  if (!primary) return parsed;
  const matching = parsed.entryPoints.find((entry) => entry.name === primary.name);
  // The signature is authoritative about types, but only the parse knows whether
  // the method still exists and whether it can be called at all.
  const resolved: EntryPoint = matching
    ? { ...primary, id: matching.id, receiver: matching.receiver, label: matching.label, unsupported: primary.unsupported ?? matching.unsupported }
    : primary;
  const rest = parsed.entryPoints.filter((entry) => entry.name !== primary.name);
  const warnings = [...declared.warnings];
  if (!matching && !primary.unsupported) warnings.push(`The problem expects a \`${primary.name}\` method. Spar could not find one in your code, so the form below is the problem's shape rather than your file's.`);
  return { entryPoints: [resolved, ...rest], preferred: resolved.id, origin: "signature", warnings: [...warnings, ...parsed.warnings.filter((warning) => !warning.includes("no type annotation"))] };
}
