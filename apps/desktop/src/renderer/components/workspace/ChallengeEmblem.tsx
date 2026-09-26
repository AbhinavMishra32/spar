import { useId, useMemo, useState } from "react";
import type { ActiveQuestion } from "@spar/domain";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { makeGem, type Gem } from "@/lib/gem";
import { cn } from "@/lib/utils";
import { DIFFICULTY_LABEL } from "./Difficulty";

type Concept = { slug: string; parentSlug: string | null; title?: string; parentTitle?: string | null };
type EmblemQuestion = Pick<ActiveQuestion, "id" | "difficulty" | "ordinal"> & {
  concepts?: ReadonlyArray<Concept> | undefined;
  title?: string | undefined;
  lastOutcome?: "passed" | "failed" | "abandoned" | "replaced" | null | undefined;
};

function useGem(question: EmblemQuestion): Gem {
  const primary = question.concepts?.[0];
  const subject = primary ? primary.parentSlug ?? primary.slug : "";
  return useMemo(() => makeGem({ seed: question.id, difficulty: question.difficulty, subject, radius: 34 }), [question.id, question.difficulty, subject]);
}

/**
 * A challenge's gem: its own stone, generated from the challenge rather than
 * fetched, with its number on a tag under it.
 *
 * What the stone says — kind from difficulty, cut from topic, everything else
 * from the id — is decided in `lib/gem.ts`. This only draws it, flat: the body,
 * blurred flashes of colour clipped to the outline, a dome shade, one highlight
 * and a hairline rim. No photographic texture, so it sits in Spar's chrome the
 * way an icon does rather than like a pasted-in render.
 *
 * The number is HTML, not SVG text. It has to be readable at 40px beside a
 * title, and SVG text scales with the stone — at that size it came out five
 * pixels tall and white on a pale stone, which is how the old emblem lost it.
 * On a tag it keeps a real type size and the app's own ink on any stone.
 */
export function ChallengeEmblem({
  question,
  size = 56,
  className,
  animated = true,
  numbered = true,
  interactive = true,
}: {
  question: EmblemQuestion;
  size?: number;
  className?: string;
  animated?: boolean;
  /** Off where the number is already said beside the stone. */
  numbered?: boolean;
  /** Clicking opens the stone's card. Off where the stone is itself the card. */
  interactive?: boolean;
}) {
  const gem = useGem(question);
  const [open, setOpen] = useState(false);
  const art = <GemArt animated={animated} gem={gem} numbered={numbered} ordinal={question.ordinal} size={size} />;
  if (!interactive) return <span aria-hidden="true" className={cn("relative inline-block shrink-0 select-none", className)}>{art}</span>;
  return (
    <>
      {/* Its own hit target, above whatever row it sits in: a history card is one
          big button, and the stone should open the stone, not the challenge. */}
      <button
        aria-label={`${gem.name}, the stone for challenge ${question.ordinal}`}
        className={cn(
          "pointer-events-auto relative z-10 inline-block shrink-0 cursor-pointer select-none rounded-full outline-none transition-transform duration-200 hover:scale-[1.06] active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring/50",
          className,
        )}
        onClick={(event) => { event.stopPropagation(); setOpen(true); }}
        type="button"
      >
        {art}
      </button>
      <GemCard gem={gem} onOpenChange={setOpen} open={open} question={question} />
    </>
  );
}

/**
 * The stone, up close: what it is called and what made it look the way it
 * does. Every trait is a fact about the challenge, so the card is also the
 * legend for every stone in the app — read one and the rest are legible.
 */
function GemCard({ gem, open, onOpenChange, question }: { gem: Gem; open: boolean; onOpenChange(open: boolean): void; question: EmblemQuestion }) {
  const primary = question.concepts?.[0];
  const topic = primary ? primary.parentTitle ?? primary.title ?? null : null;
  const solved = question.lastOutcome === "passed";
  const tint = gem.flashes[0]?.color ?? gem.body;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[23rem]">
        {/* The stone's own light, faint, behind it — the only colour on the card. */}
        <div className="relative flex flex-col items-center px-6 pt-10 pb-6 text-center">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-56 opacity-[0.16]" style={{ background: `radial-gradient(60% 70% at 50% 35%, ${tint}, transparent)` }} />
          <GemArt animated gem={gem} numbered={false} ordinal={question.ordinal} size={168} />
          <DialogTitle className="mt-5 text-xl font-semibold tracking-[-0.02em]">{gem.name}</DialogTitle>
          <DialogDescription className="mt-1 max-w-[18rem] text-ui text-muted-foreground">
            Challenge {question.ordinal}{question.title ? ` · ${question.title}` : ""}
          </DialogDescription>
          <span className={cn("mt-3 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-ui-sm font-medium", solved ? "border-[var(--success)]/30 text-[var(--success)]" : "border-border text-muted-foreground")}>
            <span className={cn("size-1.5 rounded-full", solved ? "bg-[var(--success)]" : "bg-muted-foreground/50")} />
            {solved ? "Solved" : "Not solved yet"}
          </span>
        </div>
        <dl className="border-t border-border text-ui">
          <Trait label="Kind" value={gem.kind} why={`${DIFFICULTY_LABEL[question.difficulty]} challenge`} />
          <Trait label="Cut" value={capitalize(gem.cut)} why={topic ?? "No topic"} />
          <Trait label="Pattern" value="Its own" why="No other challenge has it" />
        </dl>
      </DialogContent>
    </Dialog>
  );
}

