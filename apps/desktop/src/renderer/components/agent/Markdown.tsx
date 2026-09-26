import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCodeTheme } from "@/hooks/use-code-theme";
import { highlight, type Span } from "@/lib/highlight";
import { plainMath } from "@/lib/tex";
import { Check, Code2, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { LanguageGlyph, languageOf } from "../common/LanguageGlyph";
import { parseReference, Reference, REFERENCE_KINDS, useMarkdownLinks } from "./MarkdownLinks";
import { Figure } from "./Figure";
import { parse, type Block } from "./markdownBlocks";

/** Inline spans: `code`, **bold**, *italic*, and real links.
 *
 *  Exported because the thread is not the only place agent prose appears. A
 *  question the agent asks is written in the same language as the message
 *  before it, references and all, and rendering it as a bare string is what
 *  made `[[file:main.py|main.py]]` show up literally in the question card. */
/* Everything the inline tokeniser matches after a reference, in one string so
   the reference kinds can be interpolated in front of it. A double-quoted
   string rather than a template literal because one of these rules is the code
   span, and a backtick cannot be escaped into a template. */
const INLINE_RULES =
  "|(\\[[^\\]\\n]*\\]\\((?:https?:\\/\\/|mailto:)[^\\s)]+\\))|(`[^`]+`)|(\\*\\*[^*]+\\*\\*)|(\\*[^*]+\\*)|(_[^_]+_)|(https?:\\/\\/[^\\s<>()[\\]\"']+)";

export function Inline({ text }: { text: string }) {
  const nodes = useMemo(() => {
    /* References first, so a `[[file:a_b.c|x]]` is not torn apart by the
       emphasis rule looking at its underscores. */
    /* `[label](url)` sits between the references and the emphasis rules: after,
       so `[[file:a|b]]` still wins its own brackets, and before, so a title with
       an asterisk in it is not torn in half. Bare URLs are matched last, and
       only after the bracketed form has had its chance at them.
       
       Until this existed the agent's own citations printed as their markdown —
       `[SolveWithPython version](https://…)` — which is the one thing a reader
       cannot use: the link is right there and unclickable, and the URL is
       spelled out in the middle of a sentence. */
    const pattern = new RegExp(`(\\[\\[(?:${REFERENCE_KINDS.join("|")}):[^\\]]+\\]\\])${INLINE_RULES}`, "g");
    const result: Array<{ key: string; node: React.ReactNode }> = [];
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) {
        /* Plain prose only. TeX is unwrapped here rather than over the whole
           string so a backslash inside a code span stays a backslash — the one
           place in a message where `\(` means itself. */
        result.push({ key: `t${cursor}`, node: plainMath(text.slice(cursor, match.index)) });
      }
      const value = match[0];
      const reference = value.startsWith("[[") ? parseReference(value) : null;
      if (reference) {
        result.push({
          key: `r${match.index}`,
          node: <Reference kind={reference.kind} label={reference.label} target={reference.target} />,
        });
      } else if (value.startsWith("[")) {
        const split = value.indexOf("](");
        const label = value.slice(1, split);
        const href = value.slice(split + 2, -1);
        result.push({ key: `l${match.index}`, node: <Hyperlink href={href} label={label || linkText(href)} /> });
      } else if (/^https?:\/\//.test(value)) {
        /* A URL written out in prose. Shown as its host and path rather than in
           full: the query string of a documentation link is longer than the
           sentence around it and says nothing. */
        result.push({ key: `u${match.index}`, node: <Hyperlink href={value} label={linkText(value)} /> });
      } else if (value.startsWith("`")) {
        result.push({ key: `c${match.index}`, node: <InlineCode body={value.slice(1, -1)} /> });
      } else if (value.startsWith("**")) {
        /* Recursed, not printed. Emphasis wins the match at its own index, so a
           reference or a code span inside it was consumed whole and rendered as
           the raw string — which is why `[[file:main.py|main.py]]` showed as
           itself the moment it appeared inside a bold sentence. The inner text
           is strictly shorter and its delimiters are stripped, so this
           terminates. */
        result.push({
          key: `b${match.index}`,
          node: (
            <strong className="font-semibold">
              <Inline text={value.slice(2, -2)} />
            </strong>
          ),
        });
      } else {
        result.push({
          key: `i${match.index}`,
          node: (
            <em>
              <Inline text={value.slice(1, -1)} />
            </em>
          ),
        });
      }
      cursor = match.index + value.length;
    }
    if (cursor < text.length) result.push({ key: `t${cursor}`, node: plainMath(text.slice(cursor)) });
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

/**
 * Inline code, coloured by the same theme the editor uses.
 *
 * A fenced block names its language; an inline span cannot, so this takes the
 * project's — a snippet in a Python project is Python. When there is no
 * language to guess with, or the fragment does not parse as one, the spans come
 * back uncoloured and it renders exactly as it did before: a plain chip. That
 * fallback is why this is safe to run on every `torch.zeros` in a transcript.
 */
/**
 * A web link in agent prose.
 *
 * A button rather than an anchor, because the window refuses to navigate — an
 * `<a href>` in the renderer either does nothing or replaces the app with a web
 * page, and neither is what following a citation should do. The surface around
 * the transcript hands down the door via `onOpenUrl`; where it has not, the link
 * renders as its label in plain text, which is what the prose said anyway.
 */
function Hyperlink({ href, label }: { href: string; label: string }) {
  const links = useMarkdownLinks();
  if (!links.onOpenUrl) return <span className="text-foreground/85">{label}</span>;

  return (
    <button
      className="cursor-default rounded-[3px] text-foreground underline decoration-foreground/30 decoration-1 underline-offset-[3px] transition-colors outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={() => links.onOpenUrl?.(href)}
      title={href}
      type="button"
    >
      {label}
    </button>
  );
}

/** A URL as a person would read it out: the site, and the path if it says
 *  something. No scheme, no `www.`, no query string. */
function linkText(href: string): string {
  try {
    const url = new URL(href);
    const path = url.pathname.replace(/\/$/, "");
    const shown = `${url.host.replace(/^www\./, "")}${path}`;
    return shown.length > 48 ? `${shown.slice(0, 47)}…` : shown;
  } catch {
    return href;
  }
}

function InlineCode({ body }: { body: string }) {
  const { language } = useMarkdownLinks();
  const { theme } = useCodeTheme();
  const [spans, setSpans] = useState<Span[] | null>(null);

  useEffect(() => {
    if (!language) return;
    let alive = true;
    void highlight(body, language).then((next) => {
      if (alive) setSpans(next);
    });
    return () => {
      alive = false;
    };
  }, [body, language]);

  return (
    <code className="code-inline">
      {spans
        ? spans.map((span, index) => (
            <span key={index} style={span.slot ? { color: theme.slots[span.slot] } : undefined}>
              {span.text}
            </span>
          ))
        : body}
    </code>
  );
}

/**
 * A fenced block, coloured by the shared code theme.
 *
 * The plain text renders first and is replaced when the grammar resolves, so a
 * block that is still streaming is readable rather than blank. Rendered as
 * elements rather than as HTML — there is no markup to inject, only text and a
 * colour.
 */
export function Colorized({ body, language, follow = false, className }: { body: string; language: string; follow?: boolean; className?: string }) {
  const { theme } = useCodeTheme();
  const [colored, setColored] = useState<{ body: string; spans: Span[] } | null>(null);
  const pre = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let alive = true;
    void highlight(body, language).then((next) => { if (alive) setColored({ body, spans: next }); });
    return () => { alive = false; };
  }, [body, language]);

  /* A block still being written keeps its colours while the next pass runs:
     the part already highlighted stays as it was and only the new tail is plain,
     so streaming code does not flash grey on every delta. */
  const spans = useMemo(() => {
    if (!colored) return null;
    if (colored.body === body) return colored.spans;
    if (body.startsWith(colored.body)) return [...colored.spans, { text: body.slice(colored.body.length), slot: null }];
    return null;
  }, [body, colored]);

  useLayoutEffect(() => {
    /* Glides to the newest line rather than snapping, so the eye can stay on
       the line being written instead of refinding it after every delta. */
    if (follow && pre.current) pre.current.scrollTo({ top: pre.current.scrollHeight, behavior: "smooth" });
  }, [body, follow]);

  const lines = useMemo(() => {
    const result: Span[][] = [[]];
    for (const span of spans ?? [{ text: body, slot: null }]) {
      span.text.split("\n").forEach((text, index) => {
        if (index > 0) result.push([]);
        result[result.length - 1]!.push({ ...span, text });
      });
    }
    // The closing fence's newline is not an extra source line.
    if (body.endsWith("\n") && result.length > 1) result.pop();
    return result;
  }, [body, spans]);

  return (
    <pre className={cn("code-block-body app-scroll text-[calc(var(--text-thread)-1px)] leading-[1.6] text-[var(--code-foreground)]", className)} ref={pre} tabIndex={0} aria-label={`${language || "Plain text"} code`}>
      <code>
        {lines.map((line, index) => (
          <span className="code-block-line" key={index}>
            {line.map((span, token) => (
              <span key={token} style={span.slot ? { color: theme.slots[span.slot] } : undefined}>{span.text}</span>
            ))}
            {index < lines.length - 1 ? "\n" : null}
          </span>
        ))}
      </code>
    </pre>
  );
}

