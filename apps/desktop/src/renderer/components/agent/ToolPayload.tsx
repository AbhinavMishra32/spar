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
export function RawPayload({ input, output, status }: { input: string; output: string; status?: string | undefined }) {
  return (
    <>
      <Payload body={input} title="Input" />
      {input.trim() && output.trim() && <div className="mx-2.5 border-t border-border/60" />}
      {/* The word goes on the result, not on the call: "Done" beside the
          arguments would be claiming the arguments finished. */}
      <Payload body={output} status={status} title="Output" />
    </>
  );
}

function Payload({ title, body, status }: { title: string; body: string; status?: string | undefined }) {
  const [full, setFull] = useState(false);
  const trimmed = body.trim();
  if (!trimmed) return null;
  const lines = trimmed.split("\n").length;
  return (
    <div className="min-w-0">
      {/* A name, not a field code. These were set as uppercase letter-spaced
          eyebrows — the type of a form label — over what is plainly a block of
          the tool's own text, and at 13px that treatment is harder to read than
          the payload it is labelling. How the call ended sits at the other end
          of the same line, which is where the eye already is once it has
          finished the block. */}
      <div className="flex min-w-0 items-baseline justify-between gap-2 px-2.5 pt-2 pb-1">
        <p className="min-w-0 truncate text-thread-tool font-medium text-foreground/75">{title}</p>
        {status && <span className="shrink-0 text-thread-tool text-muted-foreground/70">{status}</span>}
      </div>
      <FadedScroll uncapped={full} watch={body}>
        <pre className="px-2.5 pb-2 font-mono text-thread-tool leading-[1.45] whitespace-pre text-muted-foreground/80">{trimmed}</pre>
      </FadedScroll>
      {lines > 8 && (
        <button
          className="mx-2.5 mb-2 cursor-default rounded-md bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] px-2 py-1 text-thread-tool text-muted-foreground transition-colors hover:text-foreground"
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
 * A payload that was cut off, made readable up to the cut.
 *
 * The worker caps what it stores at 16k, so the long results — an attempt's
 * whole event log above all — reach the renderer as valid JSON with the end
 * sawn off. Parsing that fails, and a view handed nothing has no way to tell
 * "the tool returned nothing" from "I could not read this", which is how a
 * panel ends up stating the first when the second is true.
 *
 * So the half that did arrive is closed: cut back to the last value that
 * finished, then shut the brackets that were open at that point. Ten of twelve
 * events is the honest reading of a payload with ten complete events in it.
 */
export function closeOff(body: string): string {
  const stack: string[] = [];
  let shut: string[] = [];
  let end = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") inString = true;
    else if (character === "{" || character === "[") stack.push(character === "{" ? "}" : "]");
    else if (character === "}" || character === "]") {
      stack.pop();
      /* A value just finished, and everything still open at this point is what
         has to be closed to make the prefix whole. */
      end = index;
      shut = [...stack].reverse();
    }
  }
  return end < 0 ? body : body.slice(0, end + 1) + shut.join("");
}
