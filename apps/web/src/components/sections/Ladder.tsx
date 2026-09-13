"use client";

import { useEffect, useRef } from "react";

/**
 * One field of dots, read three ways, driven by how far you have scrolled.
 *
 * The argument the whole product rests on is hard to say in a sentence and easy
 * to show in a grid. A roadmap is a uniform grid: every problem the same size,
 * evenly spaced, in the same order for everyone, with no idea which of them cost
 * you an afternoon. So the section opens on exactly that — a perfectly uniform
 * field, which is the most boring thing dots can do, on purpose. Scroll and the
 * same problems take on the shape of how they actually went, some bright and
 * some barely there. Scroll again and they resolve into Spar's own diagonal: a
 * weakness with a shape, and what to do about it.
 *
 * Nothing moves except by scrolling, and nothing is added between the acts. It
 * is the same dots the whole way down, which is the point — you solved the same
 * problems either way. What is known about them is the difference.
 */

const ACTS = [
  {
    label: "The same sheet, for everyone",
    line: "The same problems, in the same order, for everybody.",
    /* Uniform on purpose: a fixed curriculum, drawn as seven identical marks. */
    glyphs: ["▪", "▪", "▪", "▪", "▪", "▪", "▪"],
    at: 0,
  },
  {
    label: "How you actually solved it",
    line: "Spar keeps what a checkmark throws away.",
    /* The same seven marks, no longer the same: that is what an attempt adds. */
    glyphs: ["▫", "▪", "·", "▪", "▫", "▪", "·"],
    at: 0.4,
  },
  {
    label: "Where you're actually weak",
    line: "A lost invariant and a missed graph are not the same gap.",
    /* One of the seven, named. */
    glyphs: ["·", "·", "▫", "◆", "▫", "·", "·"],
    at: 0.75,
  },
];

/** Target spacing, near the hero field's own, with the column and row counts
 *  derived from it. Fixing the counts instead makes the dots grow with the
 *  container, and on a wide screen that is a handful of enormous circles rather
 *  than a grid. */
const STEP = 34;