function CodeBlock({ language, body }: { language: string; body: string }) {
  const marked = languageOf(language);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (reset.current) clearTimeout(reset.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setCopyError(false);
      if (reset.current) clearTimeout(reset.current);
      reset.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  };


  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-language" title={language || "Plain text"}>
          {marked ? <LanguageGlyph className="size-3.5" language={marked} /> : <Code2 className="size-3.5" role="img" aria-label={language || "Plain text"} />}
        </span>
        <div className="code-block-actions">
          <button aria-label={copied ? "Copied" : "Copy code"} title={copyError ? "Copy failed — try again" : copied ? "Copied" : "Copy code"} onClick={() => void copy()} type="button">
            {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
          </button>
        </div>
      </div>
      <span className="sr-only" role="status">{copyError ? "Could not copy code. Try again." : copied ? "Code copied" : ""}</span>
      <Colorized body={body} language={language} />
    </div>
  );
}

/**
 * A file, in the thread's own code block: its language's mark and its path in
 * the header, line numbers, the editor's colours. `live` follows the newest line
 * while the file is still being written.
 */
export function FileCodeBlock({ path, body, language, live = false, className }: { path: string; body: string; language: string; live?: boolean; className?: string }) {
  const marked = languageOf(language);
  const lines = body.replace(/\n$/, "").split("\n").length;
  return (
    <div className={cn("code-block !my-1", className)}>
      <div className="code-block-header !h-7 !py-1">
        <span className="code-block-language flex items-center gap-1.5">
          {marked ? <LanguageGlyph className="size-3.5 shrink-0" language={marked} /> : <Code2 className="size-3.5 shrink-0" aria-hidden />}
          <span className="truncate text-thread-tool">{path}</span>
        </span>
        <span className={cn("shrink-0 pr-1 text-thread-tool tabular-nums", live && "thinking-shimmer")}>{live ? "writing" : `${lines} lines`}</span>
      </div>
      <Colorized body={body} className={live ? "!max-h-[15rem]" : "!max-h-[20rem]"} follow={live} language={language} />
    </div>
  );
}

