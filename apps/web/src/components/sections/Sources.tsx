import { Dots } from "@/components/Dots";
import { markDots, markRadius } from "@/components/Mark";
import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";
import { PROVIDER_PATHS, ProviderGlyph, type ProviderId } from "@/components/icons";

type Source = {
  id: ProviderId;
  name: string;
  /** What it is actually good for, in the app's own terms. */
  note: string;
  /** Connected today, or listed in the app as planned. */
  live: boolean;
};

const SOURCES: readonly Source[] = [
  { id: "leetcode", name: "LeetCode", note: "Submit and run, both on their judge", live: true },
  { id: "codeforces", name: "Codeforces", note: "Submit to their judge; examples run here", live: true },
  { id: "hackerrank", name: "HackerRank", note: "Shown in the app as planned", live: false },
];

const PRODUCED = [
  {
    title: "Your attempt",
    /** Fits inside the tile at 9.5px mono; `long` is for the stacked layout. */
    note: "graded by the tests",
    long: "Graded by the tests, never by the agent",
  },
  {
    title: "Attempt history",
    note: "every run kept",
    long: "Every run kept, nothing thrown away",
  },
];

/* The geometry, in one place, because the wires have to land on the tiles
   exactly. Every path below is derived from these — there are no typed-in
   coordinates left to drift out of step with a tile that moved. */
const IN = { x: 24, w: 214, h: 74, ys: [100, 198, 296] } as const;
const CORE = { x: 424, y: 122, w: 158, h: 150 } as const;
const OUT = { x: 764, w: 212, h: 74, ys: [140, 268] } as const;
/** The centre line every wire meets the agent on. */
const AXIS = 198;

const CORE_MID = CORE.x + CORE.w / 2;
const IN_EDGE = IN.x + IN.w;
const CORE_EDGE = CORE.x + CORE.w;

/** A source's wire, curving in to meet the agent on the centre line. */
function wireIn(cy: number) {
  const mid = (IN_EDGE + CORE.x) / 2;
  return `M${IN_EDGE},${cy} C${mid},${cy} ${mid},${AXIS} ${CORE.x},${AXIS}`;
}

/** The agent's wire, fanning back out to what the turn produced. */
function wireOut(cy: number) {
  const mid = (CORE_EDGE + OUT.x) / 2;
  return `M${CORE_EDGE},${AXIS} C${mid},${AXIS} ${mid},${cy} ${OUT.x},${cy}`;
}

/** History, back round to the next target. Rounded corners, not mitred ones. */
const LOOP_Y = 392;
const LOOP_X = OUT.x + OUT.w / 2;
const LOOP = [
  `M${LOOP_X},${OUT.ys[1]! + OUT.h / 2}`,
  `L${LOOP_X},${LOOP_Y - 14}`,
  `Q${LOOP_X},${LOOP_Y} ${LOOP_X - 14},${LOOP_Y}`,
  `L${CORE_MID + 14},${LOOP_Y}`,
  `Q${CORE_MID},${LOOP_Y} ${CORE_MID},${LOOP_Y - 14}`,
  `L${CORE_MID},${CORE.y + CORE.h}`,
].join(" ");

/** The loop's label sits on the middle of the horizontal run it interrupts. */
const LABEL_X = (CORE_MID + LOOP_X) / 2;
const LABEL_W = 232;

/**
 * Where a challenge comes from, and where it ends up.
 *
 * Drawn as one SVG rather than tiles with an overlay: the wires have to land
 * exactly on the edge of each tile, and any layout that measures the boxes and
 * the wires separately drifts apart the moment the column resizes.
 *
 * The loop underneath is the point of the diagram. A left-to-right pipe would
 * say Spar fetches problems from somewhere and hands them to you, which is what
 * every other practice site does. What it actually does is read what your
 * attempt proved and let that set the next target — so the last wire goes back
 * to where the first one started.
 */
