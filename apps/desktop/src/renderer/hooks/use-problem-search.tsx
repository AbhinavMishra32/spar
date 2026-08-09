import { useCallback, useEffect, useRef, useState } from "react";
import type { PracticeSearchHit, SparApi } from "../../shared/api";
import type { ProblemBand, ProblemStanding } from "@/lib/problems";

/** How long the field is left alone before the sources are asked. Long enough
 *  that typing a problem name is one request rather than eleven, short enough
 *  that a considered query still feels answered rather than submitted. */
const DEBOUNCE_MS = 280;

/** One screenful and then some — the ceiling `sourceSearchInput` allows, which is
 *  in turn the gateways' own. Asking for fewer would make "Load more" the normal
 *  way to see a single page of results. */
const PAGE = 50;

export type ProblemSearchState = {
  hits: PracticeSearchHit[];
  /** How many problems matched across every source, not how many came back. */
  total: number;
  loading: boolean;
  /** Sources that could not answer this search, with their own reason. */
  failed: Array<{ source: "leetcode" | "codeforces"; message: string }>;
  /** The bridge itself refusing, which is not any one source's fault. */
  error: string | null;
  /** True while there are matches past the ones already held. */
  more: boolean;
  loadMore(): void;
};

const EMPTY: Omit<ProblemSearchState, "loadMore"> = { hits: [], total: 0, loading: false, failed: [], error: null, more: false };

/**
 * What the learner's sources have, for the query and filters on screen.
 *
 * Debounced, paged, and — the part worth being careful about — ordered. Every
 * response carries the request that asked for it, and a reply for a search that is
 * no longer the one on screen is dropped rather than rendered: two searches in
 * flight over a slow source finish in whatever order the network decides, and
 * without the guard the list settles on whichever one was slowest rather than on
 * whichever one the learner is still looking at.
 *
 * A source that fails is reported, not thrown. The home page is the first thing
 * the app draws and it asks every source at once; one of them being unreachable
 * has to cost the learner that source's problems and nothing else.
 */
export function useProblemSearch(
  api: SparApi | undefined,
  filters: { query: string; band: ProblemBand | "all"; standing: ProblemStanding | "all" },
): ProblemSearchState {
  const { query, band, standing } = filters;
  const [state, setState] = useState<Omit<ProblemSearchState, "loadMore">>({ ...EMPTY, loading: Boolean(api) });
  const [page, setPage] = useState(0);
  /** Bumped on every request; a reply whose ticket is stale is discarded. */
  const ticket = useRef(0);

  /* A changed query or filter is a different search, so it goes back to the first
     page. Kept out of the fetch effect, where resetting would itself be a reason
     to fetch again. */
  useEffect(() => setPage(0), [query, band, standing]);

  useEffect(() => {
    if (!api) return;
    const mine = (ticket.current += 1);
    const first = page === 0;
    setState((current) => ({ ...current, loading: true }));

    const run = () => {
      void api
        .searchPracticeProblems({
          query,
          concepts: [],
          ...(band === "all" ? {} : { difficulty: band }),
          /* `todo` at a source means "not solved", which is the one of Spar's
             three standings that does not translate — an attempted problem is
             still to do. Only the two that mean the same thing are forwarded; the
             rest is settled locally, against the learner's own history. */
          status: standing === "solved" ? "solved" : standing === "attempted" ? "attempted" : "any",
          limit: PAGE,
          offset: page * PAGE,
        })
        .then((found) => {
          if (ticket.current !== mine) return;
          setState((current) => {
            /* Pages are appended, and appended through a key set rather than
               concatenated: the sources are asked separately and interleaved, so
               a problem that sat on the boundary of one page can legitimately
               come back on the next. */
            const hits = first ? found.problems : dedupe([...current.hits, ...found.problems]);
            return { hits, total: found.total, loading: false, failed: found.failed, error: null, more: hits.length < found.total };
          });
        })
        .catch((cause) => {
          if (ticket.current !== mine) return;
          /* The held hits survive a failed refresh. A list that was fine a moment
             ago should not empty itself because the next keystroke could not be
             answered — the message says what happened. */
          setState((current) => ({ ...current, loading: false, error: cause instanceof Error ? cause.message : String(cause) }));
        });
    };

    // Only a new search waits. Asking for the next page is a click, and a click
    // that visibly does nothing for a third of a second reads as a dropped one.
    if (!first) {
      run();
      return;
    }
    const timer = setTimeout(run, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [api, band, page, query, standing]);

  const loadMore = useCallback(() => setPage((current) => current + 1), []);

  return { ...state, loadMore };
}

function dedupe(hits: PracticeSearchHit[]): PracticeSearchHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = `${hit.source}:${hit.slug}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
