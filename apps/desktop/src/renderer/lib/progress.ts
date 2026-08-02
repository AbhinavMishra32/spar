import type { SessionSummary } from "@spar/domain";
import type { MeterBand } from "@/components/ui/meter";

type Question = SessionSummary["questionTitles"][number];

/**
 * Challenge progress as one hue at three weights.
 *
 * Colour here would be claiming a judgement the numbers do not support:
 * abandoning a challenge is not a failure and a challenge still compiling is not
 * a warning. Weight says how settled each part is and nothing more.
 *
 * Shared rather than local to the dashboard so the page-wide bar and the one on
 * each session row are literally the same reading at two scales — a learner who
 * works out what the weights mean once never has to do it again.
 */
export function challengeBands(questions: Question[]): MeterBand[] {
  const count = (...statuses: Question["status"][]) =>
    questions.filter((question) => statuses.includes(question.status)).length;

  return [
    { key: "evaluated", value: count("completed"), className: "bg-foreground/70", label: "evaluated" },
    { key: "open", value: count("active", "playable", "generating", "validating"), className: "bg-foreground/28", label: "in flight" },
    { key: "closed", value: count("abandoned", "invalid"), className: "bg-foreground/10", label: "closed" },
  ];
}
