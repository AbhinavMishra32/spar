import { useState } from "react";
import { ArrowRight, Blocks, Braces, Check, ChevronDown, Circle, CircleSlash, GitCommitVertical, Grid3x3, Hash, ListOrdered, Minus, Parentheses, Plus, Quote, ToggleLeft, TriangleAlert, Type, Waypoints, X } from "lucide-react";
import type { EntryPoint, InputField, InputFieldKind, InputValue, ListContainer } from "@spar/visualizer";
import { emptyValue } from "@spar/visualizer";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The input form: arguments without writing code.
 *
 * The design problem here is not "render a form from a schema". It is that the
 * person using this cannot yet picture the data structure — that is why they
 * opened a visualiser — so every control has to be a picture of the thing it
 * builds. A linked list is a row of cells you extend from either end, not a
 * JSON textarea; a tree is a level-order row where an empty cell is visibly a
 * *hole* rather than a zero; a grid is a grid.
 *
 * Three rules hold the whole thing together:
 *
 *   1. **A guess says it is a guess.** A control derived from a parameter's name
 *      rather than its type is marked and carries a type switcher. Being wrong
 *      is fine; being wrong quietly is not.
 *   2. **Nothing is a dead end.** Every field can be switched to a raw
 *      expression, and the whole form can be abandoned for raw source. A form
 *      that cannot express what someone needs must not be the only way in.
 *   3. **The composed call is always visible.** Above the run button, in the
 *      language. The form is a faster way to write the call, not a replacement
 *      for knowing what it is.
 */

const KIND_ICON: Record<InputFieldKind["kind"], React.ComponentType<{ className?: string }>> = {
  int: Hash, float: Hash, string: Quote, bool: ToggleLeft,
  list: ListOrdered, linked: Waypoints, tree: GitCommitVertical,
  tuple: Parentheses, dict: Braces, record: Blocks, choice: ChevronDown, raw: Type,
};

const KIND_LABEL: Record<InputFieldKind["kind"], string> = {
  int: "Integer", float: "Decimal", string: "Text", bool: "Boolean",
  list: "List", linked: "Linked list", tree: "Binary tree",
  tuple: "Tuple", dict: "Dictionary", record: "Object", choice: "Choice", raw: "Expression",
};

/** What each container is called, and the brackets it is written in. Shown on
 *  the control because a row of numbers looks the same whichever it becomes,
 *  and the learner should not have to read the composed call to find out. */
const CONTAINER_LABEL: Record<NonNullable<Extract<InputFieldKind, { kind: "list" }>["container"]>, { label: string; open: string; close: string }> = {
  list: { label: "List", open: "[", close: "]" },
  tuple: { label: "Tuple", open: "(", close: ")" },
  set: { label: "Set", open: "{", close: "}" },
  frozenset: { label: "Frozen set", open: "{", close: "}" },
  deque: { label: "Deque", open: "[", close: "]" },
};

const DICT_LABEL: Record<NonNullable<Extract<InputFieldKind, { kind: "dict" }>["flavour"]>, string> = {
  dict: "Dictionary", Counter: "Counter", OrderedDict: "Ordered dictionary", defaultdict: "Default dictionary",
};

/** What a parameter can be switched to when the derivation got it wrong.
 *  Deliberately the shapes a learner can name, not every shape the model has:
 *  `record` is missing because you cannot pick which class you meant, and it is
 *  only ever produced by a derivation that already knew. */
const SWITCHABLE: InputFieldKind[] = [
  { kind: "int" },
  { kind: "float" },
  { kind: "string" },
  { kind: "bool" },
  { kind: "list", of: { name: "value", type: { kind: "int" }, optional: false, declared: null } },
  { kind: "list", of: { name: "value", type: { kind: "string" }, optional: false, declared: null } },
  { kind: "list", of: { name: "row", type: { kind: "list", of: { name: "cell", type: { kind: "int" }, optional: false, declared: null } }, optional: false, declared: null } },
  { kind: "list", of: { name: "value", type: { kind: "int" }, optional: false, declared: null }, container: "set" },
  { kind: "list", of: { name: "value", type: { kind: "int" }, optional: false, declared: null }, container: "deque" },
  { kind: "tuple", fields: [{ name: "item1", type: { kind: "int" }, optional: false, declared: null }, { name: "item2", type: { kind: "int" }, optional: false, declared: null }] },
  { kind: "dict", key: { name: "key", type: { kind: "string" }, optional: false, declared: null }, value: { name: "value", type: { kind: "int" }, optional: false, declared: null } },
  { kind: "linked", typeName: "ListNode", of: { name: "value", type: { kind: "int" }, optional: false, declared: null } },
  { kind: "tree", typeName: "TreeNode", of: { name: "value", type: { kind: "int" }, optional: false, declared: null } },
  { kind: "raw" },
];

