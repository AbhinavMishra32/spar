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
 */

const ACTS = [
  {
    label: "Run the reference",
    line: "The solution Spar wrote has to pass every test — the ones you can see and the ones you can't.",
    at: 0,
  },
  {
    label: "Break it on purpose",
    line: "Then a deliberately broken version has to pass the visible tests, proving that suite is genuinely incomplete.",
    at: 0.38,
  },
  {
    label: "The hidden cases bite",
    line: "And fail the hidden ones. A challenge that misses any of this is thrown away rather than set for you.",
    at: 0.72,
  },
];

const COLS = { wide: 16, narrow: 8 };
/** Three rows you are shown, three you are not. */
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
      if (!wrap || !ctx) return;

      const rect = wrap.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / travel));

      const cols = size.w < 640 ? COLS.narrow : COLS.wide;
      const rows = VISIBLE_ROWS + HIDDEN_ROWS;

      // Each act is a pass over the suite, left to right. The front is where
      // that run has got to; a dot behind it has been decided, one ahead of it
      // has not been reached.
      const reference = smoothstep(0.02, 0.3, p);
      const broken = smoothstep(0.4, 0.66, p);
      const hidden = smoothstep(0.74, 0.96, p);

      const step = Math.min(size.w / (cols + 1.5), size.h / (rows + 3));
      const originX = (size.w - step * (cols - 1)) / 2;
      // The gap between the two halves, so they read as two suites not one.
      const split = step * 0.9;
      const gridH = step * (rows - 1) + split;
      const originY = (size.h - gridH) / 2;
      const base = step * 0.15;

      ctx.clearRect(0, 0, size.w, size.h);

      for (let row = 0; row < rows; row++) {
        const isHidden = row >= VISIBLE_ROWS;
        for (let col = 0; col < cols; col++) {
          const x = originX + col * step;
          const y = originY + row * step + (isHidden ? split : 0);
          // Where this column sits in a left-to-right run.
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
            ctx.globalAlpha = 0.16;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(x, y, base * 0.55, 0, Math.PI * 2);
            ctx.fill();
            continue;
          }

          const radius = base * lerp(0.55, 1, lit);
          if (failHidden > 0.01) {
            // A failure is the one place this page uses colour as fill. It has
            // earned it: this is the moment the check does its job.
            ctx.globalAlpha = failHidden;
            ctx.fillStyle = "#ff2d55";
            ctx.beginPath();
            ctx.arc(x, y, radius * 1.1, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = failHidden * 0.28;
            ctx.beginPath();
            ctx.arc(x, y, radius * 2.6, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.globalAlpha = lit;
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

      // The row labels come up with the half they belong to.
      const visibleLabel = wrap.querySelector<HTMLElement>("[data-half='visible']");
      const hiddenLabel = wrap.querySelector<HTMLElement>("[data-half='hidden']");
      if (visibleLabel) visibleLabel.style.opacity = String(0.25 + 0.75 * reference);
      if (hiddenLabel) hiddenLabel.style.opacity = String(0.25 + 0.75 * Math.max(reference, hidden));
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
      <div className="sticky top-0 flex h-svh flex-col items-center justify-center overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />

        <div className="shell relative z-10 grid w-full gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <div className="relative min-h-[13rem]">
            <p className="eyebrow">
              <span data-index>[04]</span>
              Proven before you see it
            </p>
            <div className="relative mt-7 grid">
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
                  <p className="mt-4 font-display text-[clamp(1.35rem,2.4vw,1.95rem)] leading-[1.16]">
                    {act.line}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* The two halves, named beside the rows they label. */}
          <div className="hidden flex-col justify-center gap-[7.5rem] pt-2 lg:flex">
            <p
              data-half="visible"
              className="font-mono text-[10px] tracking-[0.22em] text-faint uppercase transition-opacity"
            >
              Visible tests
            </p>
            <p
              data-half="hidden"
              className="font-mono text-[10px] tracking-[0.22em] text-faint uppercase transition-opacity"
            >
              Hidden tests
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
