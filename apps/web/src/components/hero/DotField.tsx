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
    const RIPPLES = 7;
    const ripples = new Float32Array(RIPPLES * 3);
    const rippleAt = new Float64Array(RIPPLES).fill(-99_999);
    let nextRipple = 0;
    let visible = true;
    let frame = 0;
    const started = performance.now();

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

      gl.uniform2f(uRes, size.w, size.h);
      gl.uniform1f(uDpr, size.dpr);
      gl.uniform2f(uPointer, pointer.x, pointer.y);
      gl.uniform1f(uActive, active);
      gl.uniform1f(uTime, reduced ? 0 : seconds);
      gl.uniform1f(uSpacing, spacing);
      gl.uniform1f(uBase, radius);
      gl.uniform1f(uMotion, reduced ? 0 : 1);
      gl.uniform3fv(uClicks, ripples);
      // How far the pointer is from the middle, in units the layers scale up.
      // Capped, so a cursor parked in a corner leans the field rather than
      // shearing the layers apart.
      const leanX = Math.max(-1, Math.min(1, (pointer.x - size.w / 2) / (size.w / 2)));
      const leanY = Math.max(-1, Math.min(1, (pointer.y - size.h / 2) / (size.h / 2)));
      gl.uniform2f(uDrift, leanX * 11, leanY * 11);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function onPointerMove(event: PointerEvent) {
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
      // A tap is also the first time a touch device has pointed at anything,
      // and it should take the swell with it rather than only sending a wave.
      target.x = event.clientX - rect.left;
      target.y = event.clientY - rect.top;
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
