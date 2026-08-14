import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, ChevronRight, Dumbbell, Layers3, Sparkles, Target, TrendingUp } from "lucide-react";
import type { AbilityDetail, AbilityHistorySummary, ChallengeHistorySummary, ConceptSummary, LearnerProgress } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime, shortTime } from "@/lib/format";
import { CONCEPT_KIND_SHORT, CONCEPT_KIND_VAR, conceptTree, standingOf } from "@/lib/concepts";
import { Button } from "@/components/ui/button";
import { ViewSwitch } from "@/components/ui/view-switch";
import { EmptyState } from "../common/EmptyState";
import { LanguageMark } from "../common/LanguageGlyph";
import { Markdown } from "../agent/Markdown";
import { ConceptChip, OutcomeMark } from "../concepts/ConceptChip";
import { Standing } from "../concepts/ConceptSheet";
import { SparDots } from "@/components/common/SparDots";

type View = "abilities" | "concepts";

/**
 * How each ledger state is said to the learner, and how it is drawn.
 *
 * The distinction the page is built around is earned versus not. "Uncertain" is a
 * hypothesis Spar wrote when it set a target — showing it in the same grid as an
 * ability backed by three passing submissions would be the page claiming things
 * on the learner's behalf, which is the one thing an abilities page must not do.
 */
const STATUS: Record<AbilityHistorySummary["status"], { label: string; blurb: string; ring: string; text: string }> = {
  uncertain: { label: "Forming", blurb: "A hypothesis Spar is still testing", ring: "text-muted-foreground/40", text: "text-muted-foreground" },
  developing: { label: "Emerging", blurb: "Evidence is starting to support this", ring: "text-[var(--warning)]", text: "text-[var(--warning)]" },
  independent: { label: "Fluent", blurb: "You have done this unaided, more than once", ring: "text-[var(--success)]", text: "text-[var(--success)]" },
  stale: { label: "Rusty", blurb: "Earned a while ago and not touched since", ring: "text-muted-foreground/60", text: "text-muted-foreground" },
};

/** How far round the ring is drawn. Not a progress bar — there is nothing to be
 *  at the end of — just three legible steps so a card is recognisable at a glance. */
const RING_FRACTION: Record<AbilityHistorySummary["status"], number> = { uncertain: 0.12, developing: 0.55, independent: 1, stale: 0.8 };

export function AbilityPage({
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
      <AbilityDetailView
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
    <div className="app-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[62rem] px-18 pb-16 pt-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[1.35rem] font-semibold tracking-[-0.03em]">Progress</h1>
            <p className="mt-1 max-w-[38rem] text-content text-muted-foreground">
              What Spar thinks your work means: demonstrated performance, active training, uncertainty, and the evidence behind each belief.
            </p>
          </div>
          <ViewSwitch<View>
            ariaLabel="Abilities or concepts"
            className="mt-1"
            onChange={setView}
            options={[
              { value: "abilities", label: "Abilities", icon: Sparkles, badge: <Count value={earned.length} /> },
              { value: "concepts", label: "Concepts", icon: Layers3, badge: <Count value={concepts.length} /> },
            ]}
            value={view}
          />
        </div>

        <ProgressOverview progress={progress} />

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
      </div>
    </div>
  );
}

/** The count on the tab you are not looking at, so switching is an informed choice. */
function Count({ value }: { value: number }) {
  if (!value) return null;
  return <span className="tabular-nums text-ui-sm text-muted-foreground/70">{value}</span>;
}

