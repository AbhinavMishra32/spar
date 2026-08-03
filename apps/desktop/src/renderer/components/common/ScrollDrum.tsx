import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** How deep each fade runs once it is on. Mirrors `--drum-fade` in theme.css. */
const FADE = "2.25rem";

/** Sub-pixel layout rounding means a list that fits exactly reports a pixel or two
 *  of overflow, and a scroller at its end lands a fraction short of it. */
const SLACK = 2;

/**
 * A capped, internally scrolling list whose ends fade and soften like a picker
 * drum. See `.drum` in theme.css for how the effect is built.
 *
 * Each end is faded only while there is something past it: at the top of the list
 * the first card is fully crisp, at the bottom so is the last, and an end that has
 * nowhere further to go never dissolves. Both edges are also off entirely when the
 * content fits, since fading a list you can already see all of is decoration
 * pretending to be information.
 *
 * Overflow is measured rather than inferred from a row count — these are cards of
 * variable height, so any threshold would be wrong in both directions — and it is
 * re-measured on resize as well as on scroll, because whether a list overflows
 * changes when the window changes and never because someone scrolled it.
 */
export function ScrollDrum({
  children,
  className,
  maxHeight,
}: {
  children: React.ReactNode;
  className?: string;
  /** The height the list is allowed to take before it starts scrolling. */
  maxHeight: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ overflowing: false, top: false, bottom: false });

  const measure = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    const overflowing = box.scrollHeight - box.clientHeight > SLACK;
    const top = overflowing && box.scrollTop > SLACK;
    const bottom = overflowing && box.scrollTop + box.clientHeight < box.scrollHeight - SLACK;
    setEdges((current) =>
      current.overflowing === overflowing && current.top === top && current.bottom === bottom
        ? current
        : { overflowing, top, bottom },
    );
  }, []);

  useEffect(() => {
    const box = scroller.current;
    const inner = content.current;
    if (!box || !inner) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [children, measure]);

  return (
    <div className={cn("relative", className)}>
      <div
        ref={scroller}
        className={cn("app-scroll overflow-y-auto", edges.overflowing && "drum")}
        onScroll={measure}
        style={{
          maxHeight,
          // Zero rather than absent: the mask reads both on every frame, and a
          // missing value would fall back to the registered initial anyway.
          ["--drum-top" as string]: edges.top ? FADE : "0px",
          ["--drum-bottom" as string]: edges.bottom ? FADE : "0px",
        }}
      >
        {/* Padding inside the scroller, not margin outside it: the fade eats the
            first and last few millimetres once it is on, and without this the card
            at that end loses its border rather than its empty space. */}
        <div ref={content} className={cn(edges.overflowing && "py-1")}>
          {children}
        </div>
      </div>
      {/* Mounted whenever the list scrolls at all, and faded by opacity, so
          appearing and disappearing is a transition rather than a mount. */}
      {edges.overflowing && (
        <>
          <span aria-hidden className="drum-edge drum-edge-top" style={{ opacity: edges.top ? 1 : 0 }} />
          <span aria-hidden className="drum-edge drum-edge-bottom" style={{ opacity: edges.bottom ? 1 : 0 }} />
        </>
      )}
    </div>
  );
}
