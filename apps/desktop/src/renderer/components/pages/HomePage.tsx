import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Compass, Layers3, Sparkles } from "lucide-react";
import type { AbilityHistorySummary, ChallengeHistorySummary, ConceptSummary, LearnerProgress, SessionSummary, TrainingMode } from "@spar/domain";
import type { BootstrapData, SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ViewSwitch } from "@/components/ui/view-switch";
import { Band, Page, PageHeader, Panel } from "../common/Page";
import { SourceGlyph } from "../common/SourceGlyph";
import { AbilitiesView, ConceptsView } from "../progress/Browse";
import { RatingBand } from "../progress/Rating";
import { PatternsBand, StandingBand } from "../progress/Standing";
import { AbilityDetail } from "./AbilityPage";

type View = "abilities" | "concepts";

/**
 * One page: what to do now, and where you stand.
 *
 * These were two. Today was one decision — this is the problem to do next —
 * and Progress was the argument behind the rating. Keeping them apart meant
 * Today had to carry a three-figure teaser of a page nobody had opened, and
 * Progress opened with a rating whose only actionable consequence was on the
 * other page. Neither was a destination on its own: you land here, you read one
 * card, and everything under it is the reason that card says what it says.
 *
 * The order is the argument. The decision first, because it is why the app is
 * open. Then the rating and what moved it, the abilities split by how much Spar
 * actually knows, the habit it thinks it has caught, and last the library, which
 * is where you go to check any of it yourself.
 */
