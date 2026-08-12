"use client";

import { useEffect, useRef } from "react";

/**
 * The check every generated challenge has to survive, run in front of you.
 *
 * This was a bulleted list, and a list is the wrong shape for it: the whole
 * claim is about a *sequence* of runs, where what makes the last step mean
 * anything is that the step before it passed. Dots can just show that. A test
 * suite is a grid — the visible cases on top, the hidden ones underneath — and
 * scrolling runs the suite.
 *
 * The third act is the one worth staying for. A broken solution sailing through
 * the visible tests looks like a bug in the page until the hidden rows catch
 * it, which is exactly the argument: a hidden test only means something if the
 * visible ones could be passed without it.
 *
 * The suite has a column of the layout to itself. It used to be a full-bleed
 * canvas with the copy floating over it, which put a wall of dots directly
 * behind the words — unreadable, and it made the grid a background rather than
 * the diagram it is.
 */

const ACTS = [
  {
    label: "Run the reference",
    line: "Before you see it, the solution Spar wrote has to pass every case — the ones you can see and the ones you can't.",
    at: 0,
  },
  {
    label: "Break it on purpose",
    line: "Then a deliberately broken version has to pass the visible cases, proving that suite is genuinely incomplete.",
    at: 0.38,
  },
  {
    label: "The hidden cases bite",
    line: "And fail the hidden ones. Anything that misses a step here is thrown away instead of set for you.",
    at: 0.72,
  },
];

/** Roughly the spacing the hero's field runs at, so the two read as one system.
 *  Columns are derived from it rather than fixed, or the dots grow with the
 *  container and a wide screen gets a handful of enormous circles. */
