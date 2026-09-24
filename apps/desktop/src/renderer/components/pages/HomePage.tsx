import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Compass, Sparkles, Target } from "lucide-react";
import type { AbilityHistorySummary, ChallengeHistorySummary, ConceptSummary, SessionSummary, TodayRecommendation, TrainingMode } from "@spar/domain";
import type { BootstrapData, SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { shortTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Band, Page, Panel } from "../common/Page";
import { SourceGlyph } from "../common/SourceGlyph";
import { RatingHero } from "../progress/Rating";
import { BeliefSurface } from "../progress/Standing";
import { AbilityDetail } from "./AbilityPage";

/** Where a stat cell sends you. A subset of the shell's pages: only the ones a
 *  figure on this page can honestly be the summary of. */
export type HomeDestination = "challenges" | "sessions" | "problems" | "tracks";

/**
 * One page: what to do now, and where you stand.
 *
 * It used to be eight bordered surfaces down one column — the rating, a baseline
 * banner, the recommendation, open sessions, where you stand, what is being
 * watched, what was noticed, and a library — each drawn as a rounded panel with
 * the same radius, the same rim and the same fill as the last. That is the
 * failure mode of a dashboard: when every element carries the same weight, the
 * reader gets no signal about what to look at first, and eight summaries are not
 * eight facts, they are noise. The fix is not to reorder them, and it is not to
 * strip the surfaces off either — a page of hairline rules is the same absence
 * of ranking in a flatter coat. It is to decide what one decision this screen
 * exists to support, build the screen around it, and let the remaining surfaces
 * differ in size and content enough that the order is obvious. Three panels,
 * each a different height, in the order you need them.
 *
 * Spar knows exactly why the window was opened: to practise the next thing. So
 * the assignment is the page, and there are four zones, in this order and no
 * others.
 *
 * **The masthead.** The rating — see `RatingHero`. It opens the page because it
 * is the one number the app exists to move, and the counts hang off the bottom
 * of the same panel rather than in a row of their own: figures about one learner
 * are one fact, and a second bordered strip under the first reads as a card that
 * failed to close.
 *
 * **The assignment.** The heaviest thing on screen, and the reason it is heavy
 * is `reason`. The agent's one sentence about why *this* problem — "you passed
 * two grid problems by scanning and failed the one that needed a visited set" —
 * used to be folded behind a chevron marked "Why". That sentence is the entire
 * difference between Spar and a list of problems, and it was the one thing on
 * the page nobody could see. It is body copy now, and the *working* behind it —
 * the three-line argument — is what folds, because a claim should be legible and
 * its derivation should be available.
 *
 * One decision at a time: the slot is a state machine, not a card with banners
 * stacked over it. No baseline means the baseline *is* the assignment; no track
 * means making one is. A precondition drawn as a banner above the thing it is a
 * precondition for gives the reader two calls to action and no ranking.
 *
 * **Continue.** One row. The sidebar already lists every session the learner has
 * — grouped by Track, with pinned, recent and archived — so a three-row "Open"
 * band here was the same list a third time. Home only has to answer "where was
 * I", and that is one row's worth of answer.
 *
 * **What Spar believes.** One surface where there were four — see
 * `BeliefSurface`. A habit is a line under the ability it was observed against,
 * not a band six inches lower.
 *
 * Concepts are gone from this page entirely. Browsing subject matter is what
 * Problems is for, and a two-way `ViewSwitch` between abilities and concepts was
 * a second navigation system living inside a summary.
 *
 * Two rules the page keeps from what it replaced, because both were right.
 * *Nothing here is only text* — every figure, row, habit and count opens the
 * thing it is about, and a line of prose that cannot be followed anywhere is a
 * line that could have been a link. And *the ink is never thinned to rank it*:
 * this window is glass, so text at an alpha fraction composites against the
 * desktop twice and arrives grey however dark the token was. Rank by weight,
 * colour and position.
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
  const solved = challenges.filter((item) => item.lastOutcome === "passed").length;
  /* Anything the learner could pick back up: a session still being worked, or
     one parked. A completed session is history and has its own page. */
  const resumable = data.sessions.filter((item) => !item.archivedAt && item.status !== "completed");
  /* The recommendation's own session is already the assignment above, so it is
     not offered again three inches down as something to pick back up. */
  const live = resumable.filter((item) => item.id !== recommendation?.sessionId);
  const last = live[0];

  const mode = (
    /* The mode belongs to the assignment, not to the page. In the header's
       trailing corner it read as a filter over everything below it, which is
       what a control up there means — and what it actually says is "not this
       one: give me LeetCode instead", which is a sentence about the problem it
       is standing next to. */
    <Select onValueChange={chooseMode} value={modeValue(data.trainingMode)}>
      <SelectTrigger aria-label="Training mode" className="h-8 shrink-0 text-ui" size="sm"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="recommended">Recommended</SelectItem>
          <SelectItem value="focus">Focus on…</SelectItem>
          <SelectItem value="explore">Explore something new</SelectItem>
          {/* The sources wear their own marks here for the same reason the
              assignment does: a list that names LeetCode in the same grey as
              "Explore" is a list you have to read rather than spot. */}
          <SelectItem value="leetcode"><SourceGlyph className="size-3.5 shrink-0" source="leetcode" />LeetCode only</SelectItem>
          <SelectItem value="codeforces"><SourceGlyph className="size-3.5 shrink-0" source="codeforces" />Codeforces only</SelectItem>
          <SelectItem value="spar"><Sparkles className="size-3.5 shrink-0" />Spar challenges only</SelectItem>
          <SelectItem value="quick">Quick practice</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );

  return (
    <Page className="pt-6" width="wide">
      <RatingHero
        api={api}
        eyebrow={today()}
        footer={
          /* Three figures, not four. Every count on a page like this is a promise
             that the list behind it exists, so each one is a button — and the
             concepts count lost its button when concepts left this page, which
             made it the one figure here that was only text. */
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 px-3.5 py-1.5">
            <Tally label="solved" onClick={() => onNavigate("challenges")} sub={challenges.length ? `of ${challenges.length}` : ""} value={solved} />
            <Tally label={resumable.length === 1 ? "open session" : "open sessions"} onClick={() => onNavigate("sessions")} sub="" value={resumable.length} />
            <Tally label="abilities" onClick={() => onOpenAbility(null)} sub={forming.length ? `${forming.length} forming` : ""} value={earned.length} />
          </div>
        }
        progress={data.progress}
      />

      {/* One decision, whichever one is actually next. */}
      {data.baseline.status !== "complete" ? (
        <Call
          body="Spar has nothing to reason from until it has watched you work once. A handful of problems is enough to place you, and everything it sets after this is written against what it sees here."
          busy={busy}
          eyebrow="First"
          icon={Target}
          label={data.baseline.status === "in-progress" ? "Continue" : "Begin"}
          onAct={onBaseline}
          title="Set your baseline"
          tone="--work-diagnose"
        />
      ) : recommendation ? (
        <Assignment
          busy={busy || !session}
          continuing={Boolean(session?.activeQuestion)}
          mode={mode}
          onOpenAbility={onOpenAbility}
          onStart={() => session && onOpen(session)}
          recommendation={recommendation}
        />
      ) : (
        <Call
          body="A Track is what Spar practises against — a goal in your own words, and every session it sets is aimed at it."
          busy={busy}
          eyebrow="First"
          icon={Compass}
          label="Create track"
          onAct={onCreateTrack}
          title="No track yet"
          tone="--work-teach"
        />
      )}

      {last && (
        <Band
          action={<Jump label={live.length > 1 ? `All ${live.length} sessions` : "All sessions"} onClick={() => onNavigate("sessions")} />}
          className="mt-5"
          title="Continue"
        >
          <Panel className="overflow-hidden">
          <button
            className="group flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-accent/25 focus-visible:bg-accent/25"
            onClick={() => onOpenSession(last.id)}
            type="button"
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", last.status === "paused" ? "bg-muted-foreground" : "bg-[var(--success)]")} />
            <span className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">{last.title}</span>
            {/* What is actually open inside it, which is the only reason to
                resume this one rather than start something new. */}
            {last.activeQuestion && (
              <span className="hidden min-w-0 max-w-[20rem] flex-1 truncate text-ui text-muted-foreground sm:block">{last.activeQuestion.title}</span>
            )}
            <span className="shrink-0 tabular-nums text-ui-sm text-muted-foreground">
              {last.completedQuestions}/{Math.max(last.questionTitles.length, last.completedQuestions)}
            </span>
            <span className="w-9 shrink-0 text-right tabular-nums text-ui-sm text-muted-foreground">{shortTime(last.updatedAt)}</span>
            <ArrowRight className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
          </Panel>
        </Band>
      )}

      <BeliefSurface
        className="mt-5"
        notices={data.progress.notices}
        onOpenAbility={onOpenAbility}
        progress={data.progress}
      />

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
 * The assignment: what Spar has decided you should do, and why.
 *
 * The reason is the point of this whole surface, so it is set as body copy at
 * reading size and nothing covers it. It was behind a chevron before, which
 * meant the app's one genuinely distinguishing sentence — the agent explaining,
 * in the learner's own history, why this problem and not another — shipped
 * hidden. What folds instead is `reasoning`: the working underneath the claim.
 *
 * No border and no fill. This sits on the page's own ground between two rules,
 * which is the heaviest a thing can be in this vocabulary without becoming a
 * card — and a card is what it must not be, because everything that was wrong
 * with this page was that all of it was cards.
 *
 * Three targets and a control: the title starts the problem, the ability opens
 * the claim this problem is being asked in service of, Start is the same action
 * as the title for anyone who reads buttons rather than headlines, and the mode
 * select overrules the whole decision.
 *
 * There is no emblem on it. The problem's mark is recognition work — it earns
 * its place in the problems grid and in history, where one chip among fifty is
 * how you find the thing again — and this card holds exactly one problem, named
 * at display size. See the note in the body for what it cost to keep.
 */
function Assignment({ busy, continuing, mode, onOpenAbility, onStart, recommendation }: {
  busy: boolean;
  continuing: boolean;
  mode: React.ReactNode;
  onOpenAbility(abilityId: string): void;
  onStart(): void;
  recommendation: TodayRecommendation;
}) {
  const [why, setWhy] = useState(false);
  const working = recommendation.reasoning.filter((line) => line.trim().length > 0);
  const reason = recommendation.reason.trim();

  const work = workKind(recommendation.intent);

  return (
    /* The kind of work is set on the panel as a custom property and everything
       inside reads it, so the card is tinted by one value rather than by six
       copies of a conditional.
       Where that colour is allowed to land took three attempts. A wash of the
       hue at 11% over the whole panel read as a stain rather than as amber. A
       2px bar down the leading edge was the crudest device in the box. Then a
       full header strip with the label, the source and a tinted rule under it —
       which gave the card a chrome bar it does not need, at the top of the one
       page the app opens on. Colour arrives as ink, in small amounts, and the
       card has no furniture: a label, a title, the sentence, the button. */
    <Panel className="mt-3 p-5" style={{ ["--work" as string]: `var(${work.tone})` }}>
      {/* What kind of work this is and where the problem came from, on one
          quiet line above the title. Both are facts about the assignment rather
          than part of it, which is why they are small and set in a row — and
          not why they were a bar. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <p className="flex min-w-0 items-center gap-1.5 text-ui-sm font-medium text-[var(--work)]" title={work.gloss}>
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
          {work.label}
        </p>
        <SourceChip source={recommendation.source} />
      </div>

      <div className="mt-1.5">
        <div className="min-w-0">
          <button
            className="block min-w-0 max-w-full truncate rounded-[var(--radius-md)] text-left text-[1.3rem] font-semibold leading-[1.25] tracking-[-0.02em] outline-none focus-visible:ring-1 focus-visible:ring-ring"
            disabled={busy}
            onClick={onStart}
            type="button"
          >
            {recommendation.challengeTitle}
          </button>

          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-ui text-muted-foreground">
            {recommendation.abilityId ? (
              <button
                className="min-w-0 truncate rounded-[var(--radius-md)] font-medium text-foreground outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => onOpenAbility(recommendation.abilityId!)}
                title={recommendation.abilityTitle}
                type="button"
              >
                {recommendation.abilityTitle}
              </button>
            ) : (
              <span className="min-w-0 truncate font-medium text-foreground">{recommendation.abilityTitle}</span>
            )}
            <span aria-hidden>·</span>
            <span className="min-w-0 truncate">{recommendation.trackTitle}</span>
          </p>

          {reason && <p className="mt-3 max-w-[46rem] text-content leading-[1.6] text-muted-foreground">{reason}</p>}

          {/* The disclosure sits with the claim it belongs to, not out in the
              action row. Pushed to the far edge of that row it stood five
              hundred pixels from the sentence it expands, which made it read as
              a third control of equal standing to Start rather than as the rest
              of a paragraph. */}
          {working.length > 0 && (
            <button
              aria-expanded={why}
              className="mt-1.5 inline-flex items-center gap-1 rounded-[var(--radius-md)] text-ui text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setWhy((open) => !open)}
              type="button"
            >
              {why ? "Hide working" : "Show working"}
              <ChevronDown className={cn("size-3 transition-transform", why && "rotate-180")} />
            </button>
          )}

          {why && working.length > 0 && (
            <ul className="mt-2.5 flex max-w-[46rem] list-disc flex-col gap-1.5 border-l-[length:var(--hairline)] border-[color-mix(in_oklab,var(--work)_55%,transparent)] py-0.5 pl-3">
              {working.slice(0, 5).map((line) => (
                <li className="list-none text-ui leading-[1.55] text-muted-foreground" key={line}>{line}</li>
              ))}
            </ul>
          )}

          {/* The one place in the app where a button is not ink: this is the
              single primary action on the page the app opens on, and the colour
              it wears says what sort of session pressing it starts. `--background`
              for the label works in both themes without a branch — the dark
              theme's hue is light and its ground is dark, and the light theme's
              is the other way round. */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              className="bg-[var(--work)] text-[var(--background)] hover:bg-[var(--work)] hover:opacity-90"
              disabled={busy}
              onClick={onStart}
            >
              {continuing ? "Continue" : "Start"}<ArrowRight data-icon="inline-end" />
            </Button>
            {mode}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/**
 * The assignment slot when the assignment is not a problem.
 *
 * Same frame, same weight, same one button, because it is the same slot: this is
 * what has to happen before Spar can set anything, and it is therefore the thing
 * to do now. Drawn as a banner above the recommendation instead — which is what
 * the baseline prompt used to be — it gave the page two calls to action and no
 * ranking between them.
 */
function Call({ body, busy, eyebrow, icon: Icon, label, onAct, title, tone }: {
  body: string;
  busy: boolean;
  eyebrow: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onAct(): void;
  title: string;
  /** The same work colour the assignment uses, because this is the same slot and
   *  what it holds is still a kind of work: placing the learner is a diagnosis,
   *  and naming a goal is the thing everything else is built on. */
  tone: string;
}) {
  return (
    <Panel className="mt-3 p-5" style={{ ["--work" as string]: `var(${tone})` }}>
      <p className="flex items-center gap-1.5 text-ui-sm font-medium text-[var(--work)]">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
        {eyebrow}
      </p>

      <div className="mt-1.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[1.3rem] font-semibold leading-[1.25] tracking-[-0.02em]">
            <Icon className="size-[1.1rem] shrink-0 text-[var(--work)]" />
            {title}
          </h2>
          <p className="mt-2 max-w-[46rem] text-content leading-[1.6] text-muted-foreground">{body}</p>
          <Button
            className="mt-4 bg-[var(--work)] text-[var(--background)] hover:bg-[var(--work)] hover:opacity-90"
            disabled={busy}
            onClick={onAct}
          >
            {label}<ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/** Where the problem came from, in the source's own mark and word. A Spar
 *  challenge gets the same treatment rather than no mark at all: "nobody else
 *  has ever been asked this" is a fact about the problem, not an absence. */
function SourceChip({ source }: { source: "leetcode" | "codeforces" | "spar" }) {
  return (
    <span className="inline-flex h-[1.25rem] shrink-0 items-center gap-1 rounded-[var(--radius-md)] border-[length:var(--hairline)] border-[var(--border-surface-strong)] bg-[var(--surface-tertiary)] px-1.5 text-ui-sm font-medium text-foreground">
      {source === "spar"
        ? <Sparkles className="size-3 shrink-0" />
        : <SourceGlyph className="size-3 shrink-0" source={source} />}
      {SOURCE_LABEL[source]}
    </span>
  );
}

/**
 * One figure and where it came from, as a chip rather than a card.
 *
 * A count on a page like this is a promise that the list behind it exists, so
 * every one of these is a button — three figures, three lists. They sit on one
 * line because they are one line's worth of information: as cards in a grid they
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
      <span className="tabular-nums font-semibold text-foreground">{value}</span>
      {label}
      {sub && <span className="text-ui-sm text-muted-foreground">{sub}</span>}
    </button>
  );
}

/** A section's "go to the full list" action. Quiet enough to be a label and
 *  shaped enough to be pressed. */
function Jump({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button
      className="inline-flex items-center gap-1 rounded-[var(--radius-md)] px-1.5 py-0.5 text-ui-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onClick}
      type="button"
    >
      {label}
      <ArrowRight className="size-3" />
    </button>
  );
}

const SOURCE_LABEL: Record<"leetcode" | "codeforces" | "spar", string> = { leetcode: "LeetCode", codeforces: "Codeforces", spar: "Spar" };

function modeValue(mode: TrainingMode) { return mode.kind === "source" ? mode.source : mode.kind === "focus" ? "focus" : mode.kind; }
/**
 * The six kinds of work, each with the colour it is drawn in.
 *
 * The intent is the most useful thing on the assignment and it used to be the
 * least visible: one grey uppercase word above a grey title on a grey panel.
 * "Diagnose" and "Advance" are opposite instructions about how to spend the next
 * half hour — whether Spar is trying to find something out or trying to raise
 * the ceiling — and nothing on the page distinguished them.
 *
 * Colour rather than a second sentence, because the distinction is categorical
 * and there are only six categories. The tokens are in `theme.css` under "Work,
 * by kind"; the sentence each one carries is the tooltip, so the chip stays one
 * word and the word stays explainable.
 */
const WORK: Record<string, { label: string; tone: string; gloss: string }> = {
  diagnose: { label: "Diagnose", tone: "--work-diagnose", gloss: "Spar is trying to find out where the gap actually is, so this is pitched near even money." },
  teach: { label: "Prerequisite", tone: "--work-teach", gloss: "Something underneath this has to be in place first, so the problem is aimed below where you are." },
  practise: { label: "Practice", tone: "--work-practise", gloss: "Spar has the diagnosis and this is the repetition, pitched slightly against you." },
  transfer: { label: "Transfer", tone: "--work-transfer", gloss: "You can do this in the form you learned it; this asks for it somewhere new." },
  advance: { label: "Advance", tone: "--work-advance", gloss: "The current level is well enough supported to raise the constraint." },
  retain: { label: "Retention", tone: "--work-retain", gloss: "This was reliable once and has not been seen in a while. A re-check, not new ground." },
};

function workKind(intent: string) {
  return WORK[intent] ?? { label: intent, tone: "--work-retain", gloss: "" };
}
function today() { return new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }); }
