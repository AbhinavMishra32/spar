import { useState } from "react";
import { ChevronDown, Lightbulb } from "lucide-react";
import type { Language } from "@spar/domain";
import { cn } from "@/lib/utils";
import { ProblemStatement } from "./ProblemStatement";

/**
 * The hints the source published, folded shut.
 *
 * Folded rather than hidden: they are part of the problem as the source states
 * it, so withholding them would be presenting a different problem — but opening
 * one has to be a decision the learner makes, because a hint read by accident
 * cannot be un-read. Shared by the workspace and the practice page so that a
 * problem does not reveal more of itself on one screen than on the other.
 */
export function SourceHints({ className, hints, language }: {
  className?: string;
  hints: string[];
  language: Language;
}) {
  const [open, setOpen] = useState<number[]>([]);
  if (hints.length === 0) return null;

  return (
    <section aria-label="Hints from the source" className={cn("space-y-1.5", className)}>
      {hints.map((hint, index) => {
        const shown = open.includes(index);
        return (
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card" key={index}>
            <button
              aria-expanded={shown}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--color-background-elevated-secondary)]"
              onClick={() => setOpen((current) => shown ? current.filter((item) => item !== index) : [...current, index])}
              type="button"
            >
              <Lightbulb className="size-3.5 shrink-0 text-[var(--warning)]" />
              <span className="min-w-0 flex-1 text-ui font-medium">Hint {index + 1}</span>
              <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !shown && "-rotate-90")} />
            </button>
            {shown && (
              <div className="border-t border-border/70 px-3 py-2">
                <ProblemStatement language={language} source={hint} />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
