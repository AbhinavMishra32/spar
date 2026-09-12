import { Language, Parser, type Node } from "web-tree-sitter";

import type { CodeSlots } from "../../shared/codeTheme";

/**
 * Syntax highlighting with Tree-sitter.
 *
 * Monaco's own tokenizer is a Monarch grammar — a bank of regexes — and it
 * cannot tell a function call from a variable, a type from an identifier, or a
 * parameter from a local, because it never builds a tree. Tree-sitter parses,
 * so the classification comes from the node's place in the syntax rather than
 * from what it looks like.
 *
 * The grammars are the ones VS Code ships, loaded lazily: a project that never
 * shows Ruby never pays for the Ruby grammar, and the largest of them is five
 * megabytes. `@vscode/tree-sitter-wasm` publishes the compiled grammars but no
 * highlight queries, so the mapping from tree to colour is ours — see `slotFor`.
 */
export type Span = { text: string; slot: keyof CodeSlots | null };

/* Vite resolves these to URLs at build time and copies the payload into the
   bundle, so they load over the app's own protocol rather than the network. */
const GRAMMARS: Record<string, () => Promise<string>> = {
  typescript: () => import("@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm?url").then((m) => m.default),
  tsx: () => import("@vscode/tree-sitter-wasm/wasm/tree-sitter-tsx.wasm?url").then((m) => m.default),
  javascript: () => import("@vscode/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm?url").then((m) => m.default),
  cpp: () => import("@vscode/tree-sitter-wasm/wasm/tree-sitter-cpp.wasm?url").then((m) => m.default),
  python: () => import("@vscode/tree-sitter-wasm/wasm/tree-sitter-python.wasm?url").then((m) => m.default),
  go: () => import("@vscode/tree-sitter-wasm/wasm/tree-sitter-go.wasm?url").then((m) => m.default),
  rust: () => import("@vscode/tree-sitter-wasm/wasm/tree-sitter-rust.wasm?url").then((m) => m.default),
  java: () => import("@vscode/tree-sitter-wasm/wasm/tree-sitter-java.wasm?url").then((m) => m.default),
  ruby: () => import("@vscode/tree-sitter-wasm/wasm/tree-sitter-ruby.wasm?url").then((m) => m.default),
  bash: () => import("@vscode/tree-sitter-wasm/wasm/tree-sitter-bash.wasm?url").then((m) => m.default),
  css: () => import("@vscode/tree-sitter-wasm/wasm/tree-sitter-css.wasm?url").then((m) => m.default),
};

/** Fence tags a learner or an agent actually writes, onto the grammars above. */
const ALIASES: Record<string, string> = {
  ts: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  "c++": "cpp", cc: "cpp", cxx: "cpp", h: "cpp", hpp: "cpp", c: "cpp", cu: "cpp", hip: "cpp",
  py: "python", rs: "rust", rb: "ruby", golang: "go",
  sh: "bash", shell: "bash", zsh: "bash", console: "bash",
};

export const grammarFor = (tag: string): string | null => {
  const key = tag.trim().toLowerCase();
  const resolved = ALIASES[key] ?? key;
  return resolved in GRAMMARS ? resolved : null;
};

const runtime = () =>
  import("web-tree-sitter/web-tree-sitter.wasm?url").then((module) => module.default);

let started: Promise<void> | null = null;
const loaded = new Map<string, Promise<Language | null>>();

async function parserFor(grammar: string): Promise<Parser | null> {
  /* The runtime is a sibling of the grammars and is resolved the same way. A
     bare `new URL(..., import.meta.url)` does not work here: the package does
     not export the wasm as a subpath, so Vite has to be told about it with the
     `?url` suffix like every other asset. */
  started ??= runtime().then((url) => Parser.init({ locateFile: () => url }));
  try {
    await started;
  } catch (cause) {
    console.error("[construct] tree-sitter runtime did not start:", cause);
    return null;
  }

  let language = loaded.get(grammar);
  if (!language) {
    language = GRAMMARS[grammar]!()
      .then((url) => Language.load(url))
      /* Reported rather than swallowed. A grammar that fails to load makes every
         snippet in the app render as plain text, which looks like a styling
         choice rather than a failure — this is the only way anybody finds out. */
      .catch((cause: unknown) => {
        console.error(`[construct] ${grammar} grammar did not load:`, cause);
        return null;
      });
    loaded.set(grammar, language);
  }

  const resolved = await language;
  if (!resolved) return null;
  const parser = new Parser();
  parser.setLanguage(resolved);
  return parser;
}

