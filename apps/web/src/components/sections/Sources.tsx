import { markDots, markRadius } from "@/components/Mark";
import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";
import { PROVIDER_PATHS, ProviderGlyph, type ProviderId } from "@/components/icons";

type Source = {
  id: ProviderId;
  name: string;
  /** Vertical centre of its tile, in the diagram's own coordinates. */
  cy: number;
  /** Connected today, or listed in the app as planned. */
  live: boolean;
  note: string;
};

const SOURCES: readonly Source[] = [
  { id: "leetcode", name: "LeetCode", cy: 89, live: true, note: "Judged there. Run there too." },
  { id: "codeforces", name: "Codeforces", cy: 190, live: true, note: "Judged there." },
  { id: "hackerrank", name: "HackerRank", cy: 291, live: false, note: "Planned." },
];

/** Tile geometry, shared by the rects and the beams that meet them. */
const TILE = { x: 20, w: 200, h: 74 };
const CORE = { x: 430, y: 125, w: 150, h: 130 };
const LEDGER = { x: 800, w: 180, h: 74, cy: 190 };

function beam(cy: number) {
  const from = TILE.x + TILE.w;
  const to = CORE.x;
  const mid = (from + to) / 2;
  return `M${from},${cy} C${mid},${cy} ${mid},190 ${to},190`;
}

/**
 * Where Spar's own challenges and other people's problems meet.
 *
 * Drawn as one SVG rather than positioned tiles with an overlay: the beams have
 * to land exactly on the edge of each tile, and any layout where the wires and
 * the boxes are measured separately drifts apart the moment the column resizes.
 */
export function Sources() {
  return (
    <Section>
      <SectionHead
        index="05"
        label="Practice sources"
        title="Spar writes most of your challenges. It does not have to write all of them."
        lede="Connect LeetCode or Codeforces and real problems arrive against the same target, in the same ledger, in the same history."
      />

      {/* Below `sm` the diagram would be 340px wide, which puts its labels at
          about five pixels. The same three facts, as rows. */}
      <div className="mt-12 grid gap-3 sm:hidden">
        {SOURCES.map((source) => (
          <div
            key={source.id}
            className="flex items-center gap-4 rounded-xl border border-line bg-surface px-5 py-4"
            style={source.live ? undefined : { opacity: 0.5 }}
          >
            <ProviderGlyph id={source.id} className="size-5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-[0.95rem] leading-tight">{source.name}</span>
              <span className="mt-1 block font-mono text-[10px] tracking-[0.14em] text-ghost uppercase">
                {source.live ? "connected" : "planned"}
              </span>
            </span>
            <span className="shrink-0 text-[0.8rem] text-faint">{source.note}</span>
          </div>
        ))}
      </div>

      <Reveal delay={90} className="mt-14 hidden sm:block">
        <div className="card overflow-hidden p-4 sm:p-8">
          <svg
            viewBox="0 0 1000 380"
            className="h-auto w-full"
            role="img"
            aria-label="LeetCode and Codeforces feed problems into Spar, which files what you prove into one ability ledger. HackerRank is planned."
          >
            <defs>
              {/* The beam's head is bright and its tail falls away, so the dash
                  reads as something travelling rather than a moving stripe. */}
              <linearGradient id="beam-head" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#fff" stopOpacity="0" />
                <stop offset="55%" stopColor="#00e5ff" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#fff" stopOpacity="0.95" />
              </linearGradient>
            </defs>

            {SOURCES.map((source, index) => {
              const cy = source.cy;
              return (
                <g key={source.id} opacity={source.live ? 1 : 0.42}>
                  <rect
                    x={TILE.x}
                    y={cy - TILE.h / 2}
                    width={TILE.w}
                    height={TILE.h}
                    rx={16}
                    className="fill-white/[0.03] stroke-line"
                    strokeWidth={1}
                  />
                  <g transform={`translate(46 ${cy - 12}) scale(1)`} className="fill-paper">
                    <path d={PROVIDER_PATHS[source.id]} transform="scale(1)" />
                  </g>
                  <text x={84} y={cy - 1} className="fill-paper font-sans text-[15px]">
                    {source.name}
                  </text>
                  <text x={84} y={cy + 17} className="fill-faint font-mono text-[10.5px]">
                    {source.live ? "connected" : "planned"}
                  </text>

                  {/* The wire, and the pulse that runs down it. */}
                  <path d={beam(cy)} className="stroke-line" strokeWidth={1} fill="none" />
                  {source.live ? (
                    <path
                      d={beam(cy)}
                      className="beam"
                      stroke="url(#beam-head)"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      fill="none"
                      style={{ animationDelay: `${index * 1.15}s` }}
                    />
                  ) : null}
                </g>
              );
            })}

            {/* Spar itself. */}
            <rect
              x={CORE.x}
              y={CORE.y}
              width={CORE.w}
              height={CORE.h}
              rx={22}
              className="fill-white/[0.05] stroke-line-strong"
              strokeWidth={1}
            />
            <g transform={`translate(${CORE.x + CORE.w / 2 - 26} ${CORE.y + 26}) scale(0.52)`}>
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
              x={CORE.x + CORE.w / 2}
              y={CORE.y + CORE.h - 24}
              textAnchor="middle"
              className="fill-paper font-display text-[17px]"
            >
              Spar
            </text>

            {/* And out the other side. */}
            <path
              d={`M${CORE.x + CORE.w},190 L${LEDGER.x},190`}
              className="stroke-line"
              strokeWidth={1}
              fill="none"
            />
            <path
              d={`M${CORE.x + CORE.w},190 L${LEDGER.x},190`}
              className="beam"
              stroke="url(#beam-head)"
              strokeWidth={1.6}
              strokeLinecap="round"
              fill="none"
              style={{ animationDelay: "0.6s" }}
            />
            <rect
              x={LEDGER.x}
              y={LEDGER.cy - LEDGER.h / 2}
              width={LEDGER.w}
              height={LEDGER.h}
              rx={16}
              className="fill-white/[0.03] stroke-line"
              strokeWidth={1}
            />
            <text x={LEDGER.x + 24} y={LEDGER.cy - 1} className="fill-paper font-sans text-[15px]">
              One ledger
            </text>
            <text x={LEDGER.x + 24} y={LEDGER.cy + 17} className="fill-faint font-mono text-[10.5px]">
              same evidence
            </text>
          </svg>
        </div>
      </Reveal>

      <div className="mt-12 grid gap-10 md:grid-cols-3">
        <Reveal>
          <h3 className="text-[1.15rem] leading-snug">The agent is made to look.</h3>
          <p className="mt-3.5 text-[0.93rem] leading-relaxed text-muted">
            On any turn that sets a challenge it searches the source first, then either assigns what it found
            or writes its own. That is the controller, not a line in a prompt — it cannot skip the search.
          </p>
        </Reveal>
        <Reveal delay={90}>
          <h3 className="text-[1.15rem] leading-snug">Both directions are real.</h3>
          <p className="mt-3.5 text-[0.93rem] leading-relaxed text-muted">
            A sourced problem brings a difficulty other people calibrated. A written one brings something no
            library has. Spar prefers the real problem when it lands on the target — and won&rsquo;t hand you a
            contest problem to test an off-by-one.
          </p>
        </Reveal>
        <Reveal delay={180}>
          <h3 className="text-[1.15rem] leading-snug">You sign in on their page.</h3>
          <p className="mt-3.5 text-[0.93rem] leading-relaxed text-muted">
            Spar never sees your password. Not connected is fine too — and Spar says which is happening rather
            than blurring it.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}
