import { motion } from "motion/react";
import type { Language } from "@spar/domain";
import { formatIn, isRef, sameValue, type HeapObject, type Snapshot, type Value } from "@spar/visualizer";
import { cn } from "@/lib/utils";
import { layoutLinked, TraceGraph } from "./TraceGraph";
import { colorFor } from "@/lib/visualizer";

/**
 * One step of a run, drawn for a conversation.
 *
 * This exists because the visualiser page's canvas could not be made to behave
 * in here, and the reasons are worth writing down rather than rediscovering.
 * That canvas owns a pane: it holds drag offsets, it animates membership with
 * `AnimatePresence`, it sizes itself with `min-w-fit` and lays its objects down
 * a column on a grid that assumes room. Every one of those is right for a
 * debugger and wrong for a card in a message. Put it in a fixed box and it
 * either scrolls, clips, or draws the same object twice while one copy is
 * leaving and another is arriving.
 *
 * So this draws the same information with none of that. It is a pure function
 * of one frame, the frame before it, and what the agent asked to be shown:
 * every subject appears exactly once, keyed by identity; nothing is positioned
 * absolutely; the whole figure is laid out by flexbox and is therefore exactly
 * as big as it needs to be, which is what lets the card scale it to fit instead
 * of guessing.
 *
 * What it keeps from the canvas is the part that teaches: indices under
 * sequences, keys beside values, and — the important one — what changed since
 * the step before, marked. A learner can see a list; they cannot see that the
 * third cell is the one that just moved.
 */
