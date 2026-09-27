import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { beginResize, endResize } from "../lib/resizing";

const STORAGE_KEY = "spar.sidebarWidth";
/* Wide enough that a Track's name and its challenge titles read on one line
   before anyone drags it. */
export const SIDEBAR_DEFAULT_WIDTH = 290;
const MIN_WIDTH = 240;
/* The widest a sidebar is still a list rather than a second page: long session
   titles fit on one line well before this. */
const MAX_WIDTH = 400;
/* However wide it is allowed to be, it never takes more than this share of the
   window, so a small window keeps its room for the workspace. */
const MAX_SHARE = 0.3;

const maxWidth = () => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(window.innerWidth * MAX_SHARE)));
const clamp = (value: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(value)));

/**
 * Sidebar width, persisted across launches and draggable from the divider.
 *
 * A drag never goes through React. Every frame of it would otherwise re-render
 * the whole window — the sidebar, the workspace, the editor, the transcript —
 * because the width lives at the top of the app. Instead the frame writes the
 * width straight onto the elements that carry it (`bind` them with the refs),
 * and the width is committed to state and storage once, on release.
 *
 * `dragging` is exposed because the width is animated when the sidebar
 * collapses, and that transition has to be off while a drag is in flight.
 */
export function useSidebarWidth() {
  /* What the learner chose, kept as chosen; the width shown is that choice
     fitted to the window it is in now, so shrinking the window and growing it
     again gives the same sidebar back. */
  const [chosen, setChosen] = useState(() => {
    const stored = Number.parseInt(localStorage.getItem(STORAGE_KEY) ?? "", 10);
    return Number.isFinite(stored) ? stored : SIDEBAR_DEFAULT_WIDTH;
  });
  /* Held as the fitted number rather than the window's width, so resizing the
     window re-renders the app only on the frames where the sidebar actually
     changes size — never while the window is wide enough for the choice. */
  const [width, setWidth] = useState(() => clamp(chosen));
  useEffect(() => {
    setWidth(clamp(chosen));
    const onResize = () => setWidth(clamp(chosen));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [chosen]);
  const [dragging, setDragging] = useState(false);

  const column = useRef<HTMLDivElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const handle = useRef<HTMLDivElement | null>(null);
  const drag = useRef({ x: 0, from: 0, to: 0, frame: 0 });

  const paint = useCallback((value: number) => {
    if (column.current) column.current.style.width = `${value}px`;
    if (sheet.current) sheet.current.style.width = `${value}px`;
    if (handle.current) handle.current.style.left = `${value - 4}px`;
  }, []);

  const commit = useCallback((next: number) => {
    const value = clamp(next);
    setChosen(value);
    setWidth(value);
    localStorage.setItem(STORAGE_KEY, String(value));
    return value;
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, from: width, to: width, frame: 0 };
      beginResize();
      setDragging(true);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const state = drag.current;
      state.to = clamp(state.from + (event.clientX - state.x));
      if (!state.frame) state.frame = requestAnimationFrame(() => { state.frame = 0; paint(state.to); });
    },
    [paint],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const state = drag.current;
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
    paint(state.to);
    /* Committed while `dragging` is still true, so the animated width jumps to
       where the drag left it instead of easing there from where it started. */
    flushSync(() => { commit(state.to); });
    setDragging(false);
    endResize();
  }, [commit, paint]);

  const reset = useCallback(() => commit(SIDEBAR_DEFAULT_WIDTH), [commit]);

  return {
    width,
    dragging,
    reset,
    /** The elements whose size follows the drag: the clipping column, the
     *  sheet inside it, and the divider. */
    refs: { column, sheet, handle },
    /** Spread onto the divider element. */
    handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onDoubleClick: reset },
  };
}
