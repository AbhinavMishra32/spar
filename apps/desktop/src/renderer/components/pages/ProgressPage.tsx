import { useMemo, useState } from "react";
import { Layers3, Sparkles } from "lucide-react";
import type { AbilityHistorySummary, ChallengeHistorySummary, ConceptSummary, LearnerProgress } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { ViewSwitch } from "@/components/ui/view-switch";
import { Band, Page, PageHeader } from "../common/Page";
import { AbilitiesView, ConceptsView } from "../progress/Browse";
import { RatingBand } from "../progress/Rating";
import { PatternsBand, StandingBand } from "../progress/Standing";
import { AbilityDetail } from "./AbilityPage";

type View = "abilities" | "concepts";

/**
 * Progress is the argument, not the scoreboard.
 *
 * The page is read top to bottom as one case: here is the number and why it
 * moved; here is what that breaks down into, split by how much Spar actually
 * knows; here is the habit it thinks it has caught you in; and here is the
 * library, if you want to check any of it yourself. Every claim on the page
 * opens the evidence behind it — that is the rule the layout exists to keep.
 *
 * What it deliberately is not is a grid of tiles. The old version opened with
 * four counts and a 40px sparkline, which is the shape of a page that has
 * measured something but has not decided what it means.
 */
export function ProgressPage({
  abilities,
  api,
  challenges,
  concepts,
  onOpenConcept,
  onOpenSession,
  onPractise,
  progress,
}: {
  abilities: AbilityHistorySummary[];
  api: SparApi | undefined;
  challenges: ChallengeHistorySummary[];
  concepts: ConceptSummary[];
  onOpenConcept(slug: string): void;
  onOpenSession(sessionId: string): void;
  onPractise(input: { abilityId?: string; conceptSlug?: string; drill?: string }): void;
  progress: LearnerProgress;
}) {
  const [view, setView] = useState<View>("abilities");
  const [openAbility, setOpenAbility] = useState<string | null>(null);
  const summaries = useMemo(() => new Map(concepts.map((concept) => [concept.slug, concept])), [concepts]);

  if (openAbility) {
    return (
      <AbilityDetail
        abilityId={openAbility}
        api={api}
        fallback={abilities.find((ability) => ability.id === openAbility)}
        onBack={() => setOpenAbility(null)}
        onOpenConcept={onOpenConcept}
        onOpenSession={onOpenSession}
        onPractise={onPractise}
        summaries={summaries}
      />
    );
  }

  const earned = abilities.filter((ability) => ability.status !== "uncertain");
  const forming = abilities.filter((ability) => ability.status === "uncertain");

  return (
    <Page width="wide">
      <PageHeader title="Progress" />

      <Band className="mt-0">
        <RatingBand progress={progress} />
      </Band>

      <StandingBand onOpenAbility={setOpenAbility} progress={progress} />

      <PatternsBand patterns={progress.patterns} />

      {/* The library, last: it is where you go to check the argument above, so it
          comes after the argument rather than instead of it. */}
      <Band
        action={
          <ViewSwitch<View>
            ariaLabel="Abilities or concepts"
            onChange={setView}
            options={[
              { value: "abilities", label: "Abilities", icon: Sparkles, badge: <Count value={earned.length} /> },
              { value: "concepts", label: "Concepts", icon: Layers3, badge: <Count value={concepts.length} /> },
            ]}
            value={view}
          />
        }
        title={view === "abilities" ? `Abilities · ${abilities.length}` : `Concepts · ${concepts.length}`}
      >
        {view === "abilities" ? (
          <AbilitiesView
            challenges={challenges}
            earned={earned}
            forming={forming}
            onOpen={setOpenAbility}
            onOpenConcept={onOpenConcept}
            summaries={summaries}
          />
        ) : (
          <ConceptsView challenges={challenges} concepts={concepts} onOpenConcept={onOpenConcept} summaries={summaries} />
        )}
      </Band>

    </Page>
  );
}

/** The count on the tab you are not looking at, so switching is an informed choice. */
function Count({ value }: { value: number }) {
  if (!value) return null;
  return <span className="tabular-nums text-ui-sm text-muted-foreground/70">{value}</span>;
}