function ProgressOverview({ progress }: { progress: LearnerProgress }) {
  const training = progress.abilities.filter((ability) => ability.trainingStatus === "training" || ability.trainingStatus === "diagnosing");
  const strengths = progress.abilities.filter((ability) => ability.trainingStatus === "monitoring" && ability.proficiency >= 0.75);
  const uncertain = progress.abilities.filter((ability) => ability.confidence < 0.45);
  return <section className="mt-6 grid gap-3 lg:grid-cols-[1.35fr_1fr]">
    <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-[var(--app-shadow-card)]">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-ui font-medium text-muted-foreground">Spar Rating</p><div className="mt-1 flex items-baseline gap-2"><strong className="text-[2rem] font-semibold tabular-nums tracking-[-0.04em]">{progress.rating.rating}</strong>{progress.rating.provisional && <span className="rounded-md bg-accent px-1.5 py-0.5 text-ui-sm font-medium text-muted-foreground">Provisional</span>}</div><p className="mt-1 text-ui text-muted-foreground">{progress.rating.reason}</p></div>
        <TrendingUp className="size-5 text-muted-foreground" />
      </div>
      <RatingChart points={progress.ratingHistory} />
    </div>
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--app-shadow-card)]">
      <ProgressRow label="Currently training" names={training.map((item) => item.title)} value={training.length} />
      <ProgressRow label="Strengths" names={strengths.map((item) => item.title)} value={strengths.length} />
      <ProgressRow label="Needs more evidence" names={uncertain.map((item) => item.title)} value={uncertain.length} />
      <ProgressRow label="Active patterns" names={progress.patterns.filter((item) => item.status === "pattern" || item.status === "hypothesis").map((item) => item.title)} value={progress.patterns.filter((item) => item.status === "pattern" || item.status === "hypothesis").length} last />
    </div>
    {progress.notices.length > 0 && <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--app-shadow-card)] lg:col-span-2"><p className="text-ui font-medium text-muted-foreground">Spar noticed</p><div className="mt-2 grid gap-3 sm:grid-cols-2">{progress.notices.slice(0,2).map((notice)=><div key={notice.id}><p className="text-ui font-medium">{notice.title}</p><p className="mt-0.5 text-ui leading-5 text-muted-foreground">{notice.body}</p></div>)}</div></div>}
  </section>;
}

function ProgressRow({ label, names, value, last = false }: { label: string; names: string[]; value: number; last?: boolean }) {
  return <div className={cn("flex items-start gap-3 py-2.5", !last && "border-b border-border")}><span className="min-w-0 flex-1"><span className="block text-ui font-medium">{label}</span><span className="mt-0.5 block truncate text-ui-sm text-muted-foreground">{names.slice(0,2).join(", ") || "Nothing yet"}</span></span><span className="tabular-nums text-content font-medium">{value}</span></div>;
}

function RatingChart({ points }: { points: LearnerProgress["ratingHistory"] }) {
  const values = points.length > 1 ? points : [points[0]!, { ...points[0]!, id: `${points[0]!.id}-current` }];
  const min = Math.min(...values.map((point) => point.rating)) - 20;
  const max = Math.max(...values.map((point) => point.rating)) + 20;
  const coordinates = values.map((point,index) => `${(index/(values.length-1))*100},${38-((point.rating-min)/(max-min))*32}`).join(" ");
  return <svg aria-label="Spar Rating over time" className="mt-4 h-11 w-full overflow-visible" preserveAspectRatio="none" role="img" viewBox="0 0 100 40"><path d="M0 39H100" stroke="currentColor" className="text-border" strokeWidth="0.8" /><polyline fill="none" points={coordinates} stroke="currentColor" className="text-foreground/70" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" vectorEffect="non-scaling-stroke" /></svg>;
}

