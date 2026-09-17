import { useEffect, useRef, useState, type CSSProperties } from "react";

/** How deep each fade runs once it is on. Mirrors `.transcript-fade` in
 *  theme.css, and matches the scrolling drum's depth — the same gesture at the
 *  same scale, so the app fades an overflowing edge one way. */
export const TRANSCRIPT_FADE = "2.25rem";

/** Sub-pixel layout rounding means a scroller at its end lands a fraction short
 *  of it, which would leave a fade running with nothing left to fade. */
export const FADE_SLACK = 2;

/** Which ends have content past them. */
export type FadeEdges = { top: boolean; bottom: boolean };

/** The custom properties `.transcript-fade` reads. Kept beside the constants so
 *  a caller with its own scroll bookkeeping — the transcript, which measures the
 *  same scroll for auto-follow — states the fade the same way this hook does. */
export function transcriptFadeStyle(edges: FadeEdges): CSSProperties {
  return {
    ["--transcript-fade-top" as string]: edges.top ? TRANSCRIPT_FADE : "0px",
    ["--transcript-fade-bottom" as string]: edges.bottom ? TRANSCRIPT_FADE : "0px",
  };
}

/**
 * Both ends of a scroller dissolved rather than cut, on `.transcript-fade`'s
 * terms: each end fades only while there is something past it, so a panel with
 * nowhere further to go sits crisp against the chrome above and below it.
 *
 * Measured on resize as well as on scroll. Whether a panel overflows changes
 * when the pane is dragged or a case is picked that is taller than the last
 * one, and neither of those is a scroll event.
 */
export function useTranscriptFade<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [edges, setEdges] = useState<FadeEdges>({ top: false, bottom: false });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      setEdges((current) => {
        const top = node.scrollTop > FADE_SLACK;
        const bottom = distance > FADE_SLACK;
        return current.top === top && current.bottom === bottom ? current : { top, bottom };
      });
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    /* The box and its contents both move the ends around: the pane is resized by
       the splitter, and switching to a longer sample case changes the height
       without any scroll event. */
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);
    return () => {
      node.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);

  return { ref, edges, style: transcriptFadeStyle(edges) } as const;
}
