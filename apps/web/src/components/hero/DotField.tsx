"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./dotFieldShader";

type Props = {
  /** Grid step in CSS px. Larger means a sparser, calmer field. */
  spacing?: number;
  /** Resting dot radius in CSS px, before the pointer gets to it. */
  radius?: number;
  className?: string;
};

/** Pointer easing per frame. Low enough that the swell trails the cursor a
 *  little, which is what makes the field feel like a surface. */
const EASE = 0.12;

/** Clicks that can be in the air at once — must match the shader's RIPPLES. */
const RIPPLES = 7;
/** Arcs travelling at once — must match the shader's ARCS. */
const ARCS = 2;
/** How long an arc lives, and the gap before that slot strikes again. An arc is
 *  punctuation: rare enough that it stays a thing that happened. Two slots this
 *  far apart put one somewhere on the screen every eight seconds or so, which
 *  is about as often as you can have it before it turns into weather. */
const ARC_LIFE = 3.8;
const ARC_GAP = [11, 22] as const;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    if (process.env.NODE_ENV !== "production") {
      console.error(gl.getShaderInfoLog(shader));
    }
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * The field of dots behind the hero.
 *
 * Renders to a transparent WebGL2 canvas that sits under the copy. Where the
 * browser has no WebGL2, the element keeps a plain CSS dot grid instead — the
 * page is still the page, it just holds still.
 */
