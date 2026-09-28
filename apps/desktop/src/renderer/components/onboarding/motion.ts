/* The onboarding's motion vocabulary, in one place. Everywhere else in the app
   motion is quiet and short; the arrival is the one screen allowed to perform,
   so it gets its own set of springs rather than stretching the shared ones. */

/** The default for anything that moves into place: fast, no visible overshoot. */
export const SPRING = { type: "spring", stiffness: 380, damping: 34, mass: 0.9 } as const;
/** Large, slow things — a scene arriving, the mark crossing the window. */
export const GLIDE = { type: "spring", stiffness: 140, damping: 22, mass: 1 } as const;
/** Small things that are meant to feel picked up: chips, badges, checks. */
export const POP = { type: "spring", stiffness: 560, damping: 20, mass: 0.7 } as const;

/** An expo-out: most of the travel in the first third, then a long settle. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
/** For things leaving — accelerating away rather than drifting off. */
export const EASE_IN = [0.7, 0, 0.84, 0] as const;

/** A scene replacing another. `direction` is +1 forwards and -1 back, so going
 *  back reads as the previous question returning rather than a new one. */
export const scene = {
  enter: (direction: number) => ({ opacity: 0, y: direction * 40, scale: 0.97, filter: "blur(14px)" }),
  center: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { ...GLIDE, opacity: { duration: 0.4, ease: EASE_OUT }, filter: { duration: 0.5, ease: EASE_OUT } },
  },
  exit: (direction: number) => ({
    opacity: 0,
    y: direction * -28,
    scale: 0.985,
    filter: "blur(10px)",
    transition: { duration: 0.22, ease: EASE_IN },
  }),
};
