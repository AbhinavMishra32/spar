import { cn } from "@/lib/utils";

/** The product wordmark deliberately uses Poppins, while the application UI keeps Geist. */
export function SparWordmark({ className }: { className?: string }) {
  return (
    <span aria-label="Spar" className={cn("font-spar text-[1.05rem] font-semibold tracking-[-0.055em]", className)}>
      Spar
    </span>
  );
}
