"use client";

import { useEffect, useRef, useState } from "react";
import { Shot } from "@/components/Shot";

/** The size the film is authored at. It is laid out once, at this size, and
 *  scaled to the frame — so it reads as the app's own window at any width,
 *  rather than as the app reflowing to a phone. */
const WIDTH = 1280;
const HEIGHT = 800;

const DESCRIPTION =
  "Spar, playing a recorded session: a learner writes an answer to “Count the Root’s Children”, runs it, submits, and fails a hidden case. They ask for something simpler, and the agent drafts, validates, repairs and publishes a new challenge, “Identify a Tree’s Root”.";

/**
 * The app, in the hero.
 *
 * Not a video: `/hero` is Spar's renderer built on its own, replaying a
 * recorded session with a scripted cursor (see `apps/desktop/src/hero`). It
 * takes no input — the frame is inert, and so is everything inside it.
 *
 * The window is translucent the way it is on macOS, where the sidebar and the
 * page fill are tints over the desktop. Here the desktop is the page's dot
 * field, and the frame's backdrop blur is what stands in for the OS material.
 */
export function SparReplay() {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [mode, setMode] = useState<"pending" | "film" | "still">("pending");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMode(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "still" : "film");
  }, []);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry!.contentRect.width / WIDTH));
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === "spar-hero" && event.data.state === "ready") setReady(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (mode === "still") {
    return <Shot shot="workspace" priority sizes="(max-width: 640px) 170vw, (max-width: 900px) 120vw, 1160px" alt={DESCRIPTION} />;
  }

  return (
    <div className="frame hero-film">
      <div ref={frame} className="hero-film-window" style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}>
        {mode === "film" && scale > 0 && (
          <iframe
            src="/hero/index.html"
            title="Spar"
            aria-hidden
            tabIndex={-1}
            width={WIDTH}
            height={HEIGHT}
            className="hero-film-screen"
            data-ready={ready || undefined}
            style={{ transform: `scale(${scale})` }}
          />
        )}
        <p className="sr-only">{DESCRIPTION}</p>
      </div>
    </div>
  );
}
