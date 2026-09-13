import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { CaseStatus } from "../../../shared/testReport";

/**
 * Every case in the suite, as one dot each.
 *
 * A row of "Case 1 · Case 2 · Case 3" chips is a list of names nobody reads: the
 * only questions a learner has after a run are *did it pass* and *which one
 * didn't*, and forty chips answer neither until you scan all forty. Forty dots
 * answer both at a glance, and they answer it in the app's own mark — the icon
 * is a dot grid, the loaders are that grid in motion, and a suite is the one
 * place in the app where the grid is made of something real.
 *
 * The cases pick the geometry rather than the other way round. A suite is
 * whatever the challenge says it is — three visible cases, or two hundred and
 * twelve hidden ones — so the pitch shrinks as the count grows and the grid
 * wraps to whatever width the panel has. Nothing here assumes a case count, a
 * column count, or that the number was known before the run.
 */

export type CaseDot = { id: string; ordinal: number; status?: CaseStatus | undefined };

/**
 * How many dots to a row: the square root, floored at the mark's own five.
 *
 * The grid is square because the mark is square. Left to wrap into whatever
 * width the panel had, forty cases became a forty-dot line — a progress bar made
 * of dots, which is the one thing the app's grid is not. A block has a shape you
 * recognise before you read it, and a failure in the middle of a block is a
 * position rather than an offset along a line.
 *
 * Five is the floor rather than the rule: a suite of three is three dots in a
 * row, not a two-by-two with a hole in it.
 */
export function columnsFor(count: number): number {
  return Math.max(5, Math.ceil(Math.sqrt(count)));
}

/** Cell pitch in px, by how many dots have to fit. The dot is a fraction of it,
 *  so the gap and the mark shrink together and the texture stays a grid. */
function pitchFor(count: number): number {
  if (count <= 24) return 16;
  if (count <= 64) return 13;
  if (count <= 150) return 11;
  return 9;
}

/** One dot's cycle. A dot's phase is an offset into it, so the band is already
 *  mid-grid on the first frame rather than the whole suite starting flat. */
const RUN_MS = 900;

/** How far into the dip a dot goes at the bottom of the wave: a little smaller,
 *  a lot dimmer. Size alone is too quiet at a five-pixel dot and opacity alone
 *  reads as a blink; together they read as a dot receding. */
const DIP_SCALE = 0.4;
const DIP_FADE = 0.62;

/**
 * How much of one cycle the dots are spread across.
 *
 * Half, and the half is what makes it a single travelling band. The pulse is
 * symmetric — trough at the edges of the cycle, peak in the middle — so at any
 * instant the grid shows whatever slice of that curve the spread covers. Half a
 * cycle is trough-through-peak and nothing else: one bright band, moving one
 * way. A full cycle puts both ends of the grid at the same phase and you get its
 * mirror image instead — a square alternating between "middle bright" and
 * "corners bright", and three dots in a row becoming dot-two alternating with
 * dots-one-and-three. Because it is measured against the grid's own diagonal
 * rather than against a dot count, this holds for a row of three as well as for
 * a fifteen-by-fifteen block.
 */
export const SPREAD = 0.5;

/** How long a dot takes to expand out of the wave into its verdict.
 *
 *  Slow on purpose, and it is the one number here that is a matter of taste
 *  rather than of mechanism. The verdict is the thing the learner pressed the
 *  button for; letting the grid take a beat to arrive at it reads as the suite
 *  resolving, where a quick snap reads as a state change in a UI. It is matched
 *  exactly by the colour crossfade in the stylesheet — the dot finishes growing
 *  and finishes turning green at the same instant, so it is one event and not
 *  two. */
const REVEAL_MS = 1200;

/** Fast out, easing in. Cubic, so a dot that was almost at rest when the verdict
 *  came still visibly finishes rather than arriving and stopping dead. */
const easeOut = (unit: number) => 1 - (1 - unit) ** 3;

/** The floor on how long the wave runs, counted from the moment it starts.
 *
 *  A ten-case suite finishes in forty milliseconds. Without a floor the wave is
 *  a single frame of grey between pressing Run and a grid full of colour — it
 *  technically played and nobody saw it. Anything slower than this reveals the
 *  instant its results land, because by then the wave has been the wait. */
const REVEAL_HOLD_MS = 800;

