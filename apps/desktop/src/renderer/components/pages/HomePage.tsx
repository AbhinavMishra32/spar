import { useEffect, useMemo, useState } from "react";
import { ChevronDown, CornerDownLeft, Sparkles } from "lucide-react";
import type { AbilityHistorySummary, ChallengeHistorySummary, ConceptSummary, SessionSummary, TrainingMode } from "@spar/domain";
import type { BootstrapData, SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Page } from "../common/Page";
import { SourceGlyph } from "../common/SourceGlyph";
import { ChallengeEmblem } from "../workspace/ChallengeEmblem";
import { AbilityDetail } from "./AbilityPage";

/** Where something on this page sends you. */
export type HomeDestination = "challenges" | "sessions" | "problems" | "tracks" | "review";

/**
 * Home, as two things: a note and a line of days.
 *
 * **The note.** A few sentences Spar writes from what it knows — what is next
 * and what it is checking, what is due for review, where the rating stands.
 * Every figure and name in it is a link to the thing it names, so the note is
 * the navigation: there are no cards to scan because the page reads top to
 * bottom in one breath, the way a coach would say it. Under it, the reason for
 * the next challenge in Spar's own words, and one button — Enter also presses it.
 *
 * **The days.** Two weeks behind you and one ahead on one axis. Behind: a stone
 * on each day for each challenge solved that day. Ahead: how many review cards
 * fall due. Today in the middle. It is the only picture on the page, and it
 * holds the three things that change day to day — work done, the collection it
 * left, and the memory that is coming due — without a single panel.
 *
 * Everything else — abilities, sessions, history — has its own page and a place
 * in the sidebar.
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
  /** Which ability is open, or null for the page itself. Owned by App: an
   *  ability is one of the window's places, and Back must be able to name it. */
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
  const summaries = useMemo(() => new Map(concepts.map((concept) => [concept.slug, concept])), [concepts]);

  const recommendation = data.recommendation;
  const session = recommendation?.sessionId ? data.sessions.find((item) => item.id === recommendation.sessionId) : undefined;
  const continuing = Boolean(session?.activeQuestion);
  /* The one thing the page asks you to do, whichever it is today. */
  const primary: { label: string; run(): void; disabled: boolean } =
    data.baseline.status !== "complete"
      ? { label: data.baseline.status === "in-progress" ? "Continue baseline" : "Begin baseline", run: onBaseline, disabled: busy }
      : !recommendation
        ? { label: "Create a track", run: onCreateTrack, disabled: busy }
        : { label: continuing ? "Continue" : "Start", run: () => session && onOpen(session), disabled: busy || !session };

  /* Enter starts it, from anywhere on the page that is not a control. */
  useEffect(() => {
    if (ability) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || primary.disabled) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a, [role=button], [contenteditable], [role=dialog], [role=menu]")) return;
      event.preventDefault();
      primary.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ability, primary]);

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

  const name = data.profile?.name?.split(/\s+/)[0] ?? data.account?.displayName?.split(/\s+/)[0] ?? "";
  const checking = data.baseline.status === "complete" ? recommendation?.abilityTitle ?? "" : "";

  return (
    <Page className="pt-6" width="wide">
      <div className="flex min-h-[calc(100vh-10rem)] flex-col justify-center pb-10">
        <p className="text-ui text-muted-foreground">{today()}</p>

        <Note data={data} name={name} onBaseline={onBaseline} onCreateTrack={onCreateTrack} onNavigate={onNavigate} onOpenAbility={onOpenAbility} onStart={primary.run} />

        {/* What the next challenge is checking, in one line. The agent's full
            reasoning is written for Spar, in the third person, and reads that
            way — it belongs in the session, not on the front door. */}
        {checking && (
          <p className="mt-5 flex items-center gap-2 text-content text-muted-foreground">
            <Sparkles aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              Checking{" "}
              {recommendation?.abilityId
                ? <Ref onClick={() => onOpenAbility(recommendation.abilityId)}>{lowerFirst(checking)}</Ref>
                : lowerFirst(checking)}
            </span>
          </p>
        )}

        <div className="mt-8 flex items-center gap-2">
          <Button disabled={primary.disabled} onClick={primary.run} size="lg">
            {primary.label}
            <kbd className="ml-1 inline-flex items-center rounded border border-current/25 px-1 py-px opacity-70"><CornerDownLeft className="size-2.5" /></kbd>
          </Button>
          {recommendation && data.baseline.status === "complete" && <ModeMenu mode={data.trainingMode} onMode={onMode} />}
        </div>

        {/* At the foot of the first screen: the note is what you read, the days
            are what you glance at on the way out. */}
        <div className="mt-20">
          <Days challenges={challenges} data={data} onNavigate={onNavigate} />
        </div>
      </div>
    </Page>
  );
}

/* ——— The note ————————————————————————————————————————————————————— */

/**
 * Spar's note, composed from the data and nothing else. Each sentence is there
 * only when it has something true to say, and each figure in it is a door.
 */