export function TraceFigure({ focus = [], frame, language, previous }: {
  focus?: readonly string[] | undefined;
  frame: Snapshot;
  language: Language;
  previous: Snapshot | null;
}) {
  const subjects = subjectsFor(frame, focus);
  if (!subjects.length) {
    return <p className="px-4 text-ui text-[var(--transcript-step)]">Nothing is in scope on this step.</p>;
  }
  const names = Object.keys(frame.locals);
  /* Anything that points at anything is drawn as the structure it is, and only
     what is left over is drawn as boxes. This is the difference between seeing a
     tree and reading a node's fields one at a time. */
  const layout = layoutLinked(language, frame, rootsFor(frame, subjects.flatMap((subject) => (subject.kind === "object" ? [subject.key] : []))));
  const linked = new Set(layout?.nodes.map((node) => node.id) ?? []);
  const loose = subjects.filter((subject) => !linked.has(subject.key));
  return (
    <div className="flex max-w-[38rem] flex-col items-center gap-3 p-4">
      {layout && <TraceGraph changed={changedObjects(frame, previous, linked)} layout={layout} names={names} />}
      {loose.length > 0 && (
        <div className="flex flex-wrap items-start justify-center gap-2.5">
          {loose.map((subject) => (
            <Figure key={subject.key} language={language} names={names} previous={previous} subject={subject} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The objects to draw from, widened to whatever they hang off.
 *
 * Three calls into a traversal the only local is `node`, pointing at one leaf.
 * Drawing exactly that is drawing a single box with `"left" → None` in it — the
 * figure the learner complained about, and a fair description of a tree only if
 * you already know where you are in it. What they are asking is where this node
 * sits, and the answer is held one frame up, in the `tree` that reaches it.
 *
 * So any reference anywhere on the stack that can reach something already being
 * drawn is promoted to a root. It is bounded by reachability, so an unrelated
 * local in an outer frame is not dragged in, and it costs nothing on a frame
 * with no structures in it at all.
 */
function rootsFor(frame: Snapshot, ids: readonly string[]): string[] {
  if (!ids.length) return [...ids];
  const wanted = new Set(ids);
  const roots = new Set(ids);
  for (const value of Object.values(scopeOf(frame))) {
    if (!isRef(value) || roots.has(value.ref)) continue;
    const seen = new Set<string>();
    const queue = [value.ref];
    let reaches = false;
    while (queue.length && !reaches) {
      const id = queue.shift();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (wanted.has(id)) { reaches = true; break; }
      const object = frame.heap[id];
      if (!object) continue;
      for (const entry of [...(object.items ?? []), ...Object.values(object.fields ?? {}), ...(object.entries ?? []).map(([, item]) => item)]) {
        if (isRef(entry)) queue.push(entry.ref);
      }
    }
    /* Only when it reaches something on the page, and only as an addition —
       `layoutLinked` works out for itself which of these is actually on top. */
    if (reaches) roots.add(value.ref);
  }
  return [...roots];
}

/** Which of the drawn nodes hold something they did not hold a step ago. The
 *  node is the unit here rather than the field, because in a structure the
 *  question is which node changed, not which byte of it. */
function changedObjects(frame: Snapshot, previous: Snapshot | null, ids: ReadonlySet<string>): Set<string> {
  const changed = new Set<string>();
  if (!previous) return changed;
  for (const id of ids) {
    const before = previous.heap[id];
    if (!before) { changed.add(id); continue; }
    if (JSON.stringify(before) !== JSON.stringify(frame.heap[id])) changed.add(id);
  }
  return changed;
}

/** A thing worth drawing: a local holding a value, or a heap object with the
 *  names that point at it. Identity-keyed, which is the whole defence against
 *  the same object appearing twice under two different labels. */
export type Subject =
  | { kind: "scalar"; key: string; name: string; value: Value }
  | { kind: "object"; key: string; names: string[]; object: HeapObject };

/**
 * What to draw, resolved.
 *
 * The agent names things the way a person would — `counts`, `best`, sometimes an
 * id like `@n2` for a node three links down a list that has no name. All of
 * those resolve here so the tool schema never has to make it choose.
 *
 * Naming nothing that exists falls back to the whole local scope rather than to
 * an empty figure: a spotlight is the agent narrowing the picture, and a
 * narrowing that matches nothing should leave the picture alone, not delete it.
 */
export function subjectsFor(frame: Snapshot, focus: readonly string[] = []): Subject[] {
  /* Defensive about the argument as well as about the payload behind it. This
     is drawn from stored rows written by older builds, and a figure that throws
     takes the transcript — and the crash boundary above it — with it. */
  const wanted = (Array.isArray(focus) ? focus : []).filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
  const picked = wanted.length ? collect(frame, wanted) : [];
  return picked.length ? picked : collect(frame, Object.keys(frame.locals));
}

/**
 * Every name visible from this step, innermost first.
 *
 * Recursion is where structures are usually explained, and recursion is exactly
 * where the interesting name is not in scope: three calls into a traversal the
 * frame's locals are `node` and nothing else, while the root the learner is
 * asking about is `tree`, sitting in a frame further up the stack. Resolving
 * through the stack means the agent can spotlight `tree` at any depth and get
 * the whole tree with the current node marked on it — which is the picture.
 *
 * Innermost wins on a name collision, which is what the language does too.
 */
function scopeOf(frame: Snapshot): Record<string, Value> {
  const scope: Record<string, Value> = { ...frame.locals };
  for (const outer of [...frame.stack].reverse()) {
    for (const [name, value] of Object.entries(outer.locals)) if (!(name in scope)) scope[name] = value;
  }
  return scope;
}

function collect(frame: Snapshot, keys: readonly string[]): Subject[] {
  const subjects: Subject[] = [];
  const seen = new Set<string>();
  const scope = scopeOf(frame);
  for (const key of keys) {
    const id = key.startsWith("@") ? key.slice(1) : null;
    const local = scope[key];

    /* An object gathers every name pointing at it and is emitted once. Two
       aliases of one list are one box with two labels — which is also the only
       honest way to draw aliasing. */
    const target = id ?? (isRef(local) ? local.ref : frame.heap[key] ? key : null);
    if (target) {
      if (seen.has(target)) continue;
      const object = frame.heap[target];
      if (!object) continue;
      seen.add(target);
      subjects.push({
        kind: "object",
        key: target,
        names: Object.entries(scope).flatMap(([name, value]) => (isRef(value) && value.ref === target ? [name] : [])),
        object,
      });
      continue;
    }
    if (local === undefined || seen.has(`=${key}`)) continue;
    seen.add(`=${key}`);
    subjects.push({ kind: "scalar", key: `=${key}`, name: key, value: local });
  }
  return subjects;
}

function Figure({ language, names, previous, subject }: {
  language: Language;
  names: string[];
  previous: Snapshot | null;
  subject: Subject;
}) {
  if (subject.kind === "scalar") {
    const moved = Boolean(previous) && !sameValue(previous?.locals[subject.name], subject.value);
    return (
      <Card moved={moved}>
        <div className="flex items-baseline gap-2">
          <Label color={colorFor(names, subject.name)} text={subject.name} />
          <Reading moved={moved} text={formatIn(language, subject.value)} />
        </div>
      </Card>
    );
  }

  const { object } = subject;
  const before = previous?.heap[object.id];
  return (
    <Card moved={false}>
      <div className="flex items-baseline gap-2">
        {subject.names.length
          ? subject.names.map((name) => <Label color={colorFor(names, name)} key={name} text={name} />)
          : <span className="font-mono text-ui-sm text-[var(--transcript-step-mark)]">@{object.id}</span>}
        <span className="ml-auto pl-3 font-mono text-ui-sm text-[var(--transcript-step-mark)]">{object.type}</span>
      </div>

      {object.items && (
        /* Indices under a sequence and not under a set, because a set has none
           and implying otherwise is a lie the learner will act on. */
        <div className="mt-1.5 flex flex-wrap gap-1">
          {object.items.slice(0, 24).map((item, index) => (
            <Cell
              index={object.kind === "set" ? null : index}
              key={index}
              language={language}
              moved={Boolean(before) && !sameValue(before?.items?.[index], item)}
              value={item}
            />
          ))}
          {object.items.length > 24 && <More count={object.items.length - 24} />}
        </div>
      )}

      {object.entries && (
        <div className="mt-1.5 flex flex-col gap-0.5">
          {object.entries.slice(0, 10).map(([key, value], index) => (
            <Row
              changed={Boolean(before) && !sameValue(before?.entries?.[index]?.[1], value)}
              key={index}
              language={language}
              name={formatIn(language, key)}
              value={value}
            />
          ))}
          {object.entries.length > 10 && <More count={object.entries.length - 10} />}
        </div>
      )}

      {object.fields && Object.keys(object.fields).length > 0 && (
        <div className="mt-1.5 flex flex-col gap-0.5">
          {Object.entries(object.fields).slice(0, 8).map(([field, value]) => (
            <Row
              changed={Boolean(before) && !sameValue(before?.fields?.[field], value)}
              key={field}
              language={language}
              name={field}
              value={value}
            />
          ))}
        </div>
      )}

      {object.truncated && <p className="mt-1 text-ui-sm text-[var(--transcript-step-mark)]">preview — more than is shown</p>}
    </Card>
  );
}

function Card({ children, moved }: { children: React.ReactNode; moved: boolean }) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card px-3 py-2.5 transition-colors duration-300",
        moved ? "border-[var(--trace-change)]/45" : "border-border",
      )}
    >
      {children}
    </div>
  );
}

function Label({ color, text }: { color: string; text: string }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-ui font-medium">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {text}
    </span>
  );
}

/** A value that just changed arrives rather than appearing, and is warm for as
 *  long as it takes to notice. This is the one animation in the figure, and it
 *  is on the thing the caption is about. */
function Reading({ moved, text }: { moved: boolean; text: string }) {
  return (
    <motion.span
      animate={{ opacity: 1, y: 0 }}
      className={cn("font-mono text-[0.95rem] tabular-nums", moved ? "text-[var(--trace-change)]" : "text-foreground")}
      initial={moved ? { opacity: 0, y: -3 } : false}
      key={text}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
    >
      {text}
    </motion.span>
  );
}

function Cell({ index, language, moved, value }: { index: number | null; language: Language; moved: boolean; value: Value }) {
  return (
    <div className="flex flex-col items-center">
      <div
        className={cn(
          "min-w-9 rounded-lg border px-2 py-1 text-center font-mono text-ui tabular-nums transition-colors duration-300",
          moved ? "border-[var(--trace-change)]/60 text-[var(--trace-change)]" : "border-border text-foreground",
        )}
      >
        {formatIn(language, value)}
      </div>
      {index !== null && <span className="mt-0.5 font-mono text-[0.7rem] text-[var(--transcript-step-mark)]">{index}</span>}
    </div>
  );
}

function Row({ changed, language, name, value }: { changed: boolean; language: Language; name: string; value: Value }) {
  return (
    <div className="flex items-baseline gap-1.5 font-mono text-ui">
      <span className="text-[var(--transcript-step)]">{name}</span>
      <span className="text-[var(--transcript-step-mark)]">→</span>
      <span className={cn("tabular-nums", changed ? "text-[var(--trace-change)]" : "text-foreground")}>{formatIn(language, value)}</span>
    </div>
  );
}

function More({ count }: { count: number }) {
  return <span className="self-center font-mono text-ui-sm text-[var(--transcript-step-mark)]">+{count} more</span>;
}