/**
 * A problem's worked example — Input, Output, Explanation — drawn as the site
 * draws it: a quoted block in the code face that wraps, labels in bold, values
 * exactly as written. Not a code block: it is not code to copy or number, and a
 * scrolling box cut the explanation off mid-sentence.
 */
function WorkedExample({ body }: { body: string }) {
  return (
    <blockquote className="font-mono text-[0.92em] break-words whitespace-pre-wrap">
      {body.split("\n").map((line, index) => {
        const label = /^(\s*(?:Input|Output|Explanation)\s*:)(.*)$/i.exec(line);
        return (
          <Fragment key={index}>
            {index > 0 && "\n"}
            {label ? <><strong className="font-semibold text-foreground">{label[1]}</strong><span className="text-foreground/75">{label[2]}</span></> : <span className="text-foreground/75">{line}</span>}
          </Fragment>
        );
      })}
    </blockquote>
  );
}

export const Markdown = memo(function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = useMemo(() => parse(source), [source]);

  return (
    <div
      /* The scale lives in `.md-prose` — ChatGPT's own, lifted from its
         stylesheet. Sizing and spacing are not set here so that every surface
         rendering agent prose shares one system rather than each carrying its
         own guesses. */
      className={cn("md-prose min-w-0", className)}
    >
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "code":
            if (block.language === "example") return <WorkedExample key={index} body={block.body} />;
            if (block.language === "figure") return <Figure key={index} source={block.body} />;
            return <CodeBlock key={index} body={block.body} language={block.language} />;
          case "heading": {
            /* A real heading element, not a bolded paragraph: the scale keys off
               the tag, and a screen reader has nothing to go on otherwise. */
            const Tag = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[Math.min(5, Math.max(1, block.level)) - 1]!;
            return (
              <Tag key={index}>
                <Inline text={block.body} />
              </Tag>
            );
          }
          case "list":
            return block.ordered ? (
              <ol key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inline text={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote key={index}>
                <Inline text={block.body} />
              </blockquote>
            );
          case "table":
            /* Scrolls inside its own box rather than widening the column. A
               table in a chat panel is nearly always wider than the panel, and
               a message that pushes the whole transcript sideways is worse than
               one you drag two inches. */
            return (
              <div className="app-scroll -mx-1 my-2 overflow-x-auto px-1" key={index}>
                <table className="w-full min-w-max border-collapse text-left">
                  <thead>
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <th
                          className="hairline-b px-2 py-1 font-semibold whitespace-nowrap text-foreground"
                          key={cellIndex}
                          scope="col"
                        >
                          <Inline text={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td
                            className={cn(
                              "px-2 py-1 align-top text-foreground/85",
                              rowIndex < block.rows.length - 1 && "hairline-b",
                            )}
                            key={cellIndex}
                          >
                            <Inline text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "rule":
            return <hr key={index} />;
          case "image":
            /* Drawn at its own size up to the column's width, never stretched
               past it. No referrer, so the host serving a statement's figure is
               not told which app is showing it. */
            return (
              <img
                alt={block.alt}
                className="my-3 block h-auto max-w-full rounded-md"
                decoding="async"
                key={index}
                loading="lazy"
                referrerPolicy="no-referrer"
                src={block.src}
              />
            );
          default:
            return (
              <p key={index}>
                <Inline text={block.body} />
              </p>
            );
        }
      })}
    </div>
  );
});
