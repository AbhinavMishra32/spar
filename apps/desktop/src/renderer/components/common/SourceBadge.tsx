import { ExternalLink, Gavel, Laptop } from "lucide-react";
import type { ChallengeSource } from "@spar/domain";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { SourceGlyph } from "./SourceGlyph";

/**
 * Where a challenge came from, and who decides whether it is right.
 *
 * The second half is the reason this exists. A learner looking at a problem is
 * entitled to know whether passing means the source accepted it or means Spar's
 * copy of two published examples was satisfied — and those are very different
 * claims. So the badge always carries the judge, either in the row itself or one
 * hover away, and never lets the mark alone imply an acceptance.
 */

/* The same three tones the generated challenges use for their own bands, so a
   list holding both kinds reads as one list rather than two colour schemes. */
const DIFFICULTY_TONE: Record<ChallengeSource["difficulty"], string> = {
  easy: "text-[var(--success)]",
  medium: "text-[var(--warning)]",
  hard: "text-destructive",
};

const DIFFICULTY_LABEL: Record<ChallengeSource["difficulty"], string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
const SOURCE_NAME: Record<ChallengeSource["source"], string> = { leetcode: "LeetCode", codeforces: "Codeforces" };

export function SourceBadge({ className, onOpen, source, size = "default" }: {
  className?: string;
  /** Opens the problem at the source in the real browser. Omitted where there is
   *  nowhere sensible to send someone, such as a compact history row. */
  onOpen?: (url: string) => void;
  source: ChallengeSource;
  size?: "default" | "compact";
}) {
  const name = SOURCE_NAME[source.source];
  return (
    <HoverCard closeDelay={80} openDelay={220}>
      <HoverCardTrigger asChild>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-background/60 text-ui text-muted-foreground",
            size === "compact" ? "h-5 px-1.5" : "h-6 px-2",
            className,
          )}
        >
          <SourceGlyph className="size-3.5 shrink-0 text-foreground/80" source={source.source} />
          <span className="font-medium text-foreground/90">{source.displayId}</span>
          <span className={cn("font-medium", DIFFICULTY_TONE[source.difficulty])}>{DIFFICULTY_LABEL[source.difficulty]}</span>
          {/* The judge, as an icon, in the row itself. Someone scanning a list of
              challenges can see at a glance which verdicts came from the source. */}
          {source.remoteJudge
            ? <Gavel aria-label={`Judged by ${name}`} className="size-3 shrink-0 opacity-60" />
            : <Laptop aria-label="Graded on this machine" className="size-3 shrink-0 opacity-60" />}
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-[22rem] text-ui">
        <p className="font-medium text-foreground">{name} {source.displayId} · {DIFFICULTY_LABEL[source.difficulty]}</p>
        <p className="mt-1.5 text-muted-foreground">{source.judge}</p>
        {source.localCaseCount > 0 && (
          <p className="mt-1.5 text-muted-foreground">
            Running the tests here checks the {source.localCaseCount} example{source.localCaseCount === 1 ? "" : "s"} published with the problem.
          </p>
        )}
        {source.references.length > 0 && (
          <p className="mt-1.5 text-muted-foreground">
            {name} relates it to {source.references.slice(0, 3).map((reference) => reference.title).join(", ")}
            {source.references.length > 3 ? ` and ${source.references.length - 3} more` : ""}.
          </p>
        )}
        {onOpen && (
          <button
            className="mt-2.5 inline-flex items-center gap-1.5 text-ui text-foreground underline-offset-2 hover:underline"
            onClick={() => onOpen(source.url)}
            type="button"
          >
            <ExternalLink className="size-3" />Open on {name}
          </button>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
