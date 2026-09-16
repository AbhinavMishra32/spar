import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { StoredLesson } from "../../../shared/api";

type Reading = { lesson: StoredLesson | null; page: number; status: "loading" | "ready" | "missing" };
const empty: Reading = { lesson: null, page: 0, status: "loading" };
const readings = new Map<string, Reading>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function publish(id: string, reading: Reading) {
  readings.set(id, reading);
  listeners.forEach((listener) => listener());
}

/** Inline and modal readers share the fetch and reading position. */
export function useLesson(id: string | null, enabled = true) {
  const reading = useSyncExternalStore(subscribe, () => id ? readings.get(id) ?? empty : empty);
  useEffect(() => {
    if (!id || !enabled || (readings.has(id) && readings.get(id)?.status !== "loading") || pending.has(id)) return;
    pending.add(id);
    void Promise.resolve(window.spar?.lessonRead({ id })).then((lesson) => {
      publish(id, { lesson: lesson ?? null, page: Math.min(readings.get(id)?.page ?? 0, Math.max(0, (lesson?.pages.length ?? 1) - 1)), status: lesson ? "ready" : "missing" });
    }).catch(() => publish(id, { ...empty, status: "missing" })).finally(() => pending.delete(id));
  }, [id, enabled]);
  const setPage = useCallback((page: number) => {
    if (!id) return;
    const current = readings.get(id);
    publish(id, { ...(current ?? empty), page: Math.max(0, current?.lesson ? Math.min(page, current.lesson.pages.length - 1) : page) });
  }, [id]);
  return { ...reading, setPage };
}
