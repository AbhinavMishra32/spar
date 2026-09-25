/**
 * The film's clock.
 *
 * Everything in the renderer that tells time — the attempt clock, "Worked for",
 * a stage's elapsed seconds — reads `Date.now()`. The recording is stamped in
 * the session's own time, so the page's `Date` is moved onto it: the film opens
 * at the moment the recording opens, and can run faster than real time through
 * the stretches where the real turn was only waiting on a model.
 *
 * `performance.now()` and animation frames are left alone. Motion should still
 * move at the speed motion moves; only the numbers on screen are warped.
 */

const RealDate = Date;
const realNow = () => performance.now();

export type Clock = {
  /** Virtual epoch milliseconds. */
  now(): number;
  /** How many virtual milliseconds pass per real one. Zero holds the clock. */
  rate(value: number): void;
  /** Resolves once virtual time reaches `epoch`, whatever the rate does meanwhile. */
  until(epoch: number): Promise<void>;
  /** Back to `epoch`, held. Every waiter is released as cancelled. */
  reset(epoch: number): void;
};

export function installClock(start: number): Clock {
  let base = start;
  let anchor = realNow();
  let speed = 0;
  let generation = 0;
  const waiters = new Set<{ epoch: number; resolve(): void; reject(error: Error): void; generation: number }>();

  const now = () => base + (realNow() - anchor) * speed;
  const rebase = () => { base = now(); anchor = realNow(); };

  let frame = 0;
  const tick = () => {
    frame = 0;
    const current = now();
    for (const waiter of waiters) {
      if (waiter.epoch > current) continue;
      waiters.delete(waiter);
      waiter.resolve();
    }
    if (waiters.size) frame = requestAnimationFrame(tick);
  };
  const schedule = () => { if (!frame && waiters.size) frame = requestAnimationFrame(tick); };

  class FilmDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(now());
      else super(...(args as [string]));
    }
    static override now() { return Math.round(now()); }
  }
  window.Date = FilmDate as DateConstructor;

  return {
    now,
    rate(value) { rebase(); speed = value; schedule(); },
    until(epoch) {
      if (now() >= epoch) return Promise.resolve();
      return new Promise((resolve, reject) => {
        waiters.add({ epoch, resolve, reject, generation });
        schedule();
      });
    },
    reset(epoch) {
      generation += 1;
      for (const waiter of waiters) waiter.reject(new Cancelled());
      waiters.clear();
      base = epoch;
      anchor = realNow();
      speed = 0;
    },
  };
}

/** A wait that was cut short because the film started over. */
export class Cancelled extends Error {
  constructor() { super("cancelled"); }
}
