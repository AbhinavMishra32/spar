import { ChevronDown, Flag, RotateCcw } from "lucide-react";
import type { ChallengeSource, Language } from "@spar/domain";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LANGUAGE_LABEL, LanguageGlyph } from "../common/LanguageGlyph";
import { AttemptClock } from "./AttemptClock";
import { LanguageMenu } from "./LanguageMenu";
import { RunControls, type TestEngine } from "./RunControls";

/**
 * The challenge toolbar's right side, in two groups.
 *
 * The attempt — how long it has run, and the two rare things you can do to it —
 * and the code: its language and the two ways to run it. Restarting the clock
 * and giving up used to be permanent buttons weighed the same as Test and
 * Submit; they are occasional and one is final, so they live behind the clock
 * they act on.
 */
export function ChallengeActions({
  startedAt,
  completedAt,
  language,
  source,
  attemptLocked,
  languageLocked,
  onRestartTimer,
  onGiveUp,
  onLanguage,
  loadLanguages,
  run,
}: {
  startedAt: string;
  completedAt: string | null;
  language: Language;
  source: ChallengeSource | null | undefined;
  attemptLocked: boolean;
  languageLocked: boolean;
  onRestartTimer(): void;
  onGiveUp(): void;
  onLanguage(language: Language): void;
  loadLanguages?: (() => Promise<Language[]>) | undefined;
  run: {
    engine: TestEngine;
    onEngine(engine: TestEngine): void;
    exampleCount: number;
    hiddenCount: number;
    running: boolean;
    submitting: boolean;
    graded: boolean;
    finalizing: boolean;
    disabled: boolean;
    onTest(): void;
    onSubmit(): void;
  };
}) {
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={attemptLocked}>
          <button
            className="group inline-flex h-6 items-center gap-1 rounded-md px-2 transition-colors hover:bg-accent disabled:pointer-events-none data-[state=open]:bg-accent"
            title={completedAt ? "Time this attempt took" : "Attempt options"}
            type="button"
          >
            <AttemptClock className="px-0" completedAt={completedAt} startedAt={startedAt} />
            {!attemptLocked && <ChevronDown className="size-3 shrink-0 text-muted-foreground/60 transition-transform group-data-[state=open]:rotate-180" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onRestartTimer}>
            <RotateCcw aria-hidden />
            Restart the timer
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onGiveUp} variant="destructive">
            <Flag aria-hidden />
            Give up and move on
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex items-center gap-1.5">
        {/* The language sits with the actions it decides: Test and Submit run
            whatever it is set to. */}
        <LanguageMenu disabled={languageLocked} language={language} loadLanguages={loadLanguages} onSelect={onLanguage} source={source}>
          <button
            aria-label={`Language: ${LANGUAGE_LABEL[language]}`}
            className="group inline-flex h-6 items-center gap-1.5 rounded-md pl-1.5 pr-1 text-ui text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-foreground"
            title="Change language"
            type="button"
          >
            <LanguageGlyph className="size-3.5" language={language} />
            {LANGUAGE_LABEL[language]}
            {languageLocked
              ? <span className="w-0.5" />
              : <ChevronDown className="size-3 opacity-60 transition-transform group-data-[state=open]:rotate-180" />}
          </button>
        </LanguageMenu>
        <RunControls source={source} {...run} />
      </div>
    </div>
  );
}
