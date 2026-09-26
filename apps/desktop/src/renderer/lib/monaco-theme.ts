import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

import { SPAR_DARK, SPAR_LIGHT, type CodeSlots } from "../../shared/codeTheme";
import type { CodeFont } from "./code-font";
import { SEMANTIC_SLOTS } from "./monaco-semantic";

/**
 * The editor's theme, built from the same slots the transcript paints with.
 *
 * Monaco needs opaque hex up front and is configured before the stylesheet has
 * necessarily applied, so it reads the palette as data from `codeTheme` rather
 * than probing CSS. A snippet in chat and the same lines in the editor are one
 * picture: the slots are shared, and so is the classification — see
 * `monaco-semantic.ts`, which hands the editor the tree-sitter spans chat uses.
 */
export const EDITOR_THEME_LIGHT = "spar-light";
export const EDITOR_THEME_DARK = "spar-dark";

/** Monaco token rules want bare hex without the leading `#`. */
const bare = (value: string) => value.replace("#", "");

/** `#rrggbb` at an alpha, as the `#rrggbbaa` Monaco's colour keys accept. */
const alpha = (value: string, amount: number) =>
  `${value.slice(0, 7)}${Math.round(amount * 255).toString(16).padStart(2, "0")}`;

function build(slots: CodeSlots, dark: boolean): Monaco.editor.IStandaloneThemeData {
  return {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "", foreground: bare(slots.foreground) },
      /* Monarch's names, for the first frame before the parse lands and for any
         language tree-sitter has no grammar for. */
      { token: "comment", foreground: bare(slots.comment) },
      { token: "keyword", foreground: bare(slots.keyword) },
      { token: "type", foreground: bare(slots.type) },
      { token: "type.identifier", foreground: bare(slots.type) },
      { token: "identifier.function", foreground: bare(slots.entity) },
      { token: "string", foreground: bare(slots.string) },
      { token: "number", foreground: bare(slots.number) },
      { token: "delimiter", foreground: bare(slots.punctuation) },
      { token: "operator", foreground: bare(slots.operator) },
      /* The semantic layer. Its token types are the slot names themselves, so
         each rule is the slot's own colour and nothing is translated twice. */
      ...SEMANTIC_SLOTS.map((slot) => ({ token: slot, foreground: bare(slots[slot]) })),
    ],
    colors: {
      "editor.background": slots.background,
      "editor.foreground": slots.foreground,
      "editorGutter.background": slots.background,
      "editorCursor.foreground": slots.lineNumberActive,
      "editor.lineHighlightBackground": slots.lineHighlight,
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": slots.selection,
      "editor.inactiveSelectionBackground": alpha(slots.selection, 0.6),
      "editor.selectionHighlightBackground": alpha(slots.selection, 0.55),
      "editor.selectionHighlightBorder": "#00000000",
      "editor.wordHighlightBackground": alpha(slots.selection, 0.45),
      "editor.wordHighlightStrongBackground": alpha(slots.selection, 0.6),
      "editor.findMatchBackground": alpha(slots.entity, 0.28),
      "editor.findMatchHighlightBackground": alpha(slots.entity, 0.14),
      /* Brackets are punctuation, as they are in chat. The pair colouriser is a
         model setting read before any editor option lands, so it is pinned here
         rather than trusted to be off. */
      ...Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((level) => [`editorBracketHighlight.foreground${level}`, slots.punctuation]),
      ),
      "editorBracketHighlight.unexpectedBracket.foreground": slots.keyword,
      "editorBracketMatch.background": alpha(slots.selection, 0.7),
      "editorBracketMatch.border": "#00000000",
      "editorLineNumber.foreground": slots.lineNumber,
      "editorLineNumber.activeForeground": slots.lineNumberActive,
      "editorIndentGuide.background1": alpha(slots.border, 0.7),
      "editorIndentGuide.activeBackground1": slots.lineNumber,
      "editorWhitespace.foreground": alpha(slots.lineNumber, 0.5),
      "editorWidget.background": slots.surface,
      "editorWidget.border": slots.border,
      "editorHoverWidget.background": slots.surface,
      "editorHoverWidget.border": slots.border,
      "editorSuggestWidget.background": slots.surface,
      "editorSuggestWidget.border": slots.border,
      "editorSuggestWidget.foreground": slots.foreground,
      "editorSuggestWidget.selectedBackground": slots.selection,
      "editorSuggestWidget.selectedForeground": slots.foreground,
      "editorSuggestWidget.selectedIconForeground": slots.foreground,
      "editorSuggestWidget.highlightForeground": slots.entity,
      "editorSuggestWidget.focusHighlightForeground": slots.entity,
      "list.hoverBackground": slots.lineHighlight,
      "list.activeSelectionBackground": slots.selection,
      "list.activeSelectionForeground": slots.foreground,
      "list.focusBackground": slots.selection,
      "list.focusForeground": slots.foreground,
      "list.highlightForeground": slots.entity,
      "list.focusHighlightForeground": slots.entity,
      "list.focusOutline": "#00000000",
      "editorHoverWidget.foreground": slots.foreground,
      "textLink.foreground": slots.entity,
      "editorStickyScroll.background": slots.background,
      "focusBorder": "#00000000",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": alpha(slots.lineNumber, 0.22),
      "scrollbarSlider.hoverBackground": alpha(slots.lineNumber, 0.38),
      "scrollbarSlider.activeBackground": alpha(slots.lineNumber, 0.5),
      "editorOverviewRuler.border": "#00000000",
    },
  };
}