function switchLabel(kind: InputFieldKind): string {
  if (kind.kind === "list" && kind.of.type.kind === "list") return "Grid of integers";
  if (kind.kind === "list") return `${CONTAINER_LABEL[kind.container ?? "list"].label} of ${KIND_LABEL[kind.of.type.kind].toLowerCase()}s`;
  if (kind.kind === "dict") return `${DICT_LABEL[kind.flavour ?? "dict"]} of ${KIND_LABEL[kind.key.type.kind].toLowerCase()} to ${KIND_LABEL[kind.value.type.kind].toLowerCase()}`;
  if (kind.kind === "tuple") return `Tuple of ${kind.fields.length}`;
  return KIND_LABEL[kind.kind];
}

export function InputForm({
  entry,
  values,
  onChange,
  onRetype,
}: {
  entry: EntryPoint;
  values: Record<string, InputValue>;
  onChange(name: string, value: InputValue): void;
  onRetype(name: string, field: InputField): void;
}) {
  if (entry.unsupported) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-dashed border-border px-3.5 py-3 text-ui text-muted-foreground">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
        <span>{entry.unsupported}</span>
      </div>
    );
  }
  if (!entry.params.length) {
    return <p className="rounded-xl border border-dashed border-border px-3.5 py-3 text-ui text-muted-foreground">{entry.name}() takes no arguments. Run it as it is.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {entry.params.map((param) => (
        <ParamRow
          field={param}
          key={param.name}
          onChange={(value) => onChange(param.name, value)}
          onRetype={(field) => onRetype(param.name, field)}
          value={values[param.name] ?? emptyValue(param)}
        />
      ))}
    </div>
  );
}

