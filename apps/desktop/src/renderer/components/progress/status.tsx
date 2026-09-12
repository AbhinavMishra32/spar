import { Sparkles } from "lucide-react";
import type { AbilityHistorySummary } from "@spar/domain";
import { cn } from "@/lib/utils";

/**
 * How each ledger state is said to the learner, and how it is drawn.
 *
 * The distinction the surfaces are built around is earned versus not. "Forming"
 * is a hypothesis Spar wrote when it set a target — showing it in the same grid
 * as an ability backed by three passing submissions would be the app claiming
 * things on the learner's behalf, which is the one thing it must not do.
 */
export const STATUS: Record<AbilityHistorySummary["status"], { label: string; blurb: string; ring: string; text: string }> = {
  uncertain: { label: "Forming", blurb: "A hypothesis Spar is still testing", ring: "text-muted-foreground/40", text: "text-muted-foreground" },
  developing: { label: "Emerging", blurb: "Evidence is starting to support this", ring: "text-[var(--warning)]", text: "text-[var(--warning)]" },
  independent: { label: "Fluent", blurb: "You have done this unaided, more than once", ring: "text-[var(--success)]", text: "text-[var(--success)]" },
  stale: { label: "Rusty", blurb: "Earned a while ago and not touched since", ring: "text-muted-foreground/60", text: "text-muted-foreground" },
};

/** How far round the ring is drawn. Not a progress bar — there is nothing to be
 *  at the end of — just legible steps so a card is recognisable at a glance. */
const RING_FRACTION: Record<AbilityHistorySummary["status"], number> = { uncertain: 0.12, developing: 0.55, independent: 1, stale: 0.8 };

/** A ring rather than a badge: four statuses read faster as an amount of arc than
 *  as four words, and the word is right beside it anyway. */
export function StatusRing({ size = 32, status }: { size?: number; status: AbilityHistorySummary["status"] }) {
  const fraction = RING_FRACTION[status];
  const circumference = 2 * Math.PI * 9;
  return (
    <span className={cn("relative grid shrink-0 place-items-center", STATUS[status].ring)} style={{ width: size, height: size }}>
      <svg aria-hidden className="absolute inset-0 size-full -rotate-90" viewBox="0 0 24 24">
        <circle className="text-border" cx="12" cy="12" fill="none" r="9" stroke="currentColor" strokeWidth="2" />
        <circle
          cx="12"
          cy="12"
          fill="none"
          r="9"
          stroke="currentColor"
          strokeDasharray={`${circumference * fraction} ${circumference}`}
          strokeLinecap="round"
          strokeWidth="2"
        />
      </svg>
      <Sparkles style={{ width: size * 0.44, height: size * 0.44 }} />
    </span>
  );
}
