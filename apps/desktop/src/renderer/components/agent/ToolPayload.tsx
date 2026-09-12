import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The scroller, the capped payload, and the raw two-halves view.
 *
 * Their own module because both the row that draws a tool call and the detail
 * views inside it need them, and a shared piece living in one of its two
 * consumers is how an import cycle starts — `ActivityRow` imports `ToolDetail`,
 * and `ToolDetail` fell back to a component defined in `ActivityRow`.
 */
/**
 * A fixed-height scroll box whose ends fade toward whatever is out of view.
 *
 * One primitive for the two kinds of unbounded content in a transcript row — the
 * model's thinking and a tool's payload — so both live in the same amount of
 * space, and a thought that streamed inside 1.5in does not suddenly become a
 * screenful the instant it settles.
 *
 * `follow` keeps the newest line in view while content is still arriving. It sets
 * `scrollTop` rather than calling `scrollIntoView`, which looks like the same
 * thing and is not: `scrollIntoView` scrolls every ancestor that can scroll, so
 * each delta also aimed the thread's viewport at this box, the thread's own
 * auto-follow undid it, and the transcript juddered for as long as the model was
 * thinking. A layout effect, so the tail is never painted at the old offset.
 */
export function FadedScroll({
  children,
  className,
  follow = false,
  watch,
  uncapped = false,
}: {
  children: React.ReactNode;
  className?: string;
  follow?: boolean;
  /** Changes that mean the content grew, so the fades are re-measured. */
  watch?: unknown;
  /** Released once the reader has asked for the whole thing. */
  uncapped?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<"none" | "top" | "bottom" | "both">("none");

  const measure = useCallback(() => {
    const node = box.current;
    if (!node) return;
    // A rounding slack: a box scrolled to the end is routinely a fraction of a
    // pixel short of it, and a fade that never quite clears reads as a bug.
    const above = node.scrollTop > 1;
    const below = node.scrollTop + node.clientHeight < node.scrollHeight - 1;
    setFade(above && below ? "both" : above ? "top" : below ? "bottom" : "none");
  }, []);

  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    if (follow) node.scrollTop = node.scrollHeight;
    measure();
  }, [follow, measure, watch, uncapped]);

  return (
    <div
      className={cn("agent-scroll app-scroll min-w-0", className)}
      data-fade={fade}
      onScroll={measure}
      ref={box}
      {...(uncapped ? { style: { maxHeight: "none" } } : {})}
    >
      {children}
    </div>
  );
}

/**
 * One labelled block of JSON — what went in, or what came back.
 *
 * Capped like everything else in a row, with the way out being explicit: a
 * payload longer than the box says so and offers the whole thing, rather than
 * leaving the reader to guess from a scrollbar whether there are three more lines
 * or three hundred.
 */
/** Both halves of a call, as the data they are. What every tool showed before
 *  any of them had a view, and what a tool without one still shows. */
export function RawPayload({ input, output }: { input: string; output: string }) {
  return (
    <>
      <Payload body={input} title="Input" />
      {input.trim() && output.trim() && <div className="mx-2.5 border-t border-border/60" />}
      <Payload body={output} title="Result" />
    </>
  );
}

function Payload({ title, body }: { title: string; body: string }) {
  const [full, setFull] = useState(false);
  const trimmed = body.trim();
  if (!trimmed) return null;
  const lines = trimmed.split("\n").length;
  return (
    <div className="min-w-0">
      <p className="px-2.5 pt-2 pb-1 text-ui-sm font-medium tracking-wide text-muted-foreground/85 uppercase">{title}</p>
      <FadedScroll uncapped={full} watch={body}>
        <pre className="px-2.5 pb-2 font-mono text-ui-sm leading-[1.5] whitespace-pre text-muted-foreground/90">{trimmed}</pre>
      </FadedScroll>
      {lines > 8 && (
        <button
          className="mx-2.5 mb-2 cursor-default rounded-md bg-[var(--accent)] px-2 py-1 font-mono text-ui-sm text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setFull((value) => !value)}
          type="button"
        >
          {full ? "Collapse output" : `Show full output · ${lines} lines`}
        </button>
      )}
    </div>
  );
}

/**
 * The call, opened up: its arguments and its result.
 *
 * The transcript used to name each call and stop there — deliberately, on the
 * grounds that arguments are raw internals. But a tutor that says "searched your
 * history" and will not say what for is asking to be taken on faith, and the
 * learner is the one whose record it searched. Everything is shown except the
 * parts of a challenge design that are its answer, which the worker has already
 * replaced with a note saying so before this ever sees them.
 */
