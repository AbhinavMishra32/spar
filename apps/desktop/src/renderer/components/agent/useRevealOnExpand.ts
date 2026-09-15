import { useEffect, useRef } from "react";

/** Breathing room kept between the panel and the edge it was cut off by. */
const MARGIN = 12;
/** A ceiling on the follow, so a panel that never stops growing (a streaming
 *  payload) does not hold the transcript under the cursor forever. */
const LIMIT = 1100;

/**
 * Opening a row should show the row.
 *
 * A tool row near the foot of the transcript expands into space that is not
 * there: the panel draws below the fold, and the learner who pressed it is
 * looking at the same screen they were before, with a slab of JSON sliding out
 * of view under the composer. They then scroll by hand to read the thing they
 * just asked for, which is the app asking them to finish an animation it
 * started.
 *
 * So the thread follows the panel down, by exactly the amount that was cut off
 * and no more. Not `scrollIntoView`: that centres, or tops, or snaps — it moves
 * the transcript when nothing was hidden, and it throws the row's own heading
 * off the top of a tall panel. The rule is the smaller of two distances — how
 * far the panel overhangs the bottom, and how far the block can travel before
 * its first line reaches the top — so a panel that fits ends fully visible, and
 * one that does not ends with its heading at the top and the rest to scroll.
 * Nothing moves at all when the whole panel was already on screen.
 *
 * Closing has the mirror of that rule and only that: if the row's own heading
 * has been left above the fold — which is what happens when you scrolled down
 * through a long panel and then collapsed it — the thread comes back up to it.
 * A collapse that lands on a line the learner cannot see is a control that
 * appears to have deleted itself.
 *
 * The movement is a frame loop rather than one `scrollTo`, because the height it
 * is chasing is itself animating: re-deriving the remaining distance every frame
 * means the scroll inherits the panel's own easing exactly, and lands when it
 * lands. A `scrollTo` fired at the start has to guess the final height, and one
 * fired at the end is a jump after the animation the learner already watched.
 * It stops early on any real settling, and abandons the whole thing the moment
 * the learner touches the wheel — a view that fights the hand on it is worse
 * than one that never helped.
 */
export function useRevealOnExpand<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null);
  /* A row that renders already-open — a re-mount, a transcript read back from
     storage — was not expanded by anybody, and nothing should move. */
  const mounted = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!mounted.current) { mounted.current = true; return; }
    if (!node) return;
    const scroller = scrollParent(node);
    if (!scroller) return;

    let frame = 0;
    let settled = 0;
    const started = performance.now();

    const step = () => {
      const box = node.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      let travel: number;
      if (open) {
        const hidden = box.bottom + MARGIN - view.bottom;
        /* How far the block can rise before its own first line is the thing
           being cut off instead. */
        const headroom = Math.max(0, box.top - view.top - MARGIN);
        travel = Math.max(0, Math.min(hidden, headroom));
      } else {
        travel = Math.min(0, box.top - view.top - MARGIN);
      }

      if (Math.abs(travel) >= 0.5) {
        scroller.scrollTop += travel;
        settled = 0;
      } else {
        settled += 1;
      }
      /* Three quiet frames is the animation having arrived, not a slow one
         between two of its own steps. */
      if (settled < 3 && performance.now() - started < LIMIT) frame = requestAnimationFrame(step);
      else stop();
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      scroller.removeEventListener("wheel", stop);
      scroller.removeEventListener("touchmove", stop);
    };

    scroller.addEventListener("wheel", stop, { passive: true });
    scroller.addEventListener("touchmove", stop, { passive: true });
    frame = requestAnimationFrame(step);
    return stop;
  }, [open]);

  return ref;
}

/** The transcript's scroller, found from the row rather than passed down to it. */
function scrollParent(node: HTMLElement): HTMLElement | null {
  let parent = node.parentElement;
  while (parent) {
    const overflow = getComputedStyle(parent).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && parent.scrollHeight > parent.clientHeight) return parent;
    parent = parent.parentElement;
  }
  return null;
}
