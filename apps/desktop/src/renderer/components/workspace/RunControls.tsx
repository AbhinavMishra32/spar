import { Check, ChevronDown, Loader2, Lock, Monitor, Play, Send } from "lucide-react";
import type { ChallengeSource } from "@spar/domain";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SourceGlyph } from "../common/SourceGlyph";

/** Where the examples run: this machine, or the problem source's own judge. */
export type TestEngine = "local" | "source";

const SOURCE_NAME: Record<ChallengeSource["source"], string> = { leetcode: "LeetCode", codeforces: "Codeforces" };
const KEY = "spar.test.engine.v1";

/**
 * The engine the learner last chose for this source, falling back to whichever
 * one can actually run the problem. Remembered per source rather than per
 * challenge: "I test on LeetCode" is a habit, not a property of one problem.
 */
export function preferredEngine(source: ChallengeSource | null | undefined): TestEngine {
  if (!source) return "local";
  const local = source.localCaseCount > 0;
  if (!source.scratchRun) return "local";
  if (!local) return "source";
  try {
    return localStorage.getItem(`${KEY}:${source.source}`) === "source" ? "source" : "local";
  } catch {
    return "local";
  }
}

export function rememberEngine(source: ChallengeSource | null | undefined, engine: TestEngine) {
  if (!source) return;
  try { localStorage.setItem(`${KEY}:${source.source}`, engine); } catch { /* a convenience, not state */ }
}

/**
 * The two things a learner can do with their code, drawn as two different things.
 *
 * There used to be three peer buttons — Run, Run there, Submit — and the one
 * distinction that matters was the one nothing showed: two of them ran the same
 * published examples and differed only in *where*, while the third ran a
 * different suite altogether. So this is organised around the suite:
 *
 * - **Test** runs the examples. It carries their count, and where they run is a
 *   setting on it (the caret), not a sibling button — because to the learner it
 *   is the same question asked of a different machine.
 * - **Submit** runs the hidden cases. It carries a lock, and their count once
 *   anything has revealed it, so it reads as the suite you cannot see rather
 *   than as a third way to run.
 */
export function RunControls({
  source,
  engine,
  onEngine,
  exampleCount,
  hiddenCount,
  running,
  submitting,
  graded,
  finalizing,
  disabled,
  onTest,
  onSubmit,
}: {
  source: ChallengeSource | null | undefined;
  engine: TestEngine;
  onEngine(engine: TestEngine): void;
  exampleCount: number;
  /** Known once measured or once a submission has reported it; 0 when not. */
  hiddenCount: number;
  running: boolean;
  submitting: boolean;
  graded: boolean;
  finalizing: boolean;
  disabled: boolean;
  onTest(): void;
  onSubmit(): void;
}) {
  const sourceName = source ? SOURCE_NAME[source.source] : "";
  const canLocal = !source || source.localCaseCount > 0;
  const canRemote = Boolean(source?.scratchRun);
  const choosable = canLocal && canRemote;
  const remote = engine === "source" && canRemote;
  const examples = exampleCount === 1 ? "the example" : `the ${exampleCount || ""} examples`.replace("  ", " ");
  const judgedRemotely = Boolean(source?.remoteJudge);

  return (
    /* One control in two halves, because they are the same act over two suites:
       the examples you can see, and the cases you cannot. Submit is the heavier
       half, by weight and a fill. */
    <div className="inline-flex h-6 items-stretch overflow-hidden rounded-md border border-border bg-[var(--color-background-editor)]">
        {/* Test: the examples, and where they run. */}
        <button
          className="inline-flex items-center gap-1.5 px-2 text-ui transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-45"
          disabled={disabled || running || submitting}
          onClick={onTest}
          title={remote
            ? `Runs ${examples} on ${sourceName}'s judge. Nothing is recorded on your account there. ⌘↵`
            : `Runs ${examples} on this machine — instant, and nothing leaves your computer. ⌘↵`}
          type="button"
        >
          {running ? (
            <Loader2 className="size-3 animate-spin" />
          ) : remote && source ? (
            <SourceGlyph className="size-3" source={source.source} />
          ) : (
            <Play className="size-3" />
          )}
          Test
          {exampleCount > 0 && (
            <span className="rounded-full bg-[var(--color-background-elevated-secondary)] px-1.5 text-ui-sm tabular-nums text-muted-foreground">
              {exampleCount}
            </span>
          )}
        </button>
        {choosable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Where the examples run"
                className="grid w-5 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
                disabled={disabled || running || submitting}
                type="button"
              >
                <ChevronDown className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Run the examples on</DropdownMenuLabel>
              <EngineItem
                active={!remote}
                description="Instant. Nothing leaves your computer."
                icon={<Monitor className="size-3.5" />}
                label="This machine"
                onSelect={() => onEngine("local")}
              />
              {source && (
                <EngineItem
                  active={remote}
                  description="Their judge, the same examples. Not recorded on your account."
                  icon={<SourceGlyph className="size-3.5" source={source.source} />}
                  label={sourceName}
                  onSelect={() => onEngine("source")}
                />
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

      {/* Submit: the hidden cases. */}
      <button
        className="inline-flex items-center gap-1.5 border-l border-border bg-accent px-2 text-ui font-medium text-foreground transition-colors hover:bg-foreground/[0.12] disabled:pointer-events-none disabled:opacity-45"
        disabled={disabled || running || submitting || graded}
        onClick={onSubmit}
        title={graded
          ? "Solved. Spar is setting up what comes next."
          : judgedRemotely
            ? `Sends your solution to ${sourceName}, which runs every hidden case it has${hiddenCount ? ` (${hiddenCount})` : ""}. It counts on your account there. ⇧⌘↵`
            : `Runs the examples and ${hiddenCount ? `${hiddenCount} ` : ""}hidden cases you cannot see. If any fail you can fix them and submit again. ⇧⌘↵`}
        type="button"
      >
        {submitting ? <Loader2 className="size-3 animate-spin" /> : graded ? <Check className="size-3" /> : <Send className="size-3" />}
        {submitting ? (judgedRemotely ? `Judging on ${sourceName}…` : "Judging…") : finalizing ? "Finalizing…" : graded ? "Solved" : "Submit"}
        {!submitting && !graded && !finalizing && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--color-background-elevated-secondary)] px-1.5 text-ui-sm font-normal tabular-nums text-muted-foreground">
            <Lock className="size-2.5" />
            {hiddenCount > 0 ? hiddenCount : "hidden"}
          </span>
        )}
      </button>
    </div>
  );
}

function EngineItem({ active, label, description, icon, onSelect }: { active: boolean; label: string; description: string; icon: React.ReactNode; onSelect(): void }) {
  return (
    <DropdownMenuItem className="items-start gap-2 py-1.5" onSelect={onSelect}>
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-ui text-foreground">{label}</span>
        <span className="block text-ui-sm leading-[1.4] text-muted-foreground">{description}</span>
      </span>
      <Check className={cn("mt-0.5 size-3.5 shrink-0", active ? "opacity-100" : "opacity-0")} />
    </DropdownMenuItem>
  );
}
