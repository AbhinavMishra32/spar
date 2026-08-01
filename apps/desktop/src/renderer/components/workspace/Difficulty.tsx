import type { ActiveQuestion } from "@spar/domain";
import { cn } from "@/lib/utils";

const DIFFICULTY_TONE: Record<ActiveQuestion["difficulty"], string> = {
  foundation: "text-[var(--success)] bg-[var(--success)]/12",
  developing: "text-[var(--warning)] bg-[var(--warning)]/14",
  proficient: "text-[var(--warning)] bg-[var(--warning)]/18",
  advanced: "text-destructive bg-destructive/12",
};

const DIFFICULTY_LABEL: Record<ActiveQuestion["difficulty"], string> = {
  foundation: "Foundation",
  developing: "Developing",
  proficient: "Proficient",
  advanced: "Advanced",
};

export function DifficultyPill({ difficulty }: { difficulty: ActiveQuestion["difficulty"] }) {
  return (
    <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-ui-sm font-medium", DIFFICULTY_TONE[difficulty])}>
      {DIFFICULTY_LABEL[difficulty]}
    </span>
  );
}
