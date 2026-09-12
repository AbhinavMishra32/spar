import { z } from "zod";

/**
 * How the visualiser asks for an argument without asking for code.
 *
 * The old way — a second editor where you write the call yourself — is the thing
 * that makes a visualiser feel like a REPL with pictures. It also fails in the
 * one case that matters most here: someone who cannot yet see what their linked
 * list looks like is exactly the person who should not have to hand-write
 * `linked_list([3,2,0,-4])` before they are allowed to look at it.
 *
 * So a run is described as a *shape* and a *value*: an `InputSpec` says what the
 * entry point takes, and an `InputDraft` says what to pass this time. The spec is
 * derived, never typed — from a source problem's declared signature when there is
 * one, otherwise by parsing the learner's own code. Only the adapter turns the
 * pair back into source, which is why nothing in this file mentions Python.
 *
 * The escape hatch is deliberate and permanent. `raw` fields, and the raw-source
 * mode on a draft, exist because derivation will sometimes be wrong or a learner
 * will want something the form cannot say. Losing the ability to just write the
 * call would be a worse failure than never having generated the form.
 */

/**
 * What one argument is, in drawing terms.
 *
 * These are the shapes a form can render, not the types a language has. `linked`
 * and `tree` are here rather than under `list` because their editors are
 * genuinely different — a chain you extend at either end, a level-order array
 * with holes in it — even though both are entered as a row of scalars.
 */
/**
 * Which of the built-in containers a row of values becomes.
 *
 * One editor, five results. A row of numbers is entered the same way whether it
 * ends up a list, a tuple or a set — but it must not *end up* the wrong one:
 * passing `[1, 2]` to something annotated `Set[int]` gives the learner a list
 * with no `.add`, and the failure surfaces four lines into their algorithm
 * rather than at the input that caused it.
 */
export type ListContainer = "list" | "tuple" | "set" | "frozenset" | "deque";

/** Which mapping a set of key/value pairs becomes. `Counter` and `defaultdict`
 *  are here because half of the problems that want a dictionary want one of
 *  those two, and neither is spelled as a plain literal. */
export type DictFlavour = "dict" | "Counter" | "OrderedDict" | "defaultdict";

export type InputFieldKind =
  | { kind: "int" }
  | { kind: "float" }
  | { kind: "string" }
  | { kind: "bool" }
  /** A row of values of one kind. Nest one inside another for a grid.
   *  `container` says what it is built into; absent means a plain list. */
  | { kind: "list"; of: InputField; container?: ListContainer }
  /** A fixed-arity heterogeneous tuple — `Tuple[int, str]`, an interval, an
   *  edge with a weight. Entered as one control per position, because that is
   *  what distinguishes it from a row of the same thing. */
  | { kind: "tuple"; fields: InputField[] }
  /** Key/value pairs. Ordered, because a `dict` in Python is. */
  | { kind: "dict"; key: InputField; value: InputField; flavour?: DictFlavour }
  /** A chain built from an ordered row of values, e.g. LeetCode's ListNode. */
  | { kind: "linked"; of: InputField; typeName: string }
  /** A binary tree in level order, with holes for absent children. */
  | { kind: "tree"; of: InputField; typeName: string }
  /** A class the learner defined, entered field by field. */
  | { kind: "record"; typeName: string; fields: InputField[] }
  /** One of a fixed set, when the annotation named them. */
  | { kind: "choice"; options: string[] }
  /** Anything not derivable: a literal expression, typed as source. */
  | { kind: "raw" };

export type InputField = {
  name: string;
  /** What the form prints above the control. Falls back to `name`. */
  label?: string;
  type: InputFieldKind;
  /** True when the declared type admitted absence, so the control offers a
   *  null toggle rather than making the learner type the language's null. */
  optional: boolean;
  /** The annotation this was derived from, shown as a hint so a wrong derivation
   *  is visible rather than silent. */
  declared: string | null;
};

/**
 * One callable the trace can start from.
 *
 * `receiver` is the class to construct first when the entry point is a method —
 * the shape every LeetCode Python submission has. `unsupported` is set rather
 * than the entry point being dropped: a design problem with no single entry
 * point should appear in the picker greyed out with a reason, because a learner
 * looking for it and not finding it will assume the parse failed.
 */
