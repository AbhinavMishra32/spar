import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, FlaskConical, Lightbulb, Target, TriangleAlert } from "lucide-react";
import type { ActiveQuestion } from "@spar/domain";
import { cn } from "@/lib/utils";
import { declaredCases, sourcedCases } from "@/lib/testCases";
import { presentSourcedStatement } from "@/lib/sourcedStatement";
import { ChallengeEmblem } from "./ChallengeEmblem";
import { ProblemStatement } from "./ProblemStatement";
import { ConceptChip } from "../concepts/ConceptChip";
import { SourceBadge } from "../common/SourceBadge";
import { SourceGlyph } from "../common/SourceGlyph";

/**
 * The challenge on its own terms: statement, the cases it will be graded
 * against, and why it was set. No transcript, so a long conversation cannot
 * push the problem out of reach when you need to re-read it mid-attempt.
 */
export function ProblemView({
  onOpenExternal,
  question,
  testFiles,
}: {
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
  const [whyOpen, setWhyOpen] = useState(false);
  const [openHints, setOpenHints] = useState<number[]>([]);
  const presented = useMemo(
    () => presentSourcedStatement(question.statement, question.source),
    [question.source, question.statement],
  );

  const active = declared.cases.find((item) => item.id === selected) ?? declared.cases[0];

  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[46rem] px-4 pb-8 pt-4">
        <div className="mb-4 flex items-center gap-2.5">
          <ChallengeEmblem className="shrink-0" question={question} size={38} />
          <div className="min-w-0 flex-1">
            {/* A sourced challenge is not "set for you" in the same sense: it is a
                real problem the world already asks, chosen for you. Saying the
                same words over both would overclaim one and undersell the other. */}
            <p className="text-ui-sm font-medium tracking-[0.06em] text-muted-foreground/80">
              {question.source ? "CHOSEN FOR YOU" : "CHALLENGE SET FOR YOU"}
            </p>
            <p className="truncate text-content font-medium">{question.abilityTitle}</p>
          </div>
          {question.source && (
            <SourceBadge
              source={question.source}
              {...(onOpenExternal ? { onOpen: onOpenExternal } : {})}
            />
          )}
        </div>

        {/* What it is training, while it is still being worked on. No hover card
            and no link: mid-challenge is the wrong moment to send someone off to
            read their own history, and naming the concept is the whole value. */}
        {question.concepts.length > 0 && (
          <div className="mb-4 -mt-1.5 flex flex-wrap gap-1">
            {question.concepts.map((concept) => <ConceptChip key={concept.slug} showArea tag={concept} />)}
          </div>
        )}

        <ProblemStatement source={presented.statement} />

        {question.source?.localRunNote && (
          <div className="mt-4 flex items-start gap-2 rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--warning)_30%,var(--border))] bg-[color-mix(in_oklab,var(--warning)_6%,transparent)] px-3 py-2 text-ui leading-[1.55] text-muted-foreground">
            <TriangleAlert className="mt-[0.15em] size-3.5 shrink-0 text-[var(--warning)]" />
            <p><span className="font-medium text-foreground/80">Local run unavailable. </span>{question.source.localRunNote}</p>
          </div>
        )}

        {question.source?.source === "leetcode" && presented.hints.length > 0 && (
          <section className="mt-4 space-y-1.5" aria-label="LeetCode hints">
            {presented.hints.map((hint, index) => {
              const open = openHints.includes(index);
              return (
                <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card" key={index}>
                  <button
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--color-background-elevated-secondary)]"
                    onClick={() => setOpenHints((current) => open ? current.filter((item) => item !== index) : [...current, index])}
                    type="button"
                  >
                    <Lightbulb className="size-3.5 shrink-0 text-[var(--warning)]" />
                    <span className="min-w-0 flex-1 text-ui font-medium">Hint {index + 1}</span>
                    <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
                  </button>
                  {open && (
                    <div className="border-t border-border/70 px-3 py-2">
                      <ProblemStatement source={hint} />
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {declared.cases.length > 0 && active && (
          <section className="mt-5">
            <p className="mb-2 flex items-center gap-1.5 text-ui-sm font-medium tracking-[0.06em] text-muted-foreground/80">
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
              <p className="border-b border-border/70 px-3 py-2 text-ui font-medium">{active.name}</p>
              {active.assertions.length > 0 ? (
                <div className="divide-y divide-border/60">
                  {active.assertions.map((assertion, index) => (
                    <div className="flex min-w-0 flex-col gap-1 px-3 py-2" key={index}>
                      <code className="min-w-0 break-words font-mono text-ui-sm text-foreground/85">{assertion.call}</code>
                      <span className="flex min-w-0 items-start gap-1.5">
                        <ArrowRight className="mt-[0.15em] size-3 shrink-0 text-muted-foreground/60" />
                        <code className="min-w-0 break-words font-mono text-ui-sm text-[var(--success)]">
                          {assertion.expected}
                        </code>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-3 py-2 text-ui text-muted-foreground">
                  {active.file
                    ? `This case asserts something the reader cannot summarise — open ${active.file} to read it in full.`
                    : "This case published no expected value, so there is nothing to assert against here."}
                </p>
              )}
            </div>
          </section>
        )}

        <div className="mt-4 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-[var(--color-background-elevated-secondary)]">
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left"
            onClick={() => setWhyOpen((value) => !value)}
            type="button"
          >
            <Target className="size-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-ui font-medium">Why this problem</span>
            <ChevronDown className={cn("size-3 shrink-0 text-muted-foreground transition-transform", !whyOpen && "-rotate-90")} />
          </button>
          {whyOpen && (
            <div className="space-y-1.5 border-t border-border/70 px-3 py-2 text-ui leading-[1.6]">
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
      </div>
    </div>
  );
}
