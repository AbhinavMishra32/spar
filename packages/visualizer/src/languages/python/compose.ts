import type { DictFlavour, EntryPoint, InputDraft, InputField, InputValue, ListContainer } from "../../inputs.js";

/**
 * Turning a filled-in form back into the call it stands for.
 *
 * The output is real Python that the learner can read, and that matters more
 * than it sounds: the composed source is shown above the run button, so the form
 * teaches the code rather than hiding it. Someone who fills in a row of numbers
 * under "head" and sees `linked_list([3, 2, 0, -4])` appear has learned what the
 * helper does, and the next time they can skip the form.
 *
 * It is also why this emits helper calls rather than inlined constructor chains.
 * `ListNode(3, ListNode(2, ListNode(0, ListNode(-4))))` is the same object and
 * unreadable at four elements, let alone forty.
 */

/** Python's spelling of a scalar. Not `JSON.stringify`: `True`, `False` and
 *  `None` are the three places JSON and Python disagree, and a `true` spliced
 *  into source is a `NameError` at the least useful possible moment. */
function literal(value: InputValue): string {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "float('nan')";
  if (typeof value === "string") return pythonString(value);
  if (Array.isArray(value)) return `[${value.map(literal).join(", ")}]`;
  return `{${Object.entries(value).map(([key, inner]) => `${pythonString(key)}: ${literal(inner)}`).join(", ")}}`;
}

/** A double-quoted Python string.
 *
 *  JSON's escape rules are a subset of Python's for everything a form can
 *  produce — the quote, the backslash and the C0 controls escape identically,
 *  and Python 3 source is UTF-8, so anything above ASCII can stay as itself.
 *  The quoting is still done through this one function rather than inline,
 *  because this string is about to be executed and there should be exactly one
 *  place to look when that goes wrong. */
function pythonString(value: string): string {
  return JSON.stringify(value);
}

/** One argument, as source. */
export function encodeValue(field: InputField, value: InputValue): string {
  if (value === null) return "None";
  switch (field.type.kind) {
    case "raw":
      // The one place the learner's own text reaches the program unquoted, which
      // is exactly what a raw field is for. `None` is the safe reading of a raw
      // field with nothing in it that still has to produce an argument.
      return typeof value === "string" && value.trim() ? value.trim() : "None";
    case "int":
      return String(Math.trunc(Number(value) || 0));
    case "float":
      return literal(typeof value === "number" ? value : Number(value) || 0);
    case "string":
      return pythonString(String(value));
    case "bool":
      return value ? "True" : "False";
    case "choice":
      return pythonString(String(value));
    case "list": {
      const items = Array.isArray(value) ? value : [];
      const inner = field.type.of;
      return container(field.type.container ?? "list", items.map((item) => encodeValue(inner, item)));
    }
    case "tuple": {
      const items = Array.isArray(value) ? value : [];
      const parts = field.type.fields.map((inner, position) => encodeValue(inner, items[position] ?? null));
      return container("tuple", parts);
    }
    case "dict": {
      const { key, value: entryValue, flavour } = field.type;
      const pairs = (Array.isArray(value) ? value : []).map((entry) => {
        const [left, right] = Array.isArray(entry) ? entry : [entry, null];
        return `${encodeValue(key, left ?? null)}: ${encodeValue(entryValue, right ?? null)}`;
      });
      return mapping(flavour ?? "dict", pairs, entryValue);
    }
    case "linked": {
      const items = Array.isArray(value) ? value : [];
      // An empty chain is the null pointer, not a node holding nothing. Every
      // problem that takes a list handles the empty case that way.
      if (!items.length) return "None";
      return `linked_list(${literal(items)})`;
    }
    case "tree": {
      const items = Array.isArray(value) ? value : [];
      if (!items.length) return "None";
      return `tree(${literal(items)})`;
    }
    case "record": {
      const fields = field.type.fields;
      const object = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, InputValue>) : {};
      const args = fields.map((inner) => `${inner.name}=${encodeValue(inner, object[inner.name] ?? null)}`);
      return `${field.type.typeName}(${args.join(", ")})`;
    }
  }
}

