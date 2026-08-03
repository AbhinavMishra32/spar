import { useMemo } from "react";
import type { ChallengeCodePreview } from "@spar/domain";
import { cn } from "@/lib/utils";
import { fileName } from "@/lib/format";

/**
 * A few lines of a challenge's own code, at a size meant to be recognised rather
 * than read. It goes inside a card in a list, so it is deliberately quiet: the
 * whole plate sits below the card's text in contrast, and the syntax colours are
 * mixed back toward the surface until they read as texture. What the learner is
 * meant to get from it at a glance is "oh, that one" — the shape of the function,
 * the name they were working on — not the implementation.
 *
 * Monaco is the editor and it is far too much machinery for this: a list of forty
 * cards would mean forty editor instances. The tokeniser below is a single pass
 * of alternation over the four things worth colouring, which is all a nine-line
 * excerpt can show anyway. It is a highlighter, not a parser, and it never has to
 * be right about a language it does not know — the fallback is plain text, which
 * at this size is a perfectly good outcome.
 */

type Token = { text: string; kind: "plain" | "comment" | "string" | "keyword" | "number" | "function" | "punctuation" };

const KEYWORDS = new Set([
  // The three languages Spar trains in, in one set. Overlap is the point: a
  // keyword list per language would be three near-copies, and colouring `class`
  // in a file that happens to be C++ is right in either.
  "abstract", "as", "async", "auto", "await", "bool", "break", "case", "catch", "char", "class", "const", "constexpr",
  "continue", "declare", "default", "delete", "do", "double", "else", "enum", "export", "extends", "extern", "false",
  "finally", "float", "for", "friend", "from", "function", "if", "implements", "import", "in", "inline", "instanceof",
  "int", "interface", "let", "long", "namespace", "new", "nullptr", "of", "operator", "private", "protected", "public",
  "readonly", "return", "short", "signed", "sizeof", "static", "struct", "switch", "template", "this", "throw", "true",
  "try", "type", "typedef", "typeof", "unsigned", "using", "var", "virtual", "void", "while", "yield",
  "null", "undefined", "NULL",
]);

/* One alternation, tried in precedence order: comments and strings first, since
   everything inside them is text, then numbers, then a word — which is only a
   keyword or a call once we look at what follows it. */
const PATTERN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_.a-fx]*\b)|([A-Za-z_$][\w$]*)|([{}()[\];,.<>+\-*/%=!&|?:]+)/g;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = PATTERN.exec(source))) {
    if (match.index > cursor) tokens.push({ text: source.slice(cursor, match.index), kind: "plain" });
    const [value, comment, string, number, word, punctuation] = match;
    if (comment) tokens.push({ text: value, kind: "comment" });
    else if (string) tokens.push({ text: value, kind: "string" });
    else if (number) tokens.push({ text: value, kind: "number" });
    else if (word) {
      // A word followed by `(` is being called, whatever it is named.
      const called = source[match.index + value.length] === "(";
      tokens.push({ text: value, kind: KEYWORDS.has(word) ? "keyword" : called ? "function" : "plain" });
    } else if (punctuation) tokens.push({ text: value, kind: "punctuation" });
    cursor = match.index + value.length;
  }
  if (cursor < source.length) tokens.push({ text: source.slice(cursor), kind: "plain" });
  return tokens;
}

/* Mixed toward the card's own surface rather than used at full strength. At 10px
   in a list, the editor palette is loud enough to pull the eye off the title —
   which is the thing that actually identifies the challenge. */
const TONE: Record<Token["kind"], string> = {
  plain: "color-mix(in oklab, var(--code-foreground) 78%, transparent)",
  comment: "color-mix(in oklab, var(--code-comment) 68%, transparent)",
  string: "color-mix(in oklab, var(--code-string) 82%, transparent)",
  keyword: "color-mix(in oklab, var(--code-keyword) 78%, transparent)",
  number: "color-mix(in oklab, var(--code-number) 80%, transparent)",
  function: "color-mix(in oklab, var(--code-function) 82%, transparent)",
  punctuation: "color-mix(in oklab, var(--code-punctuation) 70%, transparent)",
};

export function CodePeek({ code, className }: { code: string; className?: string }) {
  const tokens = useMemo(() => tokenize(code), [code]);

  return (
    <pre
      aria-hidden
      className={cn("overflow-hidden whitespace-pre font-mono text-[0.625rem] leading-[1.55]", className)}
    >
      <code>
        {tokens.map((token, index) => (
          <span key={index} style={token.kind === "plain" ? undefined : { color: TONE[token.kind] }}>
            {token.text}
          </span>
        ))}
      </code>
    </pre>
  );
}

/**
 * The excerpt as a plate on the trailing edge of a card. A card in a list cannot
 * show a file, so it shows the top of one and says so by fading out rather than
 * by cutting off — a hard edge reads as a rendering bug, a fade reads as "there
 * is more". It is dimmed until the pointer is on the card, which keeps a scrolled
 * list calm and makes the code the reward for stopping on one.
 *
 * Stretched to its parent rather than given a height: the plate is the card's
 * right-hand edge, so it has to end where the card does however tall the text
 * column turns out to be. It is the card that owns `group`.
 */
export function CodePlate({ preview, className }: { preview: ChallengeCodePreview; className?: string }) {
  return (
    <div
      className={cn(
        "relative hidden w-[17rem] shrink-0 self-stretch overflow-hidden rounded-lg bg-[var(--color-background-editor)] shadow-[inset_0_0_0_1px_var(--border)] md:block",
        className,
      )}
    >
      <div className="flex h-6 items-center gap-1.5 border-b border-border/70 px-2">
        <span className="truncate font-mono text-[0.625rem] text-muted-foreground/70">{fileName(preview.path)}</span>
        {preview.remainingLines > 0 && (
          <span className="ml-auto shrink-0 font-mono text-[0.625rem] tabular-nums text-muted-foreground/45">
            +{preview.remainingLines}
          </span>
        )}
      </div>
      {/* Absolute so the excerpt can overflow the plate and be cut by the fade
          instead of forcing the card taller than its own text needs. */}
      <div className="absolute inset-x-0 bottom-0 top-6">
        <CodePeek className="px-2.5 pt-1.5 opacity-70 transition-opacity duration-200 group-hover:opacity-100" code={preview.code} />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-b from-transparent to-[var(--color-background-editor)]" />
      </div>
    </div>
  );
}
