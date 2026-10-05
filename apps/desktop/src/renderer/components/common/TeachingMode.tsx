import { Check } from "lucide-react";
import type { TeachingMode } from "@spar/domain";
import { TEACHING_CHOICES } from "../../../shared/challengeMix";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Standard or personalized, as two rows with what each means: the choice a
 * new session starts on, so it is read rather than guessed at.
 */
export function TeachingModePicker({ value, onChange, className }: { value: TeachingMode; onChange(next: TeachingMode): void; className?: string }) {
  return (
    <div aria-label="Teaching mode" className={cn("divide-y divide-border overflow-hidden rounded-xl border border-border", className)} role="radiogroup">
      {TEACHING_CHOICES.map((choice) => {
        const on = choice.value === value;
        return (
          <button
            aria-checked={on}
            className="flex w-full cursor-default items-start gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent"
            key={choice.value}
            onClick={() => onChange(choice.value)}
            role="radio"
            type="button"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-ui text-foreground">{choice.title}</span>
              <span className="block text-pretty text-ui-sm text-muted-foreground">{choice.detail}</span>
            </span>
            <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
              {on && <Check className="size-2.5" strokeWidth={3} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The same choice as one field among several in a form. */
export function TeachingModeMenu({ value, onChange }: { value: TeachingMode; onChange(next: TeachingMode): void }) {
  return (
    <Select onValueChange={(next) => onChange(next as TeachingMode)} value={value}>
      <SelectTrigger aria-label="Teaching mode" className="h-7 border-transparent bg-transparent pr-1.5 text-ui shadow-none hover:bg-accent dark:bg-transparent" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TEACHING_CHOICES.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.title}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