export function Sources() {
  return (
    <Section id="sources" bloom="bl">
      <SectionHead
        index="05"
        label="Where problems come from"
        title="The right problem might already exist."
        lede="Connect LeetCode and Codeforces and Spar can set you real problems from them — chosen against your ability map instead of browsed by you, and opened in the Spar workspace so the attempt lands in the same history as everything else."
      />

      {/* Below `sm` the diagram would be 1000 units wide in a 340px column,
          which puts its labels at about five pixels. The same flow, stacked. */}
      <div className="mt-12 sm:hidden">
        <p className="font-mono text-[10px] tracking-[0.2em] text-ghost uppercase">Sources</p>
        <div className="mt-3 grid gap-2">
          {SOURCES.map((source) => (
            <div
              key={source.id}
              className={`flex items-center gap-3.5 rounded-xl border border-line bg-surface px-4 py-3.5 ${
                source.live ? "" : "opacity-45"
              }`}
            >
              <ProviderGlyph id={source.id} className="size-[18px] shrink-0" />
              <span className="min-w-0">
                <span className="block text-[0.92rem] leading-tight">{source.name}</span>
                <span className="mt-0.5 block text-[0.78rem] text-faint">{source.note}</span>
              </span>
            </div>
          ))}
        </div>

        <p className="my-4 text-center font-mono text-[10px] tracking-[0.16em] text-ghost">
          ↓ searched first, every turn
        </p>

        <div className="rounded-xl border border-line-strong bg-white/[0.05] px-4 py-4 text-center">
          <p className="text-[0.95rem]">Spar picks the target</p>
          <p className="mt-1 text-[0.78rem] text-faint">Assign what it found, or write one for you</p>
        </div>

        <p className="my-4 text-center font-mono text-[10px] tracking-[0.16em] text-ghost">↓</p>

        <div className="grid gap-2">
          {PRODUCED.map((item) => (
            <div key={item.title} className="rounded-xl border border-line bg-surface px-4 py-3.5">
              <p className="text-[0.92rem] leading-tight">{item.title}</p>
              <p className="mt-0.5 text-[0.78rem] text-faint">{item.long}</p>
            </div>
          ))}
        </div>

        <p className="mt-5 text-center font-mono text-[10px] tracking-[0.14em] text-faint">
          ↺ what you prove sets the next target
        </p>
      </div>

      <Reveal delay={90} className="mt-14 hidden sm:block">
        <div className="card relative isolate overflow-hidden p-4 sm:p-6">
          <Dots variant="panel" alpha={0.13} />
          <svg
            viewBox="0 0 1000 430"
            className="h-auto w-full"
            role="img"
            aria-label="LeetCode and Codeforces feed problems to Spar, which searches them before writing its own. What it sets becomes your attempt, graded by the tests, and lands in one attempt history — which sets the next target. HackerRank is planned."
          >
            <defs>
              {/* The head is bright and the tail falls away, so the dash reads as
                  something travelling rather than as a moving stripe. */}
              <linearGradient id="beam-head" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="60%" stopColor="#00e5ff" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0.95" />
              </linearGradient>
              <radialGradient id="core-glow">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.11" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </radialGradient>
            </defs>

            <text x={IN.x} y={40} className="fill-ghost font-mono text-[10px] tracking-[0.2em]">
              SOURCES
            </text>
            <text x={CORE.x} y={40} className="fill-ghost font-mono text-[10px] tracking-[0.2em]">
              THE AGENT
            </text>
            <text x={OUT.x} y={40} className="fill-ghost font-mono text-[10px] tracking-[0.2em]">
              YOUR EVIDENCE
            </text>

            {/* Wires first, so every tile sits on top of the line it ends. */}
            <g fill="none">
              {SOURCES.map((source, index) => (
                <path
                  key={source.id}
                  d={wireIn(IN.ys[index]!)}
                  className="stroke-line"
                  strokeWidth={1}
                  opacity={source.live ? 1 : 0.5}
                />
              ))}
              {OUT.ys.map((cy) => (
                <path key={cy} d={wireOut(cy)} className="stroke-line" strokeWidth={1} />
              ))}
              <path d={LOOP} className="stroke-line" strokeWidth={1} strokeDasharray="3 5" />

              {/* The pulses. Every beam declares pathLength, so one animation
                  drives wires of four different lengths at the same apparent
                  speed — and, more to the point, actually crosses all of them.
                  In user units a 26-long dash on a 210-long path is only on
                  screen for the last few percent of its travel, which is why
                  this used to look like only LeetCode was connected. */}
              {SOURCES.map((source, index) =>
                source.live ? (
                  <path
                    key={source.id}
                    d={wireIn(IN.ys[index]!)}
                    pathLength={100}
                    className="beam"
                    stroke="url(#beam-head)"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    style={{ animationDelay: `${index * 1.15}s` }}
                  />
                ) : null,
              )}
              {OUT.ys.map((cy, index) => (
                <path
                  key={cy}
                  d={wireOut(cy)}
                  pathLength={100}
                  className="beam"
                  stroke="url(#beam-head)"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  style={{ animationDelay: `${1.7 + index * 0.5}s` }}
                />
              ))}
              <path
                d={LOOP}
                pathLength={100}
                className="beam"
                stroke="url(#beam-head)"
                strokeWidth={1.6}
                strokeLinecap="round"
                style={{ animationDelay: "2.9s" }}
              />
            </g>

            {SOURCES.map((source, index) => {
              const cy = IN.ys[index]!;
              return (
                <g key={source.id} className="group" opacity={source.live ? 1 : 0.42}>
                  <rect
                    x={IN.x}
                    y={cy - IN.h / 2}
                    width={IN.w}
                    height={IN.h}
                    rx={16}
                    strokeWidth={1}
                    className="fill-surface stroke-line transition-colors duration-300 group-hover:stroke-line-strong"
                  />
                  <g transform={`translate(${IN.x + 22} ${cy - 11}) scale(0.92)`} className="fill-paper">
                    <path d={PROVIDER_PATHS[source.id]} />
                  </g>
                  <text x={IN.x + 58} y={cy - 3} className="fill-paper font-sans text-[14px]">
                    {source.name}
                  </text>
                  <text x={IN.x + 58} y={cy + 15} className="fill-faint font-mono text-[9.5px]">
                    {source.live ? "connected" : "planned"}
                  </text>
                </g>
              );
            })}

            {/* The agent. */}
            <circle cx={CORE_MID} cy={AXIS} r={150} fill="url(#core-glow)" />
            <rect
              x={CORE.x}
              y={CORE.y}
              width={CORE.w}
              height={CORE.h}
              rx={24}
              strokeWidth={1}
              className="fill-surface-2 stroke-line-strong"
            />
            <g transform={`translate(${CORE_MID - 27} ${CORE.y + 26}) scale(0.54)`}>
              {markDots.map((dot) => (
                <circle
                  key={dot.key}
                  cx={dot.cx}
                  cy={dot.cy}
                  r={markRadius * dot.rest}
                  className="fill-paper"
                  opacity={dot.tone}
                />
              ))}
            </g>
            <text
              x={CORE_MID}
              y={CORE.y + 110}
              textAnchor="middle"
              className="fill-paper font-display text-[17px]"
            >
              Spar
            </text>
            <text
              x={CORE_MID}
              y={CORE.y + 130}
              textAnchor="middle"
              className="fill-faint font-mono text-[9px] tracking-[0.06em]"
            >
              searches, then writes
            </text>

            {PRODUCED.map((item, index) => {
              const cy = OUT.ys[index]!;
              return (
                <g key={item.title}>
                  <rect
                    x={OUT.x}
                    y={cy - OUT.h / 2}
                    width={OUT.w}
                    height={OUT.h}
                    rx={16}
                    strokeWidth={1}
                    className="fill-surface stroke-line"
                  />
                  <text x={OUT.x + 22} y={cy - 3} className="fill-paper font-sans text-[14px]">
                    {item.title}
                  </text>
                  <text x={OUT.x + 22} y={cy + 15} className="fill-faint font-mono text-[9.5px]">
                    {item.note}
                  </text>
                </g>
              );
            })}

            {/* The loop's label, in a gap punched out of the dashed line —
                centred on the run it interrupts, and only as wide as it needs
                to be, or the knockout reaches past the loop's own corner. */}
            <rect
              x={LABEL_X - LABEL_W / 2}
              y={LOOP_Y - 11}
              width={LABEL_W}
              height={22}
              className="fill-ink"
            />
            <text
              x={LABEL_X}
              y={LOOP_Y + 4}
              textAnchor="middle"
              className="fill-faint font-mono text-[10px] tracking-[0.04em]"
            >
              what you prove sets the next target
            </text>
          </svg>
        </div>
      </Reveal>

      <div className="mt-12 grid gap-10 md:grid-cols-3">
        <Reveal>
          <h3 className="text-[1.15rem] leading-snug">Recommended, not browsed.</h3>
          <p className="mt-3.5 text-[0.93rem] leading-relaxed text-muted">
            Instead of picking from hundreds of questions yourself, the problem is matched to your current
            abilities, your solved history, the concepts that need strengthening, the difficulty you should be
            at, and whatever Spar is trying to improve right now.
          </p>
        </Reveal>
        <Reveal delay={90}>
          <h3 className="text-[1.15rem] leading-snug">Solved without leaving Spar.</h3>
          <p className="mt-3.5 text-[0.93rem] leading-relaxed text-muted">
            A selected problem opens in the workspace: read it, write it, run it, work through the failures,
            submit. The verdict is the judge&rsquo;s and it lands on your account there — but the attempt stays
            here, as evidence, instead of being an event nothing learned from.
          </p>
        </Reveal>
        <Reveal delay={180}>
          <h3 className="text-[1.15rem] leading-snug">You sign in on their page.</h3>
          <p className="mt-3.5 text-[0.93rem] leading-relaxed text-muted">
            Spar never sees your password. Not connected is fine too — you just get generated challenges, and
            Spar says which is happening rather than blurring it.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}
