import { cn } from "@/lib/utils";

/** Three bars, filled by how much work the password would take to guess.
 *
 *  It is shown while a password is being *chosen* and never while one is being
 *  recalled: telling someone signing in that the password they have used for a
 *  year is weak is a judgement they cannot act on at that moment. The scoring is
 *  deliberately coarse — length first, because length is what actually matters,
 *  and one point for not being all one kind of character. Anything finer would
 *  be a number pretending to be a measurement. */
export function strengthOf(password: string) {
  if (!password) return 0;
  let score = password.length >= 8 ? 1 : 0;
  if (password.length >= 14) score += 1;
  if (/[a-zA-Z]/.test(password) && /[^a-zA-Z]/.test(password)) score += 1;
  return Math.min(score, 3);
}

const LABEL = ["Too short", "Short", "Fine", "Strong"] as const;

export function PasswordStrength({ password, className }: { password: string; className?: string }) {
  const score = strengthOf(password);
  return (
    <div aria-hidden className={cn("flex items-center gap-2", className)}>
      <div className="flex flex-1 gap-1">
        {[1, 2, 3].map((step) => (
          <span
            className={cn(
              "h-[3px] flex-1 rounded-full transition-colors duration-300",
              step > score
                ? "bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)]"
                : score === 1
                  ? "bg-[color-mix(in_oklab,var(--destructive)_60%,transparent)]"
                  : score === 2
                    ? "bg-[color-mix(in_oklab,var(--foreground)_35%,transparent)]"
                    : "bg-[color-mix(in_oklab,var(--foreground)_65%,transparent)]",
            )}
            key={step}
          />
        ))}
      </div>
      <span className="w-14 shrink-0 text-right text-ui-sm text-muted-foreground/70">{LABEL[score]}</span>
    </div>
  );
}
