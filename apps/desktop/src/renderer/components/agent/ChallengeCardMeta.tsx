import { useRef } from "react";
import { Bookmark, Clock3, Ellipsis, ExternalLink, MessageCircle, Play, Puzzle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useProblemSaved } from "@/hooks/use-saved-problems";
import { saveWithReceipt } from "../common/SaveProblem";
import { LanguageGlyph } from "../common/LanguageGlyph";
import { ReferenceTag } from "./ReferenceTag";
import { cn } from "@/lib/utils";
import type { ChallengeStop, ChallengeTrail } from "../workspace/ChallengeStepper";

/** How the two graders name a level. Spar's four bands and a judge's three are
 *  different claims, so they stay two maps rather than one that would have to
 *  pretend a "medium" and a "developing" were the same word. */
export const DIFFICULTY_WORD: Record<string, string> = { foundation: "Foundation", developing: "Developing", proficient: "Proficient", advanced: "Advanced" };
export const BAND_WORD: Record<string, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

/** How an outcome reads in running text, where "Replaced" as a pill would be a
 *  second label competing with the title beside it. */
const OUTCOME_WORD: Record<NonNullable<ChallengeStop["outcome"]>, string> = {
  passed: "solved", failed: "not solved", abandoned: "given up", replaced: "replaced",
};

const outcomeTone: Record<NonNullable<ChallengeStop["outcome"]>, string> = {
  passed: "bg-[color-mix(in_oklab,var(--success)_13%,transparent)] text-[var(--success)]",
  failed: "bg-[color-mix(in_oklab,var(--destructive)_11%,transparent)] text-destructive",
  abandoned: "bg-secondary text-muted-foreground",
  replaced: "bg-secondary text-muted-foreground",
};

/**
 * Compact result line shared by the current challenge and its session history.
 *
 * Every field draws, including on a challenge that was set a second ago and has
 * never been run. Each one used to be conditional on having a number, so a fresh
 * challenge rendered this as an empty span — a card with a title, a menu, and a
 * blank strip under it where the numbers live on every other card. That reads as
 * a card that failed to load its data, not as a challenge nobody has started.
 * Zeroes say the same thing honestly and in the shape the card will keep: the
 * clock, the bar and the run count stay in their places and start counting, so
 * the first run changes numbers rather than changing the card's layout.
 */
export function ChallengeCardMeta({ stop }: { stop: ChallengeStop }) {
  const total = stop.totalCases;
  const passed = stop.passedCases ?? 0;
  /* Whether the *problem* has a case count, which it does from the moment it is
     written — not whether anyone has run it. Without one there is no denominator,
     so the bar is drawn empty and the failed count is left off rather than being
     invented from a total nobody knows. */
  const sized = total != null && total > 0;
  /* A result, not a case count. `total - passed` on a challenge nobody has run is
     every case "failed", which is the one reading worse than the blank strip this
     replaced — it accuses the learner of losing a challenge they have not opened. */
  const graded = stop.passedCases != null;
  const failed = sized && graded ? Math.max(0, total - passed) : 0;
  const seconds = Math.floor((stop.elapsedMs ?? 0) / 1000);
  const runs = stop.testRunCount ?? 0;
  return (
    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-thread-tool text-muted-foreground">
      <span className="inline-flex shrink-0 items-center gap-1 tabular-nums"><Clock3 className="size-3" />{Math.floor(seconds / 60)}m {seconds % 60}s</span>
      <span className="inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-md bg-secondary/60 px-1.5 py-px">
        {/* Nothing run yet is an empty track, not a red one: the bar's ground
            means "failed", and a challenge with no runs has failed nothing. */}
        <span aria-hidden className={cn("flex h-1.5 w-7 overflow-hidden rounded-full", runs > 0 ? "bg-[color-mix(in_oklab,var(--destructive)_38%,transparent)]" : "bg-[var(--color-background-elevated-secondary)]")}>
          {sized && (
            <span
              className="h-full bg-[var(--success)]"
              style={{ width: `${Math.max(0, Math.min(100, (passed / total) * 100))}%` }}
            />
          )}
        </span>
        <span className={cn("font-medium tabular-nums", passed > 0 ? "text-[var(--success)]" : "text-muted-foreground")}>{passed}</span>
        <span>passed</span>
        {failed > 0 && <><span className="text-muted-foreground/50">·</span><span className="font-medium tabular-nums text-destructive">{failed}</span><span>failed</span></>}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 tabular-nums"><Play className="size-3" />{runs} runs</span>
      {stop.assistance === "assisted" && <span className="shrink-0">Hints used</span>}
    </span>
  );
}

