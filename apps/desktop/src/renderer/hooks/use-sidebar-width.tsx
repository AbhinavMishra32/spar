import { useCallback, useRef, useState } from "react";

const STORAGE_KEY = "spar.sidebarWidth";
/* Matched to the ChatGPT desktop app, which clamps its sidebar to 240–520 and
   opens at 275. Spar's rows carry session titles, which wrap and truncate worse
   than a chat title does, so the narrow end of that range is the wrong place to
   start: the sidebar should be readable before anyone drags it. */
export const SIDEBAR_DEFAULT_WIDTH = 275;
const MIN_WIDTH = 240;
const MAX_WIDTH = 520;

const clamp = (value: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));

/**
 * Sidebar width, persisted across launches and draggable from the divider.
 *
 * The drag runs off pointer capture rather than window listeners so it survives
 * the pointer leaving the handle — and `dragging` is exposed because the width
 * is animated when the sidebar collapses, and that transition has to be off
 * while a drag is in flight or the edge lags behind the cursor.
 */
export function useSidebarWidth() {
  const [width, setWidth] = useState(() => {
    const stored = Number.parseInt(localStorage.getItem(STORAGE_KEY) ?? "", 10);
    return Number.isFinite(stored) ? clamp(stored) : SIDEBAR_DEFAULT_WIDTH;
  });
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ x: 0, width: 0 });

  const commit = useCallback((next: number) => {
    const value = clamp(next);
    setWidth(value);
    localStorage.setItem(STORAGE_KEY, String(value));
    return value;
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      origin.current = { x: event.clientX, width };
      setDragging(true);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      commit(origin.current.width + (event.clientX - origin.current.x));
    },
    [commit],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }, []);

  const reset = useCallback(() => commit(SIDEBAR_DEFAULT_WIDTH), [commit]);

  return {
    width,
    dragging,
    reset,
    /** Spread onto the divider element. */
    handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onDoubleClick: reset },
  };
}
