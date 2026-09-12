import { useMemo } from "react";
import { ArrowUpRight, ChevronRight, Layers3, Sparkles, Target } from "lucide-react";
import type { AbilityHistorySummary, ChallengeHistorySummary, ConceptSummary } from "@spar/domain";
import { cn } from "@/lib/utils";
import { relativeTime, shortTime } from "@/lib/format";
import { CONCEPT_KIND_SHORT, CONCEPT_KIND_VAR, conceptTree, standingOf } from "@/lib/concepts";
import { EmptyState } from "../common/EmptyState";
import { ConceptChip } from "../concepts/ConceptChip";
import { Standing } from "../concepts/ConceptSheet";
import { Panel } from "../common/Page";
import { STATUS, StatusRing } from "./status";

/**
 * The two ways into the detail: by what you can do, or by what it is about.
 *
 * Abilities are Spar's claims and concepts are the subject matter those claims
 * are made in, so they are two views of one library rather than two features.
 */
export function AbilitiesView({ challenges, earned, forming, onOpen, onOpenConcept, summaries }: {
  challenges: ChallengeHistorySummary[];
  earned: AbilityHistorySummary[];
  forming: AbilityHistorySummary[];
  onOpen(id: string): void;
  onOpenConcept(slug: string): void;
  summaries: Map<string, ConceptSummary>;
}) {
  if (!earned.length && !forming.length) {
    return (
      <EmptyState description="Spar grants one once your submissions back it up." icon={Sparkles} title="No abilities yet" />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {earned.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {earned.map((ability) => (
            <AbilityCard
              ability={ability}
              challenges={challenges}
              key={ability.id}
              onOpen={() => onOpen(ability.id)}
              onOpenConcept={onOpenConcept}
              summaries={summaries}
            />
          ))}
        </div>
      )}

      {/* Quieter and listed rather than carded, because these are not yet claims
          about the learner — they are what Spar is currently trying to find out. */}
      {forming.length > 0 && (
        <section>
          <h3 className="mb-1.5 px-1 text-ui-sm font-medium text-muted-foreground/80">Being tested</h3>
          <div className="flex flex-col">
            {forming.map((ability) => (
              <button
                className="group flex items-center gap-2.5 rounded-[var(--radius-md)] px-2 py-2 text-left transition-colors hover:bg-accent/35"
                key={ability.id}
                onClick={() => onOpen(ability.id)}
                type="button"
              >
                <Target className="size-3.5 shrink-0 text-muted-foreground/60" />
                <span className="min-w-0 flex-1 truncate text-ui text-foreground/85">{ability.title}</span>
                <span className="shrink-0 text-ui-sm text-muted-foreground/65">{shortTime(ability.updatedAt)}</span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * One earned ability.
 *
 * The summary sentence is the card, not the title: "Two-pointer passes" is a
 * filing label, and "you can hold two indices under a rule instead of scanning
 * twice" is the thing worth reading. The concepts under it are how the learner
 * gets from the claim to the evidence behind it.
 */
function AbilityCard({ ability, challenges, onOpen, onOpenConcept, summaries }: {
  ability: AbilityHistorySummary;
  challenges: ChallengeHistorySummary[];
  onOpen(): void;
  onOpenConcept(slug: string): void;
  summaries: Map<string, ConceptSummary>;
}) {
  const status = STATUS[ability.status];

  return (
    /* Card-wide action as an overlay button rather than a click handler on the
       article: the concept chips inside are controls of their own, so the card
       cannot be a button, and a div that only responds to a mouse is not one. */
    <Panel
      className={cn(
        "group relative flex flex-col p-3.5 transition-colors duration-150",
        "hover:border-[var(--border-strong)] focus-within:border-[var(--border-strong)]",
      )}
      role="article"
    >
      <button
        aria-label={`Open ${ability.title}`}
        className="absolute inset-0 z-0 rounded-[var(--radius-xl)] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={onOpen}
        type="button"
      />
      <div className="pointer-events-none relative z-10 flex items-start gap-2.5">
        <StatusRing status={ability.status} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-content font-semibold tracking-[-0.01em]">{ability.title}</h3>
          <p className={cn("text-ui-sm font-medium", status.text)}>{status.label}</p>
        </div>
        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
      </div>

      <p className="pointer-events-none relative z-10 mt-2 line-clamp-2 text-ui leading-[1.6] text-muted-foreground">
        {ability.summary || firstLine(ability.markdown)}
      </p>

      {ability.concepts.length > 0 && (
        <div className="relative z-10 mt-2.5 flex flex-wrap gap-1">
          {ability.concepts.slice(0, 3).map((tag) => (
            <ConceptChip
              challenges={challenges}
              key={tag.slug}
              onOpen={onOpenConcept}
              tag={tag}
              {...(summaries.get(tag.slug) ? { summary: summaries.get(tag.slug)! } : {})}
            />
          ))}
          {ability.concepts.length > 3 && <span className="self-center text-ui-sm text-muted-foreground/70">+{ability.concepts.length - 3}</span>}
        </div>
      )}

      <p className="pointer-events-none relative z-10 mt-2.5 text-ui-sm text-muted-foreground/65">
        {ability.evidenceCount} evidence
        {ability.earnedAt && ` · ${relativeTime(ability.earnedAt)}`}
      </p>
    </Panel>
  );
}

/**
 * The concept map. Grouped by kind and then by area, with each area's own bar
 * above the sub-concepts that produced it — so the shape of "fine on average,
 * failing in one specific place" is visible without opening anything.
 */
export function ConceptsView({ challenges, concepts, onOpenConcept, summaries }: {
  challenges: ChallengeHistorySummary[];
  concepts: ConceptSummary[];
  onOpenConcept(slug: string): void;
  summaries: Map<string, ConceptSummary>;
}) {
  const groups = useMemo(() => {
    const tree = conceptTree(concepts);
    return (["dsa", "engineering", "craft"] as const)
      .map((kind) => ({ kind, areas: tree.filter((entry) => entry.area.kind === kind) }))
      .filter((group) => group.areas.length > 0);
  }, [concepts]);

  if (!concepts.length) {
    return (
      <EmptyState description="Challenges are tagged with what they test. Tags collect here as you submit." icon={Layers3} title="No concepts yet" />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map(({ kind, areas }) => (
        <section key={kind}>
          <h3 className="mb-1.5 flex items-center gap-1.5 px-1 text-ui-sm font-medium text-muted-foreground/80">
            <span aria-hidden className="size-1.5 rounded-full" style={{ background: CONCEPT_KIND_VAR[kind] }} />
            {CONCEPT_KIND_SHORT[kind]}
          </h3>
          <div className="flex flex-col gap-2">
            {areas.map(({ area, children }) => (
              <Panel className="px-3.5 py-2.5" key={area.slug} role="article">
                <div className="flex items-start gap-3">
                  <button
                    className="min-w-0 flex-1 text-left outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring/60"
                    onClick={() => onOpenConcept(area.slug)}
                    type="button"
                  >
                    <h4 className="truncate text-content font-semibold hover:underline">{area.title}</h4>
                  </button>
                  <AreaStanding concept={area} />
                </div>

                <Standing className="mt-2 pb-0" compact concept={area} />

                {children.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1 border-t border-border/60 pt-2.5">
                    {children.map((child) => (
                      <ConceptChip challenges={challenges} concept={child} key={child.slug} onOpen={onOpenConcept} summary={summaries.get(child.slug) ?? child} />
                    ))}
                  </div>
                )}
              </Panel>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The area's verdict as a word plus a hairline bar, right-aligned so a column of
 *  areas can be scanned down rather than read across. */
function AreaStanding({ concept }: { concept: ConceptSummary }) {
  const { label, tone } = standingOf(concept);
  return (
    <div className="shrink-0 text-right">
      <p className={cn("text-ui font-medium", tone)}>{label}</p>
      {concept.abilityCount > 0 && (
        <p className="text-ui-sm text-muted-foreground/70">
          {concept.abilityCount} abilit{concept.abilityCount === 1 ? "y" : "ies"}
        </p>
      )}
    </div>
  );
}

/** The first real line of the ledger document, for a card with no summary yet. */
function firstLine(markdown: string): string {
  return markdown.replace(/^#+\s*.*$/gm, "").replace(/\s+/g, " ").trim().slice(0, 220) || "No description recorded yet.";
}
