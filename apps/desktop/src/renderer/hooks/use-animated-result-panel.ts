import { useCallback, useEffect, useRef, useState } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";

const MOTION_MS = 280;

/**
 * Adds a short transition around imperative result-panel changes.
 *
 * The resizable-panel library writes `flex-grow` synchronously. We first render
 * the transition class, then change that value on the next animation frame; if
 * both happened in one frame the browser would have no previous layout to
 * interpolate from. The class is removed after the motion so pointer resizing
 * remains direct rather than trailing the cursor through a CSS transition.
 */
export function useAnimatedResultPanel(initiallyOpen = true) {
  const panel = useRef<ImperativePanelHandle>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const [open, setOpen] = useState(initiallyOpen);
  const [moving, setMoving] = useState(false);

  const move = useCallback((nextOpen: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    setMoving(true);
    setOpen(nextOpen);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (nextOpen) panel.current?.expand();
      else panel.current?.collapse();
      timer.current = setTimeout(() => {
        timer.current = null;
        setMoving(false);
      }, MOTION_MS);
    });
  }, []);

  const expand = useCallback(() => move(true), [move]);
  const collapse = useCallback(() => move(false), [move]);
  const toggle = useCallback(() => move(Boolean(panel.current?.isCollapsed())), [move]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  return {
    panel,
    open,
    moving,
    expand,
    collapse,
    toggle,
    markExpanded: () => setOpen(true),
    markCollapsed: () => setOpen(false),
  };
}