export type EntryPoint = {
  id: string;
  label: string;
  name: string;
  receiver: string | null;
  params: InputField[];
  returnType: string | null;
  unsupported: string | null;
};

/** Everything derivable about how to call this code, plus how we know. */
export type InputSpec = {
  entryPoints: EntryPoint[];
  /** Which entry point to offer first: the source's declared one, else the last
   *  public method of the last class, else the last top-level function. */
  preferred: string | null;
  /** Where the shapes came from, so the UI can say "from LeetCode" rather than
   *  implying Spar inferred something it was handed. */
  origin: "signature" | "source" | "none";
  /** Things the derivation could not do, in the learner's language. */
  warnings: string[];
};

export const EMPTY_SPEC: InputSpec = { entryPoints: [], preferred: null, origin: "none", warnings: [] };

/** A value for one field. Mirrors the field kinds: scalars as themselves, `list`
 *  / `linked` / `tree` as arrays (a tree's holes are nulls, level order), `record`
 *  as an object keyed by field name, `raw` as the source text to splice in. */
export type InputValue = null | number | string | boolean | InputValue[] | { [key: string]: InputValue };

/** One prepared call: which entry point, and an argument per parameter.
 *  `mode: "raw"` abandons the form and uses `source` verbatim. */
export type InputDraft = {
  entryPointId: string;
  values: Record<string, InputValue>;
  mode: "form" | "raw";
  source: string;
};

export const inputValueSchema: z.ZodType<InputValue> = z.lazy(() =>
  z.union([z.null(), z.number(), z.string(), z.boolean(), z.array(inputValueSchema), z.record(inputValueSchema)]),
);

export const inputDraftSchema = z.object({
  entryPointId: z.string().max(200),
  values: z.record(inputValueSchema),
  mode: z.enum(["form", "raw"]),
  source: z.string().max(20_000),
});

/** The value a fresh control starts at. Empty rather than clever: a prefilled
 *  `0` that the learner did not choose is indistinguishable from one they did,
 *  and it is the argument they forgot to set that wastes the run. */
export function emptyValue(field: InputField): InputValue {
  if (field.optional) return null;
  switch (field.type.kind) {
    case "int":
    case "float":
      return 0;
    case "string":
      return "";
    case "bool":
      return false;
    case "list":
    case "linked":
    case "tree":
    case "dict":
      return [];
    case "tuple":
      return field.type.fields.map((inner) => emptyValue(inner));
    case "record":
      return Object.fromEntries(field.type.fields.map((inner) => [inner.name, emptyValue(inner)]));
    case "choice":
      return field.type.options[0] ?? "";
    case "raw":
      return "";
  }
}

export function emptyDraft(entry: EntryPoint): InputDraft {
  return {
    entryPointId: entry.id,
    values: Object.fromEntries(entry.params.map((param) => [param.name, emptyValue(param)])),
    mode: "form",
    source: "",
  };
}

export function findEntryPoint(spec: InputSpec, id: string | null): EntryPoint | null {
  return spec.entryPoints.find((entry) => entry.id === id) ?? spec.entryPoints.find((entry) => entry.id === spec.preferred) ?? spec.entryPoints[0] ?? null;
}

/**
 * Read one argument as a source problem wrote it.
 *
 * LeetCode states a worked example's arguments as Python literals, one per
 * parameter — `[2,7,11,15]`, `"abc"`, `9`, `{1: [2,3]}`, sometimes prefixed
 * `nums = [2,7]`. This reads Python rather than repairing it into JSON, because
 * the interesting half of the standard library is exactly the half JSON cannot
 * express: a set has no JSON spelling, a tuple is not an array, and `{1: 2}` is
 * a perfectly ordinary dictionary with a key JSON refuses.
 *
 * Containers all come back as arrays and mappings as objects, which is a
 * deliberate flattening: what a `[1, 2]` in an example is *for* is decided by
 * the field it lands on, not by the brackets around it. `coerceValue` does that.
 *
 * Returns `undefined` rather than throwing on anything it cannot read, so a
 * malformed example prefills nothing instead of taking the form down with it.
 */
