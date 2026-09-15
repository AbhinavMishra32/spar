import { challengeItemRating, INITIAL_DEVIATION, solveProbability, type ChallengeSource, type ConceptTag, type Question, type RatingPoint } from "@spar/domain";
import { cn } from "@/lib/utils";
import { approximateRating, describeChance, leetcodeBand, sparRating } from "@/lib/ratingScale";
import { outcomeBands, standingOf } from "@/lib/concepts";
import { Meter } from "@/components/ui/meter";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ConceptChip, conceptChipProps, type ConceptContext } from "../concepts/ConceptChip";
import { CodeforcesGlyph, LeetCodeGlyph } from "../common/SourceGlyph";
import { DifficultyPill } from "./Difficulty";

/**
 * What this problem is worth and where the learner stands on what it trains,
 * behind the difficulty badge.
 *
 * The badge says one word — "Developing" — which is a difficulty tier but sits
 * where a reader expects a status, so the one number-like thing on the screen was
 * the one thing that was not a number. The word stays, because the header is a
 * header and four figures in it would be worse; what changes is that the word is
 * now the handle on the answer rather than the whole of it.
 *
 * Everything here is a presentation of two figures Spar already keeps. The
 * problem's rating is `challengeItemRating` — the same call the scorer makes when
 * the attempt ends, so this cannot quote a difficulty the result is not graded
 * against. The learner's is their Glicko-2 rating. The chance between them is
 * `solveProbability`, which is the one falsifiable claim the rating system makes;
 * printing it here is what makes the rating a thing the learner can check rather
 * than a number that moves on its own.
 */

/** The window the strip spans, as Spar's own band. Both markers go through
 *  `sparRating`, so the item and the learner stay on one scale and their order on
 *  screen is their real order. */
const STRIP_FLOOR = 700;
const STRIP_CEILING = 1800;

const position = (rating: number) =>
  Math.max(0, Math.min(100, ((sparRating(rating) - STRIP_FLOOR) / (STRIP_CEILING - STRIP_FLOOR)) * 100));

/** What kind of fact the problem's rating is. A published Codeforces rating is a
 *  measurement; a band is a bucket hundreds of points wide; a challenge Spar
 *  wrote is one author's judgement. `challengeItemRating` already separates them
 *  and the deviation already weights them — this is only the wording. */
const BASIS_NOTE = {
  published: "from the source's published rating",
  band: "estimated from its difficulty band",
  generated: "written by Spar, priced by its difficulty",
} as const;

/**
 * The difficulty badge, unchanged, with the whole reading behind it.
 *
 * A hover card rather than a tooltip because the content has chips in it that are
 * themselves hoverable and clickable, and a tooltip's content cannot be reached
 * by the pointer.
 */
export function ChallengeRatingBadge({
  conceptContext,
  concepts,
  difficulty,
  learnerRating,
  source,
}: {
  /** What the concept chips need to preview and open. */
  conceptContext?: ConceptContext | undefined;
  concepts: ConceptTag[];
  difficulty: Question["difficulty"];
  learnerRating?: RatingPoint | null | undefined;
  source: ChallengeSource | null;
}) {
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        {/* A span rather than a button: there is nothing to press, and a cursor
            that changes over something inert is a promise the header does not
            keep. `select-none` for the same reason — it is a label, and a label
            that highlights under a drag reads as text somebody meant to copy. */}
        <span
          className="shrink-0 cursor-default select-none outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring/60"
          tabIndex={0}
        >
          <DifficultyPill difficulty={difficulty} />
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-[21rem]">
        <ChallengeCalibration
          conceptContext={conceptContext}
          concepts={concepts}
          difficulty={difficulty}
          learnerRating={learnerRating}
          source={source}
        />
      </HoverCardContent>
    </HoverCard>
  );
}