export function defineEditorThemes(monaco: typeof Monaco): void {
  monaco.editor.defineTheme(EDITOR_THEME_LIGHT, build(SPAR_LIGHT.slots, false));
  monaco.editor.defineTheme(EDITOR_THEME_DARK, build(SPAR_DARK.slots, true));
}

/**
 * How every editor in the app types.
 *
 * One set, so the practice editor, the live challenge and the visualizer feel
 * like the same instrument. Each page adds only what is its own — wrapping,
 * read-only — on top.
 */
export const EDITOR_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  fontSize: 13,
  lineHeight: 1.65,
  padding: { top: 14, bottom: 14 },

  /* The caret jumps straight to where you type; only the blink is softened. */
  cursorStyle: "line",
  cursorWidth: 2,
  cursorBlinking: "smooth",
  cursorSmoothCaretAnimation: "off",
  cursorSurroundingLines: 4,
  smoothScrolling: true,

  /* Quiet chrome: a gutter just wide enough for the numbers, folding that only
     shows when you reach for it, and no ruler or minimap competing with the code. */
  minimap: { enabled: false },
  glyphMargin: false,
  folding: true,
  showFoldingControls: "mouseover",
  lineNumbersMinChars: 3,
  lineDecorationsWidth: 12,
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  renderLineHighlight: "line",
  renderLineHighlightOnlyWhenFocus: true,
  scrollBeyondLastLine: false,
  stickyScroll: { enabled: false },
  scrollbar: {
    verticalScrollbarSize: 9,
    horizontalScrollbarSize: 9,
    useShadows: false,
    alwaysConsumeMouseWheel: false,
  },

  /* Structure you can feel without it shouting: the active block's guide lifts,
     the matching bracket is a soft fill rather than a box. */
  guides: { indentation: true, highlightActiveIndentation: true, bracketPairs: false },
  matchBrackets: "near",
  bracketPairColorization: { enabled: false },
  occurrencesHighlight: "singleFile",
  selectionHighlight: true,
  renderWhitespace: "selection",

  /* Typing: pairs close and step over themselves, selections wrap in quotes and
     brackets. */
  autoClosingBrackets: "languageDefined",
  autoClosingQuotes: "languageDefined",
  autoClosingOvertype: "always",
  autoClosingDelete: "always",
  autoSurround: "languageDefined",
  autoIndent: "full",
  formatOnType: true,
  /* Popups stay inside the editor. Fixed-position overflow widgets are placed
     against the viewport, and the panels around the editor animate with
     `translate` — which makes them the containing block instead, so the suggest
     list landed a panel's offset away from the caret. */
  fixedOverflowWidgets: false,
  dragAndDrop: true,
  mouseWheelZoom: false,

  /* Tree-sitter's colours on top of Monarch's — the classification chat uses. */
  "semanticHighlighting.enabled": true,
};

/**
 * Completions, signature hints, hovers and quick fixes, as one switch.
 *
 * Off by default — see `useIntellisense`. Off is off: nothing pops up while you
 * type, and Tab and Enter only ever insert what they say.
 */
export function intellisenseOptions(on: boolean): Monaco.editor.IStandaloneEditorConstructionOptions {
  return on
    ? {
        quickSuggestions: { other: "on", comments: "off", strings: "off" },
        quickSuggestionsDelay: 40,
        suggestOnTriggerCharacters: true,
        acceptSuggestionOnEnter: "on",
        tabCompletion: "on",
        wordBasedSuggestions: "currentDocument",
        snippetSuggestions: "inline",
        suggest: { preview: true, showStatusBar: false, insertMode: "replace", showWords: true, showIcons: false },
        parameterHints: { enabled: true, cycle: true },
        hover: { enabled: true, delay: 400, sticky: true },
        lightbulb: { enabled: "onCode" as Monaco.editor.ShowLightbulbIconMode },
        inlineSuggest: { enabled: true },
      }
    : {
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        acceptSuggestionOnEnter: "off",
        tabCompletion: "off",
        wordBasedSuggestions: "off",
        snippetSuggestions: "none",
        parameterHints: { enabled: false },
        hover: { enabled: false },
        lightbulb: { enabled: "off" as Monaco.editor.ShowLightbulbIconMode },
        inlineSuggest: { enabled: false },
      };
}

/** The chosen code face, as Monaco wants it: the stack spelled out, because the
 *  editor measures glyphs from this string rather than from the stylesheet. */
export function editorFontOptions(font: CodeFont): Monaco.editor.IEditorOptions {
  return { fontFamily: font.stack, fontLigatures: font.ligatures };
}
