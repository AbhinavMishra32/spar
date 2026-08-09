import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, Library, Loader2, Rows3, Search, TriangleAlert } from "lucide-react";
import type { ChallengeHistorySummary } from "@spar/domain";
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
import { ProblemRow } from "../problems/ProblemRow";
import { ProblemTile } from "../problems/ProblemTile";
import { useProblemSearch } from "../../hooks/use-problem-search";

/** Remembered per device rather than per account: which of the two views someone
 *  wants is a fact about the screen they are sitting at. */
const VIEW_KEY = "spar.problems.view";
type View = "list" | "grid";

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
  api,
  challenges,
  onOpenChallenge,
  onStartProblem,
}: {
  api: SparApi | undefined;
  challenges: ChallengeHistorySummary[];
  onOpenChallenge(challengeId: string): void;
  /** Opens a session on one problem the learner picked. Resolves when the session
   *  is on screen, so the row that was clicked can stay busy until it is. */
  onStartProblem(input: { source: "leetcode" | "codeforces"; slug: string }): Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<ProblemOrigin | "all">("all");
  const [band, setBand] = useState<ProblemBand | "all">("all");
  const [standing, setStanding] = useState<ProblemStanding | "all">("all");
  const [sort, setSort] = useState<ProblemSort>("suggested");
  /* The list is the default. A grid of cards is the better way to browse a
     shortlist, but this page opens on everything the learner can reach, and the
     first thing anybody does with everything is scan it. */
  const [view, setView] = useState<View>(() => (localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list"));
  /** The problem being opened. One at a time: starting a source problem creates a
   *  session, so a second click would create a second session. */
  const [opening, setOpening] = useState<string | null>(null);

  const search = useProblemSearch(api, { query, band, standing });

  useEffect(() => localStorage.setItem(VIEW_KEY, view), [view]);

  const items = useMemo(() => mergeProblems(challenges, search.hits), [challenges, search.hits]);
  const filter: ProblemFilter = { query, origin, band, standing };
  const counts = useMemo(() => originCounts(items, filter), [items, query, band, standing]);
  const visible = useMemo(() => sortProblems(filterProblems(items, filter), sort, query), [items, query, origin, band, standing, sort]);

  const filtered = Boolean(query.trim()) || origin !== "all" || band !== "all" || standing !== "all";
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
      <div className="mx-auto w-full max-w-[72rem] px-8 pb-16 pt-8">
        <h1 className="text-[1.35rem] font-semibold tracking-[-0.03em]">Problems</h1>
        <p className="mt-1 max-w-[46rem] text-content text-muted-foreground">
          Everything you can practise right now: the challenges Spar has written for you, and the problems your connected
          sources hold. Opening one from a source starts a session on it, with the agent told the choice was yours.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
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
          <ViewSwitch
            ariaLabel="Problem layout"
            className="w-[9.5rem]"
            onChange={(next) => setView(next)}
            options={[
              /* Labelled, not icon-only. `ViewSwitch` renders its icons
                 `aria-hidden`, so a segment with no label is a tab with no
                 accessible name — and two abstract glyphs are a guess even for
                 someone who can see them. */
              { value: "list", label: "List", icon: Rows3 },
              { value: "grid", label: "Grid", icon: LayoutGrid },
            ]}
            value={view}
          />
        </div>

        {/* Where the problems come from, as chips rather than another select: this
            is the filter that changes what the page *is*, and it carries counts,
            which a closed dropdown cannot show. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
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
              <span className="tabular-nums text-muted-foreground/60">{counts[value]}</span>
            </button>
          ))}
        </div>

        {/* A source that could not answer is said out loud. A short list with no
            explanation is the same lie as an empty one — the learner would read it
            as "Codeforces has three problems about this". */}
        {(search.failed.length > 0 || search.error) && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/8 px-3 py-2 text-ui text-muted-foreground">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-[var(--warning)]" />
            <span className="min-w-0 flex-1">
              {search.error
                ? `Spar could not reach its practice sources. ${search.error}`
                : `${search.failed.map((entry) => ORIGIN_LABEL[entry.source]).join(" and ")} could not be searched, so nothing from ${search.failed.length === 1 ? "it" : "them"} is in this list. ${search.failed[0]!.message}`}
            </span>
          </div>
        )}

        <div className="mt-4">
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
          ) : view === "grid" ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((item) => (
                <ProblemTile item={item} key={item.key} onOpen={() => openProblem(item)} pending={opening === item.key} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col">
              {visible.map((item) => (
                <ProblemRow item={item} key={item.key} onOpen={() => openProblem(item)} pending={opening === item.key} />
              ))}
            </div>
          )}
        </div>

        {canLoadMore && (
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
