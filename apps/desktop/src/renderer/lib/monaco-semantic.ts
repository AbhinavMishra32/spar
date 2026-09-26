import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

import type { CodeSlots } from "../../shared/codeTheme";
import { highlight } from "./highlight";

/**
 * The transcript's highlighting, in the editor.
 *
 * Monaco colours with Monarch — regexes — so it cannot tell a call from a
 * variable or a type from an identifier, and the same lines looked different in
 * the editor than in a chat code block. This hands Monaco the tree-sitter spans
 * chat already renders, as semantic tokens. Monarch still paints the first frame
 * and any language without a grammar; the parse lands on top a beat later.
 *
 * The token types are the slot names, so the theme's rule for a slot is its
 * colour and nothing is mapped twice.
 */
export const SEMANTIC_SLOTS = [
  "comment",
  "keyword",
  "type",
  "entity",
  "string",
  "number",
  "punctuation",
  "variable",
  "constant",
  "operator",
] as const satisfies ReadonlyArray<keyof CodeSlots>;

const INDEX = new Map<string, number>(SEMANTIC_SLOTS.map((slot, index) => [slot, index]));

/** Monaco's language ids for the grammars `highlight` can load. */
const LANGUAGES = ["typescript", "javascript", "cpp", "python"];

/** Spans as Monaco's relative five-int encoding. A token may not cross a line,
 *  so a block comment or a template string is cut at each newline. */
function encode(spans: Awaited<ReturnType<typeof highlight>>): Uint32Array {
  const data: number[] = [];
  let line = 0;
  let column = 0;
  let lastLine = 0;
  let lastColumn = 0;
  for (const span of spans) {
    const type = span.slot ? INDEX.get(span.slot) : undefined;
    const pieces = span.text.split("\n");
    pieces.forEach((piece, index) => {
      if (index > 0) {
        line += 1;
        column = 0;
      }
      if (type !== undefined && piece.length > 0) {
        data.push(line - lastLine, line === lastLine ? column - lastColumn : column, piece.length, type, 0);
        lastLine = line;
        lastColumn = column;
      }
      column += piece.length;
    });
  }
  return new Uint32Array(data);
}

export function registerSemanticHighlighting(monaco: typeof Monaco): void {
  const legend: Monaco.languages.SemanticTokensLegend = { tokenTypes: [...SEMANTIC_SLOTS], tokenModifiers: [] };
  for (const language of LANGUAGES) {
    monaco.languages.registerDocumentSemanticTokensProvider(language, {
      getLegend: () => legend,
      provideDocumentSemanticTokens: async (model) => {
        const version = model.getVersionId();
        const spans = await highlight(model.getValue(), language);
        /* Monaco drops a stale answer itself, but the encode is not free on a
           large file and there is no reason to do it for text that is gone. */
        if (model.isDisposed() || model.getVersionId() !== version) return null;
        return { data: encode(spans) };
      },
      releaseDocumentSemanticTokens: () => {},
    });
  }
}
