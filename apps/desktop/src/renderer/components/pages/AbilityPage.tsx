import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import type { AbilityDetail as AbilityDetailData, AbilityHistorySummary, ConceptSummary } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime, shortTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { LanguageMark } from "../common/LanguageGlyph";
import { Markdown } from "../agent/Markdown";
import { ConceptChip, OutcomeMark } from "../concepts/ConceptChip";
import { SparDots } from "@/components/common/SparDots";
import { Band, Page, Panel } from "../common/Page";
import { STATUS, StatusRing } from "../progress/status";

/**
 * One ability, as an argument rather than a record.
 *
 * An ability is a claim Spar has made about the learner. So the page is built
 * the way a claim is: it says the thing, it says how far it will go, it says
 * what would settle it, and it shows the record it rests on — in that order,
 * and once each.
 *
 * Two structural decisions are the whole of this design.
 *
 * **Nothing on the strip is a restatement of something else on it.** The two
 * percentages that used to sit here were not measurements. Proficiency is a
 * constant per status in `reconcileAbilityState` — 0.82 *means* "independent",
 * so "82%" under the word "Fluent" was the same fact twice with a decimal point
 * added for authority. Confidence is `1 - e^(-n/3)`, which is the evidence count
 * wearing a percent sign. What replaced them is what those numbers were derived
 * from and cannot be read anywhere else: how the evidence splits for and
 * against, how the graded attempts went and how hard they were, and whether
 * Spar is still testing this or has left it alone.
 *
 * **There is one ledger, not two.** Attempts and the agent's observations used
 * to be a section and a disclosure, which put the graded record on the page and
 * hid the reasoning about it behind a toggle. They are the same story told at
 * two grains: what happened, and what Spar took from it. Interleaved by time
 * they read as the argument for the number at the top, which is exactly what a
 * learner is on this page to check.
 *
 * What stays behind the toggle is only what genuinely repeats the summary: the
 * belief statement, the standing patterns, and the agent's own notes.
 */
