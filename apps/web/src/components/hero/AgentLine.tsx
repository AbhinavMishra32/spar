"use client";

import { useEffect, useState } from "react";
import { Mark } from "@/components/Mark";

/**
 * The agent, narrating.
 *
 * Spar says what it is about to do before each phase rather than showing a
 * spinner, and every waiting state in the app is the mark's own diagonal wave.
 * This is that, on the page: the same glyph, the same motion, and the phases in
 * the order a real session runs them — ending on the one line the whole product
 * turns on.
 */
const PHASES = [
  "reading your last four attempts",
  "picking what to probe next",
  "writing a challenge for it",
  "checking the reference solution passes",
  "breaking it, to prove the hidden tests bite",
  "running the committed tests — no model in this path",
];

/** Long enough to read, short enough that you see it change. */
const DWELL = 2600;

export function AgentLine() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (calm.matches) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % PHASES.length), DWELL);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <p
      className="flex items-center justify-center gap-2.5 font-mono text-[11.5px] tracking-[0.04em] text-faint"
      /* It rewrites itself every couple of seconds; a screen reader being told
         so every couple of seconds is worse than not being told at all. */
      aria-hidden
    >
      <Mark size={13} animated className="opacity-80" />
      {/* Keyed so React replaces the node rather than mutating its text, which
          is what lets the fade run at all. */}
      <span key={index} className="phase-in">
        {PHASES[index]}
      </span>
    </p>
  );
}
