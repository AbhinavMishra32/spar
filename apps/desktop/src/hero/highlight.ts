import type { CodeSlots } from "../shared/codeTheme";

/**
 * `@/lib/highlight`, for the film.
 *
 * The app parses code blocks with Tree-sitter and ships a grammar per language
 * — fourteen megabytes of wasm in all. Every block the film shows is Python, so
 * this colours Python with a scanner and leaves anything else plain. Same
 * exports, same contract: the spans concatenate back to the input exactly.
 */
export type Span = { text: string; slot: keyof CodeSlots | null };

const PYTHON = new Set(["py", "python"]);

export const grammarFor = (tag: string): string | null => (PYTHON.has(tag.trim().toLowerCase()) ? "python" : null);

const KEYWORDS = new Set(["and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield"]);

export async function highlight(source: string, tag: string): Promise<Span[]> {
  if (!grammarFor(tag)) return [{ text: source, slot: null }];
  const spans: Span[] = [];
  const pattern = /(#[^\n]*)|("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|([()[\]{}:,.=<>+\-*/%!&|^~@]+)|(\s+|.)/g;
  for (const match of source.matchAll(pattern)) {
    const [text, comment, string, number, word, punctuation] = match;
    const next = source.slice(match.index + text.length).match(/^\s*\(/);
    const slot: Span["slot"] = comment ? "comment"
      : string ? "string"
      : number ? "number"
      : word ? (KEYWORDS.has(word) ? "keyword" : next ? "entity" : "variable")
      : punctuation ? "punctuation"
      : null;
    const last = spans.at(-1);
    if (last && last.slot === slot) last.text += text;
    else spans.push({ text, slot });
  }
  return spans;
}
