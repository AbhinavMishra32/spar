import { useState } from "react";
import { Braces, ChevronRight, Layers, ListTree, Terminal, X } from "lucide-react";
import type { Language } from "@spar/domain";
import { formatIn, isRef, sameValue, type HeapObject, type Snapshot, type Trace } from "@spar/visualizer";
import { cn } from "@/lib/utils";
import { colorFor } from "@/lib/visualizer";
import { Button } from "@/components/ui/button";

/**
 * The debugger half: everything the picture cannot show.
 *
 * A canvas is good at shape and bad at four things a debugger has to be good
 * at — the exact value of a scalar, who called whom, what was printed, and the
 * innards of an object nobody drew. Those are these four tabs, and they exist
 * as tabs rather than as a wall of panels because on any given step a learner
 * wants precisely one of them, and a debugger that shows all four at once has
 * spent its screen saying nothing.
 *
 * Every panel here reads the same two snapshots the canvas does — this step and
 * the one before — so "changed" means the same thing in the variable list as it
 * does on the canvas. That agreement is the point: a learner who sees `i`
 * highlighted here and a cell highlighted there has to be able to trust that
 * those are the same claim.
 */

type Tab = "variables" | "stack" | "console" | "heap";

const TABS: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "variables", label: "Variables", icon: Braces },
  { id: "stack", label: "Call stack", icon: ListTree },
  { id: "console", label: "Console", icon: Terminal },
  { id: "heap", label: "Heap", icon: Layers },
];