/**
 * How long the wave's front takes to cross the whole grid — and therefore how
 * long the verdicts take to cross it too.
 *
 * The dots are spread over `SPREAD` of a cycle, so the dip front travels corner
 * to corner in that fraction of one. Giving the reveal the same number is what
 * makes it read as the same motion rather than as a second effect layered over
 * it: the colour front leaves the far corner at the speed the dip front was
 * already moving, in the direction it was already going, and the grid finishes
 * turning over exactly one ripple after it starts.
 */
export const FRONT_MS = SPREAD * RUN_MS;

/**
 * When a dot's verdict reaches it, relative to the reveal.
 *
 * A dot is at the bottom of its dip when `elapsed / RUN_MS + phase ≡ 0.5`, so a
 * dot with a *larger* phase gets there sooner: the dip travels from the far end
 * of the diagonal back towards the near one. The reveal is ordered the same way
 * — far end first — because a colour front running against the dip is two waves
 * crossing, and reads as neither.
 */
export const revealDelay = (phase: number) => ((SPREAD - phase) / SPREAD) * FRONT_MS;

/**
 * When the grid has finished saying it: the front has crossed the last dot and
 * that dot is most of the way through its own growth.
 *
 * Not the same moment as the reveal, which is only when the *first* dot's
 * verdict lands — and the panel's text was being hung off that, so "Wrong
 * Answer" and the failing case's values were on screen while the grid behind
 * them was still a field of grey dots rippling. The words arrived before the
 * thing they were describing, which makes the animation decorative: you have
 * already read the answer, so the dots are just something still moving.
 *
 * Half the settle rather than all of it, because the last of that growth is
 * already imperceptible and waiting it out only reads as lag.
 */
export const SETTLE_MS = FRONT_MS + REVEAL_MS * 0.5;

/**
 * The celebration: one last wave, and a big one.
 *
 * Three builds were wrong before this one. A layer of paper shapes thrown over
 * the panel is a thing the app drops on top of the result — the dots go on
 * sitting underneath it being a chart. Throwing the dots themselves was made of
 * the grid but pretended they were scraps of paper, and for a second and a half
 * the block stopped being legible, which is a strange thing to do to thirty-nine
 * facts at the moment they all come good. A ring from the centre was honest and
 * still slightly foreign: concentric is not a shape this grid uses anywhere
 * else, so it read as an effect applied to the dots rather than as the dots.
 *
 * The grid already has a motion of its own. It waves — a diagonal band that
 * crossed the block the whole time the suite was running, and that the verdicts
 * themselves came in on. So the celebration is that same wave, once more and
 * much larger: the dots swell rather than dip, the band is wide enough to lift a
 * third of the block at a time, and it crosses once and is gone. Nothing leaves
 * its cell and nothing changes shape, so the suite stays readable and clickable
 * all the way through.
 *
 * It reads as the wave finishing its sentence. The one during the run is small,
 * inward, and endless, which is what waiting looks like; this one is broad,
 * outward, and crosses exactly once, which is what arriving looks like.
 *
 * Each dot's swell is `sin(π·local)` — nought to one and back with zero slope at
 * both ends — so it leaves rest and returns to rest with no corner at either,
 * and multiplies straight onto the reveal's own scaling without anything having
 * to be cancelled. Same reason the wave is written here and not in CSS.
 */
const PULSE_MS = 1350;
/** A beat after a dot's colour lands, so the verdict registers before it moves. */
const PULSE_AFTER_MS = 240;
/** How much of the grid the swell occupies at once, as a fraction of its
 *  diagonal. Wide: a narrow band crossing a coarse grid is dots blinking in
 *  sequence, and what this wants to look like is the block breathing. */
const BAND = 0.7;
/** How far a dot swells at the crest, and how much the wave behind it is worth.
 *  A third bigger, not half again: at the size these dots are drawn, a swell you
 *  can measure is a swell that reads as a size change rather than as a breath,
 *  and the grid has to still look like the same grid while it happens. */
const PULSE_GROW = 0.3;
const ECHO = 0.34;
/** How far into the celebration the second, softer wave sets off. */
const LAG = 0.26;

/**
 * Where a dot sits along the wave, 0 at the near corner and 1 at the far one.
 *
 * The travel is the grid's leading diagonal — the same sweep the app's loaders
 * use — and it is normalised against the diagonal that is actually on screen.
 * A suite of three draws one row of three, whose diagonal is two steps long, so
 * the wave crosses those three dots; it used to be divided by the nominal column
 * count instead, which for three dots meant the wave covered a quarter of its
 * travel and all three pulsed as one. Whatever the count, the far dot is at the
 * far end of the wave.
 */
