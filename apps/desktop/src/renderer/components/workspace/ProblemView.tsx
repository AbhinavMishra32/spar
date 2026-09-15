import { useMemo, useRef, useState } from "react";
import { ArrowRight, FlaskConical } from "lucide-react";
import type { ActiveQuestion, RatingPoint } from "@spar/domain";
import { cn } from "@/lib/utils";
import { declaredCases, sourcedCases } from "@/lib/testCases";
import { ChallengeBrief } from "./ChallengeBrief";
import { ChallengeRoll } from "./ChallengeRoll";
import { type ConceptContext } from "../concepts/ConceptChip";
import { SourceGlyph } from "../common/SourceGlyph";

/**
 * The challenge on its own terms: statement, the cases it will be graded
 * against, and why it was set. No transcript, so a long conversation cannot
 * push the problem out of reach when you need to re-read it mid-attempt.
 */
export function ProblemView({
  concepts,
  learnerRating,
  onOpenExternal,
  question,
  testFiles,
}: {
  /** What the concept chips need to preview and open. */
  concepts?: ConceptContext | undefined;
  /** The learner's rating, for pitching this problem against them. */
  learnerRating?: RatingPoint | null | undefined;
  /** Opens the problem at its source in the real browser. */
  onOpenExternal?: ((url: string) => void) | undefined;
  question: ActiveQuestion;
  testFiles: Record<string, string>;
}) {
  /* A sourced problem publishes its own cases, so they are read from the challenge
     rather than lifted back out of the test file Spar generated from them. The
     parser is for challenges written as `test(…)` blocks, which is every generated
     one and no sourced one. */
  const declared = useMemo(
    () => (question.source?.cases.length
      ? sourcedCases(question.source)
      : declaredCases(testFiles, question.visibleTestFiles)),
    [question.source, testFiles, question.visibleTestFiles],
  );
  const [selected, setSelected] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  const active = declared.cases.find((item) => item.id === selected) ?? declared.cases[0];

  return (
    <div className="app-scroll h-full overflow-y-auto" ref={scroller}>
      {/* One column, and the vertical rhythm is owned here rather than by each
          block's own bottom margin: the header, the chips and the statement are
          three sizes of type in a row, and spacing set per block is what left a
          negative margin cancelling a positive one further down. */}
      <ChallengeRoll
        className="mx-auto w-full max-w-[46rem] px-5 pb-10 pt-5"
        ordinal={question.ordinal}
        scroller={scroller}
        stopId={question.id}
      >
        <ChallengeBrief
          brief={question}
          conceptContext={concepts}
          {...(onOpenExternal ? { onOpenExternal } : {})}
        >
        {declared.cases.length > 0 && active && (
          <section className="mt-5">
            <p className="mb-2 flex items-center gap-1.5 text-content-sm font-medium tracking-[0.06em] text-muted-foreground/80">
              <FlaskConical className="size-3" />
              SAMPLE CASES
              {/* Whose cases these are. A sourced problem's samples are published
                  with it and are not the whole suite — the hidden ones stay at the
                  source, and saying so here is what stops these reading as
                  everything the submission will face. */}
              {question.source && (
                <span className="inline-flex items-center gap-1 font-normal normal-case tracking-normal">
                  <span className="text-muted-foreground/50">·</span>
                  <SourceGlyph className="size-3 shrink-0" source={question.source.source} />
                  published with the problem
                </span>
              )}
            </p>

            {/* Chips rather than a list of every case expanded: the point is to
                scan one contract at a time, the way you would on a problem page. */}
            <div className="mb-2 flex flex-wrap gap-1">
              {declared.cases.map((item) => (
                <button
                  className={cn(
                    "h-6 shrink-0 rounded-[var(--radius-md)] px-2 text-ui transition-colors",
                    item.id === active.id
                      ? "bg-[var(--color-background-elevated-secondary)] font-medium text-foreground"
                      : "text-muted-foreground hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground",
                  )}
                  key={item.id}
                  onClick={() => setSelected(item.id)}
                  type="button"
                >
                  Case {item.ordinal}
                </button>
              ))}
            </div>

            <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card">
              <p className="border-b border-border/70 px-3 py-2 text-content font-medium">{active.name}</p>
              {active.assertions.length > 0 ? (
                <div className="divide-y divide-border/60">
                  {active.assertions.map((assertion, index) => (
                    <div className="flex min-w-0 flex-col gap-1 px-3 py-2" key={index}>
                      <code className="min-w-0 break-words font-mono text-content-sm text-foreground/85">{assertion.call}</code>
                      <span className="flex min-w-0 items-start gap-1.5">
                        <ArrowRight className="mt-[0.15em] size-3 shrink-0 text-muted-foreground/60" />
                        <code className="min-w-0 break-words font-mono text-content-sm text-[var(--success)]">
                          {assertion.expected}
                        </code>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-3 py-2 text-content text-muted-foreground">
                  {active.file
                    ? `This case asserts something the reader cannot summarise — open ${active.file} to read it in full.`
                    : "This case published no expected value, so there is nothing to assert against here."}
                </p>
              )}
            </div>
          </section>
        )}

        </ChallengeBrief>
      </ChallengeRoll>
    </div>
  );
}
