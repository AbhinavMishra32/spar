import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { Markdown } from "../agent/Markdown";
import { MarkdownLinkProvider } from "../agent/MarkdownLinks";
import { parseStatement } from "@/lib/statement";

/**
 * The challenge statement, given the hierarchy a problem needs: what to build,
 * the rules it must satisfy, and worked examples you can scan. When the agent's
 * text already has its own structure this steps aside and renders the markdown.
 */
export function ProblemStatement({ source, language }: { source: string; language?: string | undefined }) {
  const parsed = useMemo(() => parseStatement(source), [source]);
  /* The challenge's language, so `nums[i]` in a statement is coloured the way
     the same text is in the editor beside it. A fenced block names its own
     language; an inline span cannot, and the statement's language is the only
     honest guess. Without it every span falls back to a plain chip. */
  const links = useMemo(() => (language ? { language } : {}), [language]);

  if (!parsed.structured) return <MarkdownLinkProvider value={links}><Markdown className="md-prose-content" source={source} /></MarkdownLinkProvider>;

  return (
    <MarkdownLinkProvider value={links}>
    <div className="min-w-0">
      <Markdown className="md-prose-content" source={parsed.lead} />

      {parsed.requirements.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {parsed.requirements.map((requirement, index) => (
            <li key={index} className="flex min-w-0 gap-2">
              <span className="mt-[0.62em] size-1 shrink-0 rounded-full bg-muted-foreground/50" />
              <Markdown className="md-prose-content min-w-0 flex-1" source={requirement} />
            </li>
          ))}
        </ul>
      )}

      {parsed.examples.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-ui-sm font-medium tracking-[0.06em] text-muted-foreground/80">EXAMPLES</p>
          <div className="overflow-hidden rounded-lg border border-border">
            {parsed.examples.map((example, index) => (
              <div
                key={index}
                className="flex min-w-0 flex-col gap-1 border-b border-border/60 bg-[var(--color-background-elevated-secondary)] px-2.5 py-2 last:border-b-0"
              >
                <code className="min-w-0 break-words font-mono text-ui-sm text-foreground/85">{example.call}</code>
                <span className="flex min-w-0 items-start gap-1.5">
                  <ArrowRight className="mt-[0.15em] size-3 shrink-0 text-muted-foreground/60" />
                  <code className="min-w-0 break-words font-mono text-ui-sm text-[var(--success)]">{example.result}</code>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {parsed.note && (
        <div className="mt-3">
          <Markdown className="md-prose-content text-muted-foreground" source={parsed.note} />
        </div>
      )}
    </div>
    </MarkdownLinkProvider>
  );
}
