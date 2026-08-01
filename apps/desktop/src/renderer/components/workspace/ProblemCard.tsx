import { useState } from "react";
import { ChevronDown, Target } from "lucide-react";
import type { ActiveQuestion } from "@pracai/domain";
import { cn } from "@/lib/utils";
import { ChallengeEmblem } from "./ChallengeEmblem";
import { ProblemStatement } from "./ProblemStatement";

const DIFFICULTY_TONE: Record<ActiveQuestion["difficulty"], string> = {
  foundation: "text-[var(--success)] bg-[var(--success)]/12",
  developing: "text-[var(--warning)] bg-[var(--warning)]/14",
  proficient: "text-[var(--warning)] bg-[var(--warning)]/18",
  advanced: "text-destructive bg-destructive/12",
};

const DIFFICULTY_LABEL: Record<ActiveQuestion["difficulty"], string> = {
  foundation: "Foundation",
  developing: "Developing",
  proficient: "Proficient",
  advanced: "Advanced",
};

export function DifficultyPill({ difficulty }: { difficulty: ActiveQuestion["difficulty"] }) {
  return (
    <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-ui-sm font-medium", DIFFICULTY_TONE[difficulty])}>
      {DIFFICULTY_LABEL[difficulty]}
    </span>
  );
}

/**
 * The challenge as the agent handed it over: an artifact at the head of the
 * conversation rather than a separate reference tab. It collapses so a long
 * working session can push it out of the way without losing it.
 */
export function ProblemCard({ question }: { question: ActiveQuestion }) {
  const [open, setOpen] = useState(true);
  const [whyOpen, setWhyOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--app-shadow-card)]">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <ChallengeEmblem className="shrink-0" question={question} size={34} />
        <span className="min-w-0 flex-1">
          <span className="block text-ui-sm font-medium tracking-[0.06em] text-muted-foreground/80">CHALLENGE SET FOR YOU</span>
          <span className="block truncate text-ui font-medium">{question.abilityTitle}</span>
        </span>
        {/* Title and difficulty live in the always-visible header above this card. */}
        <button
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setOpen((value) => !value)}
          title={open ? "Collapse the statement" : "Expand the statement"}
          type="button"
        >
          <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        </button>
      </div>

      <div className="border-t border-border/70 px-3 py-2.5">
        {open ? (
          <>
            <ProblemStatement source={question.statement} />

            <div className="mt-3 rounded-lg border border-border bg-[var(--color-background-elevated-secondary)]">
              <button
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
                onClick={() => setWhyOpen((value) => !value)}
                type="button"
              >
                <Target className="size-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-ui font-medium">Why this problem — {question.abilityTitle}</span>
                <ChevronDown className={cn("size-3 shrink-0 text-muted-foreground transition-transform", !whyOpen && "-rotate-90")} />
              </button>
              {whyOpen && (
                <div className="space-y-1.5 border-t border-border/70 px-2 py-1.5 text-ui leading-[1.6]">
                  <p className="text-foreground/85">{question.specificGap}</p>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground/70">Evidence wanted: </span>
                    {question.desiredEvidence}
                  </p>
                  {question.avoidTesting.length > 0 && (
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground/70">Not under test: </span>
                      {question.avoidTesting.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <button
            className="w-full truncate text-left text-ui text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setOpen(true)}
            type="button"
          >
            Statement collapsed — {question.abilityTitle}
          </button>
        )}
      </div>
    </div>
  );
}