/** One argument: its name, where its shape came from, and its control. */
function ParamRow({ field, value, onChange, onRetype }: { field: InputField; value: InputValue; onChange(value: InputValue): void; onRetype(field: InputField): void }) {
  const Icon = KIND_ICON[field.type.kind];
  const guessed = field.declared === null;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5 shadow-[var(--app-shadow-card)]">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono text-ui font-medium">{field.name}</span>

        {/* Where this control came from. A declared type is stated flatly; a
            guess is stated as a guess, because the learner is the only one who
            can tell us it is wrong. */}
        {field.declared ? (
          <span className="truncate font-mono text-ui-sm text-muted-foreground">{field.declared}</span>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-ui-sm font-medium text-warning">guessed</span>
            </TooltipTrigger>
            <TooltipContent>No type annotation, so Spar guessed {switchLabel(field.type).toLowerCase()} from the name. Change it if that is wrong.</TooltipContent>
          </Tooltip>
        )}

        <div className="ml-auto flex items-center gap-1">
          {field.optional && (
            <label className="flex cursor-pointer items-center gap-1.5 text-ui-sm text-muted-foreground">
              <Switch
                checked={value === null}
                className="scale-90"
                onCheckedChange={(checked) => onChange(checked ? null : emptyValue({ ...field, optional: false }))}
              />
              null
            </label>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="text-muted-foreground" size="icon-xs" variant="ghost">
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SWITCHABLE.map((kind) => (
                <DropdownMenuItem
                  key={switchLabel(kind)}
                  onSelect={() => onRetype({ ...field, type: kind, declared: field.declared })}
                >
                  {switchLabel(kind)}
                  {kind.kind === field.type.kind && <Check className="ml-auto size-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {value === null && field.optional ? (
        <p className="mt-2 font-mono text-ui-sm text-muted-foreground">None</p>
      ) : (
        <div className="mt-2">
          <FieldControl field={field} onChange={onChange} value={value} />
        </div>
      )}
    </div>
  );
}

function FieldControl({ field, value, onChange }: { field: InputField; value: InputValue; onChange(value: InputValue): void }) {
  switch (field.type.kind) {
    case "int":
    case "float":
      return (
        <Input
          className="h-7 max-w-40 font-mono text-ui"
          onChange={(event) => {
            const parsed = field.type.kind === "int" ? parseInt(event.target.value, 10) : parseFloat(event.target.value);
            onChange(Number.isFinite(parsed) ? parsed : 0);
          }}
          step={field.type.kind === "int" ? 1 : "any"}
          type="number"
          value={typeof value === "number" ? value : 0}
        />
      );
    case "string":
      return <Input className="h-7 font-mono text-ui" onChange={(event) => onChange(event.target.value)} placeholder="empty string" value={typeof value === "string" ? value : ""} />;
    case "bool":
      return (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-ui">
          <Switch checked={value === true} onCheckedChange={(checked) => onChange(checked)} />
          <span className="font-mono text-muted-foreground">{value === true ? "True" : "False"}</span>
        </label>
      );
    case "choice":
      return (
        <div className="flex flex-wrap gap-1.5">
          {field.type.options.map((option) => (
            <button
              className={cn("rounded-md border px-2 py-1 font-mono text-ui-sm", value === option ? "border-border-strong bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-muted")}
              key={option}
              onClick={() => onChange(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      );
    case "raw":
      return (
        <Input
          className="h-7 font-mono text-ui"
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.declared ? `a ${field.declared} expression` : "any expression, e.g. {1: [2, 3]}"}
          value={typeof value === "string" ? value : ""}
        />
      );
    case "list":
      return field.type.of.type.kind === "list"
        ? <GridEditor field={field.type.of} onChange={onChange} value={Array.isArray(value) ? value : []} />
        : <SequenceEditor container={field.type.container ?? "list"} element={field.type.of} onChange={onChange} value={Array.isArray(value) ? value : []} />;
    case "tuple":
      return <TupleEditor fields={field.type.fields} onChange={onChange} value={Array.isArray(value) ? value : []} />;
    case "dict":
      return <DictEditor field={field.type} onChange={onChange} value={Array.isArray(value) ? value : []} />;
    case "linked":
      return <SequenceEditor chain element={field.type.of} onChange={onChange} value={Array.isArray(value) ? value : []} />;
    case "tree":
      return <TreeEditor element={field.type.of} onChange={onChange} value={Array.isArray(value) ? value : []} />;
    case "record":
      return (
        <div className="flex flex-col gap-2 border-l border-border pl-3">
          {field.type.fields.map((inner) => (
            <div className="flex items-center gap-2" key={inner.name}>
              <span className="w-20 shrink-0 truncate font-mono text-ui-sm text-muted-foreground">{inner.name}</span>
              <div className="min-w-0 flex-1">
                <FieldControl
                  field={inner}
                  onChange={(next) => onChange({ ...(value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}), [inner.name]: next })}
                  value={(value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, InputValue>)[inner.name] : undefined) ?? emptyValue(inner)}
                />
              </div>
            </div>
          ))}
        </div>
      );
  }
}

/**
 * A fixed row of different things: `Tuple[int, str]`, an interval, a weighted
 * edge. Drawn in its parentheses and labelled by position, because that is the
 * only thing distinguishing it on screen from a list of two.
 */
function TupleEditor({ fields, value, onChange }: { fields: readonly InputField[]; value: InputValue[]; onChange(value: InputValue[]): void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span aria-hidden className="font-mono text-ui text-muted-foreground">(</span>
      {fields.map((inner, position) => (
        <div className="flex items-center gap-1" key={inner.name}>
          <FieldControl
            field={inner}
            onChange={(next) => onChange(fields.map((_, at) => (at === position ? next : value[at] ?? emptyValue(fields[at] as InputField))))}
            value={value[position] ?? emptyValue(inner)}
          />
          {position < fields.length - 1 && <span aria-hidden className="text-ui-sm text-muted-foreground">,</span>}
        </div>
      ))}
      <span aria-hidden className="font-mono text-ui text-muted-foreground">)</span>
    </div>
  );
}

/**
 * Key/value pairs.
 *
 * Pairs rather than an object, and in the order they were entered, because both
 * of those are true of a Python dictionary and neither is true of the JSON that
 * would be the lazy way to hold this. A key can be a number, and the order it
 * was inserted in is the order it iterates in — a form that quietly sorted or
 * stringified would be teaching something false about the language.
 */
function DictEditor({ field, value, onChange }: { field: Extract<InputFieldKind, { kind: "dict" }>; value: InputValue[]; onChange(value: InputValue[]): void }) {
  const pairs = value.map((entry) => (Array.isArray(entry) ? entry : [entry, null]));
  const write = (next: InputValue[][]) => onChange(next.map((pair) => [pair[0] ?? null, pair[1] ?? null]));

  return (
    <div className="flex flex-col gap-1.5">
      {pairs.map((pair, index) => (
        <div className="flex items-center gap-1.5" key={index}>
          <div className="min-w-0">
            <FieldControl field={field.key} onChange={(next) => write(pairs.map((item, at) => (at === index ? [next, item[1] ?? null] : item)))} value={pair[0] ?? emptyValue(field.key)} />
          </div>
          <ArrowRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <FieldControl field={field.value} onChange={(next) => write(pairs.map((item, at) => (at === index ? [item[0] ?? null, next] : item)))} value={pair[1] ?? emptyValue(field.value)} />
          </div>
          <Button className="shrink-0 text-muted-foreground" onClick={() => write(pairs.filter((_, at) => at !== index))} size="icon-xs" title="Remove this entry" variant="ghost">
            <X />
          </Button>
        </div>
      ))}
      <Button
        className="w-fit text-muted-foreground"
        onClick={() => write([...pairs, [emptyValue(field.key), emptyValue(field.value)]])}
        size="xs"
        variant="ghost"
      >
        <Plus data-icon="inline-start" />
        {pairs.length ? "Entry" : "Add an entry"}
      </Button>
    </div>
  );
}

/**
 * A row of values, which is both a list and — with `chain` — a linked list.
 *
 * One control for both because they are entered identically and differ only in
 * what they mean, so the difference is drawn rather than built: a chain gets
 * arrows between its cells and a terminating null, and reads left to right as
 * the thing it will become on the canvas. Someone typing `3 2 0 -4` into it can
 * already see the list they are about to get.
 *
 * The paste affordance is not a nicety. Every problem statement on the internet
 * states its input as `[2,7,11,15]`, and the first thing anybody does is copy
 * that — so pasting it into any cell fills the whole row.
 */
function SequenceEditor({ element, value, onChange, chain = false, container = "list" }: { element: InputField; value: InputValue[]; onChange(value: InputValue[]): void; chain?: boolean; container?: ListContainer }) {
  const set = (index: number, next: InputValue) => onChange(value.map((item, at) => (at === index ? next : item)));
  /* A chain draws its own arrows and needs no brackets. Everything else wears
     the ones it will be written in, so a set does not look like a list. */
  const brackets = chain || container === "list" ? null : CONTAINER_LABEL[container];
  const numeric = element.type.kind === "int" || element.type.kind === "float";

  const paste = (index: number, text: string) => {
    // Only intercept a paste that is obviously a whole list. A pasted `42` is
    // someone filling in one cell and must stay one cell.
    const trimmed = text.trim();
    if (!/^\[.*\]$/s.test(trimmed) && !/[,\s]/.test(trimmed)) return false;
    const parts = trimmed.replace(/^\[|\]$/g, "").split(/[,\s]+/).filter(Boolean);
    if (parts.length < 2) return false;
    const parsed = parts.map((part) => {
      const clean = part.replace(/^["']|["']$/g, "");
      if (!numeric) return clean;
      const asNumber = Number(clean);
      return Number.isFinite(asNumber) ? asNumber : 0;
    });
    onChange(index === 0 && value.length <= 1 ? parsed : [...value.slice(0, index), ...parsed, ...value.slice(index + 1)]);
    return true;
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {brackets && <span aria-hidden className="font-mono text-ui text-muted-foreground">{container === "deque" ? "deque[" : brackets.open}</span>}
      {value.map((item, index) => (
        <div className="flex items-center gap-1" key={index}>
          <Cell
            numeric={numeric}
            onChange={(next) => set(index, next)}
            onPaste={(text) => paste(index, text)}
            onRemove={() => onChange(value.filter((_, at) => at !== index))}
            value={item}
          />
          {chain && <span aria-hidden className="text-ui-sm text-muted-foreground">&rarr;</span>}
        </div>
      ))}
      {chain && <span className="font-mono text-ui-sm text-muted-foreground">{value.length ? "None" : ""}</span>}
      {brackets && <span aria-hidden className="font-mono text-ui text-muted-foreground">{brackets.close}</span>}
      <Button
        className="text-muted-foreground"
        onClick={() => onChange([...value, emptyValue(element)])}
        size="icon-xs"
        title={chain ? "Append a node" : "Append an item"}
        variant="ghost"
      >
        <Plus />
      </Button>
      {value.length === 0 && <span className="text-ui-sm text-muted-foreground">{chain ? "empty — this is None" : "empty list"}</span>}
    </div>
  );
}

/**
 * A binary tree, in level order with holes.
 *
 * LeetCode's own notation, because that is the notation every tree problem in
 * the world states its input in and a learner should be able to paste it. The
 * one thing added is that a hole is a *drawn* hole — a struck-through cell, not
 * an empty box — because the entire class of bug this control exists to prevent
 * is entering a missing child as a zero.
 */
function TreeEditor({ element, value, onChange }: { element: InputField; value: InputValue[]; onChange(value: InputValue[]): void }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        {value.map((item, index) => (
          <div className="flex items-center" key={index}>
            {item === null ? (
              <button
                className="flex h-7 w-11 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:bg-muted"
                onClick={() => onChange(value.map((entry, at) => (at === index ? 0 : entry)))}
                title="This child is absent. Click to give it a value."
                type="button"
              >
                <CircleSlash className="size-3" />
              </button>
            ) : (
              <Cell
                numeric={element.type.kind !== "string"}
                onChange={(next) => onChange(value.map((entry, at) => (at === index ? next : entry)))}
                onNull={() => onChange(value.map((entry, at) => (at === index ? null : entry)))}
                onPaste={(text) => {
                  const trimmed = text.trim();
                  if (!/^\[.*\]$/s.test(trimmed)) return false;
                  const parts = trimmed.replace(/^\[|\]$/g, "").split(/[,\s]+/).filter(Boolean);
                  if (parts.length < 2) return false;
                  onChange(parts.map((part) => (/^(null|none)$/i.test(part) ? null : Number(part) || 0)));
                  return true;
                }}
                onRemove={() => onChange(value.filter((_, at) => at !== index))}
                value={item}
              />
            )}
          </div>
        ))}
        <Button className="text-muted-foreground" onClick={() => onChange([...value, value.length ? null : 0])} size="icon-xs" title="Append a slot" variant="ghost">
          <Plus />
        </Button>
      </div>
      <p className="mt-1.5 text-ui-sm text-muted-foreground">
        {value.length ? "Level order, left to right. A struck cell is an absent child." : "empty — this is None. Paste a level-order array like [3,9,20,null,null,15,7]."}
      </p>
    </div>
  );
}

/** A grid, drawn as one. Rows are added and removed as rows, because a matrix
 *  entered as a flat list of lists is the other half of the same problem this
 *  form exists to solve. */
function GridEditor({ field, value, onChange }: { field: InputField; value: InputValue[]; onChange(value: InputValue[]): void }) {
  const width = Math.max(1, ...value.map((row) => (Array.isArray(row) ? row.length : 0)));
  const element = field.type.kind === "list" ? field.type.of : field;
  return (
    <div className="flex flex-col gap-1">
      {value.map((row, rowIndex) => (
        <div className="flex items-center gap-1" key={rowIndex}>
          <SequenceEditor
            element={element}
            onChange={(next) => onChange(value.map((entry, at) => (at === rowIndex ? next : entry)))}
            value={Array.isArray(row) ? row : []}
          />
          <Button className="text-muted-foreground" onClick={() => onChange(value.filter((_, at) => at !== rowIndex))} size="icon-xs" title="Remove row" variant="ghost">
            <Minus />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button
          onClick={() => onChange([...value, Array.from({ length: value.length ? width : 1 }, () => emptyValue(element))])}
          size="xs"
          variant="ghost"
        >
          <Grid3x3 data-icon="inline-start" />
          Add row
        </Button>
        {value.length > 0 && <span className="text-ui-sm text-muted-foreground">{value.length} × {width}</span>}
      </div>
    </div>
  );
}

/** One cell. Small, monospaced, and sized to its content so a row of them reads
 *  as the array it stands for rather than as a form. */
function Cell({ value, numeric, onChange, onRemove, onPaste, onNull }: {
  value: InputValue;
  numeric: boolean;
  onChange(value: InputValue): void;
  onRemove(): void;
  onPaste(text: string): boolean;
  onNull?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const text = value === null ? "" : String(value);
  return (
    <span className="relative inline-flex">
      <input
        className={cn(
          "h-7 rounded-md border border-input bg-transparent px-1.5 text-center font-mono text-ui outline-none transition-colors",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
        )}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(numeric ? (Number(event.target.value) || 0) : event.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(event) => {
          // Backspace on an already-empty cell removes it, so a row can be
          // shortened without reaching for the mouse.
          if (event.key === "Backspace" && text === "") { event.preventDefault(); onRemove(); }
          if (event.key === "n" && (event.metaKey || event.ctrlKey) && onNull) { event.preventDefault(); onNull(); }
        }}
        onPaste={(event) => {
          if (onPaste(event.clipboardData.getData("text"))) event.preventDefault();
        }}
        style={{ width: `${Math.max(2.75, Math.min(8, text.length * 0.62 + 1.6))}rem` }}
        value={text}
      />
      {focused && (
        <button
          className="absolute -right-1 -top-1 z-10 rounded-full bg-muted p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          onMouseDown={(event) => { event.preventDefault(); onRemove(); }}
          tabIndex={-1}
          title="Remove"
          type="button"
        >
          <Circle className="size-2" />
        </button>
      )}
    </span>
  );
}
