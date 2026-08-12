"use client";

import { useEffect, useState } from "react";
import { markDots, markRadius } from "@/components/Mark";

/**
 * What the page shows while it is becoming itself.
 *
 * The mark assembles a dot at a time down its own diagonal, then hands the
 * screen over. It is there because something has to be: the display face and
 * the WebGL context both want a beat, and a black rectangle with a headline
 * snapping into place once the font arrives is the version of that beat where
 * nobody decided anything.
 *
 * Three rules keep it from being an obstacle. It is an overlay, so the page is
 * fully in the DOM behind it and a crawler never sees a splash screen. It waits
 * on the fonts but never on them for long — a stalled webfont must not trap a
 * visitor, so the whole thing is on a hard timeout. And under reduced motion it
 * does not run at all.
 */

/** Long enough to read as deliberate, short enough not to be a toll gate. */
const MIN_MS = 950;
/** The point at which we stop waiting for anything and get out of the way. */
const CAP_MS = 2200;
/** How long the band takes to cross the grid, corner to corner. */
const TRAVEL_MS = 620;

export function Boot() {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setGone(true);
      return;
    }

    let cancelled = false;
    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const fonts = document.fonts?.ready ?? Promise.resolve();

    Promise.race([Promise.all([wait(MIN_MS), fonts]), wait(CAP_MS)]).then(() => {
      if (cancelled) return;
      setLeaving(true);
      window.setTimeout(() => !cancelled && setGone(true), 650);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Locks the page behind it, so the hero cannot be scrolled away underneath a
  // screen that is still covering it.
  useEffect(() => {
    if (gone) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [gone]);

  if (gone) return null;

  return (
    <div className="boot" data-leaving={leaving} aria-hidden>
      <svg viewBox="0 0 100 100" width={68} height={68} fill="currentColor" className="boot-mark">
        {markDots.map((dot) => (
          <circle
            key={dot.key}
            cx={dot.cx}
            cy={dot.cy}
            r={markRadius}
            className="boot-dot"
            style={{
              transformOrigin: `${dot.cx}px ${dot.cy}px`,
              /* Each dot arrives at its place in the diagonal, so the mark
                 assembles as a band rather than appearing all at once. */
              animationDelay: `${dot.along * TRAVEL_MS}ms`,
              ["--dot-rest" as string]: dot.rest,
              ["--dot-tone" as string]: dot.tone,
            }}
          />
        ))}
      </svg>
    </div>
  );
}