/**
 * A leaf node's colour.
 *
 * Ordered by how specific the evidence is. Node type names are remarkably
 * consistent across grammars — every one calls a comment `comment` and a string
 * something containing `string` — so most of this is one shared table rather
 * than a rule per language.
 *
 * The keyword case is the one worth explaining: grammars do not have a
 * `keyword` node. Words like `if`, `return` and `const` appear as *anonymous*
 * nodes whose type is the literal text, so "anonymous and alphabetic" is what a
 * keyword actually is in a Tree-sitter tree.
 */
function slotFor(node: Node): keyof CodeSlots | null {
  const type = node.type;

  if (type.includes("comment")) return "comment";
  if (type.includes("string") || type === "character_literal" || type.includes("char_literal")) return "string";
  if (type.includes("number") || type.includes("integer") || type.includes("float")) return "number";

  if (!node.isNamed) {
    /* Anonymous: either a keyword or punctuation, told apart by whether it is
       made of letters. */
    return /^[\p{L}_]+$/u.test(type) ? "keyword" : /^[=+\-*/%<>!&|^~?:]+$/.test(type) ? "operator" : "punctuation";
  }

  if (type.includes("type_identifier") || type === "primitive_type" || type.includes("type_specifier")) return "type";

  if (type === "true" || type === "false" || type === "null" || type === "nil" || type === "none") return "constant";

  if (type.includes("identifier")) {
    const parent = node.parent;
    /* A call's function is the interesting identifier on a line, and the one
       thing a regex tokenizer can never find reliably. */
    if (parent && (parent.type.includes("call") || parent.type === "function_declarator")) {
      return parent.childForFieldName("function") === node || parent.firstNamedChild === node ? "entity" : "variable";
    }
    if (parent?.type.includes("function_definition") || parent?.type.includes("function_declaration")) return "entity";
    /* SCREAMING_CASE is a constant in every language that has the convention. */
    if (/^[A-Z][A-Z0-9_]{1,}$/.test(node.text)) return "constant";
    /* Capitalised is a type in most of them. */
    if (/^[A-Z]/.test(node.text)) return "type";
    return "variable";
  }

  return null;
}

/**
 * Parses and returns the source as coloured spans.
 *
 * Walks leaves in document order and emits the gaps between them verbatim, so
 * whitespace and anything the grammar did not classify survive untouched and
 * the concatenated spans are byte-identical to the input. Returns a single
 * uncoloured span when the language is unknown or the grammar fails to load,
 * which is what makes this safe to call for any fence tag at all.
 */
export async function highlight(source: string, tag: string): Promise<Span[]> {
  const grammar = grammarFor(tag);
  if (!grammar) return [{ text: source, slot: null }];

  const parser = await parserFor(grammar).catch(() => null);
  if (!parser) return [{ text: source, slot: null }];

  try {
    const tree = parser.parse(source);
    if (!tree) return [{ text: source, slot: null }];

    const spans: Span[] = [];
    let cursor = 0;
    const visit = (node: Node) => {
      if (node.childCount === 0) {
        if (node.startIndex > cursor) spans.push({ text: source.slice(cursor, node.startIndex), slot: null });
        if (node.endIndex > node.startIndex) {
          spans.push({ text: source.slice(node.startIndex, node.endIndex), slot: slotFor(node) });
          cursor = node.endIndex;
        }
        return;
      }
      for (let index = 0; index < node.childCount; index += 1) {
        const child = node.child(index);
        if (child) visit(child);
      }
    };

    visit(tree.rootNode);
    if (cursor < source.length) spans.push({ text: source.slice(cursor), slot: null });
    tree.delete();
    parser.delete();
    return spans;
  } catch {
    parser.delete();
    return [{ text: source, slot: null }];
  }
}
