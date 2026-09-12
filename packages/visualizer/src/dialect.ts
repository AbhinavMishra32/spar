import type { Language } from "@spar/domain";
import type { EntryPoint, InputDraft, InputSpec } from "./inputs.js";
import type { DeclaredSignature } from "./language.js";
import { isRef, type Value } from "./trace.js";
import { pythonDialect } from "./languages/python/index.js";

/**
 * The half of a language adapter that has no process behind it.
 *
 * The renderer needs to compose a call, spell a value, name a file and colour a
 * grammar; it must never need to know what binary produces a trace. Splitting
 * the adapter in two along that line is what lets the same package be bundled
 * into a sandboxed renderer and loaded in the main process without either side
 * carrying the other's dependencies — and it is why nothing in this file
 * imports `node:` anything.
 *
 * Adding a language means adding a dialect here and a host adapter beside it.
 * Neither the canvas nor the input form changes.
 */
export type Dialect = {
  id: Language;
  label: string;
  /** The tab name for the learner's code, e.g. `algorithm.py`. */
  fileName: string;
  /** Monaco's identifier for the grammar, which is not always Spar's name. */
  editorLanguage: string;
  /** Helpers the runtime injects, which an exported script must carry itself. */
  prelude: string;
  starter: string;
  /** How this language spells the three literals JSON disagrees with. */
  literals: { null: string; true: string; false: string };
  specFromSignature(signature: DeclaredSignature): InputSpec;
  composeSetup(entry: EntryPoint, draft: InputDraft): string;
};

const DIALECTS: Partial<Record<Language, Dialect>> = { python: pythonDialect };

export function dialect(id: Language): Dialect | undefined {
  return DIALECTS[id];
}

/** Every language the visualiser can run, for the picker. One today; the picker
 *  is written against this list rather than against Python, so it stays true
 *  when that changes. */
export function dialects(): Dialect[] {
  return Object.values(DIALECTS).filter((entry): entry is Dialect => Boolean(entry));
}

export function canVisualize(id: Language): boolean {
  return Boolean(DIALECTS[id]);
}

/**
 * How a value reads in this language.
 *
 * The trace model carries JSON, but a Python learner should never see `null`
 * where their program has `None` — the inspector is meant to read like the file
 * beside it. Strings keep their quotes so an empty string is visible and `"3"`
 * is distinguishable from `3`, which is the failure most worth catching early.
 */
export function formatIn(id: Language, value: Value | undefined): string {
  const literals = DIALECTS[id]?.literals;
  if (value === undefined) return "—";
  if (value === null) return literals?.null ?? "null";
  if (typeof value === "boolean") return (value ? literals?.true : literals?.false) ?? String(value);
  if (isRef(value)) return `@${value.ref}`;
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