export function Inspector({
  frame,
  previous,
  trace,
  language,
  selected,
  onSelect,
}: {
  frame: Snapshot | undefined;
  previous: Snapshot | undefined;
  trace: Trace | null;
  language: Language;
  selected: string | null;
  onSelect(id: string | null): void;
}) {
  const [tab, setTab] = useState<Tab>("variables");
  const locals = Object.entries(frame?.locals ?? {});
  const names = locals.map(([name]) => name);
  /* The console shows the whole run's output rather than output-so-far. A
     learner scrubbing the timeline wants to see what their program printed, and
     watching it truncate as they step backwards is a puzzle about the debugger
     rather than about their code. The frame's own output is what drives the
     unread dot, so stepping still tells you *when* something was printed. */
  const output = trace?.output || frame?.output || "";

  const counts: Record<Tab, number | null> = {
    variables: locals.length,
    stack: frame?.stack.length ?? 0,
    console: null,
    heap: Object.keys(frame?.heap ?? {}).length,
  };

  return (
    <section className="flex h-full min-h-0 flex-col border-t border-border">
      <div className="flex items-center gap-1 px-2.5 pt-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2 text-ui font-medium outline-none transition-colors",
              "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
              tab === id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            key={id}
            onClick={() => setTab(id)}
            type="button"
          >
            <Icon className="size-3.5" />
            {label}
            {counts[id] !== null && <span className="rounded bg-muted px-1 text-ui-sm tabular-nums text-muted-foreground">{counts[id]}</span>}
            {/* Something was printed on this exact step. */}
            {id === "console" && frame?.output && previous && frame.output !== previous.output && (
              <span aria-label="printed on this step" className="size-1.5 rounded-full bg-[var(--trace-change)]" />
            )}
          </button>
        ))}
        <span className="ml-auto pr-1 text-ui-sm text-muted-foreground">
          {frame?.event === "call" ? "State on entering the call" : frame?.event === "return" ? "State as the call returns" : "State after the highlighted line"}
        </span>
      </div>

      <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2.5">
        {!frame && <p className="py-6 text-center text-ui text-muted-foreground">Run your code to inspect it step by step.</p>}

        {frame && tab === "variables" && (
          <div className="flex flex-wrap gap-1.5">
            {locals.map(([name, value]) => {
              const changed = Boolean(previous) && !sameValue(previous?.locals[name], value);
              const target = isRef(value) ? frame.heap[value.ref] : undefined;
              return (
                <button
                  className={cn(
                    "group flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left transition-colors",
                    changed ? "border-[var(--trace-change)] bg-[var(--trace-change)]/5" : "border-border hover:border-border-strong",
                    isRef(value) ? "cursor-pointer" : "cursor-default",
                  )}
                  key={name}
                  onClick={() => isRef(value) && onSelect(value.ref === selected ? null : value.ref)}
                  type="button"
                >
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: colorFor(names, name) }} />
                  <span className="font-mono text-ui font-medium">{name}</span>
                  {isRef(value) ? (
                    <span className="flex items-center gap-1 font-mono text-ui text-muted-foreground">
                      <ChevronRight className="size-3" />
                      {target ? `${target.type}` : "object"}
                      <span className="text-ui-sm">@{value.ref}</span>
                    </span>
                  ) : (
                    <span className="font-mono text-ui tabular-nums text-muted-foreground">{formatIn(language, value)}</span>
                  )}
                </button>
              );
            })}
            {!locals.length && <p className="text-ui text-muted-foreground">Nothing is in scope here.</p>}
          </div>
        )}

        {frame && tab === "stack" && (
          <div className="flex flex-col gap-0.5">
            {/* Innermost last, which is how a stack trace reads and how the
                recursion actually nests. The active frame is the one the
                highlighted line is in. */}
            {frame.stack.map((entry, index) => {
              const active = index === frame.stack.length - 1;
              return (
                <div
                  className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-ui", active ? "bg-accent" : "text-muted-foreground")}
                  key={`${entry.name}-${index}`}
                  style={{ marginLeft: `${Math.min(index, 8) * 0.75}rem` }}
                >
                  <span className="font-mono text-ui-sm tabular-nums opacity-60">{index}</span>
                  <span className="font-mono font-medium">{entry.name}()</span>
                  <span className="font-mono text-ui-sm opacity-70">line {entry.line}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-ui-sm opacity-70">{Object.keys(entry.locals).join(", ")}</span>
                  {active && <span className="shrink-0 rounded bg-background/60 px-1 text-ui-sm font-medium">active</span>}
                </div>
              );
            })}
            {!frame.stack.length && <p className="text-ui text-muted-foreground">Module level — nothing on the stack.</p>}
          </div>
        )}

        {frame && tab === "console" && (
          <pre className="whitespace-pre-wrap break-words font-mono text-ui text-foreground">
            {output || <span className="text-muted-foreground">Nothing printed. Use print() to see output here.</span>}
          </pre>
        )}

        {frame && tab === "heap" && (
          <div className="flex flex-col gap-0.5">
            {Object.values(frame.heap).map((object) => (
              <button
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui transition-colors",
                  selected === object.id ? "bg-accent" : "hover:bg-muted",
                )}
                key={object.id}
                onClick={() => onSelect(object.id === selected ? null : object.id)}
                type="button"
              >
                <span className="w-9 shrink-0 font-mono text-ui-sm text-muted-foreground">@{object.id}</span>
                <span className="w-24 shrink-0 truncate font-mono">{object.type}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-muted-foreground">{summarize(language, object)}</span>
              </button>
            ))}
            {!Object.keys(frame.heap).length && <p className="text-ui text-muted-foreground">No objects on the heap at this step.</p>}
          </div>
        )}
      </div>

      {selected && frame?.heap[selected] && (
        <div className="border-t border-border bg-[var(--color-background-surface-under)] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-ui-sm font-medium uppercase tracking-[0.08em] text-muted-foreground">Object</span>
            <span className="font-mono text-ui font-medium">{frame.heap[selected]?.type}</span>
            <span className="font-mono text-ui-sm text-muted-foreground">@{selected}</span>
            <Button className="ml-auto text-muted-foreground" onClick={() => onSelect(null)} size="icon-xs" variant="ghost">
              <X />
            </Button>
          </div>
          <pre className="app-scroll mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-ui-sm text-muted-foreground">
            {JSON.stringify(frame.heap[selected]?.fields ?? frame.heap[selected]?.items ?? frame.heap[selected]?.entries ?? {}, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}

/** One line about an object, for the heap list. Enough to recognise it by
 *  without opening it, which is what a heap list is for. */
/** The brackets a container is written in. A `set` summarised as `[1, 2]` is
 *  telling the learner it is a list, on the one panel whose job is to say what
 *  things actually are. */
const BRACKETS: Record<string, [string, string]> = {
  tuple: ["(", ")"],
  set: ["{", "}"],
  frozenset: ["frozenset({", "})"],
  deque: ["deque([", "])"],
};

function summarize(language: Language, object: HeapObject): string {
  if (object.items) {
    const [open, close] = BRACKETS[object.type] ?? ["[", "]"];
    return `${open}${object.items.slice(0, 8).map((item) => formatIn(language, item)).join(", ")}${object.items.length > 8 ? ", …" : ""}${close}`;
  }
  if (object.entries) return `{${object.entries.slice(0, 5).map(([key, value]) => `${formatIn(language, key)}: ${formatIn(language, value)}`).join(", ")}${object.entries.length > 5 ? ", …" : ""}}`;
  if (object.fields) return Object.entries(object.fields).map(([key, value]) => `${key}=${formatIn(language, value)}`).join(" ");
  return "";
}
