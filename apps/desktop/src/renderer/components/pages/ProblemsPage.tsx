import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bookmark, LayoutGrid, Library, Loader2, Rows3, Search, TriangleAlert, Waypoints } from "lucide-react";
import type { AbilityHistorySummary, ChallengeHistorySummary, ConceptSummary, LearnerProgress } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { cn } from "@/lib/utils";
import {
  BAND_LABEL,
  ORIGIN_LABEL,
  filterProblems,
  mergeProblems,
  originCounts,
  sortProblems,
  type ProblemBand,
  type ProblemFilter,
  type ProblemItem,
  type ProblemOrigin,
  type ProblemSort,
  type ProblemStanding,
} from "@/lib/problems";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ViewSwitch } from "@/components/ui/view-switch";
import { EmptyState } from "../common/EmptyState";
import { BandPill, OriginChip, ProblemMark } from "../problems/ProblemMark";
import { ProblemRow } from "../problems/ProblemRow";
import { ProblemTile } from "../problems/ProblemTile";
import { ConceptMap } from "../problems/ConceptMap";
import { useProblemSearch } from "../../hooks/use-problem-search";
import { useSavedProblems } from "@/hooks/use-saved-problems";

/** Remembered per device rather than per account: which of the two views someone
 *  wants is a fact about the screen they are sitting at. */
const VIEW_KEY = "spar.problems.view";
type View = "list" | "grid" | "map";
const VIEWS: View[] = ["list", "grid", "map"];

const ORIGINS: Array<ProblemOrigin | "all"> = ["all", "spar", "codeforces", "leetcode"];
const BANDS: Array<ProblemBand | "all"> = ["all", "easy", "medium", "hard"];
const STANDINGS: Array<ProblemStanding | "all"> = ["all", "todo", "attempted", "solved"];
const STANDING_LABEL: Record<ProblemStanding, string> = { todo: "Not started", attempted: "Attempted", solved: "Solved" };
const SORTS: Array<{ value: ProblemSort; label: string }> = [
  { value: "suggested", label: "Suggested" },
  { value: "recent", label: "Recently worked on" },
  { value: "easiest", label: "Easiest first" },
  { value: "hardest", label: "Hardest first" },
];

/**
 * Every problem the learner can reach, in one list.
 *
 * The page answers one question — *what should I solve now* — and it answers it
 * from two places at once: the challenges Spar has written for this learner and
 * already graded, and the problems their connected sources hold and have never
 * handed them. Those are merged before anything is drawn (see `lib/problems`),
 * because the alternative is two tabs, and a learner who has to pick a tab before
 * they can pick a problem is being asked to know something about Spar's internals
 * in order to practise.
 *
 * Deliberately not the home page. Home is where you say what you want to get
 * better at and let the agent read your evidence before it chooses; this is where
 * you overrule it. Both are worth having and neither should be the other's
 * preamble — which is what a composer stacked on top of a problem grid turns into.
 */