export function ChallengeOutcomeTag({ outcome }: { outcome: ChallengeStop["outcome"] }) {
  if (!outcome) return null;
  return <span className={cn("shrink-0 rounded-md px-1.5 py-px text-thread-tool font-medium capitalize", outcomeTone[outcome])}>{outcome}</span>;
}

/**
 * What the next message is about, sitting over the field.
 *
 * It used to be a card: the challenge's title, its outcome pill, its clock, a
 * pass bar and a run count, in a bordered box two lines tall. All of that is
 * true and none of it was being asked — the learner had just said "ask about
 * this one", and the only thing they needed back was which one, in a form small
 * enough to check without reading. It is the same tag the agent writes inline
 * and the same tag `@` puts in the draft, which is the point: one shape for a
 * reference, wherever the reference turns up.
 */
export function ChallengeComposerContext({ onRemove, stop }: { onRemove(): void; stop: ChallengeStop }) {
  const total = stop.totalCases ?? 0;
  const seconds = Math.floor((stop.elapsedMs ?? 0) / 1000);
  /* Everything the card used to spend two lines and a progress bar on, as the
     words behind them. Only what is true gets said: a challenge nobody has run
     has no case count to report and no runs to count, and printing "0/0 · 0
     runs" there is the card inventing a result to fill its own layout. */
  const facts = [
    stop.outcome ? OUTCOME_WORD[stop.outcome] : null,
    seconds > 0 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : null,
    total > 0 && stop.passedCases != null ? `${stop.passedCases}/${total}` : null,
    stop.testRunCount ? `${stop.testRunCount} run${stop.testRunCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return (
    <div className="ml-2 mr-auto mt-2 flex min-w-0 max-w-[calc(100%-1rem)] items-center">
      <ReferenceTag
        glyph={stop.language
          ? <LanguageGlyph className="size-3.5" language={stop.language} />
          : <Puzzle className="size-3.5" />}
        label={stop.title}
        lead={`#${stop.ordinal}`}
        note={facts.length > 0 ? facts.join(" · ") : "not started"}
        onRemove={onRemove}
        removeLabel={`Stop asking about ${stop.title}`}
        title={`Asking about ${stop.title}`}
        variant="chip"
      />
    </div>
  );
}

export function ChallengeCardMenu({ includeSave = true, stop, trail }: { includeSave?: boolean; stop: ChallengeStop; trail: ChallengeTrail }) {
  const saved = useProblemSaved(`spar:${stop.id}`);
  const afterClose = useRef<(() => void) | null>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Actions for ${stop.title}`} className="grid size-6 shrink-0 place-items-center rounded-[var(--radius-md)] text-muted-foreground outline-none transition-[color,background-color,opacity] duration-150 hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-[var(--color-background-elevated-secondary)] data-[state=open]:text-foreground">
        <Ellipsis className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={(event) => {
        if (afterClose.current) {
          event.preventDefault();
          const action = afterClose.current;
          afterClose.current = null;
          action();
        }
      }} onKeyDown={(event) => event.stopPropagation()}>
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={!trail.onOpenQuestion} onSelect={() => { afterClose.current = () => trail.onOpenQuestion?.(stop); }}><ExternalLink />Open question</DropdownMenuItem>
          <DropdownMenuItem disabled={!trail.onOpenSession} onSelect={() => { afterClose.current = () => trail.onOpenSession?.(stop); }}><Play />Open in session</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {includeSave && <DropdownMenuItem onSelect={() => saveWithReceipt({ problemKey: `spar:${stop.id}`, title: stop.title, saved })}><Bookmark className={saved ? "fill-current" : undefined} />{saved ? "Remove from saved" : "Save challenge"}</DropdownMenuItem>}
          <DropdownMenuItem disabled={!trail.onAsk} onSelect={() => { afterClose.current = () => trail.onAsk?.(stop); }}><MessageCircle />Ask about this challenge</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