function AbilitiesView({
  challenges,
  earned,
  forming,
  onOpen,
  onOpenConcept,
  summaries,
}: {
  challenges: ChallengeHistorySummary[];
  earned: AbilityHistorySummary[];
  forming: AbilityHistorySummary[];
  onOpen(id: string): void;
  onOpenConcept(slug: string): void;
  summaries: Map<string, ConceptSummary>;
}) {
  if (!earned.length && !forming.length) {
    return (
      <div className="mt-5">
        <EmptyState
          description="Spar introduces one when it sets a training target, then grants it once your submissions back it up. Start a session and the first will appear here."
          icon={Sparkles}
          title="No abilities yet"
        />
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-6">
      {earned.length > 0 && (
        <section>
          <SectionLabel>Earned</SectionLabel>
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
        </section>
      )}

      {/* Quieter and listed rather than carded, because these are not yet claims
          about the learner — they are what Spar is currently trying to find out. */}
      {forming.length > 0 && (
        <section>
          <SectionLabel>Being tested</SectionLabel>
          <div className="flex flex-col gap-1">
            {forming.map((ability) => (
              <button
                className="group flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-accent/30"
                key={ability.id}
                onClick={() => onOpen(ability.id)}
                type="button"
              >
                <Target className="size-3.5 shrink-0 text-muted-foreground/60" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui font-medium text-foreground/85">{ability.title}</span>
                  <span className="block truncate text-ui-sm text-muted-foreground/75">{STATUS.uncertain.blurb} · updated {shortTime(ability.updatedAt)}</span>
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-ui-sm font-medium text-muted-foreground/80">{children}</h2>;
}

/**
 * One earned ability.
 *
 * The summary sentence is the card, not the title: "Two-pointer passes" is a
 * filing label, and "you can hold two indices under a rule instead of scanning
 * twice" is the thing worth reading. The concepts under it are how the learner
 * gets from the claim to the evidence behind it.
 */
function AbilityCard({
  ability,
  challenges,
  onOpen,
  onOpenConcept,
  summaries,
}: {
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
    <article
      className={cn(
        "group relative flex flex-col rounded-xl border border-border bg-card p-3.5 shadow-[var(--app-shadow-card)] transition-[box-shadow,border-color] duration-150",
        "hover:border-[var(--border-strong)] hover:shadow-[var(--app-shadow-sheet)] focus-within:border-[var(--border-strong)]",
      )}
    >
      <button
        aria-label={`Open ${ability.title}`}
        className="absolute inset-0 z-0 rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
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

      <p className="pointer-events-none relative z-10 mt-2 line-clamp-3 text-ui leading-[1.65] text-foreground/80">
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

      <p className="pointer-events-none relative z-10 mt-2.5 text-ui-sm text-muted-foreground/70">
        {ability.evidenceCount} evidence link{ability.evidenceCount === 1 ? "" : "s"} · v{ability.version}
        {ability.earnedAt && ` · earned ${relativeTime(ability.earnedAt)}`}
        {ability.practice.length > 0 && ` · ${ability.practice.length} drill${ability.practice.length === 1 ? "" : "s"}`}
      </p>
    </article>
  );
}

/** A ring rather than a badge: three statuses read faster as an amount of arc than
 *  as three words, and the word is right beside it anyway. */
function StatusRing({ status }: { status: AbilityHistorySummary["status"] }) {
  const fraction = RING_FRACTION[status];
  const circumference = 2 * Math.PI * 9;
  return (
    <span className={cn("relative grid size-8 shrink-0 place-items-center", STATUS[status].ring)}>
      <svg aria-hidden className="absolute inset-0 size-8 -rotate-90" viewBox="0 0 24 24">
        <circle className="text-border" cx="12" cy="12" fill="none" r="9" stroke="currentColor" strokeWidth="2" />
        <circle
          cx="12"
          cy="12"
          fill="none"
          r="9"
          stroke="currentColor"
          strokeDasharray={`${circumference * fraction} ${circumference}`}
          strokeLinecap="round"
          strokeWidth="2"
        />
      </svg>
      <Sparkles className="size-3.5" />
    </span>
  );
}

/**
 * The ability's own page: the claim, the concepts, the challenges that earned it,
 * and where to go next.
 *
 * Practice is the reason this page exists rather than being a bigger card. An
 * ability the learner cannot act on is a certificate; the drills turn it into a
 * door, and each one opens a real session aimed by the agent.
 */
function AbilityDetailView({
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
  const [detail, setDetail] = useState<AbilityDetail | null>(null);

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
        <p className="flex items-center gap-2 text-ui text-muted-foreground"><SparDots pattern="sweep" size={18} label="Opening ability" />Opening ability…</p>
      </div>
    );
  }

  const status = STATUS[ability.status];
  const passed = detail?.evidence.filter((item) => item.outcome === "passed").length ?? 0;

  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[62rem] px-18 pb-16 pt-8">
        <button
          className="mb-4 inline-flex items-center gap-1.5 text-ui text-muted-foreground transition-colors hover:text-foreground"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft className="size-3.5" />
          All abilities
        </button>

        <header className="flex items-start gap-3">
          <StatusRing status={ability.status} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[1.35rem] font-semibold leading-tight tracking-[-0.03em]">{ability.title}</h1>
            <p className="mt-0.5 text-ui">
              <span className={cn("font-medium", status.text)}>{status.label}</span>
              <span className="text-muted-foreground"> · {status.blurb.toLowerCase()}</span>
            </p>
          </div>
        </header>

        {ability.summary && (
          <p className="mt-4 max-w-[40rem] text-[0.95rem] leading-[1.7] text-foreground/90">{ability.summary}</p>
        )}

        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {detail?.machine && <Stat label="Confidence" value={`${Math.round(detail.machine.confidence * 100)}%`} />}
          {detail?.machine && <Stat label="Training status" value={trainingStatus(detail.machine.trainingStatus)} />}
          {detail?.machine && <Stat label="Trend" value={detail.machine.trend} />}
          <Stat label="Evidence links" value={String(ability.evidenceCount)} />
          <Stat label="Challenges passed" value={detail ? `${passed} of ${detail.evidence.length}` : "…"} />
          <Stat label="Version" value={`v${ability.version}`} />
          <Stat label={ability.earnedAt ? "Earned" : "Introduced"} value={relativeTime(ability.earnedAt ?? ability.updatedAt)} />
        </dl>

        {detail?.machine?.nextVerification && <section className="mt-6 rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--app-shadow-card)]"><SectionLabel>What Spar wants to verify next</SectionLabel><p className="text-content leading-6 text-foreground/85">{detail.machine.nextVerification}</p></section>}

        {detail?.patterns.length ? <section className="mt-6"><SectionLabel>Patterns</SectionLabel><div className="flex flex-col gap-2">{detail.patterns.map((pattern)=><div className="rounded-lg border border-border px-3 py-2.5" key={pattern.id}><div className="flex items-center justify-between gap-3"><p className="text-ui font-medium">{pattern.title}</p><span className="text-ui-sm capitalize text-muted-foreground">{pattern.status}</span></div><p className="mt-1 text-ui leading-5 text-muted-foreground">{pattern.description}</p></div>)}</div></section> : null}

        {ability.concepts.length > 0 && (
          <section className="mt-6">
            <SectionLabel>Concepts this covers</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
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
          </section>
        )}

        {/* The drills, and a plain deeper-water option when the agent wrote none.
            An ability page with nothing to do on it is the version that sucked. */}
        <section className="mt-6">
          <SectionLabel>Go further</SectionLabel>
          {ability.practice.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {ability.practice.map((drill, index) => (
                <button
                  className="group flex items-start gap-2.5 rounded-xl border border-border bg-card p-3 text-left shadow-[var(--app-shadow-card)] transition-[box-shadow,border-color] hover:border-[var(--border-strong)] hover:shadow-[var(--app-shadow-sheet)]"
                  key={index}
                  onClick={() => onPractise({ abilityId: ability.id, drill })}
                  type="button"
                >
                  <span className="mt-px grid size-6 shrink-0 place-items-center rounded-md bg-[var(--color-background-elevated-secondary)] text-muted-foreground transition-colors group-hover:text-foreground">
                    <Dumbbell className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 text-ui leading-[1.6] text-foreground/85">{drill}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border/80 p-3.5">
              <p className="text-ui leading-[1.6] text-muted-foreground">
                Spar has not written drills for this one yet. Starting a session on it anyway is how it gets the evidence to write them from.
              </p>
              <Button className="mt-2.5" onClick={() => onPractise({ abilityId: ability.id })} size="sm" variant="secondary">
                <Dumbbell />
                Practise this ability
              </Button>
            </div>
          )}
        </section>

        {detail?.learnerEvidence.length ? <section className="mt-6"><SectionLabel>Ability timeline</SectionLabel><div className="relative ml-1 flex flex-col gap-0 border-l border-border pl-4">{detail.learnerEvidence.map((item)=><div className="relative pb-4" key={item.id}><span className="absolute -left-[1.18rem] top-1 size-2 rounded-full border border-border bg-background" /><div className="flex items-baseline justify-between gap-3"><p className="text-ui leading-5 text-foreground/85">{item.statement}</p><span className="shrink-0 text-ui-sm text-muted-foreground">{shortTime(item.occurredAt)}</span></div><p className="mt-0.5 text-ui-sm capitalize text-muted-foreground">{item.polarity} · {item.independence}</p></div>)}</div></section> : null}

        <section className="mt-6">
          <SectionLabel>Related attempts</SectionLabel>
          {detail ? (
            detail.evidence.length ? (
              <div className="flex flex-col">
                {detail.evidence.map((item) => (
                  <button
                    className="group -mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/35"
                    key={item.challengeId}
                    onClick={() => onOpenSession(item.sessionId)}
                    type="button"
                  >
                    <OutcomeMark outcome={item.outcome} />
                    <LanguageMark language={item.language} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui text-foreground/90">{item.title}</span>
                      <span className="block truncate text-ui-sm text-muted-foreground/75">{item.sessionTitle} · {item.difficulty}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-ui-sm text-muted-foreground/70">{shortTime(item.occurredAt)}</span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-ui leading-[1.6] text-muted-foreground">No challenges have been set against this ability yet.</p>
            )
          ) : (
            <p className="flex items-center gap-2 text-ui text-muted-foreground"><SparDots pattern="pulse" size={16} />Reading evidence…</p>
          )}
        </section>

        {/* Last, and labelled as notes: this is the agent's working document, and
            the learner reading their own ledger should meet the claim first. */}
        {ability.markdown.trim() && (
          <section className="mt-6 border-t border-border pt-5">
            <SectionLabel>Spar's notes</SectionLabel>
            <div className="text-ui leading-[1.7] text-muted-foreground">
              <Markdown source={ability.markdown} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ui-sm text-muted-foreground/75">{label}</dt>
      <dd className="text-content font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The concept map. Grouped by kind and then by area, with each area's own bar
 * above the sub-concepts that produced it — so the shape of "fine on average,
 * failing in one specific place" is visible without opening anything.
 */
function ConceptsView({
  challenges,
  concepts,
  onOpenConcept,
  summaries,
}: {
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
      <div className="mt-5">
        <EmptyState
          description="Every challenge Spar compiles is tagged with what it is actually testing — a sliding-window invariant, an aliasing trap, a base case. Those tags collect here as you submit."
          icon={Layers3}
          title="No concepts yet"
        />
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-6">
      {groups.map(({ kind, areas }) => (
        <section key={kind}>
          <h2 className="mb-2 flex items-center gap-1.5 text-ui-sm font-medium text-muted-foreground/80">
            <span aria-hidden className="size-1.5 rounded-full" style={{ background: CONCEPT_KIND_VAR[kind] }} />
            {CONCEPT_KIND_SHORT[kind]}
          </h2>
          <div className="flex flex-col gap-2">
            {areas.map(({ area, children }) => (
              <article className="rounded-xl border border-border bg-card px-3.5 py-3 shadow-[var(--app-shadow-card)]" key={area.slug}>
                <div className="flex items-start gap-3">
                  <button
                    className="min-w-0 flex-1 text-left outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring/60"
                    onClick={() => onOpenConcept(area.slug)}
                    type="button"
                  >
                    <h3 className="truncate text-content font-semibold hover:underline">{area.title}</h3>
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
              </article>
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
function trainingStatus(value: string) { return ({ unknown: "Unknown", diagnosing: "Being diagnosed", training: "Actively trained", monitoring: "Monitoring" } as Record<string,string>)[value] ?? value; }