export function ProblemsPage({
  abilities,
  api,
  challenges,
  concepts,
  onOpenAbility,
  onOpenChallenge,
  onOpenConcept,
  onStartProblem,
  progress,
  shelfRequest,
}: {
  /** The ledger and the subject tree, for the map view only — the list and the
   *  grid are built from problems, and this is the same library seen from
   *  above. */
  abilities: AbilityHistorySummary[];
  api: SparApi | undefined;
  challenges: ChallengeHistorySummary[];
  concepts: ConceptSummary[];
  onOpenAbility(abilityId: string): void;
  onOpenChallenge(challengeId: string): void;
  onOpenConcept(slug: string): void;
  progress: LearnerProgress;
  /** Opens a session on one problem the learner picked. Resolves when the session
   *  is on screen, so the row that was clicked can stay busy until it is. */
  onStartProblem(input: { source: "leetcode" | "codeforces"; slug: string }): Promise<void>;
  /** Bumped by the shell when something elsewhere asked for the shelf — pressing
   *  a save receipt, so far. A counter and not a boolean because this page owns
   *  its filters: this is one request to turn the shelf on, and asking twice
   *  after the learner has turned it back off has to work the second time. */
  shelfRequest?: number;
}) {
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<ProblemOrigin | "all">("all");
  const [band, setBand] = useState<ProblemBand | "all">("all");
  const [standing, setStanding] = useState<ProblemStanding | "all">("all");
  /* Not folded into `origin`: see `ProblemFilter.saved`. Held here rather than
     remembered, because a shelf you land on is a shelf you have to leave before
     you can browse, and browsing is what this page is for. */
  const [onlySaved, setOnlySaved] = useState(false);
  const [sort, setSort] = useState<ProblemSort>("suggested");
  /* The list is the default. A grid of cards is the better way to browse a
     shortlist, but this page opens on everything the learner can reach, and the
     first thing anybody does with everything is scan it. */
  const [view, setView] = useState<View>(() => {
    const saved = localStorage.getItem(VIEW_KEY) as View | null;
    return saved && VIEWS.includes(saved) ? saved : "list";
  });
  /** The problem being opened. One at a time: starting a source problem creates a
   *  session, so a second click would create a second session. */
  const [opening, setOpening] = useState<string | null>(null);

  const search = useProblemSearch(api, { query, band, standing });

  useEffect(() => {
    if (!shelfRequest) return;
    setOnlySaved(true);
  }, [shelfRequest]);

  useEffect(() => localStorage.setItem(VIEW_KEY, view), [view]);

  const saved = useSavedProblems();
  const savedKeys = useMemo(() => new Set(saved.map((row) => row.key)), [saved]);
  const items = useMemo(() => mergeProblems(challenges, search.hits, saved), [challenges, search.hits, saved]);
  const filter: ProblemFilter = { query, origin, band, standing, saved: onlySaved, savedKeys };
  const counts = useMemo(() => originCounts(items, filter), [items, query, band, standing, onlySaved, savedKeys]);
  /* What the shelf chip counts: how many saved problems this page can actually
     show, not how many rows the table holds. A saved Spar challenge whose
     session was deleted has a key and nothing to draw, and counting it would
     promise a row that never appears. */
  const savedCount = useMemo(
    () => items.filter((item) => savedKeys.has(item.key)).length,
    [items, savedKeys],
  );
  /* The rating is passed rather than read here so the ranking stays a pure
     function of what it is given: `progress.rating` is the learner's standing,
     and the suggested order is what that standing implies about this library. */
  const visible = useMemo(() => sortProblems(filterProblems(items, filter), sort, query, progress.rating), [items, query, origin, band, standing, onlySaved, savedKeys, sort, progress.rating]);

  const filtered = Boolean(query.trim()) || origin !== "all" || band !== "all" || standing !== "all" || onlySaved;

  /* One problem, lifted out of the list and given a card.
   *
   * The page's whole job is "what should I solve now", and a flat run of 88 rows
   * answers it by handing the question back — the ranking was already in the
   * order, but an ordered list with no top to it reads as an index rather than as
   * a recommendation. So the first suggestion is drawn as the thing it is, once,
   * and taken out of the list below rather than shown twice.
   *
   * Only when nobody has narrowed anything and only under the ranking that means
   * "Spar's pick". Once a filter or another sort is on, the learner is doing the
   * choosing and the page should not answer over them. */
  const hero = !filtered && sort === "suggested" && visible.length > 2 ? visible[0] ?? null : null;
  const listed = hero ? visible.filter((item) => item.key !== hero.key) : visible;

  /* "Load more" is about the remote half only — the learner's own history arrives
     whole on the bootstrap. Offering it while an origin filter has the remote half
     hidden would fetch problems the list has already been told not to show. */
  const canLoadMore = search.more && origin !== "spar" && !search.loading;

  const openProblem = (item: ProblemItem) => {
    if (opening) return;
    if (item.kind === "challenge") {
      onOpenChallenge(item.challenge.id);
      return;
    }
    setOpening(item.key);
    void onStartProblem({ source: item.hit.source, slug: item.hit.slug }).finally(() => setOpening(null));
  };

  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[72rem] px-8 pb-5 pt-8">
        <h1 className="text-[1.35rem] font-semibold tracking-[-0.03em]">Problems</h1>
        {/* One sentence and a tally, rather than a paragraph. What the page holds
            is now said by the origin chips and their counts a few lines down, so
            repeating it in prose above them left the only genuinely new fact — that
            opening a source problem starts a session — buried at the end of four
            lines nobody reads twice. */}
        <p className="mt-1 max-w-[46rem] text-content text-muted-foreground">
          Everything you can practise right now. Opening one from a source starts a session on it.
        </p>

      </div>

      {/* The controls stay with you. This page opens on everything the learner can
          reach — eighty-odd rows on a full library — and a filter bar that scrolls
          away means narrowing a long list requires scrolling back to the top to do
          it.

          The band is the full width of the pane and square-cornered, and its
          contents sit in the same column as everything else. That split is the
          whole thing: a sticky bar drawn inside the column was a white slab with
          two hard edges floating in the middle of the page, and one drawn wider
          than the column left its controls unaligned with the rows they filter. A
          toolbar is a piece of the window, so it goes edge to edge and is ruled off
          rather than boxed. */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-[72rem] px-8 py-3">
          <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              aria-label="Search problems"
              className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-8 text-ui outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-[var(--border-strong)]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search every problem Spar can reach…"
              type="search"
              value={query}
            />
            {search.loading && (
              <Loader2 aria-hidden className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground/70" />
            )}
          </div>

          {/* Level, status and sort narrow a list of problems. The map is a
              drawing of the subject tree, and none of the three has anything to
              say about a concept — so they go rather than sit there inert. */}
          {view !== "map" && (
            <>
          <FilterSelect
            label="Any level"
            onChange={(value) => setBand(value as ProblemBand | "all")}
            options={BANDS.map((value) => ({ value, label: value === "all" ? "Any level" : BAND_LABEL[value] }))}
            value={band}
          />
          <FilterSelect
            label="Any status"
            onChange={(value) => setStanding(value as ProblemStanding | "all")}
            options={STANDINGS.map((value) => ({ value, label: value === "all" ? "Any status" : STANDING_LABEL[value] }))}
            value={standing}
          />
          <FilterSelect
            label="Suggested"
            onChange={(value) => setSort(value as ProblemSort)}
            options={SORTS}
            value={sort}
            width="9.5rem"
          />
            </>
          )}
          <ViewSwitch
            ariaLabel="Problem layout"
            className="w-[13rem]"
            onChange={(next) => setView(next)}
            options={[
              /* Labelled, not icon-only. `ViewSwitch` renders its icons
                 `aria-hidden`, so a segment with no label is a tab with no
                 accessible name — and two abstract glyphs are a guess even for
                 someone who can see them. */
              { value: "list", label: "List", icon: Rows3 },
              { value: "grid", label: "Grid", icon: LayoutGrid },
              { value: "map", label: "Map", icon: Waypoints },
            ]}
            value={view}
          />
        </div>

        {/* Where the problems come from, as chips rather than another select: this
            is the filter that changes what the page *is*, and it carries counts,
            which a closed dropdown cannot show. */}
        <div className={cn("mt-2 flex flex-wrap items-center gap-1", view === "map" && "hidden")}>
          {ORIGINS.map((value) => (
            <button
              key={value}
              aria-pressed={origin === value}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-ui outline-none transition-colors",
                "focus-visible:ring-1 focus-visible:ring-ring",
                origin === value
                  ? "bg-[var(--color-background-elevated-secondary)] font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setOrigin(value)}
              type="button"
            >
              {value === "all" ? "All" : ORIGIN_LABEL[value]}
              <span className="tabular-nums text-muted-foreground">{counts[value]}</span>
            </button>
          ))}

          {/* The shelf, set apart by a rule rather than added to the row.
              Everything to the left of it answers "where is this problem from",
              and this answers "did I put it aside" — they are both filters and
              they are not the same kind of fact, so combining them into one
              exclusive row would mean choosing Saved gave up choosing LeetCode,
              which is precisely the combination a shelf is for.

              Hidden until there is one. An empty shelf chip is a permanent
              invitation to press something that will show nothing, and the
              bookmark on every row is already the instruction for how to fill
              it. */}
          {savedCount > 0 && (
            <>
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
              <button
                aria-pressed={onlySaved}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-ui outline-none transition-colors",
                  "focus-visible:ring-1 focus-visible:ring-ring",
                  onlySaved
                    ? "bg-[var(--color-background-elevated-secondary)] font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setOnlySaved((value) => !value)}
                type="button"
              >
                <Bookmark className={cn("size-3.5", onlySaved && "fill-current")} />
                Saved
                <span className="tabular-nums text-muted-foreground">{savedCount}</span>
              </button>
            </>
          )}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[72rem] px-8 pb-16 pt-4">
        {/* A source that could not answer is said out loud. A short list with no
            explanation is the same lie as an empty one — the learner would read it
            as "Codeforces has three problems about this". */}
        {view !== "map" && (search.failed.length > 0 || search.error) && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/8 px-3 py-2 text-ui text-muted-foreground">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-[var(--warning)]" />
            <span className="min-w-0 flex-1">
              {search.error
                ? `Spar could not reach its practice sources. ${search.error}`
                : `${search.failed.map((entry) => ORIGIN_LABEL[entry.source]).join(" and ")} could not be searched, so nothing from ${search.failed.length === 1 ? "it" : "them"} is in this list. ${search.failed[0]!.message}`}
            </span>
          </div>
        )}

        {view === "map" ? (
          <ConceptMap
            abilities={abilities}
            concepts={concepts}
            onOpenAbility={onOpenAbility}
            onOpenConcept={onOpenConcept}
            progress={progress}
            query={query}
          />
        ) : (
          <div className="mt-1">
            {visible.length === 0 ? (
              <EmptyState
                description={
                  search.loading
                    ? "Asking your practice sources…"
                    : filtered
                      ? "Nothing matches these filters. Widen one, or clear the search."
                      : "Connect a practice source in Settings to browse real problems, or start a session on the home page and let the agent write you one."
                }
                icon={Library}
                title={search.loading ? "Looking" : filtered ? "No problems match" : "No problems yet"}
                {...(filtered && !search.loading
                  ? {
                      action: (
                        <button
                          className="inline-flex h-7 items-center rounded-lg border border-border bg-card px-2.5 text-ui transition-colors hover:border-[var(--border-strong)]"
                          onClick={() => {
                            setQuery("");
                            setOrigin("all");
                            setBand("all");
                            setStanding("all");
                          }}
                          type="button"
                        >
                          Clear filters
                        </button>
                      ),
                    }
                  : {})}
              />
            ) : (
              <>
                {hero && <NextUp item={hero} onOpen={() => openProblem(hero)} pending={opening === hero.key} />}

                {view === "grid" ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {listed.map((item) => (
                      <ProblemTile item={item} key={item.key} onOpen={() => openProblem(item)} pending={opening === item.key} />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {listed.map((item) => (
                      <ProblemRow item={item} key={item.key} onOpen={() => openProblem(item)} pending={opening === item.key} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {canLoadMore && view !== "map" && (
          <div className="mt-4 flex justify-center">
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-ui text-muted-foreground transition-colors hover:border-[var(--border-strong)] hover:text-foreground"
              onClick={search.loadMore}
              type="button"
            >
              Load more
              <span className="tabular-nums text-muted-foreground/60">{search.total - search.hits.length} left</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


/**
 * Spar's pick, drawn as a recommendation rather than as row one.
 *
 * Everything here is already in the row below it; what the card adds is the
 * commitment. A ranked list with no top to it is an index — the reader has to be
 * told that position one means something before the order is worth anything to
 * them — and the difference between "here are 88 problems" and "start with this
 * one" is the difference between a database and a coach.
 *
 * It says why, in the learner's terms, and the reason is real: an unfinished
 * problem outranks a fresh one because you already have the context for it
 * loaded.
 */
function NextUp({ item, onOpen, pending }: { item: ProblemItem; onOpen(): void; pending: boolean }) {
  const reason =
    item.standing === "attempted"
      ? "You have already started this one"
      : item.kind === "challenge"
        ? "Written for you, from your own evidence"
        : `From ${ORIGIN_LABEL[item.origin]}, matched to what you are working on`;

  return (
    <button
      aria-busy={pending || undefined}
      className={cn(
        /* Square and ruled, like the rows under it. A rounded card floating above a
           ruled list is a second design language for the same object — the reader
           is told this is a different kind of thing when it is the same problem
           given more room. No fill either: `bg-card` over this page's off-white is
           a white slab the eye reads as a panel laid on the list. The rule beneath
           it is the list's own, so it reads as the list's first entry — which is
           exactly what it is. */
        "group flex w-full items-center gap-4 border-b border-border px-3 py-4 text-left outline-none",
        "transition-colors duration-100 hover:bg-[var(--color-background-elevated-secondary)]",
        "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        pending && "pointer-events-none",
      )}
      disabled={pending}
      onClick={onOpen}
      type="button"
    >
      <ProblemMark className="shrink-0" item={item} size={38} />

      <div className="min-w-0 flex-1">
        <p className="text-ui-sm font-medium tracking-[0.04em] text-muted-foreground">NEXT UP</p>
        <p className="mt-0.5 truncate text-[1.0625rem] font-semibold leading-[1.3] tracking-[-0.015em]">{item.title}</p>
        <p className="mt-0.5 truncate text-ui text-muted-foreground">{reason}</p>
      </div>

      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <BandPill band={item.band} />
        <OriginChip origin={item.origin} />
      </div>

      <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-background-elevated-secondary)] px-3 text-ui font-medium transition-colors group-hover:bg-accent">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUpRight className="size-3.5" />}
        {pending ? "Opening…" : item.kind === "challenge" ? "Open" : "Start solving"}
      </span>
    </button>
  );
}

/** A filter as a select, sized to the control row rather than to a settings form. */
function FilterSelect({
  label,
  onChange,
  options,
  value,
  width = "8.5rem",
}: {
  label: string;
  onChange(value: string): void;
  options: Array<{ value: string; label: string }>;
  value: string;
  width?: string;
}) {
  return (
    <Select onValueChange={onChange} value={value}>
      <SelectTrigger aria-label={label} className="h-8 shrink-0 text-ui" style={{ width }}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
