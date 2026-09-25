import { useEffect, useState } from "react";

/**
 * Monaco, as the film sees it.
 *
 * The film never needs a language service, a model, workers or a text buffer —
 * only the editor's picture: its gutter, its current-line band, its colours and
 * a caret. So this draws that picture from the same palette and metrics the app
 * hands Monaco (`lib/monaco-theme.ts`, the options in `Workspace`) and nothing
 * else. It is aliased in for `@monaco-editor/react` by `vite.hero.config.ts`,
 * which keeps several megabytes of editor out of the landing page.
 *
 * Typing comes from the director, which is handed this editor's `onChange` —
 * the same callback Monaco would call — so the workspace sees every keystroke
 * as an edit and marks the file dirty the way it does in the app.
 */

const DARK = {
  background: "#141414",
  foreground: "#c9d1d9",
  lineHighlight: "#1e1e1e",
  lineNumber: "#6b6b6b",
  lineNumberActive: "#fafafa",
  comment: "#8b949e",
  keyword: "#ff8177",
  string: "#8bd891",
  number: "#79c0ff",
  punctuation: "#b3bac2",
};

type Props = {
  value?: string;
  language?: string;
  onChange?: (value: string | undefined) => void;
  options?: { fontSize?: number; lineHeight?: number; padding?: { top?: number } };
};

/** Where the director reaches in. One editor is ever on screen in the film. */
export const filmEditor: { current: { type(value: string, caret: number): void; blur(): void } | null } = { current: null };

export default function StaticEditor({ value = "", onChange, options }: Props) {
  const [caret, setCaret] = useState<number | null>(null);
  const fontSize = options?.fontSize ?? 12.5;
  const lineHeight = Math.round(fontSize * (options?.lineHeight ?? 1.65));
  const top = options?.padding?.top ?? 12;

  useEffect(() => {
    filmEditor.current = {
      type(next, position) {
        setCaret(position);
        onChange?.(next);
      },
      blur() { setCaret(null); },
    };
    return () => { filmEditor.current = null; };
  }, [onChange]);

  const lines = value.replace(/\n$/, "").split("\n");
  if (value.endsWith("\n")) lines.push("");
  const caretLine = caret === null ? -1 : value.slice(0, caret).split("\n").length - 1;
  const caretColumn = caret === null ? 0 : caret - value.lastIndexOf("\n", caret - 1) - 1;

  return (
    <div
      aria-hidden
      className="relative h-full overflow-hidden"
      data-film="editor"
      style={{ background: DARK.background, color: DARK.foreground, fontFamily: "SF Mono, ui-monospace, SFMono-Regular, Menlo, monospace", fontSize, lineHeight: `${lineHeight}px`, fontVariantLigatures: "normal" }}
    >
      <div style={{ paddingTop: top }}>
        {lines.map((line, index) => (
          <div
            key={index}
            className="relative flex"
            style={{ height: lineHeight, background: index === caretLine ? DARK.lineHighlight : undefined }}
          >
            <span
              className="shrink-0 text-right tabular-nums select-none"
              style={{ width: 64, paddingRight: 26, color: index === caretLine ? DARK.lineNumberActive : DARK.lineNumber }}
            >
              {index + 1}
            </span>
            <span className="relative whitespace-pre">
              {tokenize(line).map((token, part) => (
                <span key={part} style={{ color: token.color, fontStyle: token.italic ? "italic" : undefined }}>{token.text}</span>
              ))}
              {index === caretLine && (
                <span
                  className="hero-caret absolute"
                  style={{ top: 2, width: 2, background: "#fafafa", left: `${caretColumn}ch`, height: lineHeight - 4 }}
                />
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Python, coloured the way Monaco's Monarch grammar colours it ----------- */

const KEYWORDS = new Set(["and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield"]);

function tokenize(line: string): Array<{ text: string; color: string; italic?: boolean }> {
  const out: Array<{ text: string; color: string; italic?: boolean }> = [];
  const pattern = /(#.*$)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([()[\]{}:,.=<>+\-*/%!]+)|(\s+)|(.)/g;
  for (const match of line.matchAll(pattern)) {
    const [text, comment, string, number, word, punctuation] = match;
    if (comment) out.push({ text, color: DARK.comment, italic: true });
    else if (string) out.push({ text, color: DARK.string });
    else if (number) out.push({ text, color: DARK.number });
    else if (word) out.push({ text, color: KEYWORDS.has(word) ? DARK.keyword : DARK.foreground });
    else if (punctuation) out.push({ text, color: DARK.punctuation });
    else out.push({ text, color: DARK.foreground });
  }
  return out;
}
