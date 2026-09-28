import type { ArrivalEvent, SparApi } from "../shared/api";

/* The desktop around the onboarding window, for its few big moments.

   Nothing is drawn at rest. The window's backdrop is the mark's grid, and this
   layer is that same grid carried on past the window's edges, invisible until a
   pulse crosses it: the mark landing, the notebook being signed and the learner
   leaving each send one ring out across the desktop, lighting the dots it passes
   for as long as it takes to pass them. Leaving sends the widest, with a wake
   behind it, and the layer closes once it has gone by.

   Each dot is a light core over a soft dark halo, so a ring reads on a white
   wallpaper and a black one alike. The canvas is drawn only while a ring is
   travelling and the window is the one in front, and never over the window. */

/** The window backdrop's pitch: `--auth-dot-pitch` in theme.css. */
const PITCH = 22;
/** Where the backdrop's first dot sits from the window's corner. Its grid is
 *  pinned there (see `.onboarding-field`), so this one lines up with it. */
const PHASE = PITCH / 2;
const TAU = Math.PI * 2;

type Pulse = {
  x: number;
  y: number;
  born: number;
  strength: number;
  /** Pixels a second. */
  speed: number;
  /** How far ahead of the front a dot starts to light, and how long it stays lit behind it. */
  lead: number;
  trail: number;
  /** How far the ring travels before it has faded out. */
  reach: number;
};

const canvas = document.getElementById("field") as HTMLCanvasElement;
const context = canvas.getContext("2d")!;

let width = 0;
let height = 0;
let frame: { x: number; y: number; width: number; height: number } | null = null;
let focused = false;
let fading = false;
let pulses: Pulse[] = [];
/** Every dot's centre, x then y, in this layer's coordinates. */
let dots = new Float32Array(0);
let lit = new Float32Array(0);
let raf = 0;

function layout() {
  const ratio = devicePixelRatio || 1;
  width = innerWidth;
  height = innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  grid();
}

/** The grid, continued from the window's own, minus the dots the window covers. */
function grid() {
  const originX = (frame?.x ?? 0) + PHASE;
  const originY = (frame?.y ?? 0) + PHASE;
  const startX = originX - Math.ceil(originX / PITCH) * PITCH;
  const startY = originY - Math.ceil(originY / PITCH) * PITCH;
  const points: number[] = [];
  for (let y = startY; y < height + PITCH; y += PITCH) {
    for (let x = startX; x < width + PITCH; x += PITCH) {
      if (frame && x > frame.x - 4 && x < frame.x + frame.width + 4 && y > frame.y - 4 && y < frame.y + frame.height + 4) continue;
      points.push(x, y);
    }
  }
  dots = Float32Array.from(points);
  lit = new Float32Array(points.length / 2);
}

function wake() {
  if (!raf && pulses.length) raf = requestAnimationFrame(draw);
}

function draw(now: number) {
  raf = 0;
  context.clearRect(0, 0, width, height);
  pulses = pulses.filter((pulse) => ((now - pulse.born) / 1000) * pulse.speed - pulse.trail < pulse.reach);
  if (!focused || !pulses.length) return;

  lit.fill(0);
  const count = lit.length;
  for (const pulse of pulses) {
    const radius = ((now - pulse.born) / 1000) * pulse.speed;
    // Fades as it travels, eased so most of the fall comes near the end.
    const carry = pulse.strength * Math.pow(Math.max(0, 1 - radius / pulse.reach), 1.4);
    if (carry < 0.01) continue;
    const inner = radius - pulse.trail * 2.2;
    const outer = radius + pulse.lead * 2.2;
    for (let index = 0; index < count; index++) {
      const dx = dots[index * 2]! - pulse.x;
      const dy = dots[index * 2 + 1]! - pulse.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < inner || distance > outer) continue;
      const offset = (distance - radius) / (distance > radius ? pulse.lead : pulse.trail);
      lit[index] = Math.min(1, lit[index]! + carry * Math.exp(-offset * offset));
    }
  }

  // Halos first, all of them, so no core is ever shaded by its neighbour's.
  for (const pass of [0, 1] as const) {
    context.fillStyle = pass === 0 ? "#000" : "#fff";
    for (let index = 0; index < count; index++) {
      const value = lit[index]!;
      if (value < 0.03) continue;
      const x = dots[index * 2]!;
      const y = dots[index * 2 + 1]!;
      const core = 0.7 + 1.15 * value;
      context.globalAlpha = pass === 0 ? 0.2 * value : 0.92 * value;
      context.beginPath();
      context.arc(x, y, pass === 0 ? core + 1.9 : core, 0, TAU);
      context.fill();
    }
  }
  context.globalAlpha = 1;
  raf = requestAnimationFrame(draw);
}

const api = (window as unknown as { spar?: SparApi }).spar;
api?.arrival.onEvent((event: ArrivalEvent) => {
  if (event.type === "window") {
    frame = { x: event.x, y: event.y, width: event.width, height: event.height };
    grid();
  }
  if (event.type === "focus") {
    focused = event.focused;
    // Looking away ends whatever was crossing the desktop; nothing replays after.
    if (!focused) pulses = [];
  }
  if (event.type === "pulse" && focused && !fading) {
    const diagonal = Math.hypot(width, height);
    const bloom = event.kind === "bloom";
    pulses.push({
      x: event.x,
      y: event.y,
      born: performance.now(),
      strength: Math.min(1, bloom ? 1 : 0.55 + event.strength * 0.3),
      speed: bloom ? 1_750 : 1_150,
      lead: bloom ? 48 : 26,
      trail: bloom ? 190 : 52,
      reach: bloom ? diagonal : Math.min(diagonal, 700 + event.strength * 520),
    });
    if (pulses.length > 4) pulses.shift();
  }
  if (event.type === "fade") fading = true;
  wake();
});

addEventListener("resize", layout);
layout();