export function HomePage({
  abilities,
  ability,
  api,
  busy,
  challenges,
  concepts,
  data,
  onBaseline,
  onCreateTrack,
  onMode,
  onOpen,
  onOpenAbility,
  onOpenConcept,
  onOpenSession,
  onPractise,
}: {
  abilities: AbilityHistorySummary[];
  /** Which ability is open, or null for the page itself. Owned by App rather
   *  than here: an ability is one of the window's places, and a place the
   *  history cannot name is a place Back cannot return to. */
  ability: string | null;
  api: SparApi | undefined;
  busy: boolean;
  challenges: ChallengeHistorySummary[];
  concepts: ConceptSummary[];
  data: BootstrapData;
  onBaseline(): void;
  onCreateTrack(): void;
  onMode(mode: TrainingMode): Promise<void>;
  onOpen(session: SessionSummary): void;
  onOpenAbility(abilityId: string | null): void;
  onOpenConcept(slug: string): void;
  onOpenSession(sessionId: string): void;
  onPractise(input: { abilityId?: string; conceptSlug?: string; drill?: string }): void;
}) {
  const recommendation = data.recommendation;
  const session = recommendation?.sessionId ? data.sessions.find((item) => item.id === recommendation.sessionId) : undefined;
  const [focusOpen, setFocusOpen] = useState(false);
  const [why, setWhy] = useState(false);
  const [focus, setFocus] = useState(data.trainingMode.kind === "focus" ? data.trainingMode.focus : "");
  const [view, setView] = useState<View>("abilities");
  const summaries = useMemo(() => new Map(concepts.map((concept) => [concept.slug, concept])), [concepts]);

  const chooseMode = (value: string) => {
    if (value === "focus") { setFocusOpen(true); return; }
    const mode: TrainingMode = value === "recommended" ? { kind: "recommended" }
      : value === "explore" ? { kind: "explore" }
      : value === "quick" ? { kind: "quick" }
      : { kind: "source", source: value as "leetcode" | "codeforces" | "spar" };
    void onMode(mode);
  };

  if (ability) {
    return (
      <AbilityDetail
        abilityId={ability}
        api={api}
        challenges={challenges}
        fallback={abilities.find((entry) => entry.id === ability)}
        onBack={() => onOpenAbility(null)}
        onOpenConcept={onOpenConcept}
        onOpenSession={onOpenSession}
        onPractise={onPractise}
        summaries={summaries}
      />
    );
  }

  const earned = abilities.filter((item) => item.status !== "uncertain");
  const forming = abilities.filter((item) => item.status === "uncertain");

  return (
    <Page width="wide">
      <PageHeader
        action={
          <Select onValueChange={chooseMode} value={modeValue(data.trainingMode)}>
            <SelectTrigger aria-label="Training mode" className="shrink-0" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="recommended">Recommended</SelectItem>
                <SelectItem value="focus">Focus on…</SelectItem>
                <SelectItem value="explore">Explore something new</SelectItem>
                <SelectItem value="leetcode">LeetCode only</SelectItem>
                <SelectItem value="codeforces">Codeforces only</SelectItem>
                <SelectItem value="spar">Spar challenges only</SelectItem>
                <SelectItem value="quick">Quick practice</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        }
        eyebrow={today()}
        title="Home"
      />

      {/* A precondition, so it sits above the thing it is a precondition for. */}
      {data.baseline.status !== "complete" && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-2.5" tone="quiet">
          <p className="min-w-0 flex-1 text-ui">Baseline not set</p>
          <Button disabled={busy} onClick={onBaseline} size="sm" variant="ghost">
            {data.baseline.status === "in-progress" ? "Continue" : "Begin"}
          </Button>
        </Panel>
      )}

      {recommendation ? (
        <Panel className="overflow-hidden">
          <div className="px-5 pb-4 pt-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui text-muted-foreground">
              <span className="text-foreground/75">{intentLabel(recommendation.intent)}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1.5">
                {recommendation.source === "spar" ? <Sparkles className="size-3.5" /> : <SourceGlyph className="size-3.5" source={recommendation.source} />}
                {SOURCE_LABEL[recommendation.source]}
              </span>
              <span aria-hidden>·</span>
              <span className="truncate">{recommendation.abilityTitle}</span>
            </div>

            <h2 className="mt-2.5 text-[1.4rem] font-semibold leading-[1.2] tracking-[-0.03em]">{recommendation.challengeTitle}</h2>
            <p className="mt-2 line-clamp-2 max-w-[36rem] text-ui leading-[1.65] text-muted-foreground">{recommendation.reason}</p>

            {/* Folded, not deleted. The reasoning is worth having and is worth
                nobody's attention until they ask for it. */}
            {recommendation.reasoning.length > 0 && (
              <>
                <button
                  aria-expanded={why}
                  className="mt-2.5 inline-flex items-center gap-1 text-ui-sm text-muted-foreground/80 transition-colors hover:text-foreground"
                  onClick={() => setWhy((open) => !open)}
                  type="button"
                >
                  Why this
                  <ChevronDown className={cn("size-3 transition-transform", why && "rotate-180")} />
                </button>
                {why && (
                  <ul className="mt-2 flex flex-col gap-1.5 border-l border-border pl-3">
                    {recommendation.reasoning.slice(0, 4).map((line) => (
                      <li className="text-ui leading-[1.6] text-muted-foreground" key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-3">
            <span className="truncate text-ui text-muted-foreground">{recommendation.trackTitle}</span>
            <Button disabled={busy || !session} onClick={() => session && onOpen(session)} size="sm">
              {session?.activeQuestion ? "Continue" : "Start"}<ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </Panel>
      ) : (
        <Panel className="flex flex-col items-center px-8 py-12 text-center">
          <Compass className="size-5 text-muted-foreground" />
          <h2 className="mt-3 text-content font-semibold">No track yet</h2>
          <Button className="mt-4" onClick={onCreateTrack} size="sm">Create Track</Button>
        </Panel>
      )}

      {data.progress.notices.length > 0 && (
        <Band title="Noticed">
          <Panel className="divide-y divide-border overflow-hidden">
            {data.progress.notices.slice(0, 3).map((notice) => (
              <div className="flex items-baseline justify-between gap-3 px-4 py-2.5" key={notice.id}>
                <p className="min-w-0 truncate text-ui">{notice.title}</p>
                <span className="shrink-0 text-ui-sm text-muted-foreground/70">{relativeTime(notice.createdAt)}</span>
              </div>
            ))}
          </Panel>
        </Band>
      )}

      {/* Where the page stops being about today and starts being about the
          record. No divider says so: the bands already read as one column, and
          the rating under the recommendation is the reason the recommendation
          is what it is. */}
      <Band>
        <RatingBand progress={data.progress} />
      </Band>

      <StandingBand onOpenAbility={onOpenAbility} progress={data.progress} />

      <PatternsBand patterns={data.progress.patterns} />

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
            onOpen={onOpenAbility}
            onOpenConcept={onOpenConcept}
            summaries={summaries}
          />
        ) : (
          <ConceptsView challenges={challenges} concepts={concepts} onOpenConcept={onOpenConcept} summaries={summaries} />
        )}
      </Band>

      <Dialog onOpenChange={setFocusOpen} open={focusOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Focus training</DialogTitle>
            <DialogDescription>Spar still personalizes within this area.</DialogDescription>
          </DialogHeader>
          <Input autoFocus onChange={(event) => setFocus(event.target.value)} placeholder="Graphs, TypeScript types, dynamic programming…" value={focus} />
          <DialogFooter>
            <Button disabled={!focus.trim()} onClick={() => { void onMode({ kind: "focus", focus: focus.trim() }); setFocusOpen(false); }}>Apply focus</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

/** The count on the tab you are not looking at, so switching is an informed choice. */
function Count({ value }: { value: number }) {
  if (!value) return null;
  return <span className="tabular-nums text-ui-sm text-muted-foreground/70">{value}</span>;
}

const SOURCE_LABEL: Record<"leetcode" | "codeforces" | "spar", string> = { leetcode: "LeetCode", codeforces: "Codeforces", spar: "Spar" };

function modeValue(mode: TrainingMode) { return mode.kind === "source" ? mode.source : mode.kind === "focus" ? "focus" : mode.kind; }
function intentLabel(intent: string) { return ({ diagnose: "Diagnose", teach: "Prerequisite", practise: "Practice", transfer: "Transfer", retain: "Retention", advance: "Advance" } as Record<string, string>)[intent] ?? intent; }
function today() { return new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }); }
