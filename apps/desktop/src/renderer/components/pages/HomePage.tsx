import { useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Compass, Layers3, Sparkles } from "lucide-react";
import type { AbilityHistorySummary, ChallengeHistorySummary, ConceptSummary, SessionSummary, SparNotice, TodayRecommendation, TrainingMode } from "@spar/domain";
import type { BootstrapData, SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { relativeTime, shortTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ViewSwitch } from "@/components/ui/view-switch";
import { Band, Page, PageHeader, Panel } from "../common/Page";
import { SourceGlyph } from "../common/SourceGlyph";
import { ProblemEmblem } from "../problems/ProblemEmblem";
import { AbilitiesView, ConceptsView } from "../progress/Browse";
import { RatingHero } from "../progress/Rating";
import { PatternsBand, StandingBand } from "../progress/Standing";
import { AbilityDetail } from "./AbilityPage";

type View = "abilities" | "concepts";

/** Where a stat cell sends you. A subset of the shell's pages: only the ones a
 *  figure on this page can honestly be the summary of. */
export type HomeDestination = "challenges" | "sessions" | "problems" | "tracks";

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
 * The order is the argument. The rating first, because it is the one number the
 * app exists to move and every other thing here is either a move against it or
 * the evidence behind it. Then the decision — the problem to do next — then
 * whatever is still open, the abilities split by how much Spar actually knows,
 * the habit it thinks it has caught, and last the library, which is where you go
 * to check any of it yourself.
 *
 * Three rules hold the layout together, and all three were learned by breaking
 * them.
 *
 * **The decision is a row, not a poster.** It used to be a 200px card carrying a
 * headline, a two-line summary of the agent's reasoning and a footer — a third
 * of the window spent restating a choice that had already been made. A person
 * who opens this app to practise needs the title, where the problem came from,
 * and a button. Everything else the agent had to say is behind "Why this", which
 * is where an argument nobody asked for belongs.
 *
 * **Not everything is a row of cards.** Counts belong on one line as chips, and
 * the three standings belong in one column rather than three panels abreast: a
 * grid gives every group the height of the tallest, so short groups are padded
 * with air and long ones are cut off. Side by side is for two things being
 * compared — the rating and its curve — not for three lists that happen to be
 * siblings.
 *
 * **Nothing here is only text.** Every figure, row, badge and chip on this page
 * opens the thing it is about: a count opens the list it counts, a pattern opens
 * the ability it was observed against, a notice opens itself. A line of prose
 * that cannot be followed anywhere is a line that could have been a link.
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
  onNavigate,
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
  onNavigate(page: HomeDestination): void;
  onOpen(session: SessionSummary): void;
  onOpenAbility(abilityId: string | null): void;
  onOpenConcept(slug: string): void;
  onOpenSession(sessionId: string): void;
  onPractise(input: { abilityId?: string; conceptSlug?: string; drill?: string }): void;
}) {
  const recommendation = data.recommendation;
  const session = recommendation?.sessionId ? data.sessions.find((item) => item.id === recommendation.sessionId) : undefined;
  const [focusOpen, setFocusOpen] = useState(false);
  const [focus, setFocus] = useState(data.trainingMode.kind === "focus" ? data.trainingMode.focus : "");
  const [view, setView] = useState<View>("abilities");
  const summaries = useMemo(() => new Map(concepts.map((concept) => [concept.slug, concept])), [concepts]);
  /* The library is the one band a figure above can point at rather than navigate
     to, so the stat cells scroll to it instead of leaving the page. */
  const library = useRef<HTMLDivElement | null>(null);

  const chooseMode = (value: string) => {
    if (value === "focus") { setFocusOpen(true); return; }
    const mode: TrainingMode = value === "recommended" ? { kind: "recommended" }
      : value === "explore" ? { kind: "explore" }
      : value === "quick" ? { kind: "quick" }
      : { kind: "source", source: value as "leetcode" | "codeforces" | "spar" };
    void onMode(mode);
  };

  const showLibrary = (next: View) => {
    setView(next);
    library.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  const solved = challenges.filter((item) => item.lastOutcome === "passed").length;
  /* Anything the learner could pick back up: a session still being worked, or
     one parked. A completed session is history and has its own page. */
  const resumable = data.sessions.filter((item) => !item.archivedAt && item.status !== "completed");
  const open = resumable.length;
  /* The recommendation's own session is already the card above, so it is not
     offered again three rows down as something to pick back up. */
  const live = resumable.filter((item) => item.id !== recommendation?.sessionId).slice(0, 3);

  return (
    <Page className="pt-6" width="wide">
      <PageHeader
        action={
          <Select onValueChange={chooseMode} value={modeValue(data.trainingMode)}>
            <SelectTrigger aria-label="Training mode" className="shrink-0" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="recommended">Recommended</SelectItem>
                <SelectItem value="focus">Focus on…</SelectItem>
                <SelectItem value="explore">Explore something new</SelectItem>
                {/* The sources wear their own marks here for the same reason the
                    card does: a list that names LeetCode in the same grey as
                    "Explore" is a list you have to read rather than spot. */}
                <SelectItem value="leetcode"><SourceGlyph className="size-3.5 shrink-0" source="leetcode" />LeetCode only</SelectItem>
                <SelectItem value="codeforces"><SourceGlyph className="size-3.5 shrink-0" source="codeforces" />Codeforces only</SelectItem>
                <SelectItem value="spar"><Sparkles className="size-3.5 shrink-0" />Spar challenges only</SelectItem>
                <SelectItem value="quick">Quick practice</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        }
        className="mb-4"
        eyebrow={today()}
        title="Home"
      />

      {/* The headline. This is the number the app exists to move, so it opens the
          page and everything under it is either the next move against it or the
          evidence behind it. The counts ride in its footer rather than in a row
          of their own cards: four figures about the same learner are one fact,
          and a second bordered strip under this one reads as a card that failed
          to close. */}
      <RatingHero
        footer={
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 px-3.5 py-1.5">
            <Tally label="solved" onClick={() => onNavigate("challenges")} sub={challenges.length ? `of ${challenges.length}` : ""} value={solved} />
            <Tally label="open" onClick={() => onNavigate("sessions")} sub={open === 1 ? "session" : "sessions"} value={open} />
            <Tally label="abilities" onClick={() => showLibrary("abilities")} sub={forming.length ? `${forming.length} forming` : ""} value={earned.length} />
            <Tally label="concepts" onClick={() => showLibrary("concepts")} sub="" value={concepts.length} />
          </div>
        }
        progress={data.progress}
      />

      {/* A precondition, so it sits above the thing it is a precondition for. */}
      {data.baseline.status !== "complete" && (
        <button
          className="mb-3 flex w-full items-center gap-3 rounded-[var(--radius-xl)] border-[length:var(--hairline)] border-[var(--border-surface-strong)] bg-[var(--surface-tertiary)] px-3.5 py-2 text-left outline-none transition-colors hover:bg-accent/30 focus-visible:ring-1 focus-visible:ring-ring"
          disabled={busy}
          onClick={onBaseline}
          type="button"
        >
          <span className="min-w-0 flex-1 truncate text-ui">Baseline not set</span>
          <span className="shrink-0 text-ui font-medium text-foreground/80">
            {data.baseline.status === "in-progress" ? "Continue" : "Begin"}
          </span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/70" />
        </button>
      )}

      {recommendation ? (
        <NextCard
          busy={busy || !session}
          continuing={Boolean(session?.activeQuestion)}
          onOpenAbility={onOpenAbility}
          onStart={() => session && onOpen(session)}
          recommendation={recommendation}
        />
      ) : (
        <Panel className="flex items-center gap-3 px-3.5 py-3">
          <Compass className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-content font-medium">No track yet</span>
          <Button onClick={onCreateTrack} size="sm">Create track<ArrowRight data-icon="inline-end" /></Button>
        </Panel>
      )}

      {live.length > 0 && (
        <Band
          action={<Jump label="All sessions" onClick={() => onNavigate("sessions")} />}
          className="mt-4"
          title="Open"
        >
          <Panel className="divide-y-[length:var(--hairline)] divide-[var(--border-surface-strong)] overflow-hidden">
            {live.map((item) => (
              <button
                className="group flex w-full items-center gap-2.5 px-3.5 py-2 text-left outline-none transition-colors hover:bg-accent/25 focus-visible:bg-accent/25"
                key={item.id}
                onClick={() => onOpenSession(item.id)}
                type="button"
              >
                <span className={cn("size-1.5 shrink-0 rounded-full", item.status === "paused" ? "bg-muted-foreground/40" : "bg-[var(--success)]")} />
                <span className="min-w-0 flex-1 truncate text-ui font-medium text-foreground/90">{item.title}</span>
                {/* What is actually open inside it, which is the only reason to
                    resume this one rather than the one under it. */}
                {item.activeQuestion && (
                  <span className="hidden min-w-0 max-w-[18rem] flex-1 truncate text-ui text-muted-foreground sm:block">{item.activeQuestion.title}</span>
                )}
                <span className="shrink-0 tabular-nums text-ui-sm text-muted-foreground/70">
                  {item.completedQuestions}/{Math.max(item.questionTitles.length, item.completedQuestions)}
                </span>
                <span className="w-9 shrink-0 text-right tabular-nums text-ui-sm text-muted-foreground/70">{shortTime(item.updatedAt)}</span>
                <ArrowRight className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
              </button>
            ))}
          </Panel>
        </Band>
      )}

      <StandingBand className="mt-4" onOpenAbility={onOpenAbility} progress={data.progress} />

      <PatternsBand className="mt-4" onOpenAbility={onOpenAbility} patterns={data.progress.patterns} />

      {data.progress.notices.length > 0 && (
        <Band className="mt-4" title="Noticed">
          <Panel className="divide-y-[length:var(--hairline)] divide-[var(--border-surface-strong)] overflow-hidden">
            {data.progress.notices.slice(0, 4).map((notice) => <Notice key={notice.id} notice={notice} />)}
          </Panel>
        </Band>
      )}

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
        className="mt-5 scroll-mt-4"
        title={view === "abilities" ? `Abilities · ${abilities.length}` : `Concepts · ${concepts.length}`}
      >
        <div ref={library}>
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
        </div>
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

/**
 * The decision, as one row.
 *
 * Three targets, left to right, and nothing between them that is not one: the
 * body starts the problem, "Why" unfolds the agent's argument, and Start is the
 * same action as the body for anyone who reads buttons rather than cards. The
 * ability is its own chip because it is the claim this problem is being asked in
 * service of, and it opens that claim's page.
 *
 * The mark on the left is the problem's own, stamped from its subject the same
 * way every other problem in the app is stamped — the same shape here, in the
 * problems grid, and in history, which is what makes it recognition rather than
 * decoration. See `ProblemEmblem`.
 */
function NextCard({ busy, continuing, onOpenAbility, onStart, recommendation }: {
  busy: boolean;
  continuing: boolean;
  onOpenAbility(abilityId: string): void;
  onStart(): void;
  recommendation: TodayRecommendation;
}) {
  const [why, setWhy] = useState(false);
  /* The reason is the agent's prose and the reasoning is its working. On the
     surface they were a paragraph and a fold; folded together they are one
     argument, which is what they always were. */
  const argument = [recommendation.reason, ...recommendation.reasoning].filter((line) => line.trim().length > 0);

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center gap-3 pl-3 pr-2.5">
        <button
          className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
          disabled={busy}
          onClick={onStart}
          type="button"
        >
          <ProblemEmblem seed={recommendation.id} size={28} strong subject={recommendation.abilityTitle} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="min-w-0 truncate text-content font-semibold tracking-[-0.01em]">{recommendation.challengeTitle}</span>
              <SourceChip source={recommendation.source} />
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-ui-sm text-muted-foreground">
              <span className="shrink-0 font-medium text-foreground/70">{intentLabel(recommendation.intent)}</span>
              <span aria-hidden>·</span>
              <span className="truncate">{recommendation.trackTitle}</span>
            </span>
          </span>
        </button>

        {/* The ability, as the one piece of context worth leaving for. */}
        {recommendation.abilityId && (
          <button
            className="hidden max-w-[13rem] shrink-0 truncate rounded-[var(--radius-md)] px-2 py-1 text-ui text-muted-foreground outline-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring md:block"
            onClick={() => onOpenAbility(recommendation.abilityId!)}
            title={recommendation.abilityTitle}
            type="button"
          >
            {recommendation.abilityTitle}
          </button>
        )}

        {argument.length > 0 && (
          <button
            aria-expanded={why}
            className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-md)] px-1.5 py-1 text-ui text-muted-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setWhy((open) => !open)}
            type="button"
          >
            Why
            <ChevronDown className={cn("size-3 transition-transform", why && "rotate-180")} />
          </button>
        )}

        <Button className="shrink-0" disabled={busy} onClick={onStart} size="sm">
          {continuing ? "Continue" : "Start"}<ArrowRight data-icon="inline-end" />
        </Button>
      </div>

      {why && argument.length > 0 && (
        <ul className="flex flex-col gap-1 border-t-[length:var(--hairline)] border-[var(--border-surface-strong)] bg-[var(--surface-tertiary)] px-3.5 py-2.5">
          {argument.slice(0, 5).map((line) => (
            <li className="flex gap-2 text-ui leading-[1.55] text-muted-foreground" key={line}>
              <span aria-hidden className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-muted-foreground/40" />
              {line}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Where the problem came from, in the source's own mark and word. A Spar
 *  challenge gets the same treatment rather than no mark at all: "nobody else
 *  has ever been asked this" is a fact about the problem, not an absence. */
function SourceChip({ source }: { source: "leetcode" | "codeforces" | "spar" }) {
  return (
    <span className="inline-flex h-[1.1rem] shrink-0 items-center gap-1 rounded-[var(--radius-md)] border-[length:var(--hairline)] border-[var(--border-surface-strong)] bg-[var(--surface-tertiary)] px-1.5 text-ui-sm font-medium text-foreground/80">
      {source === "spar"
        ? <Sparkles className="size-3 shrink-0 text-foreground/70" />
        : <SourceGlyph className="size-3 shrink-0" source={source} />}
      {SOURCE_LABEL[source]}
    </span>
  );
}

/**
 * One figure and where it came from, as a chip rather than a card.
 *
 * A count on a dashboard is a promise that the list behind it exists, so every
 * one of these is a button — four figures, four lists. They sit on one line
 * because they are one line's worth of information: as four cards in a grid they
 * took the same vertical space as the rating they were describing, which is the
 * wrong way round.
 */
function Tally({ label, onClick, sub, value }: { label: string; onClick(): void; sub: string; value: number }) {
  return (
    <button
      className="flex items-baseline gap-1 rounded-[var(--radius-md)] px-2 py-1 text-ui text-muted-foreground outline-none transition-colors hover:bg-accent/30 hover:text-foreground focus-visible:bg-accent/30"
      onClick={onClick}
      type="button"
    >
      <span className="tabular-nums font-semibold text-foreground/90">{value}</span>
      {label}
      {sub && <span className="text-ui-sm text-muted-foreground/55">{sub}</span>}
    </button>
  );
}

/** A notice, which is a title and a body nobody needs until they want it. The
 *  row opens itself rather than linking anywhere: the body is the whole of what
 *  Spar has to say, so a destination would just be this text on its own page. */
function Notice({ notice }: { notice: SparNotice }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left outline-none transition-colors hover:bg-accent/25 focus-visible:bg-accent/25"
        disabled={!notice.body.trim()}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate text-ui">{notice.title}</span>
        <span className="shrink-0 text-ui-sm text-muted-foreground/70">{relativeTime(notice.createdAt)}</span>
        {notice.body.trim() && <ChevronDown className={cn("size-3 shrink-0 text-muted-foreground/60 transition-transform", open && "rotate-180")} />}
      </button>
      {open && <p className="border-t-[length:var(--hairline)] border-[var(--border-surface-strong)] bg-[var(--surface-tertiary)] px-3.5 py-2.5 text-ui leading-[1.55] text-muted-foreground">{notice.body}</p>}
    </div>
  );
}

/** A band's "go to the full list" action. Quiet enough to be a label and shaped
 *  enough to be pressed. */
function Jump({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button
      className="inline-flex items-center gap-1 rounded-[var(--radius-md)] px-1.5 py-0.5 text-ui text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onClick}
      type="button"
    >
      {label}
      <ArrowRight className="size-3" />
    </button>
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
