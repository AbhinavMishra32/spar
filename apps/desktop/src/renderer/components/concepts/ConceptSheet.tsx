import { useEffect, useState } from "react";
import { ArrowUpRight, Dumbbell, Sparkles } from "lucide-react";
import type { ConceptDetail, ConceptSummary } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { shortTime } from "@/lib/format";
import { CONCEPT_KIND_SHORT, CONCEPT_KIND_VAR, outcomeBands, standingOf } from "@/lib/concepts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Meter, MeterKey } from "@/components/ui/meter";
import { LanguageMark, languageOf } from "../common/LanguageGlyph";
import { OutcomeMark } from "./ConceptChip";
import { SparDots } from "@/components/common/SparDots";

/**
 * Everything the learner has done under one concept.
 *
 * Opens from any chip in the app, and it always opens instantly: the header and
 * the counts are drawn from the summary the caller already had, and the challenge
 * list fills in from the store underneath. A modal that shows a spinner where its
 * own title should be reads as slow even when the read takes a millisecond.
 */
export function ConceptSheet({
  api,
  onOpenChange,
  onOpenSession,
  onPractise,
  slug,
  summaries,
}: {
  api: SparApi | undefined;
  onOpenChange(open: boolean): void;
  onOpenSession(sessionId: string): void;
  onPractise(slug: string): void;
  slug: string | null;
  summaries: Map<string, ConceptSummary>;
}) {
  const [detail, setDetail] = useState<ConceptDetail | null>(null);
  const known = slug ? summaries.get(slug) ?? null : null;

  useEffect(() => {
    setDetail(null);
    if (!slug || !api) return;
    let live = true;
    void api.readConcept(slug).then((next) => { if (live) setDetail(next); }).catch(() => undefined);
    return () => { live = false; };
  }, [api, slug]);

  const concept = detail?.concept ?? known;

  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(slug)}>
      <DialogContent className="max-h-[min(42rem,calc(100vh-4rem))] gap-0 overflow-hidden p-0 sm:max-w-[34rem]">
        {concept ? (
          <div className="app-scroll flex max-h-[min(42rem,calc(100vh-4rem))] flex-col overflow-y-auto">
            <header className="px-4 pb-3 pt-4">
              <div className="flex items-start gap-2 pr-8">
                <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: CONCEPT_KIND_VAR[concept.kind] }} />
                <div className="min-w-0 flex-1">
                  <p className="text-ui-sm text-muted-foreground/80">
                    {concept.parentTitle ? `${CONCEPT_KIND_SHORT[concept.kind]} · ${concept.parentTitle}` : CONCEPT_KIND_SHORT[concept.kind]}
                  </p>
                  <DialogTitle className="mt-0.5 text-[1.05rem] font-semibold tracking-[-0.02em]">{concept.title}</DialogTitle>
                </div>
              </div>
              {concept.description && <p className="mt-2 text-ui leading-[1.65] text-muted-foreground">{concept.description}</p>}
            </header>

            <Standing className="px-4" concept={concept} />

            {/* The point of the whole feature: an area that averages out fine, with
                the one sub-concept that is not fine named underneath it. */}
            {detail?.children.length ? (
              <Section title="By sub-concept">
                <div className="flex flex-col gap-1.5">
                  {detail.children.map((child) => <SubConcept concept={child} key={child.slug} />)}
                </div>
              </Section>
            ) : null}

            {detail?.abilities.length ? (
              <Section title={detail.abilities.length === 1 ? "An ability covers this" : "Abilities covering this"}>
                <div className="flex flex-wrap gap-1.5">
                  {detail.abilities.map((ability) => (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-[var(--color-background-elevated-secondary)] px-2 py-1 text-ui" key={ability.id}>
                      <Sparkles className="size-3 text-muted-foreground" />
                      {ability.title}
                    </span>
                  ))}
                </div>
              </Section>
            ) : null}

            <Section title={detail ? `${detail.challenges.length} challenge${detail.challenges.length === 1 ? "" : "s"}` : "Challenges"}>
              {detail ? (
                detail.challenges.length ? (
                  <div className="flex flex-col">
                    {detail.challenges.map((challenge) => (
                      <button
                        className="group -mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-accent/40"
                        key={challenge.challengeId}
                        onClick={() => onOpenSession(challenge.sessionId)}
                        type="button"
                      >
                        <OutcomeMark outcome={challenge.outcome} />
                        {/* Resolved rather than cast: the evidence row carries the
                            language as plain text, and a value outside the three
                            Spar trains in has no mark rather than a broken one. */}
                        {languageOf(challenge.language) && <LanguageMark language={languageOf(challenge.language)!} />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ui text-foreground/90">{challenge.title}</span>
                          <span className="block truncate text-ui-sm text-muted-foreground/75">
                            {challenge.sessionTitle} · {challenge.difficulty}
                            {challenge.role === "primary" ? " · aimed here" : ""}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-ui-sm text-muted-foreground/70">{shortTime(challenge.occurredAt)}</span>
                        <ArrowUpRight className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-ui leading-[1.6] text-muted-foreground">
                    Nothing has been set under this yet. Practising it is how the first evidence gets here.
                  </p>
                )
              ) : (
                <p className="flex items-center gap-2 text-ui text-muted-foreground"><SparDots pattern="pulse" size={16} />Reading your history…</p>
              )}
            </Section>

            <footer className="sticky bottom-0 mt-auto flex items-center gap-2 border-t border-border bg-popover/95 px-4 py-3 backdrop-blur-sm">
              <p className="min-w-0 flex-1 text-ui-sm leading-[1.5] text-muted-foreground">
                Spar aims the first challenge at whatever your evidence here says is still uncertain.
              </p>
              <Button onClick={() => onPractise(concept.slug)} size="sm">
                <Dumbbell />
                Practise this
              </Button>
            </footer>
          </div>
        ) : (
          <div className="grid h-40 place-items-center">
            <p className="flex items-center gap-2 text-ui text-muted-foreground"><SparDots pattern="sweep" size={18} label="Opening" />Opening…</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="border-t border-border/70 px-4 py-3">
      <h3 className="mb-2 text-ui-sm font-medium text-muted-foreground/80">{title}</h3>
      {children}
    </section>
  );
}

/** The standing word, the bar, and the legend that makes the bar countable. */
export function Standing({ className, concept, compact = false }: { className?: string; concept: ConceptSummary; compact?: boolean }) {
  const { label, tone } = standingOf(concept);
  const bands = outcomeBands(concept);

  if (!concept.challengeCount) {
    return (
      <div className={cn("pb-3", className)}>
        <p className="text-ui text-muted-foreground">Untested — nothing recorded here yet.</p>
      </div>
    );
  }

  return (
    <div className={cn("pb-3", className)}>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className={cn("font-semibold tracking-[-0.02em]", compact ? "text-content" : "text-[1.05rem]", tone)}>{label}</span>
        <span className="text-ui text-muted-foreground">
          across {concept.challengeCount} challenge{concept.challengeCount === 1 ? "" : "s"}
          {concept.testRunCount > 0 && ` · ${concept.testRunCount} test run${concept.testRunCount === 1 ? "" : "s"}`}
          {concept.lastSeenAt && ` · last ${shortTime(concept.lastSeenAt)}`}
        </span>
      </div>
      <Meter animate={!compact} bands={bands} height="0.375rem" />
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {bands.filter((band) => band.value > 0).map((band) => <MeterKey band={band} key={band.key} />)}
      </div>
    </div>
  );
}

/** One sub-concept as a single line: name, standing, and its own bar. Same shape
 *  repeated so the eye can compare them down the column rather than read each. */
function SubConcept({ concept }: { concept: ConceptSummary }) {
  const { label, tone } = standingOf(concept);
  return (
    <div className="flex items-center gap-2.5">
      <span className="min-w-0 flex-[1.4] truncate text-ui text-foreground/85">{concept.title}</span>
      <Meter animate={false} bands={outcomeBands(concept)} className="flex-1" height="0.3125rem" />
      <span className={cn("w-12 shrink-0 text-right text-ui-sm font-medium", tone)}>{label}</span>
      <span className="w-8 shrink-0 text-right tabular-nums text-ui-sm text-muted-foreground/70">{concept.passedCount}/{concept.challengeCount}</span>
    </div>
  );
}