export function DotField({ spacing = 32, radius = 2.9, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!context) return;
    // Aliased non-null so the render loop's closures aren't each re-checking a
    // context that cannot have gone away.
    const gl: WebGL2RenderingContext = context;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      if (process.env.NODE_ENV !== "production") {
        console.error(gl.getProgramInfoLog(program));
      }
      return;
    }
    gl.useProgram(program);
    // The canvas is transparent and the dots are premultiplied, so source-over
    // with an already-multiplied source is the correct blend.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // Only now is the CSS grid behind the canvas redundant. It stays put on
    // anything that failed above this line, which is the whole point of it.
    const wrap = wrapRef.current;
    if (wrap) wrap.dataset.live = "true";

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const uRes = uniform("uRes");
    const uDpr = uniform("uDpr");
    const uPointer = uniform("uPointer");
    const uActive = uniform("uActive");
    const uTime = uniform("uTime");
    const uSpacing = uniform("uSpacing");
    const uBase = uniform("uBase");
    const uMotion = uniform("uMotion");
    const uClicks = uniform("uClicks");
    const uDrift = uniform("uDrift");
    const uArcA = uniform("uArcA");
    const uArcB = uniform("uArcB");
    const uArcAge = uniform("uArcAge");
    const uFocus = uniform("uFocus");

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = calm.matches;

    const size = { w: 0, h: 0, dpr: 1 };
    // Start the swell off-canvas so the field is at rest until the pointer
    // actually arrives, rather than blooming from a corner on load.
    const pointer = { x: -9999, y: -9999 };
    const target = { x: -9999, y: -9999 };
    let active = 0;
    let activeTarget = 0;
    // A ring of clicks rather than one. Keep clicking and you keep getting
    // waves; only the eighth one back is taken away from you, by which time it
    // has left the screen. Each slot is x, y, and the timestamp it landed at —
    // the age the shader wants is worked out per frame.
    const ripples = new Float32Array(RIPPLES * 3);
    const rippleAt = new Float64Array(RIPPLES).fill(-99_999);
    let nextRipple = 0;
    // Where the field is looking, and how hard. Eased, so attention arrives and
    // leaves rather than cutting.
    const focus = { x: 0, y: 0, weight: 0 };
    let visible = true;
    let frame = 0;
    const started = performance.now();

    // Arcs: two vec4s of path points each, plus an age. Every slot keeps its
    // own next-strike time, so they never fall into a rhythm.
    const arcA = new Float32Array(ARCS * 4);
    const arcB = new Float32Array(ARCS * 4);
    const arcAge = new Float32Array(ARCS).fill(-1);
    const arcDue = new Array<number>(ARCS).fill(0);
    for (let i = 0; i < ARCS; i++) {
      // Staggered from the first frame, so the hero does not open on three at
      // once and then nothing for ten seconds.
      arcDue[i] = 1800 + i * 7000 + Math.random() * 5000;
    }

    /** Picks the two dots and the route between them.
     *
     *  Every point is snapped to a dot's own centre, including the two bends in
     *  the middle. That is what keeps this belonging to the grid rather than
     *  sitting on top of it: the route has no positions of its own, only dots
     *  it passes through. The bends are pushed off the straight line so the two
     *  meet by a route rather than along a ruler. */
    function strike(slot: number, w: number, h: number, step: number) {
      // The canvas runs the whole height of the hero, which includes the part
      // the app window sits over and the part the mask has already faded out.
      // An arc down there happens where nobody can see it, so the whole event
      // is kept to the band where the field is actually legible.
      const zone = Math.min(h * 0.52, window.innerHeight * 0.94);
      const snap = (x: number, y: number): [number, number] => [
        (Math.floor(x / step) + 0.5) * step,
        (Math.floor(y / step) + 0.5) * step,
      ];

      // Both ends have to be on screen with room around them. A connection with
      // one end off the edge is not a connection, it is a thing leaving.
      const inset = Math.min(w, zone) * 0.12;
      const pick = (): [number, number] => [
        inset + Math.random() * (w - inset * 2),
        inset + Math.random() * (zone - inset * 2),
      ];

      // The copy sits in the middle under a scrim, so anything that happens
      // there happens where it cannot be seen.
      const clear = (x: number, y: number) => {
        const dx = (x - w / 2) / (w * 0.3);
        const dy = (y - zone * 0.5) / (zone * 0.42);
        return dx * dx + dy * dy > 1;
      };

      const min = step * 5;
      const max = Math.min(w, zone) * 0.72;
      let from = pick();
      let to = pick();
      // A handful of tries, then take what we have — this runs on a frame.
      for (let attempt = 0; attempt < 12; attempt++) {
        const gap = Math.hypot(to[0] - from[0], to[1] - from[1]);
        if (gap > min && gap < max && clear(...from) && clear(...to)) break;
        from = pick();
        to = pick();
      }

      // Two bends off the straight line, so they meet by a route rather than
      // along a ruler — and clamped, so a bend cannot leave the screen either.
      const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
      const px = -Math.sin(angle);
      const py = Math.cos(angle);
      const bend = () => (Math.random() - 0.5) * step * 3.2;
      const at = (t: number, offset: number): [number, number] =>
        snap(
          Math.min(w - inset, Math.max(inset, from[0] + (to[0] - from[0]) * t + px * offset)),
          Math.min(zone - inset, Math.max(inset, from[1] + (to[1] - from[1]) * t + py * offset)),
        );

      const [x0, y0] = snap(from[0], from[1]);
      const [x1, y1] = at(0.34, bend());
      const [x2, y2] = at(0.68, bend());
      const [x3, y3] = snap(to[0], to[1]);

      arcA[slot * 4] = x0;
      arcA[slot * 4 + 1] = y0;
      arcA[slot * 4 + 2] = x1;
      arcA[slot * 4 + 3] = y1;
      arcB[slot * 4] = x2;
      arcB[slot * 4 + 1] = y2;
      arcB[slot * 4 + 2] = x3;
      arcB[slot * 4 + 3] = y3;
      arcAge[slot] = 0;
    }

    function resize() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      // Fill rate is the whole cost here: three discs across a 3×3 neighbourhood
      // for every pixel. Big viewports drop to 1.5× rather than dropping frames.
      const ceiling = w * h > 2_200_000 ? 1.5 : 2;
      const dpr = Math.min(window.devicePixelRatio || 1, ceiling);
      if (w === size.w && h === size.h && dpr === size.dpr) return;
      size.w = w;
      size.h = h;
      size.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function draw(now: number) {
      frame = requestAnimationFrame(draw);
      if (!visible) return;

      const seconds = (now - started) / 1000;

      // Nobody has pointed at it yet — most obviously on a phone, and for the
      // first few seconds on every desktop. Rather than sit there as a flat
      // halftone, the swell wanders the field on its own. Two incommensurable
      // frequencies per axis, so the path never visibly repeats. The real
      // pointer takes over the moment it arrives, from wherever the drift had
      // got to.
      if (activeTarget === 0 && !reduced) {
        target.x = size.w * (0.5 + 0.3 * Math.sin(seconds * 0.17) + 0.11 * Math.sin(seconds * 0.43));
        target.y = size.h * (0.48 + 0.26 * Math.cos(seconds * 0.23) + 0.09 * Math.cos(seconds * 0.55));
        if (pointer.x < -1000) {
          pointer.x = target.x;
          pointer.y = target.y;
        }
      }

      // The drift is quieter than a hand on the mouse: it is the page idling,
      // not the page pretending someone is there.
      const wanted = activeTarget === 1 ? 1 : reduced ? 0 : 0.58;

      pointer.x += (target.x - pointer.x) * EASE;
      pointer.y += (target.y - pointer.y) * EASE;
      active += (wanted - active) * EASE;

      for (let i = 0; i < RIPPLES; i++) {
        ripples[i * 3 + 2] = reduced ? 999 : (now - (rippleAt[i] ?? -99_999)) / 1000;
      }

      // Each arc runs its life out and then books its own next strike, which is
      // what keeps three of them from ever settling into a rhythm.
      const elapsed = now - started;
      for (let i = 0; i < ARCS; i++) {
        if (reduced) {
          arcAge[i] = -1;
          continue;
        }
        if (elapsed < (arcDue[i] ?? 0)) continue;
        const age = (elapsed - (arcDue[i] ?? 0)) / 1000;
        if (age > ARC_LIFE) {
          arcAge[i] = -1;
          arcDue[i] = elapsed + (ARC_GAP[0] + Math.random() * (ARC_GAP[1] - ARC_GAP[0])) * 1000;
        } else {
          if (arcAge[i] === -1) strike(i, size.w, size.h, spacing);
          arcAge[i] = age;
        }
      }

      gl.uniform2f(uRes, size.w, size.h);
      gl.uniform1f(uDpr, size.dpr);
      gl.uniform2f(uPointer, pointer.x, pointer.y);
      gl.uniform1f(uActive, active);
      gl.uniform1f(uTime, reduced ? 0 : seconds);
      gl.uniform1f(uSpacing, spacing);
      gl.uniform1f(uBase, radius);
      gl.uniform1f(uMotion, reduced ? 0 : 1);
      gl.uniform3fv(uClicks, ripples);
      // Whichever connection is furthest along its charge takes the field's
      // attention, and the field pans towards it — the same lean the pointer
      // gets, borrowed by the event for as long as it lasts.
      let want = 0;
      let wantX = 0;
      let wantY = 0;
      for (let i = 0; i < ARCS; i++) {
        const age = arcAge[i] ?? -1;
        if (age < 0 || age > ARC_LIFE) continue;
        // In over the charge, out over the settle.
        const strength = Math.min(1, age / 0.9) * (1 - Math.min(1, Math.max(0, (age - 2.6) / 1.2)));
        if (strength <= want) continue;
        want = strength;
        wantX = ((arcA[i * 4] ?? 0) + (arcB[i * 4 + 2] ?? 0)) / 2;
        wantY = ((arcA[i * 4 + 1] ?? 0) + (arcB[i * 4 + 3] ?? 0)) / 2;
      }
      if (want > focus.weight || focus.weight < 0.01) {
        focus.x = wantX;
        focus.y = wantY;
      }
      focus.weight += (want - focus.weight) * 0.05;
      gl.uniform3f(uFocus, focus.x, focus.y, focus.weight);

      // How far the pointer is from the middle, in units the layers scale up.
      // Capped, so a cursor parked in a corner leans the field rather than
      // shearing the layers apart.
      let leanX = Math.max(-1, Math.min(1, (pointer.x - size.w / 2) / (size.w / 2)));
      let leanY = Math.max(-1, Math.min(1, (pointer.y - size.h / 2) / (size.h / 2)));
      if (focus.weight > 0.01) {
        const pullX = Math.max(-1, Math.min(1, (focus.x - size.w / 2) / (size.w / 2)));
        const pullY = Math.max(-1, Math.min(1, (focus.y - size.h / 2) / (size.h / 2)));
        const pull = focus.weight * 0.75;
        leanX += (pullX - leanX) * pull;
        leanY += (pullY - leanY) * pull;
      }
      gl.uniform2f(uDrift, leanX * 11, leanY * 11);
      gl.uniform4fv(uArcA, arcA);
      gl.uniform4fv(uArcB, arcB);
      gl.uniform1fv(uArcAge, arcAge);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function onPointerMove(event: PointerEvent) {
      // Only a real cursor takes the field over. A touch device fires
      // pointermove while you scroll, and it has no pointerleave to fire
      // afterwards — so honouring those latched the swell to wherever your
      // thumb last was and killed the drift for the rest of the visit. On
      // touch the field keeps drifting and taps send ripples, which is the
      // whole of the interaction there anyway.
      if (event.pointerType !== "mouse") return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      target.x = event.clientX - rect.left;
      target.y = event.clientY - rect.top;
      // Reaching past the canvas still counts, up to a point: the swell should
      // follow the cursor towards the edge instead of dying at the boundary.
      const near =
        target.x > -160 && target.y > -160 && target.x < rect.width + 160 && target.y < rect.height + 160;
      activeTarget = near ? 1 : 0;
      if (pointer.x < -1000) {
        // First sighting: put the swell where the cursor is rather than easing
        // it in from off-screen.
        pointer.x = target.x;
        pointer.y = target.y;
      }
    }

    function onPointerDown(event: PointerEvent) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const slot = nextRipple;
      nextRipple = (nextRipple + 1) % RIPPLES;
      ripples[slot * 3] = event.clientX - rect.left;
      ripples[slot * 3 + 1] = event.clientY - rect.top;
      rippleAt[slot] = performance.now();
    }

    function onLeave() {
      activeTarget = 0;
    }

    function onCalmChange(event: MediaQueryListEvent) {
      reduced = event.matches;
    }

    function onContextLost(event: Event) {
      // Without this the context never comes back, and the hero is left blank.
      event.preventDefault();
      cancelAnimationFrame(frame);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const seen = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true;
      },
      { rootMargin: "120px" },
    );
    seen.observe(canvas);

    resize();
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("blur", onLeave);
    document.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("webglcontextlost", onContextLost);
    calm.addEventListener("change", onCalmChange);
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      seen.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      calm.removeEventListener("change", onCalmChange);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (wrap) delete wrap.dataset.live;
    };
  }, [spacing, radius]);

  return (
    <div ref={wrapRef} className={cn("dot-field", className)} aria-hidden>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
