import { cn } from "@/lib/utils";

/** The product wordmark deliberately uses Poppins, while the application UI keeps Geist.
 *  Poppins carries a taller x-height than Geist, so the default size is expressed in `em`
 *  and trimmed slightly: dropped into a sentence the wordmark then optically matches the
 *  copy around it instead of bulging out of the line. Callers that stand the wordmark on
 *  its own (sign-in, sidebar header) pass an explicit size. */
export function SparWordmark({ className }: { className?: string }) {
  return (
    <span
      aria-label="Spar"
      className={cn("font-spar text-[0.94em] font-semibold tracking-[-0.055em] whitespace-nowrap", className)}
    >
      Spar
    </span>
  );
}