export function AbilityDetail({
  abilityId,
  api,
  fallback,
  onBack,
  onOpenConcept,
  onOpenSession,
  onPractise,
  summaries,
}: {
  abilityId: string;
  api: SparApi | undefined;
  fallback: AbilityHistorySummary | undefined;
  onBack(): void;
  onOpenConcept(slug: string): void;
  onOpenSession(sessionId: string): void;
  onPractise(input: { abilityId?: string; conceptSlug?: string; drill?: string }): void;
  summaries: Map<string, ConceptSummary>;
}) {
  const [detail, setDetail] = useState<AbilityDetailData | null>(null);
  const [notes, setNotes] = useState(false);

  useEffect(() => {
    setDetail(null);
    if (!api) return;
    let live = true;
    void api.readAbility(abilityId).then((next) => { if (live) setDetail(next); }).catch(() => undefined);
    return () => { live = false; };
  }, [abilityId, api]);

  /* The one ledger. Newest first, because the question it answers is "why does
     it say that *now*" — the oldest attempt is the least of the reasons. */
  const ledger = useMemo<Entry[]>(() => {
    if (!detail) return [];
    const attempts: Entry[] = detail.evidence.map((item) => ({ kind: "attempt", at: Date.parse(item.occurredAt) || 0, item }));
    const observations: Entry[] = detail.learnerEvidence.map((item) => ({ kind: "observation", at: Date.parse(item.occurredAt) || 0, item }));
    return [...attempts, ...observations].sort((a, b) => b.at - a.at);
  }, [detail]);

  const ability = detail?.ability ?? fallback;
  if (!ability) {
    return (
      <div className="grid h-full place-items-center">
        <p className="flex items-center gap-2 text-ui text-muted-foreground">
          <SparDots label="Opening ability" pattern="sweep" size={18} />Opening ability…
        </p>
      </div>
    );
  }

  const status = STATUS[ability.status];
  const attempts = detail?.evidence.length ?? 0;
  const passed = detail?.evidence.filter((item) => item.outcome === "passed").length ?? 0;
  /* How the agent's own notes split. This is what the confidence percentage was
     computed from, and unlike the percentage it says which way the evidence
     points as well as how much of it there is. */
  const signals = {
    for: detail?.learnerEvidence.filter((item) => item.polarity === "supporting").length ?? 0,
    against: detail?.learnerEvidence.filter((item) => item.polarity === "contradictory").length ?? 0,
    neutral: detail?.learnerEvidence.filter((item) => item.polarity === "neutral").length ?? 0,
    total: detail?.learnerEvidence.length ?? 0,
  };
  /* The hardest problem actually cleared. An ability held up by four foundation
     passes and one proficient failure is a different thing from the same counts
     the other way round, and the pass tally alone cannot tell them apart. */
  const hardest = detail?.evidence
    .filter((item) => item.outcome === "passed")
    .sort((a, b) => DIFFICULTY.indexOf(b.difficulty) - DIFFICULTY.indexOf(a.difficulty))[0]?.difficulty;
  const lastWorked = ledger[0]?.kind === "attempt" ? ledger[0].item.occurredAt : ledger[0]?.kind === "observation" ? ledger[0].item.occurredAt : null;

  return (
    <Page>
      <button
        className="mb-7 inline-flex items-center gap-1.5 text-ui text-muted-foreground transition-colors hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft className="size-3.5" />
        Progress
      </button>

      {/* The claim, said once, at the size of the thing the page is about. The
          status sits under the title rather than beside it: a coloured word set
          against a 24px heading is read as part of the name. */}
      <header>
        <div className="flex items-center gap-2.5">
          <StatusRing size={22} status={ability.status} />
          <span className={cn("text-ui font-medium", status.text)}>{status.label}</span>
          <span aria-hidden className="text-muted-foreground/40">·</span>
          <span className="text-ui text-muted-foreground">
            {ability.earnedAt ? "earned" : "introduced"} {relativeTime(ability.earnedAt ?? ability.updatedAt)}
          </span>
        </div>
        {/* The page has a verb, and it is at the top. Everything below is Spar
            reporting; this is the one control that changes anything, and burying
            it under the ledger made the page somewhere you read rather than
            somewhere you act. */}
        <div className="mt-3 flex items-start justify-between gap-6">
          <h1 className="text-[1.625rem] font-semibold leading-[1.12] tracking-[-0.035em]">{ability.title}</h1>
          <Button className="mt-0.5 shrink-0" onClick={() => onPractise({ abilityId: ability.id })} size="sm" variant="secondary">
            Practise this
          </Button>
        </div>
        {ability.summary && <p className="mt-3 max-w-[38rem] text-content leading-[1.65] text-foreground/85">{ability.summary}</p>}
      </header>

      {/* Three facts, none of which can be read off any other part of the page.
          A cell states the figure and then what the figure is made of, because
          "4 signals" is a number and "3 for, 1 against" is the reason to look
          further down. */}
      <Panel className="mt-7 grid grid-cols-3 divide-x divide-[var(--border-surface-strong)] overflow-hidden">
        <Cell label="Evidence">
          {signals.total ? (
            <>
              <p className="text-ui tabular-nums text-foreground/90">
                {signals.for} for{signals.against ? `, ${signals.against} against` : ""}
              </p>
              {/* On the line the other two cells use for their qualifier, because
                  the shape of the split is the qualifier. */}
              <Split against={signals.against} className="mt-[0.6875rem]" for={signals.for} neutral={signals.neutral} />
            </>
          ) : (
            <p className="text-ui text-muted-foreground/60">Nothing noted yet</p>
          )}
        </Cell>

        <Cell label="Graded">
          <p className="text-ui tabular-nums text-foreground/90">{attempts ? `${passed} of ${attempts} passed` : "No attempts"}</p>
          <p className="mt-2 text-ui-sm text-muted-foreground/70">
            {hardest ? `hardest cleared: ${hardest}` : attempts ? "none cleared yet" : "nothing set for this yet"}
          </p>
        </Cell>

        <Cell label="Last worked">
          <p className="text-ui text-foreground/90">{lastWorked ? relativeTime(lastWorked) : "Never"}</p>
          <p className="mt-2 text-ui-sm text-muted-foreground/70">
            {detail?.machine ? TRAINING[detail.machine.trainingStatus] ?? "" : ""}
          </p>
        </Cell>
      </Panel>

      {/* What would move those numbers. The target and the drills are one
          section because they are one thought: the target is the reason each
          drill exists, and a drill opens a session aimed at it. */}
      {(detail?.machine?.nextVerification || ability.practice.length || detail) && (
        <Band title="What would settle it">
          {detail?.machine?.nextVerification && (
            <p className="mb-3 max-w-[38rem] text-content leading-[1.65] text-foreground/85">
              Spar wants to see {lowerFirst(detail.machine.nextVerification)}
            </p>
          )}
          {ability.practice.length ? (
            <div className="flex flex-col">
              {ability.practice.map((drill, index) => (
                <button
                  className="group -mx-2 flex items-start gap-2.5 rounded-[var(--radius-md)] px-2 py-2 text-left transition-colors hover:bg-accent/35"
                  key={index}
                  onClick={() => onPractise({ abilityId: ability.id, drill })}
                  type="button"
                >
                  <ChevronRight className="mt-[0.2rem] size-3.5 shrink-0 text-muted-foreground/45 transition-colors group-hover:text-foreground" />
                  <span className="min-w-0 flex-1 text-ui leading-[1.6] text-foreground/85">{drill}</span>
                </button>
              ))}
            </div>
          ) : (
            <Button onClick={() => onPractise({ abilityId: ability.id })} size="sm" variant="secondary">
              Practise this
            </Button>
          )}
        </Band>
      )}

      {/* The record, and the reading of it, in one column down one rail. */}
      <Band
        action={attempts ? <span className="text-ui-sm text-muted-foreground/70">{passed} of {attempts} passed</span> : undefined}
        title="What it rests on"
      >
        {!detail ? (
          <p className="flex items-center gap-2 text-ui text-muted-foreground"><SparDots pattern="pulse" size={16} />Reading evidence…</p>
        ) : ledger.length ? (
          <div className="flex flex-col">
            {ledger.map((entry) => (entry.kind === "attempt" ? (
              <button
                className="group -mx-2 flex items-center gap-2.5 rounded-[var(--radius-md)] px-2 py-[0.4375rem] text-left transition-colors hover:bg-accent/35"
                key={entry.item.challengeId}
                onClick={() => onOpenSession(entry.item.sessionId)}
                type="button"
              >
                <OutcomeMark outcome={entry.item.outcome} />
                <span className="min-w-0 flex-1 truncate text-ui text-foreground/90">{entry.item.title}</span>
                <LanguageMark language={entry.item.language} />
                <span className="shrink-0 text-ui-sm text-muted-foreground/65">{entry.item.difficulty}</span>
                <span className="w-8 shrink-0 text-right tabular-nums text-ui-sm text-muted-foreground/65">{shortTime(entry.item.occurredAt)}</span>
              </button>
            ) : (
              /* An observation is Spar talking, so it is set in the agent's own
                 register — quieter than the graded row above it, aligned to the
                 same rail, and marked only by which way it cuts. */
              <div className="-mx-2 flex items-baseline gap-2.5 px-2 py-[0.4375rem]" key={entry.item.id}>
                <span
                  className={cn(
                    "relative top-[-0.125rem] size-1.5 shrink-0 rounded-full",
                    entry.item.polarity === "supporting" ? "bg-[var(--success)]" : entry.item.polarity === "contradictory" ? "bg-destructive" : "bg-muted-foreground/50",
                  )}
                  style={{ marginInline: "0.25rem" }}
                />
                <span className="min-w-0 flex-1 text-ui leading-[1.55] text-muted-foreground">{entry.item.statement}</span>
                <span className="w-8 shrink-0 text-right tabular-nums text-ui-sm text-muted-foreground/50">{shortTime(entry.item.occurredAt)}</span>
              </div>
            )))}
          </div>
        ) : (
          <p className="text-ui text-muted-foreground/60">Nothing graded yet</p>
        )}
      </Band>

      {/* Filed under. Last because it is where this sits in the library, not
          what it is — and it is the one row on the page that leads somewhere
          other than deeper into this ability. */}
      {ability.concepts.length > 0 && (
        <div className="mt-7 flex flex-wrap items-center gap-2">
          <span className="text-ui text-muted-foreground/70">Filed under</span>
          {ability.concepts.map((tag) => (
            <ConceptChip
              key={tag.slug}
              onOpen={onOpenConcept}
              tag={tag}
              {...(summaries.get(tag.slug) ? { summary: summaries.get(tag.slug)! } : {})}
            />
          ))}
        </div>
      )}

      {/* What is left is the agent restating itself: the belief in its own
          words, the standing patterns, and its working document. Worth keeping,
          not worth reading by default. */}
      {(detail?.machine?.currentBelief || detail?.patterns.length || ability.markdown.trim()) && (
        <div className="mt-8 border-t-[length:var(--hairline)] border-[var(--border-surface-strong)] pt-4">
          <button
            aria-expanded={notes}
            className="inline-flex items-center gap-1 text-ui text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setNotes((open) => !open)}
            type="button"
          >
            Spar's working notes
            <ChevronDown className={cn("size-3 transition-transform", notes && "rotate-180")} />
          </button>

          {notes && (
            <div className="mt-4 flex flex-col gap-6">
              {detail?.machine?.currentBelief && (
                <section>
                  <h2 className="mb-1.5 text-ui text-muted-foreground">Belief</h2>
                  <p className="text-ui leading-[1.7] text-foreground/85">{detail.machine.currentBelief}</p>
                </section>
              )}

              {detail?.patterns.length ? (
                <section>
                  <h2 className="mb-1.5 text-ui text-muted-foreground">Patterns</h2>
                  <div className="flex flex-col gap-3">
                    {detail.patterns.map((pattern) => (
                      <div key={pattern.id}>
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="min-w-0 text-ui">{pattern.title}</p>
                          <span className="shrink-0 text-ui-sm capitalize text-muted-foreground/65">{pattern.status}</span>
                        </div>
                        {pattern.description && <p className="mt-0.5 text-ui leading-[1.6] text-muted-foreground">{pattern.description}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {ability.markdown.trim() && (
                <div className="text-ui leading-[1.7] text-muted-foreground">
                  <Markdown source={ability.markdown} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Page>
  );
}

/** One row of the ledger: something that was graded, or something Spar noticed. */
type Entry =
  | { kind: "attempt"; at: number; item: AbilityDetailData["evidence"][number] }
  | { kind: "observation"; at: number; item: AbilityDetailData["learnerEvidence"][number] };

/** One cell of the strip: what it is, then the figure, then what the figure is
 *  made of. Fixed order so the three read across as one line. */
function Cell({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="px-4 py-3.5">
      <p className="mb-1.5 text-ui-sm uppercase tracking-[0.06em] text-muted-foreground/60">{label}</p>
      {children}
    </div>
  );
}

/**
 * The evidence, as the shape it actually has.
 *
 * One segment per note rather than a proportion bar: with four notes on a
 * typical ability, a bar 75% full is a harder read than three ticks and a gap,
 * and it invites the question "75% of what" — which has no answer.
 */
function Split({ against, className, for: supporting, neutral }: { against: number; className?: string; for: number; neutral: number }) {
  const segments = [
    ...Array.from({ length: supporting }, () => "bg-[var(--success)]"),
    ...Array.from({ length: neutral }, () => "bg-muted-foreground/40"),
    ...Array.from({ length: against }, () => "bg-destructive"),
  ];
  return (
    <span aria-hidden className={cn("flex h-[3px] gap-[3px]", className)}>
      {segments.map((tone, index) => (
        <span className={cn("h-full min-w-1 flex-1 rounded-full", tone)} key={index} />
      ))}
    </span>
  );
}

/** The verification note is written as a sentence and is being spliced into one
 *  here, so its first letter has to give way — unless it opens on something that
 *  is capitalised in its own right. */
function lowerFirst(value: string) {
  const rest = value.slice(1);
  return rest === rest.toLowerCase() ? value.charAt(0).toLowerCase() + rest : value;
}

/** Hardest first when reversed, so the order is the comparison. */
const DIFFICULTY = ["foundation", "developing", "proficient", "advanced"];

/** What Spar is doing about this ability, which is the part that says whether
 *  coming back tomorrow will show anything new. */
const TRAINING: Record<string, string> = {
  unknown: "not scheduled",
  diagnosing: "Spar is diagnosing this",
  training: "in active training",
  monitoring: "Spar is monitoring this",
};
