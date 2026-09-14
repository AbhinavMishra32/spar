import { CheckCircle2, CircleDashed, TimerReset } from "lucide-react";
import { cn } from "@/lib/utils";
import { BAND_LABEL, ORIGIN_LABEL, type ProblemBand, type ProblemItem, type ProblemOrigin, type ProblemStanding } from "@/lib/problems";
import { SourceGlyph } from "../common/SourceGlyph";
import { SparWordmark } from "../common/SparWordmark";
import { ProblemEmblem } from "./ProblemEmblem";

/**
 * The small parts every problem view is assembled from.
 *
 * They live together because the grid and the list have to be the *same* list
 * seen two ways: a band that is a tinted pill in one and a coloured word in the
 * other is two designs, and switching between them would feel like navigating
 * rather than changing the zoom.
 */

/* The three bands, in the tones the rest of the app already uses for difficulty —
   see `SourceBadge` and `DifficultyPill`. Shared deliberately: a list holding a
   Codeforces problem beside a challenge Spar wrote has to grade both on one
   scale, or the colours stop meaning anything. */
const BAND_TONE: Record<ProblemBand, string> = {
  easy: "text-[var(--success)] bg-[var(--success)]/12",
  medium: "text-[var(--warning)] bg-[var(--warning)]/14",
  hard: "text-destructive bg-destructive/12",
};

const STANDING: Record<ProblemStanding, { icon: React.ComponentType<{ className?: string }>; tone: string; label: string }> = {
  solved: { icon: CheckCircle2, tone: "text-[var(--success)]", label: "Solved" },
  attempted: { icon: TimerReset, tone: "text-[var(--warning)]", label: "Attempted" },
  /* Solid, like its two neighbours. At 50% this was a hairline circle on glass —
     the one standing that means "you have not been here yet" was the one you
     could not see, so a list of untouched problems read as a list with no marks
     in it at all. Rank is the tone, not the alpha. */
  todo: { icon: CircleDashed, tone: "text-muted-foreground", label: "Not started" },
};

export function BandPill({ band, className }: { band: ProblemBand; className?: string }) {
  return (
    <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-ui-sm font-medium", BAND_TONE[band], className)}>
      {BAND_LABEL[band]}
    </span>
  );
}

/** Which of the two kinds of problem this is: one the world already asks, or one
 *  Spar wrote for this learner. Worth a mark on every row — the difference decides
 *  who grades it and whether anyone else has ever solved it. */
export function OriginChip({ origin, className, bare = false }: { origin: ProblemOrigin; className?: string; bare?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 text-ui-sm text-muted-foreground",
        /* A box only where the chip has to hold its own against a card. In a ruled
           list it does not: every row carries the same border and fill, so eighty
           of them read as a column of empty boxes with a word inside. */
        bare ? "" : "rounded-[var(--radius-md)] border border-border bg-background/60 px-1.5",
        className,
      )}
    >
      {/* Spar signs its own work with its name, not with a sparkle. The wordmark
          is the one mark in this column that is a brand rather than a vendor's
          logo beside a label, so it stands alone: LeetCode's mark is followed by
          "LeetCode" because the mark alone is a logo-memory test, and "Spar" set
          in Poppins is already the word. The sparkle it replaces also said the
          wrong thing — it is the app's icon for generated-by-a-model, which is
          what wrote the problem, not whose problem it is. */}
      {origin === "spar" ? (
        <SparWordmark className="text-foreground" />
      ) : (
        <>
          <SourceGlyph className="size-3 shrink-0 text-foreground" source={origin} />
          <span className="font-medium text-foreground">{ORIGIN_LABEL[origin]}</span>
        </>
      )}
    </span>
  );
}

/** Where the learner stands on this problem, as the row's first mark.
 *
 *  Titled as well as labelled: three small glyphs in a column is a legend the
 *  reader has to build for themselves, and the one place it can be handed to them
 *  without spending a column on words is the pointer. The status filter above the
 *  list says the same three words, which is where someone goes once they know
 *  what they are looking at. */
export const STANDING_LABEL: Record<ProblemStanding, string> = {
  solved: "Solved",
  attempted: "Attempted — opened, not passed yet",
  todo: "Not started",
};

export function StandingMark({ className, standing }: { className?: string; standing: ProblemStanding }) {
  const { icon: Icon, tone, label } = STANDING[standing];
  return <Icon aria-label={label} className={cn("size-3.5 shrink-0", tone, className)} />;
}

/**
 * A problem's face.
 *
 * Every problem gets one, including one nobody has ever opened: a grid where half
 * the tiles wear art and half wear a grey square reads as two lists again. The
 * seed is the dedupe key, so the same problem keeps the same medal whether it is
 * showing as a remote hit today or as the learner's own challenge tomorrow — and
 * the subject is its first tag, which is what makes a shape mean something rather
 * than merely differ. See `ProblemEmblem`.
 */
export function ProblemMark({ className, item, size = 40 }: { className?: string; item: ProblemItem; size?: number }) {
  return (
    <ProblemEmblem
      {...(className ? { className } : {})}
      detail={size >= 30}
      seed={item.key}
      size={size}
      subject={item.tags[0] ?? ""}
    />
  );
}

/** What the row can say about a problem in one short phrase, or nothing at all.
 *  Never invents a figure: Codeforces publishes no acceptance rate, so a
 *  Codeforces row simply does not carry one. */
export function problemNote(item: ProblemItem): string | null {
  if (item.kind === "source") {
    return item.hit.acceptanceRate === null ? null : `${Math.round(item.hit.acceptanceRate)}% accepted`;
  }
  const { attemptCount, testRunCount } = item.challenge;
  if (!attemptCount && !testRunCount) return null;
  return `${attemptCount} attempt${attemptCount === 1 ? "" : "s"} · ${testRunCount} test run${testRunCount === 1 ? "" : "s"}`;
}
