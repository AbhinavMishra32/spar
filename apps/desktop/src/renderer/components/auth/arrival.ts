import { useCallback, useEffect, useRef, useState } from "react";
import { PASS_MS } from "../common/SparDots";

/* The two screens someone arrives through — signing in and the intake — are one
 *  surface in two parts, so their motion is defined once here rather than tuned
 *  twice. */

/** The window's own easing, matching the sheets and disclosures elsewhere. */
export const EASE = [0.32, 0.72, 0, 1] as const;
/** Resizing the panel around a step that changed size. Slower than the content
 *  crossfade, because a box that snaps while its contents fade reads as two
 *  separate events rather than one. */
export const PANEL = { duration: 0.28, ease: EASE };
/** One step replacing another. */
export const STEP = { duration: 0.18, ease: EASE };
/** A line of copy or a label being replaced by another. Short enough to feel
 *  like the same element saying something new. */
export const TEXT = { duration: 0.14, ease: EASE };
/** A row appearing under the action, with the panel resizing around it. */
export const LINKS = { duration: 0.22, ease: EASE };

/** The dot mark, woken for one full pass at a time.
 *
 *  `pass` is the animation's identity: bumping it remounts the dots, which is
 *  what restarts a run-once animation from its first frame instead of leaving it
 *  finished. `awake` is whether one is running. A request that outlasts a pass
 *  gets another, so the mark keeps moving for as long as Spar is working, and
 *  every pass ends on the resting grid — see `pattern="pass"` in SparDots. */
export function useMarkPass(busy: boolean) {
  const [pass, setPass] = useState(0);
  const [awake, setAwake] = useState(false);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);

  const rouse = useCallback(() => {
    setPass((count) => count + 1);
    setAwake(true);
    clearTimeout(settle.current);
    /* Never shortened, only extended: a pass cut off halfway is the snap back to
       the resting grid that this pattern exists to avoid. */
    settle.current = setTimeout(() => setAwake(false), PASS_MS);
  }, []);

  useEffect(() => () => clearTimeout(settle.current), []);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(rouse, PASS_MS);
    return () => clearInterval(timer);
  }, [busy, rouse]);

  return { pass, awake, rouse };
}
