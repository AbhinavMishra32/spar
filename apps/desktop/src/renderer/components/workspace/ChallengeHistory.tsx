import {
  Check,
  CircleDot,
  FileCode2,
  Flag,
  Gavel,
  Play,
  Send,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ChallengeTimelineEntry } from "@spar/domain";
import { cn } from "@/lib/utils";
import { shortTime } from "@/lib/format";
import { useScrollFade } from "@/hooks/use-scroll-fade";

/**
 * Everything that happened to one challenge, as a history the page can hold in a
 * fixed slot.
 *
 * A challenge that took a few rounds of editing and running produces twenty-odd
 * events, and drawn as a plain list they pushed the practice notice — the one
 * thing on the page that has to be read — a screen and a half below the fold.
 * So the list scrolls inside its own box, with both ends faded to say it
 * continues, and a short history simply doesn't fill the box.
 *
 * Each row is marked by what kind of event it was rather than by an identical
 * dot: a run, an edit and a verdict are different things, and at this density
 * the glyph is what lets you find the verdict without reading every line.
 */

/** What each event type looks like. Unrecognised types — older builds wrote
 *  their own — fall back to the neutral dot the whole list used to use. */
const GLYPH: Record<string, LucideIcon> = {
  attempt_started: Flag,
  file_changed: FileCode2,
  command_executed: Play,
  test_run: CircleDot,
  submission_created: Send,
  submission_evaluated: Gavel,
  attempt_completed: Flag,
};

function glyphFor(entry: ChallengeTimelineEntry): LucideIcon {
  if (entry.type === "test_run") return entry.tone === "good" ? Check : X;
  return GLYPH[entry.type] ?? CircleDot;
}

const TONE: Record<ChallengeTimelineEntry["tone"], string> = {
  neutral: "text-muted-foreground/60",
  good: "text-[var(--success)]",
  bad: "text-destructive",
};

export function ChallengeHistory({ entries }: { entries: ChallengeTimelineEntry[] }) {
  const fade = useScrollFade<HTMLDivElement>(18);

  return (
    <div
      className="app-scroll max-h-[16.5rem] overflow-y-auto overscroll-contain"
      ref={fade.ref}
      style={fade.style}
    >
      <ol className="relative flex flex-col gap-1.5 py-0.5">
        {/* One rail behind the whole list rather than a connector per row: the
            rail is continuous, so the events read as one history even where they
            came from two different attempts. It is inset to the glyph's centre
            and stops short of both ends so it doesn't run into the fade. */}
        <span className="absolute inset-y-2 left-[0.53rem] w-px bg-border" aria-hidden />
        {entries.map((entry) => {
          const Glyph = glyphFor(entry);
          return (
            <li className="relative flex items-baseline gap-2.5" key={entry.id}>
              {/* The glyph sits on the rail, so it needs the page's own
                  background behind it rather than the rail showing through. */}
              <span className="flex size-[1.06rem] shrink-0 translate-y-[0.18rem] items-center justify-center rounded-full bg-background">
                <Glyph className={cn("size-3", TONE[entry.tone])} />
              </span>
              <span className="min-w-0 flex-1 text-ui leading-[1.55] text-foreground/80">{entry.detail}</span>
              <span className="shrink-0 text-ui-sm tabular-nums text-muted-foreground/60">
                {shortTime(entry.occurredAt)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