export function phaseFor(count: number, across: number) {
  const step = (index: number) => Math.floor(index / across) + (index % across);
  /* Measured over the cells that exist, not over the rectangle they sit in. A
     suite whose last row is short has no bottom-right corner, and normalising
     against one the grid does not draw leaves the wave stopping a little before
     the end of the block — a small thing, and exactly the kind of small thing
     that is invisible at forty cases and obvious at four. */
  let diagonal = 0;
  for (let index = 0; index < count; index += 1) diagonal = Math.max(diagonal, step(index));
  return (index: number) => (diagonal > 0 ? (SPREAD * step(index)) / diagonal : 0);
}

const TONE: Record<CaseStatus, string> = {
  passed: "bg-[var(--success)]",
  failed: "bg-destructive",
  skipped: "bg-muted-foreground/35",
  /* A case the harness declared and did not run. Drawn like a skip: the learner
     is owed the same answer either way — this one has no verdict. */
  todo: "bg-muted-foreground/35",
};

/**
 * One case, memoised on its own values.
 *
 * Two hundred dots reconciled on every render of a panel whose terminal is
 * streaming is two hundred elements walked several times a second to conclude
 * that nothing about them changed. Every prop here is a primitive or a stable
 * callback, so a dot re-renders when its own verdict lands and at no other time
 * — and the wave never renders it at all, because the wave writes to the node.
 */
const Dot = memo(function Dot({
  id,
  index,
  ordinal,
  status,
  selected,
  revealed,
  delay,
  pitch,
  dot,
  register,
  onSelect,
}: {
  id: string;
  index: number;
  ordinal: number;
  status: CaseStatus | undefined;
  selected: boolean;
  revealed: boolean;
  /** How far behind the reveal this dot's colour is, in ms — the same offset the
   *  wave gives it, so the crossfade travels with the growth rather than under
   *  it. Zero on the way back to grey: a new run should not have to wait out a
   *  ripple before it looks like it has started. */
  delay: number;
  pitch: number;
  dot: number;
  register(index: number, node: HTMLSpanElement | null): void;
  onSelect?: ((id: string) => void) | undefined;
}) {
  /* The verdict this dot is *drawing*, which is not the same as the verdict it
     has. Until the reveal, it has none as far as the grid is concerned: grey,
     waving, like every other. */
  const shown = revealed ? status : undefined;
  const pending = !shown;
  return (
    <button
      aria-label={`Case ${ordinal}${shown ? `, ${shown}` : ""}`}
      aria-selected={onSelect ? selected : undefined}
      className="grid shrink-0 cursor-default place-items-center"
      disabled={!onSelect}
      onClick={onSelect ? () => onSelect(id) : undefined}
      role={onSelect ? "tab" : undefined}
      style={{ width: pitch, height: pitch }}
      title={`Case ${ordinal}`}
      type="button"
    >
      <span
        className={cn(
          /* Colour and halo only. Size and opacity belong to the wave, which
             writes them straight onto this node — see `useWave`. */
          "case-dot col-start-1 row-start-1 rounded-full",
          /* A case the reveal reached and found no verdict on — declared and
             never run — is neither grey-waiting nor a verdict. It is the border
             colour: present, and empty. */
          shown ? TONE[shown] : revealed ? "bg-border" : "bg-muted-foreground/60",
        )}
        ref={(node) => register(index, node)}
        style={{
          width: dot,
          height: dot,
          transitionDelay: revealed ? `${delay}ms` : "0ms",
          /* Halo and selection ring are one shadow rather than two ring
             utilities: they land on the same property, and which of two
             equal-specificity classes wins is a fact about the stylesheet rather
             than about the order they were written in here. A failure is haloed
             in its own colour whether or not it is selected — the one dot that
             matters has to be findable in a field of two hundred without first
             being told where to look. */
          boxShadow: pending
            ? undefined
            : selected
              ? `0 0 0 2px var(--color-background-surface-under), 0 0 0 3.5px ${shown === "failed" ? "var(--destructive)" : "var(--border-strong)"}`
              : shown === "failed"
                ? "0 0 0 3px color-mix(in oklab, var(--destructive) 22%, transparent)"
                : undefined,
        }}
      />
    </button>
  );
});

