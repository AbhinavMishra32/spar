import { useCallback, useEffect, useRef, useState } from "react";
import type { PracticeInventory, SparApi } from "../../shared/api";

/**
 * The practice sources and whether each is connected, kept current.
 *
 * One reader for every surface that has to say whether LeetCode or Codeforces
 * is usable right now. The main process owns the connections; this re-reads on
 * every connection event it sends, and only the newest read may land, so a slow
 * "connected" answer cannot arrive after "expired" and undo it.
 *
 * `null` until the first read answers.
 */
export function usePracticeSources(api: SparApi | undefined): PracticeInventory[] | null {
  const [inventory, setInventory] = useState<PracticeInventory[] | null>(null);
  const revision = useRef(0);
  const read = useCallback(async () => {
    if (!api) return;
    const mine = ++revision.current;
    const next = await api.practiceSources();
    if (mine === revision.current) setInventory(next);
  }, [api]);
  useEffect(() => { void read().catch(() => undefined); }, [read]);
  useEffect(() => api?.onPracticeSourceEvent(() => { void read().catch(() => undefined); }), [api, read]);
  return inventory;
}
