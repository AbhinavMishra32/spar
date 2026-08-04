import type { Transition, Variants } from "motion/react";

export type OverlaySide = "top" | "right" | "bottom" | "left";

/**
 * Every surface that pops open in the app — menus, selects, tooltips, hover
 * cards, modals — moves on the curves below, so opening a menu and opening a
 * dialog feel like the same gesture at two different sizes.
 *
 * The feel is the one the challenge's problem/chat swap already uses, because
 * that is the one in this app that reads right: a surface resolves *out of a
 * blur* at slightly-too-large and settles onto its resting size. Blur is what
 * sells it — without it a scale is just a zoom, and with it the surface reads as
 * coming forward into focus rather than being pasted on.
 *
 * Three rules hold everywhere:
 *
 * - **Geometry never bounces.** `bounce: 0` springs, not damped oscillators. A
 *   spring that overshoots reads as playful; macOS chrome is not playful, and an
 *   overshoot on a menu anchored to a trigger visibly detaches it.
 * - **Opacity and blur ride their own tweens.** A spring's approach is
 *   asymptotic, so a surface would spend its last 80ms at 97% opacity looking
 *   like it is waiting for something. They land early and get out of the way.
 * - **Opens are slower than closes.** The moment you have decided to dismiss
 *   something, every extra frame is lag — so exits are short, accelerating, and
 *   blur out harder than they blurred in.
 */

/** Geometry: flat, no overshoot. `visualDuration` is time-to-settle, not a period. */
const SURFACE_SPRING: Transition = { type: "spring", visualDuration: 0.26, bounce: 0 };

/** A centred modal is bigger and heavier, so it takes marginally longer to land. */
const MODAL_SPRING: Transition = { type: "spring", visualDuration: 0.34, bounce: 0 };

/** Decelerating — fast at the start, easing into rest. */
const EASE_OUT = [0.22, 0.61, 0.36, 1] as const;
/** Accelerating — the exit curve; leaves quickly and does not linger. */
const EASE_IN = [0.4, 0, 1, 1] as const;

const OPEN_FADE: Transition = { duration: 0.16, ease: EASE_OUT };
const OPEN_BLUR: Transition = { duration: 0.26, ease: EASE_OUT };
const CLOSE_MOVE: Transition = { duration: 0.16, ease: [0.32, 0, 0.67, 0] };
const CLOSE_FADE: Transition = { duration: 0.12, ease: EASE_IN };
const CLOSE_BLUR: Transition = { duration: 0.14, ease: EASE_IN };

/** How far out of focus a surface starts, and how far it dissolves on the way out. */
const BLUR_IN = 10;
const BLUR_OUT = 8;

/** How far a surface travels along the axis it opens on. */
const SURFACE_TRAVEL = 6;

/** Reduced motion keeps the fade and drops everything that moves — including the
 *  blur, which is motion by another name for anyone who asked not to have any. */
function stillVariants(): Variants {
  return {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.12 } },
    exit: { opacity: 0, transition: { duration: 0.09 } },
  };
}

/** Offset pointing back toward the trigger, so the surface grows out of it. */
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
 * An anchored surface: menus, popovers, popper-positioned selects.
 *
 * It doesn't just scale — it unfurls: scaleY starts further back than scaleX,
 * which reads as the menu unrolling out of its own transform origin rather than
 * a card being zoomed at you. Paired with Radix's
 * `--radix-*-content-transform-origin` the growth starts at the trigger's
 * corner, which is what makes an anchored menu feel attached to what opened it.
 *
 * The surface moves as one object. Its contents ride along and never animate
 * themselves — rows that fade in on their own clock read as still loading, and
 * on the way out as coming apart.
 */
export function overlaySurfaceVariants(options: {
  side?: OverlaySide;
  reduced?: boolean;
  spring?: Transition;
} = {}): Variants {
  const { side = "bottom", reduced = false, spring = SURFACE_SPRING } = options;
  if (reduced) return stillVariants();

  const { x, y } = towardTrigger(side, SURFACE_TRAVEL);

  return {
    hidden: { opacity: 0, filter: `blur(${BLUR_IN}px)`, scaleX: 0.96, scaleY: 0.9, x, y },
    visible: {
      opacity: 1,
      filter: "blur(0px)",
      scaleX: 1,
      scaleY: 1,
      x: 0,
      y: 0,
      transition: { default: spring, opacity: OPEN_FADE, filter: OPEN_BLUR },
    },
    exit: {
      opacity: 0,
      filter: `blur(${BLUR_OUT}px)`,
      scaleX: 0.985,
      scaleY: 0.96,
      x: x * 0.35,
      y: y * 0.35,
      transition: { default: CLOSE_MOVE, opacity: CLOSE_FADE, filter: CLOSE_BLUR },
    },
  };
}

/**
 * A modal has no trigger to grow out of, so it arrives from slightly below and
 * behind — the one direction that reads as "brought forward" rather than as a
 * corner of the screen — and resolves out of a deeper blur than a menu does,
 * because it is a bigger object travelling further.
 */
export function modalContentVariants(reduced = false): Variants {
  if (reduced) return stillVariants();

  return {
    hidden: { opacity: 0, filter: `blur(${BLUR_IN + 4}px)`, scale: 0.94, y: 10 },
    visible: {
      opacity: 1,
      filter: "blur(0px)",
      scale: 1,
      y: 0,
      transition: { default: MODAL_SPRING, opacity: OPEN_FADE, filter: { duration: 0.32, ease: EASE_OUT } },
    },
    exit: {
      opacity: 0,
      filter: `blur(${BLUR_OUT + 4}px)`,
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
