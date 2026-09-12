import { ArrowLeft, ArrowRight, Pause, Play, SkipBack, SkipForward, Sparkles } from "lucide-react";
import type { Language } from "@spar/domain";
import { formatIn, type LineNote, type Snapshot } from "@spar/visualizer";
import { cn } from "@/lib/utils";
import { changedFields, describeStep } from "@/lib/visualizer";
import { Button } from "@/components/ui/button";

/**
 * What just happened, and the controls for moving through it.
 *
 * The narration is the part of this feature that does the teaching. A canvas
 * shows *that* a pointer moved; this says which line moved it, which branch was
 * taken and why, and what changed as a result. Someone who can only look at one
 * thing on the screen should be able to look at this and follow the algorithm.
 *
 * The condition line is the piece worth the most. `while left < right` evaluating
 * to False is the single most common thing a learner mispredicts, and the tracer
 * captures the truthiness conversion as it actually happened — so this is
 * reporting the branch that was taken, not re-deriving one from the source.
 */
export function StepNarration({
  frame,
  previous,
  note,
  language,
}: {
  frame: Snapshot | undefined;
  previous: Snapshot | undefined;
  note: LineNote | undefined;
  language: Language;
}) {
  const changes = changedFields(language, frame, previous);
  return (
    <div className="flex items-start gap-2.5 border-t border-border px-4 py-3">
      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        {frame?.condition && (
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-ui">{frame.condition.expression}</code>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-ui font-medium",
                frame.condition.result ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
              )}
            >
              {frame.condition.result ? "True" : "False"}
            </span>
            <span className="text-ui text-muted-foreground">{frame.condition.branch}</span>
          </div>
        )}

        <div className="flex items-baseline gap-2">
          <span className="text-content font-medium">{describeStep(frame, note)}</span>
          {frame && <span className="font-mono text-ui-sm text-muted-foreground">line {frame.line}</span>}
        </div>

        <p className="mt-0.5 text-ui text-muted-foreground">
          {!frame ? (
            "Run your code to follow it line by line."
          ) : frame.event === "call" ? (
            "The arguments are in scope. Step forward to run the first statement."
          ) : frame.event === "return" ? (
            <>Returned <code className="font-mono text-foreground">{formatIn(language, frame.result)}</code>. This frame is leaving the stack.</>
          ) : (
            <code className="font-mono">{note?.text ?? "Executing this statement"}</code>
          )}
        </p>

        {changes.length > 0 && (
          <p className="mt-1 font-mono text-ui-sm text-[var(--trace-change)]">{changes.slice(0, 4).join("  ·  ")}{changes.length > 4 ? `  ·  +${changes.length - 4} more` : ""}</p>
        )}
      </div>
    </div>
  );
}

const SPEEDS = [0.5, 1, 2, 4];

/**
 * The transport.
 *
 * Disabled rather than hidden while a trace is stale, and that is the whole
 * reason this component takes a `stale` flag at all: stepping through a trace
 * that no longer matches the code on screen is the one way a visualiser can
 * actively mislead. The bar says why it is disabled instead of going quiet.
 */
export function Transport({
  index,
  count,
  playing,
  speed,
  stale,
  busy,
  onIndex,
  onStep,
  onPlaying,
  onSpeed,
}: {
  index: number;
  count: number;
  playing: boolean;
  speed: number;
  stale: boolean;
  busy: boolean;
  onIndex(index: number): void;
  onStep(delta: number): void;
  onPlaying(playing: boolean): void;
  onSpeed(speed: number): void;
}) {
  const disabled = !count || stale || busy;
  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-2.5">
      <div className="flex items-center gap-0.5">
        <Button disabled={disabled} onClick={() => onIndex(0)} size="icon-sm" title="First step" variant="ghost">
          <SkipBack />
        </Button>
        <Button disabled={disabled || index === 0} onClick={() => onStep(-1)} size="icon-sm" title="Previous step (←)" variant="ghost">
          <ArrowLeft />
        </Button>
        <Button
          disabled={disabled}
          onClick={() => { if (index === count - 1) onIndex(0); onPlaying(!playing); }}
          size="icon-sm"
          title={playing ? "Pause (space)" : "Play (space)"}
          variant="secondary"
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button disabled={disabled || index >= count - 1} onClick={() => onStep(1)} size="icon-sm" title="Next step (→)" variant="ghost">
          <ArrowRight />
        </Button>
        <Button disabled={disabled} onClick={() => onIndex(count - 1)} size="icon-sm" title="Last step" variant="ghost">
          <SkipForward />
        </Button>
      </div>

      <input
        aria-label="Execution step"
        className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-foreground disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
        disabled={disabled}
        max={Math.max(0, count - 1)}
        min={0}
        onChange={(event) => onIndex(Number(event.target.value))}
        type="range"
        value={index}
      />

      <span className="shrink-0 font-mono text-ui tabular-nums text-muted-foreground">
        {count ? index + 1 : 0}<span className="opacity-50"> / {count}</span>
      </span>

      <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-[var(--color-background-elevated-secondary)] p-0.5">
        {SPEEDS.map((option) => (
          <button
            className={cn(
              "rounded-[var(--radius-sm)] px-1.5 py-0.5 text-ui-sm tabular-nums transition-colors",
              speed === option ? "bg-background text-foreground shadow-[0_1px_2px_oklch(0%_0_0/8%)] dark:bg-[color-mix(in_oklab,var(--foreground)_14%,transparent)]" : "text-muted-foreground hover:text-foreground",
            )}
            disabled={disabled}
            key={option}
            onClick={() => onSpeed(option)}
            type="button"
          >
            {option}×
          </button>
        ))}
      </div>
    </div>
  );
}
