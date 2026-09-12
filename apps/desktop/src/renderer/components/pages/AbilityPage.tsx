import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Dumbbell } from "lucide-react";
import type { AbilityDetail as AbilityDetailData, AbilityHistorySummary, ConceptSummary } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime, shortTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { LanguageMark } from "../common/LanguageGlyph";
import { Markdown } from "../agent/Markdown";
import { ConceptChip, OutcomeMark } from "../concepts/ConceptChip";
import { SparDots } from "@/components/common/SparDots";
import { Band, Meter, Page } from "../common/Page";
import { STATUS, StatusRing } from "../progress/status";

/**
 * One ability: the claim, what it rests on, and what to do about it.
 *
 * One column, read straight down. The two-column version put the numbers in a
 * boxed rail beside the argument, which made the page look like a dashboard
 * about a thing rather than the thing — and boxed six one-line sections into six
 * separate cards, so a page with about a paragraph of real content read as a
 * form. Here the claim leads, the measurements are one inline row under it, and
 * everything after is a list with a label.
 *
 * Practice is why this page exists rather than being a bigger card. An ability
 * the learner cannot act on is a certificate; the drills turn it into a door,
 * and each one opens a real session aimed by the agent.
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

  useEffect(() => {
    setDetail(null);
    if (!api) return;
    let live = true;
    void api.readAbility(abilityId).then((next) => { if (live) setDetail(next); }).catch(() => undefined);
    return () => { live = false; };
  }, [abilityId, api]);

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
  const passed = detail?.evidence.filter((item) => item.outcome === "passed").length ?? 0;

  return (
    <Page>
      <button
        className="mb-6 inline-flex items-center gap-1.5 text-ui text-muted-foreground transition-colors hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft className="size-3.5" />
        Progress
      </button>

      <header className="flex items-start gap-3">
        <StatusRing size={34} status={ability.status} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.5rem] font-semibold leading-[1.15] tracking-[-0.035em]">{ability.title}</h1>
          <p className="mt-0.5 text-ui">
            <span className={status.text}>{status.label}</span>
            <span className="text-muted-foreground"> · {status.blurb.toLowerCase()}</span>
          </p>
        </div>
      </header>

      {ability.summary && <p className="mt-4 text-content leading-[1.7] text-foreground/85">{ability.summary}</p>}

      {/* The measurements, inline. Proficiency and confidence are the two halves
          of the model and are drawn identically on purpose — the whole point is
          that they can disagree. */}
      {detail?.machine && (
        <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-3">
          <Gauge label="Proficiency" value={detail.machine.proficiency} />
          <Gauge label="Confidence" value={detail.machine.confidence} />
        </div>
      )}

      <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui text-muted-foreground">
        <span>{detail ? `${passed} of ${detail.evidence.length} passed` : "…"}</span>
        <span aria-hidden>·</span>
        <span>{ability.evidenceCount} evidence</span>
        {detail?.machine && <><span aria-hidden>·</span><span>{TREND[detail.machine.trend] ?? detail.machine.trend}</span></>}
        <span aria-hidden>·</span>
        <span>{ability.earnedAt ? "earned" : "introduced"} {relativeTime(ability.earnedAt ?? ability.updatedAt)}</span>
        <span aria-hidden>·</span>
        <span>v{ability.version}</span>
      </p>

      {ability.concepts.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {ability.concepts.map((tag) => (
            <ConceptChip
              key={tag.slug}
              onOpen={onOpenConcept}
              showArea
              tag={tag}
              {...(summaries.get(tag.slug) ? { summary: summaries.get(tag.slug)! } : {})}
            />
          ))}
        </div>
      )}

      {detail?.machine?.currentBelief && (
        <Band title="Belief">
          <p className="text-content leading-[1.7] text-foreground/85">{detail.machine.currentBelief}</p>
          {detail.machine.nextVerification && (
            <p className="mt-2 text-ui leading-[1.65] text-muted-foreground">Checking next: {detail.machine.nextVerification}</p>
          )}
        </Band>
      )}

      <Band title="Practice">
        {ability.practice.length ? (
          <div className="flex flex-col">
            {ability.practice.map((drill, index) => (
              <button
                className="group -mx-2 flex items-start gap-2.5 rounded-[var(--radius-md)] px-2 py-2 text-left transition-colors hover:bg-accent/35"
                key={index}
                onClick={() => onPractise({ abilityId: ability.id, drill })}
                type="button"
              >
                <Dumbbell className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" />
                <span className="min-w-0 flex-1 text-ui leading-[1.6] text-foreground/85">{drill}</span>
                <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-ui text-muted-foreground/70">No drills written yet.</p>
            <Button onClick={() => onPractise({ abilityId: ability.id })} size="sm" variant="secondary">
              <Dumbbell />
              Practise
            </Button>
          </div>
        )}
      </Band>

      <Band title="Attempts">
        {detail ? (
          detail.evidence.length ? (
            <div className="flex flex-col">
              {detail.evidence.map((item) => (
                <button
                  className="group -mx-2 flex items-center gap-2.5 rounded-[var(--radius-md)] px-2 py-2 text-left transition-colors hover:bg-accent/35"
                  key={item.challengeId}
                  onClick={() => onOpenSession(item.sessionId)}
                  type="button"
                >
                  <OutcomeMark outcome={item.outcome} />
                  <LanguageMark language={item.language} />
                  <span className="min-w-0 flex-1 truncate text-ui text-foreground/90">{item.title}</span>
                  <span className="shrink-0 text-ui-sm text-muted-foreground/65">{item.difficulty}</span>
                  <span className="shrink-0 tabular-nums text-ui-sm text-muted-foreground/65">{shortTime(item.occurredAt)}</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-ui text-muted-foreground/60">None yet</p>
          )
        ) : (
          <p className="flex items-center gap-2 text-ui text-muted-foreground"><SparDots pattern="pulse" size={16} />Reading evidence…</p>
        )}
      </Band>

      {detail?.learnerEvidence.length ? (
        <Band title="Evidence">
          <div className="flex flex-col gap-2.5">
            {detail.learnerEvidence.map((item) => (
              <div className="flex items-baseline gap-2.5" key={item.id}>
                <span
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    item.polarity === "supporting" ? "bg-[var(--success)]" : item.polarity === "contradictory" ? "bg-destructive" : "bg-muted-foreground/50",
                  )}
                />
                <span className="min-w-0 flex-1 text-ui leading-[1.6] text-foreground/85">{item.statement}</span>
                <span className="shrink-0 text-ui-sm capitalize text-muted-foreground/65">{item.independence}</span>
                <span className="shrink-0 tabular-nums text-ui-sm text-muted-foreground/65">{shortTime(item.occurredAt)}</span>
              </div>
            ))}
          </div>
        </Band>
      ) : null}

      {/* The one place a pattern's own prose belongs, because this is the ability
          it was written against. */}
      {detail?.patterns.length ? (
        <Band title="Patterns">
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
        </Band>
      ) : null}

      {/* Last, and labelled as notes: this is the agent's working document, and
          the learner reading their own ledger should meet the claim first. */}
      {ability.markdown.trim() && (
        <Band className="mt-8 border-t-[length:var(--hairline)] border-[var(--border-surface-strong)] pt-6" title="Notes">
          <div className="text-ui leading-[1.7] text-muted-foreground">
            <Markdown source={ability.markdown} />
          </div>
        </Band>
      )}
    </Page>
  );
}

/** A proportion with its number said out loud, sized so the bar is obviously a
 *  gauge and never an underline of the label above it. */
function Gauge({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-ui text-muted-foreground">{label}</span>
      <Meter className="w-20" value={value} />
      <span className="tabular-nums text-ui">{Math.round(value * 100)}%</span>
    </div>
  );
}

const TREND: Record<string, string> = { improving: "Improving", stable: "Stable", declining: "Declining", unknown: "Trend unknown" };