function Note({ data, name, onBaseline, onCreateTrack, onNavigate, onOpenAbility, onStart }: {
  data: BootstrapData;
  name: string;
  onBaseline(): void;
  onCreateTrack(): void;
  onNavigate(page: HomeDestination): void;
  onOpenAbility(abilityId: string | null): void;
  onStart(): void;
}) {
  const recommendation = data.recommendation;
  const session = recommendation?.sessionId ? data.sessions.find((item) => item.id === recommendation.sessionId) : undefined;
  const reviews = data.reviews;
  const rating = data.progress.rating;
  const history = data.progress.ratingHistory;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const before = [...history].reverse().find((point) => Date.parse(point.occurredAt) <= weekAgo) ?? history[0];
  const delta = before && before.id !== rating.id ? rating.rating - before.rating : 0;

  const next: React.ReactNode =
    data.baseline.status !== "complete" ? (
      <>Spar hasn&apos;t watched you work yet — <Ref onClick={onBaseline}>set your baseline</Ref> and it will start writing for you.</>
    ) : !recommendation ? (
      <>Tell Spar what you&apos;re training for — <Ref onClick={onCreateTrack}>create a track</Ref> and it will start writing for you.</>
    ) : (
      <>
        {session?.activeQuestion ? "You're partway through " : "Next is "}
        <Ref onClick={onStart}>{recommendation.challengeTitle}</Ref>
        .
      </>
    );

  const review: React.ReactNode =
    reviews.dueCount > 0 ? (
      <> <Ref onClick={() => onNavigate("review")}>{reviews.dueCount} {reviews.dueCount === 1 ? "card is" : "cards are"}</Ref> due for review.</>
    ) : reviews.totalCards > 0 && reviews.nextDueAt ? (
      <> Nothing to review until {relativeDay(reviews.nextDueAt)}.</>
    ) : null;

  const standing: React.ReactNode = history.length > 0 ? (
    <>
      {" "}Your rating is <Ref onClick={() => onNavigate("challenges")}>{rating.rating}</Ref>
      {delta > 0 ? <>, <span className="text-[var(--success)]">up {delta}</span> this week.</> : delta < 0 ? <>, down {-delta} this week.</> : "."}
    </>
  ) : null;

  return (
    <h1 className="mt-2 max-w-[38rem] text-[1.6rem] leading-[1.38] font-semibold tracking-[-0.035em] text-pretty">
      {greeting()}{name ? `, ${name}` : ""}.{" "}
      <span className="text-muted-foreground">{next}{review}{standing}</span>
    </h1>
  );
}

/** A figure or a name in the note that opens what it names. Set in full ink
 *  against the note's grey, with a hairline under it that fills on hover. */
function Ref({ children, onClick }: { children: React.ReactNode; onClick(): void }) {
  /* A span, not a button: a button is an atomic box, so a long title inside
     one could not wrap with the sentence and broke out of it onto lines of
     its own. */
  return (
    <span
      className="cursor-pointer rounded-sm text-foreground tabular-nums underline decoration-foreground/25 decoration-1 underline-offset-[0.18em] outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      onClick={onClick}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); } }}
      role="button"
      tabIndex={0}
    >
      {children}
    </span>
  );
}

/* ——— The days ————————————————————————————————————————————————————— */

const PAST = 14;
const AHEAD = 7;

/**
 * Two weeks behind and one ahead, one column a day. Behind, the stones of the
 * challenges solved that day; ahead, the review cards falling due. The axis is
 * the point: what you did and what is coming are the same line.
 */
