import { Fragment, memo, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { LanguageGlyph, languageOf } from "../common/LanguageGlyph";

/** Blocks the renderer understands. Anything unrecognised falls through as a paragraph. */
type Block =
  | { kind: "code"; language: string; body: string }
  | { kind: "heading"; level: number; body: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; body: string }
  | { kind: "rule" }
  | { kind: "paragraph"; body: string };

const FENCE = /^```(\w*)\s*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;

function parse(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (!paragraph.length) return;
    blocks.push({ kind: "paragraph", body: paragraph.join("\n").trim() });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index]!)) {
        body.push(lines[index]!);
        index += 1;
      }
      blocks.push({ kind: "code", language: fence[1] || "text", body: body.join("\n") });
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    if (/^\s*(---|___|\*\*\*)\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1]!.length, body: heading[2]! });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      const body = [quote[1]!];
      while (index + 1 < lines.length && QUOTE.test(lines[index + 1]!)) {
        index += 1;
        body.push(QUOTE.exec(lines[index]!)![1]!);
      }
      blocks.push({ kind: "quote", body: body.join("\n") });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      flush();
      const isOrdered = Boolean(ordered);
      const items = [(bullet ?? ordered)![1]!];
      while (index + 1 < lines.length) {
        const next = lines[index + 1]!;
        const nextMatch = isOrdered ? ORDERED.exec(next) : BULLET.exec(next);
        if (!nextMatch) break;
        index += 1;
        items.push(nextMatch[1]!);
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }

    paragraph.push(line);
  }

  flush();
  return blocks;
}

/** Inline spans: `code`, **bold**, *italic*, and bare links rendered as plain text. */
function Inline({ text }: { text: string }) {
  const nodes = useMemo(() => {
    const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;
    const result: Array<{ key: string; node: React.ReactNode }> = [];
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) {
        result.push({ key: `t${cursor}`, node: text.slice(cursor, match.index) });
      }
      const value = match[0];
      if (value.startsWith("`")) {
        result.push({ key: `c${match.index}`, node: <code className="code-inline">{value.slice(1, -1)}</code> });
      } else if (value.startsWith("**")) {
        result.push({ key: `b${match.index}`, node: <strong className="font-semibold">{value.slice(2, -2)}</strong> });
      } else {
        result.push({ key: `i${match.index}`, node: <em>{value.slice(1, -1)}</em> });
      }
      cursor = match.index + value.length;
    }
    if (cursor < text.length) result.push({ key: `t${cursor}`, node: text.slice(cursor) });
    return result;
  }, [text]);

  return (
    <>
      {nodes.map((item) => (
        <Fragment key={item.key}>{item.node}</Fragment>
      ))}
    </>
  );
}

function CodeBlock({ language, body }: { language: string; body: string }) {
  const [copied, setCopied] = useState(false);
  // A fence can say anything — `bash`, `json`, `text`. Only the three Spar trains
  // in have a mark; the rest keep the tag they were written with.
  const marked = languageOf(language);
  const copy = () => {
    void navigator.clipboard.writeText(body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="code-block group/code my-2 overflow-hidden">
      <div className="flex h-7 items-center justify-between border-b border-border/70 px-2.5">
        {marked
          ? <LanguageGlyph className="size-3 text-muted-foreground" language={marked} />
          : <span className="font-mono text-ui-sm text-muted-foreground">{language}</span>}
        <button
          className="grid size-5 place-items-center rounded-md text-muted-foreground opacity-0 transition group-hover/code:opacity-100 hover:bg-accent hover:text-foreground"
          onClick={copy}
          title="Copy"
          type="button"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>
      <pre className="app-scroll overflow-x-auto px-2.5 py-2 text-[0.75rem] leading-[1.55] text-[var(--code-foreground)]">
        <code>{body}</code>
      </pre>
    </div>
  );
}

export const Markdown = memo(function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = useMemo(() => parse(source), [source]);

  return (
    <div
      className={cn(
        // A bare UUID or long path must wrap rather than widen the column.
        "min-w-0 text-content leading-[1.62] [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    >
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "code":
            return <CodeBlock key={index} body={block.body} language={block.language} />;
          case "heading": {
            const size = block.level <= 1 ? "text-[0.95rem]" : block.level === 2 ? "text-[0.875rem]" : "text-content";
            return (
              <p key={index} className={cn("mt-4 mb-1.5 font-semibold tracking-tight", size)}>
                <Inline text={block.body} />
              </p>
            );
          }
          case "list":
            return block.ordered ? (
              <ol key={index} className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inline text={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={index} className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote key={index} className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
                <Inline text={block.body} />
              </blockquote>
            );
          case "rule":
            return <hr key={index} className="my-3 border-t border-border" />;
          default:
            return (
              <p key={index} className="my-2 whitespace-pre-wrap">
                <Inline text={block.body} />
              </p>
            );
        }
      })}
    </div>
  );
});