/**
 * The built-in containers, spelled.
 *
 * Each of these was previously encoded as a list, which is the kind of wrong
 * that does not announce itself: `[1, 2]` passed where a `Set[int]` was declared
 * runs happily until the algorithm reaches for `.add`, and the learner then
 * debugs their algorithm rather than their input. An empty set is the one that
 * has to be spelled out — `{}` is an empty dictionary — and a one-element tuple
 * needs its trailing comma or the parentheses are only grouping.
 */
function container(kind: ListContainer, parts: readonly string[]): string {
  const body = parts.join(", ");
  switch (kind) {
    case "tuple":
      return parts.length === 1 ? `(${body},)` : `(${body})`;
    case "set":
      return parts.length ? `{${body}}` : "set()";
    case "frozenset":
      return parts.length ? `frozenset({${body}})` : "frozenset()";
    case "deque":
      return `deque([${body}])`;
    case "list":
      return `[${body}]`;
  }
}

/** A mapping, in whichever of the four spellings the annotation asked for. A
 *  `defaultdict` needs its factory, and the value's own kind is exactly the
 *  evidence for which one — `DefaultDict[str, List[int]]` defaults to `list`. */
function mapping(flavour: DictFlavour, pairs: readonly string[], value: InputField): string {
  const literal = `{${pairs.join(", ")}}`;
  switch (flavour) {
    case "dict":
      return literal;
    case "Counter":
      return `Counter(${literal})`;
    case "OrderedDict":
      return `OrderedDict(${literal})`;
    case "defaultdict":
      return `defaultdict(${factory(value)}, ${literal})`;
  }
}

function factory(value: InputField): string {
  switch (value.type.kind) {
    case "string":
      return "str";
    case "float":
      return "float";
    case "bool":
      return "bool";
    case "list":
      return value.type.container === "set" ? "set" : value.type.container === "deque" ? "deque" : "list";
    case "dict":
      return "dict";
    default:
      return "int";
  }
}

/**
 * The whole setup block.
 *
 * Arguments are bound to named variables before the call rather than inlined,
 * for two reasons. The first is that the trace is more useful when the input has
 * a name: `head` in the setup is the same `head` the canvas labels. The second is
 * that a long list inlined into a call wraps into something nobody can read, and
 * the point of showing the composed source is that it is readable.
 *
 * The result is printed. The entry-point call happens outside the traced file,
 * so its return value would otherwise appear only on the final frame's `result`
 * — printing it puts the answer in the console too, where a learner comparing
 * against an expected output will look for it.
 */
export function composeSetup(entry: EntryPoint, draft: InputDraft): string {
  if (draft.mode === "raw") return draft.source;
  if (entry.unsupported) return draft.source;

  const bindings: string[] = [];
  const args: string[] = [];
  for (const param of entry.params) {
    const value = draft.values[param.name];
    const encoded = encodeValue(param, value === undefined ? null : value);
    // Anything that becomes an object on the heap is bound to its parameter's
    // name, however short it is. The canvas labels an object with the names
    // pointing at it, so binding is what makes the chain on screen say "head"
    // instead of floating there unnamed — the argument's name is the single
    // most useful label in the whole picture, and inlining throws it away.
    // Everything else follows length: a short scalar reads better at the call
    // site than on a line of its own.
    const structural = ["linked", "tree", "record", "dict"].includes(param.type.kind) && encoded !== "None";
    if (!structural && encoded.length <= 24 && !encoded.includes("\n")) {
      args.push(encoded);
      continue;
    }
    bindings.push(`${param.name} = ${encoded}`);
    args.push(param.name);
  }
  const receiver = entry.receiver ? `${entry.receiver}().` : "";
  const call = `${receiver}${entry.name}(${args.join(", ")})`;
  /* `show` rather than a bare print. A solution that returns a linked list
     prints as `<ListNode object at 0x104...>`, which is worse than useless to
     someone holding an expected output of `[5,4,3,2,1]` — `show` renders a
     chain as a list and a tree as its level-order array, and leaves everything
     else exactly as it was. It is named in the composed source rather than
     applied invisibly, because the learner can then see that the printed value
     went through something, and read what. */
  return [...bindings, `print(show(${call}))`].join("\n");
}