export function parseLiteral(text: string): InputValue | undefined {
  const stripped = text.trim().replace(/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*/, "").trim();
  if (!stripped) return undefined;
  const reader = new LiteralReader(stripped);
  try {
    const value = reader.value();
    reader.skipSpace();
    if (!reader.done()) throw new Error("trailing input");
    return value;
  } catch {
    // A bare word that is not a literal is still usable as a string argument;
    // anything else is left to the raw field rather than guessed at.
    return /^[A-Za-z0-9_.\- ]+$/.test(stripped) ? stripped : undefined;
  }
}

/** A recursive-descent reader for the literal subset of Python: numbers,
 *  strings, `None`/`True`/`False`, and the four bracketed containers. Small
 *  enough to read in one sitting, which is the point — the alternative was a
 *  pile of regular expressions that each fixed one example and broke another. */
class LiteralReader {
  private at = 0;

  constructor(private readonly text: string) {}

  done(): boolean {
    return this.at >= this.text.length;
  }

  skipSpace(): void {
    while (this.at < this.text.length && /\s/.test(this.text[this.at] as string)) this.at += 1;
  }

  value(): InputValue {
    this.skipSpace();
    const character = this.text[this.at];
    if (character === undefined) throw new Error("empty");
    if (character === "[") return this.sequence("]");
    if (character === "(") return this.sequence(")");
    if (character === "{") return this.braced();
    if (character === '"' || character === "'") return this.string();
    return this.word();
  }

  /** `[...]`, `(...)` and the set half of `{...}`, all of which become arrays. */
  private sequence(closing: string): InputValue[] {
    this.at += 1;
    const items: InputValue[] = [];
    for (;;) {
      this.skipSpace();
      if (this.text[this.at] === closing) { this.at += 1; return items; }
      items.push(this.value());
      this.skipSpace();
      if (this.text[this.at] === ",") { this.at += 1; continue; }
      if (this.text[this.at] === closing) { this.at += 1; return items; }
      throw new Error("unterminated sequence");
    }
  }

  /** `{}` is a dictionary in Python and a set only when it has an unpaired
   *  first element, so the two are told apart by looking for the colon. */
  private braced(): InputValue {
    const opened = this.at;
    this.at += 1;
    this.skipSpace();
    if (this.text[this.at] === "}") { this.at += 1; return {}; }
    const first = this.value();
    this.skipSpace();
    if (this.text[this.at] !== ":") {
      this.at = opened;
      return this.sequence("}");
    }
    const entries: Array<[string, InputValue]> = [];
    this.at += 1;
    entries.push([keyText(first), this.value()]);
    for (;;) {
      this.skipSpace();
      if (this.text[this.at] === "}") { this.at += 1; return Object.fromEntries(entries); }
      if (this.text[this.at] !== ",") throw new Error("unterminated mapping");
      this.at += 1;
      this.skipSpace();
      if (this.text[this.at] === "}") { this.at += 1; return Object.fromEntries(entries); }
      const key = this.value();
      this.skipSpace();
      if (this.text[this.at] !== ":") throw new Error("mapping entry without a value");
      this.at += 1;
      entries.push([keyText(key), this.value()]);
    }
  }

  private string(): string {
    const quote = this.text[this.at] as string;
    this.at += 1;
    let out = "";
    while (this.at < this.text.length) {
      const character = this.text[this.at] as string;
      if (character === "\\") {
        const escaped = this.text[this.at + 1];
        out += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped === "r" ? "\r" : (escaped ?? "");
        this.at += 2;
        continue;
      }
      this.at += 1;
      if (character === quote) return out;
      out += character;
    }
    throw new Error("unterminated string");
  }