const STEP = 26;
const VISIBLE_ROWS = 3;
const HIDDEN_ROWS = 3;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function ProofRun() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    let size = { w: 0, h: 0 };
    let frame = 0;

    function resize() {
      const canvas = canvasRef.current;
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = { w: rect.width, h: rect.height };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      frame = requestAnimationFrame(draw);
      const wrap = wrapRef.current;
      if (!wrap || !ctx || size.w === 0) return;

      const rect = wrap.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / travel));

      const rows = VISIBLE_ROWS + HIDDEN_ROWS;
      const cols = Math.max(6, Math.min(34, Math.round(size.w / STEP)));
      const step = size.w / (cols + 1);
      const base = step * 0.17;

      // Each act is a pass over the suite, left to right. The front is where
      // that run has got to; a dot behind it has been decided, one ahead of it
      // has not been reached.
      const reference = smoothstep(0.02, 0.3, p);
      const broken = smoothstep(0.4, 0.66, p);
      const hidden = smoothstep(0.74, 0.96, p);

      // The gap between the halves, and room above each for its label.
      const gap = step * 1.9;
      const label = 22;
      const gridH = step * (rows - 1) + gap + label * 2;
      const originX = (size.w - step * (cols - 1)) / 2;
      const originY = (size.h - gridH) / 2 + label;

      ctx.clearRect(0, 0, size.w, size.h);
      ctx.font = "500 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.letterSpacing = "0.18em";

      // Labels are drawn into the canvas rather than positioned over it, so
      // they cannot drift away from the rows they name.
      ctx.fillStyle = "rgba(255,255,255,0.42)";
      ctx.globalAlpha = 0.35 + 0.65 * reference;
      ctx.fillText("VISIBLE TESTS", originX, originY - 12);
      ctx.globalAlpha = 0.35 + 0.65 * Math.max(reference, hidden);
      ctx.fillText("HIDDEN TESTS", originX, originY + step * VISIBLE_ROWS + gap - 12);
      ctx.globalAlpha = 1;

      for (let row = 0; row < rows; row++) {
        const isHidden = row >= VISIBLE_ROWS;
        for (let col = 0; col < cols; col++) {
          const x = originX + col * step;
          const y = originY + row * step + (isHidden ? gap + label : 0);
          const front = cols > 1 ? col / (cols - 1) : 0;
          const reached = (run: number) => smoothstep(front * 0.85, front * 0.85 + 0.18, run);

          // Act one lights everything: the reference passes the lot.
          const passRef = reached(reference);
          // Act two runs the broken solution. The visible half goes on passing,
          // which is the uncomfortable part and the point.
          const passBroken = isHidden ? 0 : reached(broken);
          // Act three is the hidden half catching what the visible half missed.
          const failHidden = isHidden ? reached(hidden) : 0;

          const lit = Math.max(passRef, passBroken, failHidden);
          if (lit <= 0.01) {
            // Not yet reached: the case exists, it just has no verdict.
            ctx.globalAlpha = 0.14;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(x, y, base * 0.5, 0, Math.PI * 2);
            ctx.fill();
            continue;
          }

          const radius = base * lerp(0.5, 1, lit);
          if (failHidden > 0.01) {
            // A failure is the one place this page uses colour as a fill. It
            // has earned it: this is the moment the check does its job.
            ctx.globalAlpha = failHidden;
            ctx.fillStyle = "#ff2d55";
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = failHidden * 0.22;
            ctx.beginPath();
            ctx.arc(x, y, radius * 2.4, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.globalAlpha = 0.28 + 0.72 * lit;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;

      for (const [index, act] of ACTS.entries()) {
        const node = wrap.querySelector<HTMLElement>(`[data-proof="${index}"]`);
        if (!node) continue;
        const next = ACTS[index + 1]?.at ?? 2;
        const rising = index === 0 ? 1 : smoothstep(act.at - 0.12, act.at + 0.02, p);
        const shown = rising * (1 - smoothstep(next - 0.14, next - 0.02, p));
        node.style.opacity = String(calm.matches ? (index === 0 ? 1 : 0) : shown);
        node.style.transform = `translateY(${(1 - shown) * 12}px)`;
      }
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} className="edge relative h-[280svh]">
      <div className="sticky top-0 flex h-svh items-center overflow-hidden">
        <div className="shell grid w-full items-center gap-12 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:gap-16">
          <div>
            <p className="eyebrow">
              <span data-index>[07]</span>
              The model is not the judge
            </p>
            {/* Stacked, so the block never resizes as one line replaces another. */}
            <div className="relative mt-7 grid min-h-[10rem]">
              {ACTS.map((act, index) => (
                <div
                  key={act.label}
                  data-proof={index}
                  className="col-start-1 row-start-1"
                  style={{ opacity: index === 0 ? 1 : 0 }}
                >
                  <p className="font-mono text-[10.5px] tracking-[0.2em] text-faint uppercase">
                    {act.label}
                  </p>
                  <p className="mt-4 font-display text-[clamp(1.3rem,2.2vw,1.8rem)] leading-[1.16]">
                    {act.line}
                  </p>
                </div>
              ))}
            </div>

            {/* Static, under the acts that move: the verdict is where the page
                stops talking about validation and starts talking about what a
                failure is worth. A failed case is not a grade, it is the most
                specific evidence in the system. */}
            <p className="mt-8 max-w-[46ch] border-t border-line pt-7 text-[0.92rem] leading-relaxed text-muted">
              Your solution is graded by running those cases, never by asking a model. And a failing hidden
              case says more than <span className="text-paper">Wrong Answer</span> — it names which input broke
              you, which is the sharpest evidence the ability map ever gets.
            </p>
          </div>

          {/* The suite gets its own column, and nothing is set over it. */}
          <div className="h-[15rem] w-full sm:h-[17rem]">
            <canvas
              ref={canvasRef}
              className="h-full w-full"
              role="img"
              aria-label="A test suite drawn as dots: the visible cases above the hidden ones. The reference solution passes both, a deliberately broken version passes the visible cases, and the hidden cases catch it."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
