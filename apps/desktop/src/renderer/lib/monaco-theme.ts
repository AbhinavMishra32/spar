import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

/**
 * Monaco needs opaque hex up front and is configured before the stylesheet has
 * necessarily applied, so the palette is declared literally here rather than
 * probed from CSS. These values mirror the oklch tokens in theme.css.
 */
type Palette = {
  background: string;
  foreground: string;
  lineHighlight: string;
  lineNumber: string;
  lineNumberActive: string;
  border: string;
  popover: string;
  selection: string;
  comment: string;
  keyword: string;
  type: string;
  fn: string;
  string: string;
  number: string;
  punctuation: string;
};

const LIGHT: Palette = {
  background: "#fafafa",
  foreground: "#33363b",
  lineHighlight: "#f2f2f2",
  lineNumber: "#a3a3a3",
  lineNumberActive: "#0a0a0a",
  border: "#e8e8e8",
  popover: "#ffffff",
  selection: "#dcdcdc",
  comment: "#727780",
  keyword: "#ce2734",
  type: "#7b4bd2",
  fn: "#1a6fc9",
  string: "#185a96",
  number: "#1660b5",
  punctuation: "#6f747c",
};

const DARK: Palette = {
  background: "#141414",
  foreground: "#c9d1d9",
  lineHighlight: "#1e1e1e",
  lineNumber: "#6b6b6b",
  lineNumberActive: "#fafafa",
  border: "#2a2a2a",
  popover: "#242424",
  selection: "#333333",
  comment: "#8b949e",
  keyword: "#ff8177",
  type: "#d2a8ff",
  fn: "#66b8ff",
  string: "#8bd891",
  number: "#79c0ff",
  punctuation: "#b3bac2",
};

export const EDITOR_THEME_LIGHT = "spar-light";
export const EDITOR_THEME_DARK = "spar-dark";

/** Monaco token rules want bare hex without the leading `#`. */
const bare = (value: string) => value.replace("#", "");

function build(palette: Palette, dark: boolean): Monaco.editor.IStandaloneThemeData {
  return {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "", foreground: bare(palette.foreground) },
      { token: "comment", foreground: bare(palette.comment), fontStyle: "italic" },
      { token: "keyword", foreground: bare(palette.keyword) },
      { token: "type", foreground: bare(palette.type) },
      { token: "type.identifier", foreground: bare(palette.type) },
      { token: "identifier.function", foreground: bare(palette.fn) },
      { token: "string", foreground: bare(palette.string) },
      { token: "number", foreground: bare(palette.number) },
      { token: "delimiter", foreground: bare(palette.punctuation) },
      { token: "operator", foreground: bare(palette.punctuation) },
    ],
    colors: {
      "editor.background": palette.background,
      "editor.foreground": palette.foreground,
      "editorGutter.background": palette.background,
      "editor.lineHighlightBackground": palette.lineHighlight,
      "editor.selectionBackground": palette.selection,
      "editorLineNumber.foreground": palette.lineNumber,
      "editorLineNumber.activeForeground": palette.lineNumberActive,
      "editorIndentGuide.background1": palette.border,
      "editorWidget.background": palette.popover,
      "editorWidget.border": palette.border,
      "editorSuggestWidget.background": palette.popover,
      "scrollbarSlider.background": `${palette.border}cc`,
      "scrollbarSlider.hoverBackground": palette.selection,
      "editorOverviewRuler.border": palette.background,
    },
  };
}

export function defineEditorThemes(monaco: typeof Monaco): void {
  monaco.editor.defineTheme(EDITOR_THEME_LIGHT, build(LIGHT, false));
  monaco.editor.defineTheme(EDITOR_THEME_DARK, build(DARK, true));
}