  /** A number, or one of the three bare words Python spells differently. */
  private word(): InputValue {
    const rest = this.text.slice(this.at);
    const number = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (number?.[0]) {
      this.at += number[0].length;
      return Number(number[0]);
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (!name?.[0]) throw new Error("not a literal");
    this.at += name[0].length;
    if (name[0] === "None" || name[0] === "null") return null;
    if (name[0] === "True" || name[0] === "true") return true;
    if (name[0] === "False" || name[0] === "false") return false;
    if (name[0] === "Infinity" || name[0] === "inf") return Number.POSITIVE_INFINITY;
    throw new Error("unknown name");
  }
}

/** Mapping keys arrive as whatever they were written as and are held as text,
 *  then coerced back by the key field. Only the round trip has to be faithful. */
function keyText(value: InputValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Fit a parsed literal onto a field, so an example from a source problem lands
 * in the right controls.
 *
 * Coercion is one-directional and shallow on purpose: a number written into a
 * string field becomes its text, a scalar arriving at a list field becomes a
 * one-element list, and anything genuinely mismatched is dropped rather than
 * mangled — an argument silently reshaped to fit is worse than an empty control,
 * because the learner will trust it.
 */
export function coerceValue(field: InputField, value: InputValue | undefined): InputValue {
  if (value === undefined) return emptyValue(field);
  if (value === null) return field.optional ? null : emptyValue(field);
  switch (field.type.kind) {
    case "int": {
      const numeric = typeof value === "number" ? Math.trunc(value) : Number(value);
      return Number.isFinite(numeric) ? numeric : emptyValue(field);
    }
    case "float": {
      const numeric = typeof value === "number" ? value : Number(value);
      return Number.isFinite(numeric) ? numeric : emptyValue(field);
    }
    case "string":
      return typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
    case "bool":
      return typeof value === "boolean" ? value : Boolean(value);
    case "choice":
      return typeof value === "string" && field.type.options.includes(value) ? value : (field.type.options[0] ?? "");
    case "list":
    case "linked":
    case "tree": {
      const inner = field.type.of;
      const items = Array.isArray(value) ? value : [value];
      // A tree's holes are meaningful, so nulls survive into it whatever the
      // element field says; elsewhere a null element is coerced like any other.
      return items.map((item) => (field.type.kind === "tree" && item === null ? null : coerceValue(inner, item)));
    }
    case "tuple": {
      const items = Array.isArray(value) ? value : [value];
      return field.type.fields.map((inner, position) => coerceValue(inner, items[position]));
    }
    case "dict": {
      /* Pairs, not an object, because Python's keys are not all strings and its
         dictionaries are ordered. A literal that arrived as an object is still
         accepted — a source problem writes `{"a": 1}` and its keys are coerced
         back to whatever the key field says they are. */
      const { key, value: inner } = field.type;
      const pairs: InputValue[][] = Array.isArray(value)
        ? value.map((entry) => (Array.isArray(entry) ? entry : [entry, null]))
        : typeof value === "object" && value !== null
          ? Object.entries(value)
          : [];
      return pairs.map(([left, right]) => [coerceValue(key, left ?? null), coerceValue(inner, right ?? null)]);
    }
    case "record": {
      const fields = field.type.fields;
      const object = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, InputValue>) : {};
      return Object.fromEntries(fields.map((inner) => [inner.name, coerceValue(inner, object[inner.name])]));
    }
    case "raw":
      return typeof value === "string" ? value : JSON.stringify(value);
  }
}

/**
 * Turn a source problem's worked example into a draft.
 *
 * The arguments arrive positionally and in signature order, which is the only
 * reason this can work at all — the names in the statement are prose and the
 * names in the signature are the contract. Missing arguments keep their empty
 * value so a partial example still fills in what it can.
 */
export function draftFromExample(entry: EntryPoint, argumentSources: readonly string[]): InputDraft {
  const draft = emptyDraft(entry);
  entry.params.forEach((param, index) => {
    const source = argumentSources[index];
    if (source === undefined) return;
    draft.values[param.name] = coerceValue(param, parseLiteral(source));
  });
  return draft;
}

/** Every element a nested field can hold, flattened — used to size the editors
 *  and to decide whether a list is a grid before drawing it. */
export function isGrid(field: InputField): boolean {
  return field.type.kind === "list" && field.type.of.type.kind === "list";
}
