import { useLayoutEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * The vertical travel between the challenges of one session.
 *
 * A session is a column, and the stepper reads as one: back is up, forward is
 * down, and the ordinal beside it rolls the same way. This is the body making
 * the same move, so stepping reads as travel through a list rather than as the
 * screen being rebuilt.
 *
 * Two things were wrong before, and they are separate problems that looked like
 * one. The content simply swapped — same element, new props, no transition — so
 * a challenge with a longer statement resized the column in a single frame. And
 * the scroll container kept its offset across the swap, so stepping while read
 * down a long problem landed you in the middle of the next one, which is the
 * part that read as a glitch rather than as a jump.
 *
 * `popLayout` is what keeps the swap from shifting anything: the outgoing copy
 * is taken out of flow as it leaves, so the incoming one is never pushed down a
 * half-rendered page. The scroll reset runs in a layout effect, before paint, so
 * the new challenge is never briefly visible at the old offset.
 */
export function ChallengeRoll({
  children,
  className,
  ordinal,
  scroller,
  stopId,
}: {
  children: ReactNode;
  className?: string;
  /** Position in the session. Its direction of travel is what the roll follows. */
  ordinal: number;
  /** The scrolling ancestor to return to the top when the challenge changes. */
  scroller: React.RefObject<HTMLElement | null>;
  /** Identity of the challenge on screen — the roll is keyed on this. */
  stopId: string;
}) {
  const previous = useRef(ordinal);
  const direction = ordinal >= previous.current ? 1 : -1;
  previous.current = ordinal;

  useLayoutEffect(() => {
    scroller.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [scroller, stopId]);

  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.div
        key={stopId}
        animate={{ y: 0, opacity: 1 }}
        className={className}
        exit={{ y: direction * -18, opacity: 0 }}
        initial={{ y: direction * 18, opacity: 0 }}
        /* Travel on a flat spring so it arrives without a bounce — this is a
           position in a list, not a card being thrown. Opacity is quicker than
           the movement on the way out so the two copies never sit legible on top
           of each other while `popLayout` has them overlapping. */
        transition={{
          y: { type: "spring", visualDuration: 0.32, bounce: 0 },
          opacity: { duration: 0.16, ease: [0.22, 0.61, 0.36, 1] },
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