/** Stable per-dot pseudo-randomness — the same field on every visit. */
function evidence(col: number, row: number) {
  const n = Math.sin(col * 12.9898 + row * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function LadderField() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    let size = { w: 0, h: 0, dpr: 1 };
    let frame = 0;

    function resize() {
      const canvas = canvasRef.current;
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      frame = requestAnimationFrame(draw);
      const wrap = wrapRef.current;
      if (!wrap || !ctx) return;

      // Progress is read from the sticky wrapper's own box rather than from a
      // scroll listener, so it is right on the frame it is drawn — including
      // the frames an inertial scroller produces between wheel events.
      const rect = wrap.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / travel));

      const cols = Math.max(7, Math.min(40, Math.round(size.w / STEP)));
      const rows = Math.max(6, Math.min(24, Math.round(size.h / STEP)));

      // The two crossfades between the three acts.
      const toEvidence = smoothstep(0.14, 0.46, p);
      const toDiagonal = smoothstep(0.56, 0.88, p);

      const step = Math.min(size.w / (cols + 1), size.h / (rows + 1));
      const originX = (size.w - step * (cols - 1)) / 2;
      const originY = (size.h - step * (rows - 1)) / 2;
      const base = step * 0.1;

      ctx.clearRect(0, 0, size.w, size.h);
      ctx.globalCompositeOperation = "lighter";

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const u = cols > 1 ? col / (cols - 1) : 0;
          const v = rows > 1 ? row / (rows - 1) : 0;
          const ev = evidence(col, row);

          // Act one: a rung is a rung. Every dot identical, which is the whole
          // complaint about a fixed curriculum stated as a picture.
          const ladderR = base;
          const ladderTone = 0.3;

          // Act two: what the attempts actually showed. Same grid, no longer
          // uniform — a few cleared cleanly, most somewhere in between.
          const evidenceR = base * (0.3 + 1.9 * ev * ev);
          const evidenceTone = 0.12 + 0.8 * ev * ev;

          // Act three: the mark's own taper, at the scale of the whole field.
          // Brightest along the leading diagonal, falling away from it.
          const offDiagonal = Math.abs(u - v);
          const diagonalR = base * (2.0 - 1.8 * offDiagonal);
          const diagonalTone = Math.max(0, 1 - 1.15 * offDiagonal);

          const radius = lerp(lerp(ladderR, evidenceR, toEvidence), diagonalR, toDiagonal);
          const tone = lerp(lerp(ladderTone, evidenceTone, toEvidence), diagonalTone, toDiagonal);
          if (radius <= 0.15 || tone <= 0.01) continue;

          // Scatter belongs to the middle act only: evidence is messy, and the
          // point of the third act is that Spar makes something ordered of it.
          const messy = toEvidence * (1 - toDiagonal);
          const x = originX + col * step + (ev - 0.5) * step * 0.5 * messy;
          const y = originY + row * step + (evidence(row, col) - 0.5) * step * 0.5 * messy;

          // The hero's aberration, on a 2D canvas: three copies of the disc,
          // one per channel, pushed apart along the row. Where they agree you
          // get white; where they don't you get the fringe. Additive blending
          // is what makes the overlap add back up to white.
          const split = radius * 0.27 * (0.25 + 0.75 * toDiagonal);
          ctx.globalAlpha = tone;
          ctx.fillStyle = "#ff0000";
          ctx.beginPath();
          ctx.arc(x + split, y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#00ff00";
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#0000ff";
          ctx.beginPath();
          ctx.arc(x - split, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      // The captions are driven from the same progress, so what you read and
      // what the dots are doing can never disagree.
      const now = performance.now() / 1000;
      for (const [index, act] of ACTS.entries()) {
        const node = wrap.querySelector<HTMLElement>(`[data-act="${index}"]`);
        if (!node) continue;
        const next = ACTS[index + 1]?.at ?? 2;
        // The first act is already on screen when the section arrives — fading
        // it in from nothing would mean the section opens on a blank frame.
        const rising = index === 0 ? 1 : smoothstep(act.at - 0.12, act.at + 0.02, p);
        const shown = rising * (1 - smoothstep(next - 0.14, next - 0.02, p));
        node.style.opacity = String(calm.matches ? (index === 0 ? 1 : 0) : shown);
        node.style.transform = `translateY(${(1 - shown) * 14}px)`;

        /* The glyph row says the same thing the dots do, in seven characters.
           Act one does not move — a fixed curriculum has nothing to report. Act
           two flickers unevenly, because that is what evidence looks like before
           anything has been made of it. Act three settles, and one mark holds. */
        const glyphs = node.querySelectorAll<HTMLElement>("[data-glyph]");
        for (const [slot, glyph] of glyphs.entries()) {
          const seed = evidence(index * 11 + slot, slot);
          let alpha = 0.4;
          let scale = 1;
          if (index === 1 && !calm.matches) {
            alpha = 0.14 + 0.66 * (0.5 + 0.5 * Math.sin(now * 1.5 + seed * 11));
          } else if (index === 2) {
            const held = slot === 3;
            alpha = held ? (calm.matches ? 1 : 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(now * 2.1))) : 0.3;
            scale = held ? 1.15 : 1;
          }
          glyph.style.opacity = String(alpha);
          glyph.style.transform = `scale(${scale})`;
        }
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
    <div ref={wrapRef} className="relative h-[320svh]">
      <div className="sticky top-0 flex h-svh flex-col items-center justify-center overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
        {/* Keeps the copy off the brightest part of the field. */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(52%_40%_at_50%_52%,rgba(0,0,0,0.94),rgba(0,0,0,0.72)_58%,transparent_82%)]" />

        <div className="shell relative z-10 text-center">
          {/* Stacked, so the box never resizes as one line replaces another. */}
          <div className="relative mx-auto grid min-h-[11rem] max-w-[46ch] place-items-center">
            {ACTS.map((act, index) => (
              <div
                key={act.label}
                data-act={index}
                className="col-start-1 row-start-1"
                style={{ opacity: index === 0 ? 1 : 0 }}
              >
                <p className="font-mono text-[10.5px] tracking-[0.2em] text-faint uppercase">
                  {String(index + 1).padStart(2, "0")} — {act.label}
                </p>
                <p className="mt-5 font-display text-[clamp(1.5rem,3.1vw,2.4rem)] leading-[1.12]">
                  {act.line}
                </p>
                <p aria-hidden className="mt-7 flex justify-center gap-3 font-mono text-[1.05rem] text-paper">
                  {act.glyphs.map((glyph, slot) => (
                    <span
                      key={slot}
                      data-glyph
                      className="inline-block transition-none"
                      style={{ opacity: 0.4 }}
                    >
                      {glyph}
                    </span>
                  ))}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