function Days({ challenges, data, onNavigate }: { challenges: ChallengeHistorySummary[]; data: BootstrapData; onNavigate(page: HomeDestination): void }) {
  const days = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const solved = new Map<number, ChallengeHistorySummary[]>();
    for (const item of challenges) {
      if (item.lastOutcome !== "passed") continue;
      const day = new Date(item.updatedAt);
      day.setHours(0, 0, 0, 0);
      const offset = Math.round((day.getTime() - start.getTime()) / 86_400_000);
      if (offset > 0 || offset < -(PAST - 1)) continue;
      solved.set(offset, [...(solved.get(offset) ?? []), item]);
    }
    return Array.from({ length: PAST + AHEAD }, (_, index) => {
      const offset = index - (PAST - 1);
      const date = new Date(start.getTime() + offset * 86_400_000);
      return { offset, date, stones: solved.get(offset) ?? [], due: offset >= 0 ? data.reviews.upcoming[offset]?.count ?? 0 : 0 };
    });
  }, [challenges, data.reviews.upcoming]);

  const solvedCount = days.reduce((sum, day) => sum + day.stones.length, 0);
  const dueAhead = days.reduce((sum, day) => sum + (day.offset > 0 ? day.due : 0), 0);
  const columns = { gridTemplateColumns: `repeat(${PAST + AHEAD}, minmax(0, 1fr))` };

  return (
    <section aria-label="The last two weeks and the next one">
      <div className="mb-3 flex items-baseline justify-between text-ui-sm text-muted-foreground">
        <span>{solvedCount ? `${solvedCount} solved in the last two weeks` : "The last two weeks"}</span>
        <span>{dueAhead ? `${dueAhead} ${dueAhead === 1 ? "review" : "reviews"} next week` : "Next week"}</span>
      </div>
      <div className="grid gap-1.5" style={columns}>
        {days.map((day) => {
          const today = day.offset === 0;
          const past = day.offset <= 0;
          const top = day.stones[0];
          const label = day.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
          return (
            <div className="flex min-w-0 flex-col items-center gap-1.5" key={day.offset}>
              {past ? (
                /* A day behind you: its stone, or an empty cell. More than one
                   solve that day shows the latest stone and a count. */
                <div
                  className={cn(
                    "relative grid aspect-square w-full max-w-11 place-items-center rounded-[10px]",
                    top ? "bg-foreground/[0.05]" : "bg-foreground/[0.025]",
                    today && "ring-1 ring-foreground/45 ring-inset",
                  )}
                  title={top ? `${label} · ${day.stones.length} solved` : label}
                >
                  {top && <ChallengeEmblem animated={false} numbered={false} question={top} size={26} />}
                  {day.stones.length > 1 && (
                    <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 text-[9px] leading-none font-semibold text-background tabular-nums">
                      {day.stones.length}
                    </span>
                  )}
                </div>
              ) : (
                /* A day ahead: how many cards come due, or nothing. */
                <button
                  className={cn(
                    "grid aspect-square w-full max-w-11 place-items-center rounded-[10px] border border-dashed text-ui-sm tabular-nums transition-colors",
                    day.due ? "border-foreground/30 text-foreground hover:bg-foreground/[0.05]" : "pointer-events-none border-foreground/10 text-transparent",
                  )}
                  disabled={!day.due}
                  onClick={() => onNavigate("review")}
                  title={day.due ? `${label} · ${day.due} due for review` : label}
                  type="button"
                >
                  {day.due || ""}
                </button>
              )}
              <span className={cn("text-[10px] leading-none tabular-nums", today ? "font-semibold text-foreground" : "text-muted-foreground/70")}>
                {today ? "Today" : day.date.getDate() === 1 ? day.date.toLocaleDateString(undefined, { month: "short" }) : day.date.getDate()}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ——— The mode ————————————————————————————————————————————————————— */

/** "Not this one": what decides the next challenge, as a quiet menu beside the
 *  button it overrules. */
function ModeMenu({ mode, onMode }: { mode: TrainingMode; onMode(mode: TrainingMode): Promise<void> }) {
  const [focusOpen, setFocusOpen] = useState(false);
  const [focus, setFocus] = useState(mode.kind === "focus" ? mode.focus : "");
  const label = mode.kind === "recommended" ? "Recommended"
    : mode.kind === "focus" ? `Focus: ${mode.focus}`
    : mode.kind === "explore" ? "Exploring"
    : mode.kind === "quick" ? "Quick practice"
    : `${SOURCE_LABEL[mode.source]} only`;
  const pick = (next: TrainingMode) => void onMode(next);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="max-w-56 text-muted-foreground" size="lg" variant="ghost">
            <span className="truncate">{label}</span>
            <ChevronDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onSelect={() => pick({ kind: "recommended" })}>Recommended</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setFocusOpen(true)}>Focus on…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pick({ kind: "explore" })}>Explore something new</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pick({ kind: "quick" })}>Quick practice</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => pick({ kind: "source", source: "leetcode" })}><SourceGlyph className="size-3.5" source="leetcode" />LeetCode only</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pick({ kind: "source", source: "codeforces" })}><SourceGlyph className="size-3.5" source="codeforces" />Codeforces only</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pick({ kind: "source", source: "spar" })}><Sparkles className="size-3.5" />Spar challenges only</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog onOpenChange={setFocusOpen} open={focusOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Focus training</DialogTitle>
            <DialogDescription>Spar still picks within this area.</DialogDescription>
          </DialogHeader>
          <Input autoFocus onChange={(event) => setFocus(event.target.value)} placeholder="Graphs, TypeScript types, dynamic programming…" value={focus} />
          <DialogFooter>
            <Button disabled={!focus.trim()} onClick={() => { pick({ kind: "focus", focus: focus.trim() }); setFocusOpen(false); }}>Apply focus</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ——— words ———————————————————————————————————————————————————————— */

const SOURCE_LABEL: Record<"leetcode" | "codeforces" | "spar", string> = { leetcode: "LeetCode", codeforces: "Codeforces", spar: "Spar" };

function today() { return new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }); }

function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function relativeDay(iso: string) {
  const days = Math.round((new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  return days <= 0 ? "later today" : days === 1 ? "tomorrow" : new Date(iso).toLocaleDateString(undefined, { weekday: "long" });
}

const lowerFirst = (value: string) => (/^[A-Z][a-z]/.test(value) ? value[0]!.toLowerCase() + value.slice(1) : value);
