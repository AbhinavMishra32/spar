/**
 * The sidebar's reveal, defined once.
 *
 * Three things move when the sidebar is toggled — the column itself, the
 * sidebar sliding inside it, and the bar on the other side making room for the
 * button that brings it back. They are one gesture, so they share one curve;
 * tuned separately they read as three animations that happen to start together.
 *
 * Slower than the 0.18s this ran at, and deliberately: at that length a
 * 275-pixel column does not travel, it teleports with a smear. The window's own
 * easing leaves nearly all of the motion in the first third, so the extra time
 * is spent settling rather than sliding.
 */
export const SIDEBAR_SLIDE = { duration: 0.26, ease: [0.32, 0.72, 0, 1] } as const;

/** The same curve as a CSS transition, for the paddings and fills that change
 *  with it but are not driven by motion values. */
export const SIDEBAR_SLIDE_CSS = "duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)]";
