import { CheckCircle2, CircleDashed, Sparkles, TimerReset } from "lucide-react";
import { cn } from "@/lib/utils";
import { BAND_LABEL, ORIGIN_LABEL, type ProblemBand, type ProblemItem, type ProblemOrigin, type ProblemStanding } from "@/lib/problems";
import { SourceGlyph } from "../common/SourceGlyph";
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
  todo: { icon: CircleDashed, tone: "text-muted-foreground/50", label: "Not started" },
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
export function OriginChip({ origin, className }: { origin: ProblemOrigin; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-background/60 px-1.5 text-ui-sm text-muted-foreground",
        className,
      )}
    >
      {origin === "spar"
        ? <Sparkles className="size-3 shrink-0 text-foreground/70" />
        : <SourceGlyph className="size-3 shrink-0 text-foreground/80" source={origin} />}
      <span className="font-medium text-foreground/90">{ORIGIN_LABEL[origin]}</span>
    </span>
  );
}

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
