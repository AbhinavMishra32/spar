import { useEffect, useState } from "react";

import { useCodeTheme } from "@/hooks/use-code-theme";
import { highlight, type Span } from "@/lib/highlight";
import { cn } from "@/lib/utils";

/**
 * Code, in the theme the editor uses.
 *
 * Capped by default and openable. A file the agent read can be four hundred
 * lines, and a transcript that grows by a screenful every time the agent looks
 * at something is a transcript nobody can scroll.
 *
 * Its own module because two detail views draw code now — the file a tool read,
 * and the solve behind a replay — and a component shared by `ToolDetail` and by
 * something `ToolDetail` renders is how an import cycle starts.
 */
export function Snippet({ body, language }: { body: string; language: string }) {
  const { theme } = useCodeTheme();
  const [spans, setSpans] = useState<Span[] | null>(null);
  const [full, setFull] = useState(false);
  const trimmed = body.replace(/\s+$/, "");
  const lines = trimmed ? trimmed.split("\n").length : 0;

  useEffect(() => {
    let alive = true;
    void highlight(trimmed, language).then((next) => {
      if (alive) setSpans(next);
    });
    return () => {
      alive = false;
    };
  }, [trimmed, language]);

  if (!trimmed) return null;

  return (
    <>
      <pre
        className={cn(
          "app-scroll overflow-x-auto px-2.5 pb-2 font-mono text-[length:inherit] leading-[1.55]",
          !full && lines > 14 && "max-h-[15.5rem] overflow-y-hidden",
        )}
        style={{ color: theme.slots.foreground }}
      >
        {/* Plain until the grammar resolves, so a long file is readable
            immediately rather than blank for a beat. */}
        <code>
          {spans
            ? spans.map((span, index) => (
                <span key={index} style={span.slot ? { color: theme.slots[span.slot] } : undefined}>
                  {span.text}
                </span>
              ))
            : trimmed}
        </code>
      </pre>
      {lines > 14 && (
        <button
          className="mx-2.5 mb-2 cursor-default rounded-md bg-[var(--accent)] px-2 py-1 text-[length:inherit] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setFull((value) => !value)}
          type="button"
        >
          {full ? "Collapse" : `Show all ${lines} lines`}
        </button>
      )}
    </>
  );
}