export function ChallengeCalibration({
  conceptContext,
  concepts,
  difficulty,
  learnerRating,
  source,
}: {
  conceptContext?: ConceptContext | undefined;
  concepts: ConceptTag[];
  difficulty: Question["difficulty"];
  /** The learner's standing. A rating still at the full initial deviation is not
   *  a rating — Glickman's 350 spans the whole scale, which is the system's way
   *  of saying it knows nothing — so the comparison is left out entirely rather
   *  than drawn against the 1500 every new profile is seeded with. */
  learnerRating?: RatingPoint | null | undefined;
  source: ChallengeSource | null;
}) {
  const item = challengeItemRating({ difficulty, source });
  const rated = learnerRating && learnerRating.deviation < INITIAL_DEVIATION ? learnerRating : null;
  const chance = rated
    ? solveProbability({ rating: rated.rating, deviation: rated.deviation, volatility: rated.volatility }, item.rating)
    : null;
  /* Above the problem means it should go your way. The tint follows that reading
     rather than the difficulty word, because the same problem is a warm-up for
     one learner and a stretch for another. */
  const comfortable = rated ? rated.rating >= item.rating : null;

  /* What it is aimed at, first. `role` is the only ordering the challenge itself
     carries, and a supporting concept listed above the primary one would make
     the ◆ the only thing saying which is which. */
  const ordered = [...concepts].sort((left, right) =>
    Number(right.role === "primary") - Number(left.role === "primary") || left.title.localeCompare(right.title),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-content-title font-semibold tabular-nums leading-none">{sparRating(item.rating)}</span>
          <span className="text-ui-sm text-muted-foreground">Spar rating</span>
          <span className="ml-auto shrink-0 text-right text-ui-sm text-muted-foreground/70">{BASIS_NOTE[item.basis]}</span>
        </div>

        <div className="relative h-1.5 w-full rounded-full bg-[var(--color-background-elevated-secondary)]">
          {rated && (
            <span
              aria-hidden
              className={cn("absolute inset-y-0 rounded-full", comfortable ? "bg-[var(--success)]/45" : "bg-[var(--warning)]/45")}
              style={{
                left: `${Math.min(position(item.rating), position(rated.rating))}%`,
                width: `${Math.abs(position(rated.rating) - position(item.rating))}%`,
              }}
            />
          )}
          <span
            aria-hidden
            className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] bg-foreground/80"
            style={{ left: `${position(item.rating)}%` }}
          />
          {rated && (
            <span
              aria-hidden
              className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-background-elevated-secondary)] bg-foreground"
              style={{ left: `${position(rated.rating)}%` }}
            />
          )}
        </div>

        {rated && chance != null ? (
          <p className="flex flex-wrap items-center gap-x-1.5 text-ui text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full bg-foreground" />
              You
              <span className="font-medium tabular-nums text-foreground">{sparRating(rated.rating)}</span>
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span>{describeChance(chance, rated.deviation)}</span>
          </p>
        ) : (
          <p className="text-ui text-muted-foreground">Solve a few more and Spar can say how this sits against you.</p>
        )}
      </div>

      {/* The same level on the scales people actually know. No "≈": the glyph and
          the word say it is that site's level, and a maths symbol in front of a
          brand name reads as a formula rather than as a comparison. */}
      <div className="flex flex-col gap-1.5 border-t border-border/70 pt-2.5">
        <p className="text-ui-sm text-muted-foreground/70">Comparable to</p>
        <div className="flex items-center gap-2 text-ui">
          <LeetCodeGlyph className="size-3.5 shrink-0" />
          <span className="text-foreground/85">LeetCode {leetcodeBand(item.rating)}</span>
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{approximateRating(item.rating, "leetcode")}</span>
        </div>
        <div className="flex items-center gap-2 text-ui">
          <CodeforcesGlyph className="size-3.5 shrink-0" />
          <span className="text-foreground/85">Codeforces</span>
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{approximateRating(item.rating, "codeforces")}</span>
        </div>
      </div>

      {ordered.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border/70 pt-2.5">
          <p className="text-ui-sm text-muted-foreground/70">What this trains</p>
          {ordered.map((concept) => (
            <ConceptStanding concept={concept} context={conceptContext} key={concept.slug} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One concept the problem trains, with the learner's record under it.
 *
 * The chip stays the chip — same preview, same click-through — because a tag that
 * behaves one way in history and another way here is two controls wearing one
 * face. What is added is only the part a tag cannot say: how it has been going.
 */
function ConceptStanding({ concept, context }: { concept: ConceptTag; context?: ConceptContext | undefined }) {
  const summary = context?.summaries.get(concept.slug);
  const standing = summary ? standingOf(summary) : null;
  const tested = Boolean(summary?.challengeCount);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <ConceptChip className="min-w-0" showArea tag={concept} {...conceptChipProps(context, concept.slug)} />
        {standing && <span className={cn("ml-auto shrink-0 text-ui-sm font-medium", standing.tone)}>{standing.label}</span>}
      </div>
      {tested && summary ? (
        <div className="flex min-w-0 items-center gap-2">
          <Meter animate={false} bands={outcomeBands(summary)} className="flex-1" height="0.25rem" />
          <span className="shrink-0 text-ui-sm tabular-nums text-muted-foreground/70">
            {summary.passedCount}/{summary.challengeCount} solved
          </span>
        </div>
      ) : (
        /* Not a gap in the learner — a concept they have not been given yet. Said
           in muted tone for the same reason `standingOf` tones "untested" that
           way. */
        <p className="text-ui-sm text-muted-foreground/60">Nothing recorded here yet</p>
      )}
    </div>
  );
}