/** Whether this machine has asked not to be animated at. Read once, at the
 *  moment a grid starts: a preference that flips mid-wave is not worth a
 *  listener, and the next run will pick it up. */
function motionOff(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * How much one dot is swelled by the final wave, at a moment of it.
 *
 * Along the same diagonal the running wave travels and the verdicts arrive on —
 * `row + column`, normalised so the far corner is 1 — which is what makes this
 * read as the same wave rather than as a new one. Normalised, so the band takes
 * the same time to cross a suite of five as a suite of two hundred: the
 * celebration is one length, not a function of how many cases the challenge
 * happens to have.
 *
 * The front has to travel a band-width *past* the far corner, not to it: a dot
 * is only crossed once the whole front has gone by, so a front that stops at 1
 * leaves the last diagonal untouched and the wave dies short of the edge of its
 * own grid. It runs from 0 to `1 + width`, which is also what makes both ends
 * exact — at `unit` 0 and 1 every dot is at rest, so the celebration begins and
 * ends on the grid as drawn rather than snapping back from wherever it had got
 * to.
 */
export function pulseFor(count: number, across: number) {
  const step = (index: number) => Math.floor(index / across) + (index % across);
  let diagonal = 0;
  for (let index = 0; index < count; index += 1) diagonal = Math.max(diagonal, step(index));

  /* One band's contribution at a distance along the diagonal: `local` is where
     the dot sits inside the front, and outside [0, 1] the band has not reached
     it or has already gone by. */
  const crest = (front: number, distance: number, width: number) => {
    const local = (front - distance) / width;
    return local > 0 && local < 1 ? Math.sin(Math.PI * local) : 0;
  };

  const wide = BAND * 1.5;
  return (index: number, unit: number) => {
    const distance = diagonal > 0 ? step(index) / diagonal : 0;
    const lead = crest(unit * (1 + BAND), distance, BAND);
    /* The second wave's own clock, started late and still finishing on time — so
       it trails the first the whole way and settles with it rather than being
       cut off mid-swell at the end. */
    const after = Math.max(0, (unit - LAG) / (1 - LAG));
    return PULSE_GROW * lead + PULSE_GROW * ECHO * crest(after * (1 + wide), distance, wide);
  };
}

/**
 * The wave, a frame at a time, written straight to the dots.
 *
 * There is no CSS here and the reason is the only interesting thing about this
 * function. A dot's size has to be able to *leave* the wave from wherever the
 * wave has it — a dot caught at the bottom of the dip and a dot caught at rest
 * are at different sizes, and both have to arrive at full size smoothly. No CSS
 * animation can do that, and the three attempts that tried all broke the same
 * way: an animation's contribution to a property is not something a transition
 * can pick up from, so the moment you take the keyframes off — or flatten them
 * through a `var()` they sample once rather than every frame — the dot snaps to
 * whatever it is worth without them. That snap is the pop.
 *
 * Driven from here, size is simply a continuous function of the clock, and the
 * reveal is a second continuous function multiplied into it: each dot's dip is
 * measured at the instant its verdict lands and eased to zero from exactly
 * there. Nothing is ever cancelled, so there is nothing to snap. The loop stops
 * itself once every dot is at rest, and it never touches React — two hundred
 * dots are two hundred style writes on nodes the reconciler is not looking at.
 */
function useWave(
  count: number,
  across: number,
  running: boolean,
  onReveal: (revealed: boolean) => void,
  onSettle: (settled: boolean) => void,
  celebrate: boolean,
) {
  const nodes = useRef<Array<HTMLSpanElement | null>>([]);
  const register = useRef((index: number, node: HTMLSpanElement | null) => {
    nodes.current[index] = node;
  }).current;
  /* The clock outlives the effect. A hidden suite has no declared size, so its
     grid grows a dot at a time as results stream in — and every one of those
     restarts this effect. Reading the start time from a ref means the wave keeps
     its place across them: the block gets taller mid-ripple rather than jumping
     back to a flat grid each time a case reports. */
  const started = useRef(0);
  const revealAt = useRef(Number.POSITIVE_INFINITY);
  const wasRunning = useRef(false);

  useEffect(() => {
    const dots = nodes.current;
    const rest = (node: HTMLSpanElement | null) => {
      if (!node) return;
      node.style.transform = "";
      node.style.opacity = "";
    };
    if (motionOff()) {
      for (const node of dots) rest(node);
      onReveal(!running);
      onSettle(!running);
      return;
    }

    const now = performance.now();
    /* A new run restarts the clock; the same run re-running this effect does
       not. The grid outlives both — press Run twice and it is one component
       throughout — so "when did the wave start" cannot be "when did this effect
       last run", or the second attempt would inherit the first one's long-spent
       hold and reveal without ever waving. */
    if (running && !wasRunning.current) {
      started.current = now;
      revealAt.current = Number.POSITIVE_INFINITY;
    }
    wasRunning.current = running;
    if (!started.current) started.current = now;
    /* A run reveals when it ends and this effect re-runs with `running` false;
       a grid that was never running — a result read back — reveals on the hold
       alone. Set once, so a grid that grows after its reveal was scheduled keeps
       the schedule.

       Measured from when the wave started, not from when the run ended.

       This is the difference between an animation and a progress indicator, and
       it was the bug: the hold was counted from the results arriving, so the
       suite ran, the verdicts came back, and *then* the grid made you watch
       eight hundred milliseconds of grey before admitting it already knew. A run
       that takes longer than the hold has already paid it — the wave was the
       wait — so it reveals on the frame the results land. The floor only ever
       bites on a suite that finishes faster than you can see. */
    if (!running && !Number.isFinite(revealAt.current)) {
      revealAt.current = Math.max(now, started.current + REVEAL_HOLD_MS);
    }

    const begin = started.current;
    const reveal = revealAt.current;
    /* Already revealed, and restarting for some other reason. Do not send the
       grid back to grey to watch it come in again. */
    /* Say it, rather than assume it has been said.

       This read `announced = now >= reveal` and told React nothing when that was
       true — which, once the hold started counting from the start of the wave
       instead of the end of the run, is every run longer than eight hundred
       milliseconds. The reveal moment was already in the past the moment the
       effect ran, so the loop had nothing left to announce and the grid sat grey
       over a finished suite. `announced` tracks whether the *caller* knows, so
       the only safe way to set it is by telling them. */
    let announced = now >= reveal;
    onReveal(announced);
    /* Same rule as the reveal, one beat later: say it rather than assume it has
       been said, or a run long enough to have already passed the mark leaves the
       panel waiting on an announcement that was never made. */
    let settled = now >= reveal + SETTLE_MS;
    onSettle(settled);

    const phase = phaseFor(count, across);
    const swellOf = pulseFor(count, across);

    /* The dip at a moment, 0 at rest and 1 at the bottom. A raised cosine, so
       the dot eases through both ends instead of cornering at them. */
    const dipAt = (elapsed: number, index: number) =>
      0.5 * (1 - Math.cos(2 * Math.PI * (elapsed / RUN_MS + phase(index))));

    let frame = 0;
    const tick = (now: number) => {
      if (!announced && now >= reveal) {
        announced = true;
        onReveal(true);
      }
      if (!settled && now >= reveal + SETTLE_MS) {
        settled = true;
        onSettle(true);
      }
      let moving = false;
      for (let index = 0; index < count; index += 1) {
        const node = dots[index];
        if (!node) continue;
        /* This dot's own moment, one ripple's travel behind the far end of the
           grid. Until it arrives the dot is simply in the wave, indistinguishable
           from the ones still waiting — which is the point: the verdicts come in
           as a front crossing the block, not as a grid changing state. */
        const releasedAt = reveal + revealDelay(phase(index));
        const settling = (now - releasedAt) / REVEAL_MS;
        if (settling < 1) moving = true;
        /* Frozen at its release: after it, the dot is expanding out of the dip it
           was in at that instant rather than chasing a wave that has moved on, so
           the growth is one unbroken push from whatever size the wave had it to
           full size. That is the whole reason this loop exists. */
        const held = dipAt(Math.min(now, releasedAt) - begin, index);
        const dip = settling > 0 ? (1 - easeOut(Math.min(1, settling))) * held : held;
        /* The throw rides on top of the reveal: same dot, same frame, one
           transform. The dip is still shrinking this dot while it is already in
           the air, which is what makes the launch continuous with the wave that
           delivered it rather than a second animation starting. */
        const beat = celebrate ? (now - (reveal + PULSE_AFTER_MS)) / PULSE_MS : 1;
        const pulsing = beat > 0 && beat < 1;
        if (pulsing) moving = true;
        const swell = pulsing ? swellOf(index, beat) : 0;
        if (dip < 0.002 && swell < 0.002) rest(node);
        else {
          /* One transform, both effects. The dip is still easing this dot out of
             the wave while the ring is already crossing it — multiplied rather
             than sequenced, so the celebration does not have to wait for the
             reveal to be over and neither of them has to be cancelled. */
          node.style.transform = `scale(${((1 - DIP_SCALE * dip) * (1 + swell)).toFixed(4)})`;
          node.style.opacity = `${(1 - DIP_FADE * dip).toFixed(4)}`;
        }
      }
      if (!announced || !settled || moving) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [count, across, running, onReveal, onSettle, celebrate]);

  return register;
}

export function CaseDots({
  cases,
  activeId,
  onSelect,
  running = false,
  columns,
  className,
  celebrate = false,
  onSettled,
}: {
  cases: CaseDot[];
  /** The dot wearing the selection ring. Empty when nothing is selected — which
   *  is the Accepted case, where there is no failure to be looking at. */
  activeId?: string | undefined;
  onSelect?: ((id: string) => void) | undefined;
  /** The suite is in flight. Every dot is grey and waving for as long as it is —
   *  including cases that have already reported.
   *
   *  The dots used to turn over one at a time as cases reported, which sounds
   *  like more information and is worse to watch: results arrive in bursts a few
   *  milliseconds apart and cases do not run in the order they are numbered, so
   *  the grid speckled red and green in a sequence that meant nothing, and the
   *  suite was half-coloured before you had finished reading that it was
   *  running. Grey throughout says one true thing — *this is running* — and then
   *  the verdicts land as one answer. */
  running?: boolean;
  /** Dots per row. Defaults to the square — see `columnsFor`. */
  columns?: number | undefined;
  className?: string;
  /** Fires when the grid has finished delivering the verdicts — see `SETTLE_MS`.
   *  Anything that says the result in words waits for this, so the words land
   *  after the dots have said it rather than over them. */
  onSettled?: ((settled: boolean) => void) | undefined;
  /** Every case passed. The grid takes one last, large wave — see `pulseFor`. Set it on the verdict, not on the run: it starts from the
   *  reveal, so the ring follows the verdicts across rather than racing them. */
  celebrate?: boolean;
}) {
  const pitch = pitchFor(cases.length);
  const across = columns ?? columnsFor(cases.length);
  const dot = Math.max(4, Math.round(pitch * 0.44));
  /* The same offsets the wave uses, handed to CSS so the colour crossfades on
     the dot's own schedule instead of the grid's. */
  const delays = useMemo(() => {
    const phase = phaseFor(cases.length, across);
    return cases.map((_, index) => revealDelay(phase(index)));
  }, [cases, across]);

  const [revealed, setRevealed] = useState(false);
  /* Stable, so the wave's effect is not torn down and restarted by a render of
     the panel around it — the callback itself is read through a ref for the same
     reason, since the panel passes a new one whenever its own state moves. */
  const onReveal = useRef(setRevealed).current;
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const onSettle = useRef((value: boolean) => settled.current?.(value)).current;
  const register = useWave(cases.length, across, running, onReveal, onSettle, celebrate);

  return (
    <div
      className={cn("flex flex-wrap", className)}
      /* The width is what makes the rows break where they should. A grid narrower
         than its container wraps at the column count; one wider than the panel
         wraps at the panel, which is the right answer too — the block stays a
         block and simply gets taller. */
      style={{ maxWidth: across * pitch }}
      role={onSelect ? "tablist" : undefined}
      /* Busy until the verdicts are actually on screen, which is a little past
         the end of the run — the hold is part of the wait, not part of the
         answer. */
      {...(revealed ? {} : { "aria-busy": true })}
    >
      {cases.map((item, index) => (
        <Dot
          delay={delays[index] ?? 0}
          dot={dot}
          id={item.id}
          index={index}
          key={item.ordinal}
          onSelect={onSelect}
          ordinal={item.ordinal}
          pitch={pitch}
          register={register}
          revealed={revealed}
          selected={Boolean(activeId) && item.id === activeId}
          status={item.status}
        />
      ))}
    </div>
  );
}

/**
 * A grid of cases with no verdicts on them: the suite as it looks while it runs,
 * and — with `from` — the tail of a suite that was stopped before it got there.
 */
export function blankCases(count: number, from = 0): CaseDot[] {
  return Array.from({ length: Math.max(0, count - from) }, (_, index) => ({
    id: `case-${from + index}`,
    ordinal: from + index + 1,
  }));
}
