"use client";

import { useEffect } from "react";
import Lenis from "lenis";

/**
 * Inertial scrolling.
 *
 * A wheel notch moves the page a fixed distance instantly; this eases it, so
 * long sections arrive rather than jump. It matters more here than it would on
 * a text page because almost everything on this one is drawn per frame — the
 * dot field, the beams, the reveals — and a scroll that steps in hard jumps
 * makes all of it look like it is stuttering when it isn't.
 *
 * Two things it must not break. Reduced motion turns it off entirely and gives
 * the native scroller back, since this is exactly the effect that setting is
 * about. And touch is left alone: a phone's own scrolling is already inertial,
 * and hijacking it costs you the rubber-banding and the momentum handoff that
 * make a native scroll feel native.
 */
export function SmoothScroll() {
  useEffect(() => {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (calm.matches) return;

    const lenis = new Lenis({
      // Slow enough to read as weight, short enough that a flick still gets you
      // down the page rather than making you wait out an animation.
      duration: 1.05,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
      smoothWheel: true,
      syncTouch: false,
      // Same-page links are scrolled by Lenis rather than by the browser, or
      // the two fight and the anchor lands somewhere neither of them intended.
      anchors: { offset: -72 },
    });

    let frame = requestAnimationFrame(function raf(time: number) {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    });

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  return null;
}