function Trait({ label, value, why }: { label: string; value: string; why: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-border/60 px-6 py-2.5 last:border-b-0">
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium text-foreground">{value}</dd>
      <dd className="min-w-0 truncate text-right text-muted-foreground">{why}</dd>
    </div>
  );
}

const capitalize = (value: string) => value.replace(/^\w/, (c) => c.toUpperCase());

function GemArt({ gem, size, numbered, animated, ordinal }: { gem: Gem; size: number; numbered: boolean; animated: boolean; ordinal: number }) {
  const uid = useId().replace(/:/g, "");
  /* The glow is for the large stone alone — on a 40px row it is a smudge. */
  const glow = size >= 96;
  const tag = Math.max(10, Math.round(size * 0.13));

  return (
    <span className="relative block" style={{ width: size, height: size }}>
      <svg className="block overflow-visible" height={size} viewBox="0 0 100 100" width={size}>
        <defs>
          <clipPath id={`gem-clip-${uid}`}>
            <path d={gem.path} />
          </clipPath>
          <filter height="200%" id={`gem-blur-${uid}`} width="200%" x="-50%" y="-50%">
            <feGaussianBlur stdDeviation={gem.blur} />
          </filter>
          {/* Shade toward the rim, lit from the top-left: the one cue that makes
              a flat outline read as a dome. */}
          <radialGradient cx="42%" cy="36%" id={`gem-dome-${uid}`} r="70%">
            <stop offset="45%" stopColor={gem.rim} stopOpacity="0" />
            <stop offset="100%" stopColor={gem.rim} stopOpacity={gem.tone === "dark" ? 0.85 : 0.6} />
          </radialGradient>
          <filter height="300%" id={`gem-soft-${uid}`} width="300%" x="-100%" y="-100%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
          {glow && (
            <radialGradient id={`gem-glow-${uid}`}>
              <stop offset="0%" stopColor={gem.flashes[0]?.color ?? gem.body} stopOpacity="0.35" />
              <stop offset="100%" stopColor={gem.flashes[0]?.color ?? gem.body} stopOpacity="0" />
            </radialGradient>
          )}
        </defs>

        {/* Lifted a little, so the tag under it overlaps the stone's foot
            rather than its middle. */}
        <g transform={numbered ? "translate(0 -4)" : undefined}>
          {glow && <circle cx="50" cy="50" fill={`url(#gem-glow-${uid})`} r="58" />}
          <path d={gem.path} fill={gem.body} />
          <g clipPath={`url(#gem-clip-${uid})`}>
            <g
              filter={`url(#gem-blur-${uid})`}
              style={animated ? { transformOrigin: "50px 50px", animation: "emblem-spin 48s linear infinite" } : undefined}
            >
              {gem.flashes.map((flash, index) => (
                <circle cx={flash.cx} cy={flash.cy} fill={flash.color} fillOpacity={flash.opacity} key={index} r={flash.r} />
              ))}
            </g>
            {gem.flecks.length > 0 && (
              <g filter={`url(#gem-soft-${uid})`}>
                {gem.flecks.map((fleck, index) => (
                  <circle cx={fleck.cx} cy={fleck.cy} fill={fleck.color} fillOpacity="0.9" key={index} r={fleck.r} />
                ))}
              </g>
            )}
            <path d={gem.path} fill={`url(#gem-dome-${uid})`} />
            <ellipse
              cx={gem.highlight.cx}
              cy={gem.highlight.cy}
              fill="#fff"
              fillOpacity={gem.highlight.opacity}
              filter={`url(#gem-soft-${uid})`}
              rx={gem.highlight.rx}
              ry={gem.highlight.ry}
              transform={`rotate(${gem.highlight.rotate} ${gem.highlight.cx} ${gem.highlight.cy})`}
            />
          </g>
          {gem.glints.map((glint, index) => (
            <path
              d={`M${glint.x},${glint.y - glint.size}Q${glint.x},${glint.y} ${glint.x + glint.size},${glint.y}Q${glint.x},${glint.y} ${glint.x},${glint.y + glint.size}Q${glint.x},${glint.y} ${glint.x - glint.size},${glint.y}Q${glint.x},${glint.y} ${glint.x},${glint.y - glint.size}Z`}
              fill="#fff"
              fillOpacity="0.9"
              key={index}
            />
          ))}
          {/* The rim: a hairline in the app's own ink on a pale stone, so it
              holds its edge on a white card; light on a dark one. */}
          <path
            d={gem.path}
            fill="none"
            stroke={gem.tone === "dark" ? "#fff" : "var(--foreground)"}
            strokeOpacity={gem.tone === "dark" ? 0.22 : 0.14}
            strokeWidth={Math.max(1, 100 / size)}
          />
        </g>
      </svg>

      {numbered && (
        <span
          className="absolute left-1/2 -translate-x-1/2 rounded-full border border-border bg-background px-[0.4em] font-semibold leading-none text-foreground tabular-nums shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
          style={{ bottom: -Math.round(tag * 0.35), fontSize: tag, paddingBlock: Math.max(2, Math.round(tag * 0.22)) }}
        >
          {ordinal}
        </span>
      )}
    </span>
  );
}
