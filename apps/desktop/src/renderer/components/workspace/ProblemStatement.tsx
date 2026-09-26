import { Figure } from "../agent/Figure";
import { useMemo } from "react";
import { Markdown } from "../agent/Markdown";
import { MarkdownLinkProvider, useMarkdownLinks } from "../agent/MarkdownLinks";
import { parseStatement } from "@/lib/statement";

/**
 * The challenge statement, given the hierarchy a problem needs: what to build,
 * the rules it must satisfy, and worked examples you can scan. When the agent's
 * text already has its own structure this steps aside and renders the markdown.
 */
export function ProblemStatement({ source, language, asWritten = false }: {
  source: string;
  language?: string | undefined;
  /** Render the markdown exactly as given. For a problem from LeetCode or
   *  Codeforces: the regrouping below exists to give an agent's run-on prose a
   *  shape, and a site's own statement already has one — its paragraphs,
   *  figures, worked examples and constraints, in the order it chose. Taking
   *  that apart is how a statement lost everything but its first sentence. */
  asWritten?: boolean;
}) {
  const parsed = useMemo(
    () => (asWritten ? { structured: false, lead: source, requirements: [], examples: [], note: "" } : parseStatement(source)),
    [asWritten, source],
  );
  /* The challenge's language, so `nums[i]` in a statement is coloured the way
     the same text is in the editor beside it. A fenced block names its own
     language; an inline span cannot, and the statement's language is the only
     honest guess. Without it every span falls back to a plain chip. */
  /* Added to what the shell already provides rather than replacing it: a
     statement is inside the app, so a [[concept:…]] or [[lesson:…]] in one must
     open the same surfaces it opens everywhere else. Providing a bare
     `{ language }` here is what made those chips dead inside the problem. */
  const outer = useMarkdownLinks();
  const links = useMemo(() => (language ? { ...outer, language } : outer), [language, outer]);

  if (!parsed.structured) return <MarkdownLinkProvider value={links}><Markdown className="md-prose-content" source={parsed.lead} /></MarkdownLinkProvider>;

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

      {/* Each example its own card, named, the way a problem page numbers
          them. A figure is the card's top band — the picture of the input —
          and the rows under it read Input, Output, then why. One border per
          example: a framed figure inside a framed card was a box in a box. */}
      {parsed.examples.length > 0 && (
        <div className="mt-5 space-y-3">
          {parsed.examples.map((example, index) => (
            <section key={index} className="min-w-0">
              <p className="mb-1.5 text-content-sm font-medium text-foreground/85">Example {index + 1}</p>
              <div className="overflow-hidden rounded-lg border border-border bg-[var(--color-background-elevated-secondary)]">
                {example.figure && (
                  <div className="border-b border-border/60 px-3 py-4">
                    <Figure bare source={example.figure} />
                  </div>
                )}
                <dl className="grid min-w-0 grid-cols-[3.75rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2.5 text-content-sm">
                  <dt className="text-muted-foreground">Input</dt>
                  <dd className="min-w-0"><code className="break-words font-mono text-foreground">{example.call}</code></dd>
                  <dt className="text-muted-foreground">Output</dt>
                  <dd className="min-w-0"><code className="break-words font-mono text-[var(--success)]">{example.result}</code></dd>
                </dl>
                {/* Why this one is the answer — often the whole point of the
                    example, so it travels with it. */}
                {example.note && (
                  <div className="border-t border-border/60 px-3 py-2.5">
                    <Markdown className="md-prose-content min-w-0 text-foreground/75" source={example.note} />
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {parsed.note && (
        <div className="mt-3">
          <Markdown className="md-prose-content text-foreground/75" source={parsed.note} />
        </div>
      )}
    </div>
    </MarkdownLinkProvider>
  );
}
