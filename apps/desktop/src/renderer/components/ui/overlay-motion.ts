import type { Transition, Variants } from "motion/react";

export type OverlaySide = "top" | "right" | "bottom" | "left";

/**
 * Two kinds of surface pop open in this app, and they do not move alike.
 *
 * Menus, submenus, selects, tooltips and hover cards are Aside's, transcribed
 * from its own composer rather than eyeballed: `duration-100`, plain CSS
 * `ease`, and three properties — `fade-in-0`, `zoom-in-95` and
 * `slide-in-from-<side>-2`, which is 8px of travel back toward the trigger.
 * The close drops the travel and keeps the fade and the scale, so the surface
 * collapses into its own origin instead of rewinding along the way it came in.
 * No blur, no spring.
 *
 * 100ms is the whole of it, and that is the part worth keeping: a menu is not
 * an object arriving from somewhere, it is a list that was always going to be
 * under the pointer, and anything you have time to watch is a menu you are
 * waiting on.
 *
 * A modal is the other kind: no trigger to grow out of, it covers what you were
 * reading, and it is worth a beat. That one keeps the blur-and-settle.
 */

/** CSS `ease`, verbatim — the curve their menus actually run on. */
const MENU_EASE = [0.25, 0.1, 0.25, 1] as const;

/** `duration-100`, both directions. */
const MENU_MOVE: Transition = { duration: 0.1, ease: MENU_EASE };

/** `zoom-in-95` / `zoom-out-95`. */
const MENU_SCALE = 0.95;

/** `slide-in-from-<side>-2`: two spacing units, and a spacing unit is 4px. */
const MENU_TRAVEL = 8;

/** A centred modal is big and heavy, so it takes a moment to land. */
const MODAL_SPRING: Transition = { type: "spring", visualDuration: 0.34, bounce: 0 };

/** Decelerating — fast at the start, easing into rest. */
const EASE_OUT = [0.22, 0.61, 0.36, 1] as const;
/** Accelerating — the exit curve; leaves quickly and does not linger. */
const EASE_IN = [0.4, 0, 1, 1] as const;

const OPEN_FADE: Transition = { duration: 0.16, ease: EASE_OUT };
const CLOSE_MOVE: Transition = { duration: 0.16, ease: [0.32, 0, 0.67, 0] };
const CLOSE_FADE: Transition = { duration: 0.12, ease: EASE_IN };
const CLOSE_BLUR: Transition = { duration: 0.14, ease: EASE_IN };

/** How far out of focus a modal starts, and how far it dissolves on the way out. */
const BLUR_IN = 14;
const BLUR_OUT = 12;

/** Reduced motion keeps the fade and drops everything that moves — including the
 *  blur, which is motion by another name for anyone who asked not to have any. */
function stillVariants(): Variants {
  return {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.1 } },
    exit: { opacity: 0, transition: { duration: 0.1 } },
  };
}

/** Offset pointing back toward the trigger, so the surface arrives out of it. */
function towardTrigger(side: OverlaySide, distance: number): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: 0, y: distance };
    case "bottom":
      return { x: 0, y: -distance };
    case "left":
      return { x: distance, y: 0 };
    case "right":
      return { x: -distance, y: 0 };
  }
}

/**
 * An anchored surface: menus, submenus, popovers, hover cards.
 *
 * The surface moves as one object. Its contents ride along and never animate
 * themselves — rows that fade in on their own clock read as still loading, and
 * on the way out as coming apart.
 */
export function overlaySurfaceVariants(options: {
  side?: OverlaySide;
  reduced?: boolean;
} = {}): Variants {
  const { side = "bottom", reduced = false } = options;
  if (reduced) return stillVariants();

  const { x, y } = towardTrigger(side, MENU_TRAVEL);

  return {
    hidden: { opacity: 0, scale: MENU_SCALE, x, y },
    visible: { opacity: 1, scale: 1, x: 0, y: 0, transition: MENU_MOVE },
    exit: { opacity: 0, scale: MENU_SCALE, x: 0, y: 0, transition: MENU_MOVE },
  };
}

/**
 * A modal has no trigger to grow out of, so it arrives from slightly below and
 * behind — the one direction that reads as "brought forward" rather than as a
 * corner of the screen — and resolves out of a blur, because it is a big object
 * travelling a real distance.
 */
export function modalContentVariants(reduced = false): Variants {
  if (reduced) return stillVariants();

  return {
    hidden: { opacity: 0, filter: `blur(${BLUR_IN}px)`, scale: 0.94, y: 10 },
    visible: {
      opacity: 1,
      filter: "blur(0px)",
      scale: 1,
      y: 0,
      transition: { default: MODAL_SPRING, opacity: OPEN_FADE, filter: { duration: 0.32, ease: EASE_OUT } },
    },
    exit: {
      opacity: 0,
      filter: `blur(${BLUR_OUT}px)`,
      scale: 0.975,
      y: 4,
      transition: { default: CLOSE_MOVE, opacity: CLOSE_FADE, filter: CLOSE_BLUR },
    },
  };
}

/** The scrim. Nothing but opacity — a backdrop-filter that animates costs a
 *  repaint of the whole window, every frame, behind the thing you are looking at. */
export function modalOverlayVariants(): Variants {
  return {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.2, ease: EASE_OUT } },
    exit: { opacity: 0, transition: { duration: 0.14, ease: EASE_IN } },
  };
}
