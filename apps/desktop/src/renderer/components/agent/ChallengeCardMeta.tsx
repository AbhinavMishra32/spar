import { useRef } from "react";
import { Bookmark, Clock3, Ellipsis, ExternalLink, MessageCircle, Play, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toggleSavedProblem, useProblemSaved } from "@/hooks/use-saved-problems";
import { cn } from "@/lib/utils";
import type { ChallengeStop, ChallengeTrail } from "../workspace/ChallengeStepper";

const outcomeTone: Record<NonNullable<ChallengeStop["outcome"]>, string> = {
  passed: "bg-[color-mix(in_oklab,var(--success)_13%,transparent)] text-[var(--success)]",
  failed: "bg-[color-mix(in_oklab,var(--destructive)_11%,transparent)] text-destructive",
  abandoned: "bg-secondary text-muted-foreground",
  replaced: "bg-secondary text-muted-foreground",
};

/** Compact result line shared by the current challenge and its session history. */
export function ChallengeCardMeta({ stop }: { stop: ChallengeStop }) {
  const total = stop.totalCases;
  const passed = stop.passedCases;
  const known = total != null && total > 0 && passed != null;
  const failed = known ? Math.max(0, total - passed) : 0;
  const seconds = stop.elapsedMs == null ? null : Math.floor(stop.elapsedMs / 1000);
  return (
    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-ui-sm text-muted-foreground">
      {seconds != null && <span className="inline-flex shrink-0 items-center gap-1 tabular-nums"><Clock3 className="size-3" />{Math.floor(seconds / 60)}m {seconds % 60}s</span>}
      {known && (
        <span className="inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-md bg-secondary/60 px-1.5 py-px">
          <span aria-hidden className="flex h-1.5 w-7 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--destructive)_38%,transparent)]">
            <span
              className="h-full bg-[var(--success)]"
              style={{ width: `${Math.max(0, Math.min(100, (passed / total) * 100))}%` }}
            />
          </span>
          <span className="font-medium tabular-nums text-[var(--success)]">{passed}</span>
          <span>passed</span>
          {failed > 0 && <><span className="text-muted-foreground/50">·</span><span className="font-medium tabular-nums text-destructive">{failed}</span><span>failed</span></>}
        </span>
      )}
      {!!stop.testRunCount && <span className="inline-flex shrink-0 items-center gap-1"><Play className="size-3" />{stop.testRunCount} runs</span>}
      {stop.assistance === "assisted" && <span className="shrink-0">Hints used</span>}
    </span>
  );
}

export function ChallengeOutcomeTag({ outcome }: { outcome: ChallengeStop["outcome"] }) {
  if (!outcome) return null;
  return <span className={cn("shrink-0 rounded-md px-1.5 py-px text-ui-sm font-medium capitalize", outcomeTone[outcome])}>{outcome}</span>;
}

export function ChallengeComposerContext({ onRemove, stop }: { onRemove(): void; stop: ChallengeStop }) {
  return (
    <div className="ml-2 mr-auto mt-2 flex w-[min(26rem,calc(100%-1rem))] min-w-0 items-center gap-2 rounded-xl border border-[var(--glass-hairline)] bg-secondary/45 px-2.5 py-2 shadow-sm">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--color-background-elevated-secondary)] font-mono text-ui-sm tabular-nums text-muted-foreground">#{stop.ordinal}</span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-thread font-medium text-foreground">{stop.title}</span>
          <ChallengeOutcomeTag outcome={stop.outcome} />
        </span>
        <ChallengeCardMeta stop={stop} />
      </span>
      <button
        aria-label={`Stop asking about ${stop.title}`}
        className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onRemove}
        type="button"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function ChallengeCardMenu({ includeSave = true, stop, trail }: { includeSave?: boolean; stop: ChallengeStop; trail: ChallengeTrail }) {
  const saved = useProblemSaved(`spar:${stop.id}`);
  const afterClose = useRef<(() => void) | null>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Actions for ${stop.title}`} className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Ellipsis className="size-4" />
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
          {includeSave && <DropdownMenuItem onSelect={() => void toggleSavedProblem(`spar:${stop.id}`)}><Bookmark className={saved ? "fill-current" : undefined} />{saved ? "Remove from saved" : "Save challenge"}</DropdownMenuItem>}
          <DropdownMenuItem disabled={!trail.onAsk} onSelect={() => { afterClose.current = () => trail.onAsk?.(stop); }}><MessageCircle />Ask about this challenge</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
