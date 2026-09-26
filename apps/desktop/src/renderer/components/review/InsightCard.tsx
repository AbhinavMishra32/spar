import { useState } from "react";
import { ChevronRight, Lightbulb, Repeat2, Sparkles, TriangleAlert } from "lucide-react";
import { REVIEW_FORMAT_LABEL, REVIEW_TARGETS, REVIEW_TARGET_LABEL, type ReviewCard, type ReviewLog, type ReviewTarget } from "@spar/domain";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Markdown } from "../agent/Markdown";
import { RATING_LABEL, dueLabel, dueTone, percent, shortDate, TONE_CLASS } from "./schedule";

/*
 * An insight card, read back.
 *
 * This is what the agent took from the solve: the cue that should have pointed
 * at the idea, the idea, why it holds, the moment it turned, and the mistakes
 * made on the way. It is shown after a review has been answered, never before —
 * a card you can read while answering is a card you are reading, not recalling.
 */

export function InsightCardBody({ card, compact = false }: { card: ReviewCard; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col", compact ? "gap-3" : "gap-4")}>
      <Field label="When you see">{card.trigger}</Field>
      <Field label="The idea" strong>
        {card.insight}
      </Field>
      {card.invariant && <Field label="Why it holds">{card.invariant}</Field>}
      <div>
        <Label>What made it click{card.independence === "assisted" ? " · with help" : card.independence === "independent" ? " · on your own" : ""}</Label>
        <p className="text-ui leading-[1.6] text-foreground/85">{card.click.summary}</p>
        {card.click.diff && !compact && (
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border bg-[var(--color-background-editor)] px-3 py-2 font-mono text-[11.5px] leading-[1.55] text-foreground/85">
            {card.click.diff.split("\n").map((line, index) => (
              <span
                key={index}
                className={cn("block", line.startsWith("+") && "text-[var(--success)]", line.startsWith("-") && "text-destructive")}
              >
                {line || " "}
              </span>
            ))}
          </pre>
        )}
      </div>
      {card.pitfalls.length > 0 && (
        <div>
          <Label>Where you slipped</Label>
          <ul className="flex flex-col gap-1.5">
            {card.pitfalls.map((pitfall, index) => (
              <li key={index} className="flex items-start gap-2 text-ui leading-[1.55]">
                <TriangleAlert className="mt-[3px] size-3 shrink-0 text-[var(--warning)]" />
                <span>
                  <span className="text-foreground/85">{pitfall.mistake}</span>
                  <span className="text-muted-foreground"> — {pitfall.fix}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {card.transfer.length > 0 && !compact && (
        <div>
          <Label>Also works for</Label>
          <ul className="flex flex-wrap gap-1.5">
            {card.transfer.map((item, index) => (
              <li key={index} className="rounded-md bg-[var(--color-background-elevated-secondary)] px-2 py-0.5 text-ui-sm text-foreground/80">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-ui-sm font-medium tracking-[0.04em] text-muted-foreground/75">{children}</p>;
}

function Field({ label, strong = false, children }: { label: string; strong?: boolean; children: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <p className={cn("text-ui leading-[1.6]", strong ? "font-medium text-foreground" : "text-foreground/85")}>{children}</p>
    </div>
  );
}

/** The memory numbers, in one line: when it is due, how likely recall is now, how many reviews. */
export function MemoryLine({ card, className }: { card: ReviewCard; className?: string }) {
  const tone = card.suspended ? "later" : dueTone(card.dueAt);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-sm text-muted-foreground", className)}>
      <span className={cn("rounded-md px-1.5 py-0.5 font-medium", TONE_CLASS[tone])}>{card.suspended ? "Paused" : dueLabel(card.dueAt)}</span>
      <span title="The chance you would recall this right now, from the forgetting curve">Recall {percent(card.retrievability)}</span>
      <span title="Days until recall is expected to fall to your target">Holds ~{card.stability < 1 ? "<1" : Math.round(card.stability)}d</span>
      <span>
        {card.reps} review{card.reps === 1 ? "" : "s"}
        {card.lapses ? ` · ${card.lapses} forgotten` : ""}
      </span>
    </div>
  );
}

/** Every time this card was reviewed, newest first, with what was asked and how it went. */
export function ReviewTimeline({ logs }: { logs: ReviewLog[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!logs.length) return null;
  return (
    <ol className="flex flex-col">
      {logs.map((log) => {
        const expanded = open === log.id;
        const readable = Boolean(log.prompt || log.feedback);
        return (
          <li key={log.id} className="border-b border-border/60 last:border-b-0">
            <button
              className={cn("flex w-full items-center gap-2 py-1.5 text-left text-ui", readable ? "hover:text-foreground" : "cursor-default")}
              disabled={!readable}
              onClick={() => setOpen(expanded ? null : log.id)}
              type="button"
            >
              <SourceGlyph source={log.source} />
              <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{shortDate(log.reviewedAt)}</span>
              <span className="min-w-0 flex-1 truncate text-foreground/85">
                {log.source === "solve" ? "Solved — first card filed" : log.source === "implicit" ? "Credited from a related review" : log.format ? REVIEW_FORMAT_LABEL[log.format] : "Review"}
                {log.target && log.source !== "solve" && log.source !== "implicit" ? <span className="text-muted-foreground"> · {REVIEW_TARGET_LABEL[log.target].toLowerCase()}</span> : null}
              </span>
              <RatingPill rating={log.rating as 1 | 2 | 3 | 4} muted={log.source === "implicit"} />
              <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground/70">+{Math.round(log.scheduledDays)}d</span>
              {readable && <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground/50 transition-transform", expanded && "rotate-90")} />}
            </button>
            {expanded && (
              <div className="mb-2 ml-6 flex flex-col gap-2 rounded-lg bg-[var(--color-background-elevated-secondary)] px-3 py-2 text-ui-sm leading-[1.6]">
                {log.prompt && <Markdown className="text-ui-sm" source={log.prompt} />}
                {log.answer && (
                  <p className="whitespace-pre-wrap border-l-2 border-border pl-2 text-foreground/80">{log.answer}</p>
                )}
                {log.feedback && <p className="text-muted-foreground">{log.feedback}</p>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function SourceGlyph({ source }: { source: ReviewLog["source"] }) {
  const Icon = source === "solve" ? Sparkles : source === "resolve" ? Repeat2 : Lightbulb;
  return <Icon className={cn("size-3 shrink-0", source === "implicit" ? "text-muted-foreground/40" : "text-muted-foreground/70")} />;
}

export function RatingPill({ rating, muted = false }: { rating: 1 | 2 | 3 | 4; muted?: boolean }) {
  return (
    <span
      className={cn(
        "w-12 shrink-0 rounded px-1 text-center text-ui-sm font-medium",
        muted
          ? "text-muted-foreground/60"
          : rating === 1
            ? "bg-destructive/12 text-destructive"
            : rating === 2
              ? "bg-[var(--warning)]/15 text-[var(--warning)]"
              : "bg-[var(--success)]/12 text-[var(--success)]",
      )}
    >
      {RATING_LABEL[rating]}
    </span>
  );
}

export const TARGET_HINT: Record<ReviewTarget, string> = {
  problem: "This exact challenge: how you would solve it again, and its edge cases",
  pattern: "Spotting the technique in a problem with a different story",
  concept: "The invariant or property that makes it correct",
  "turning-point": "The realisation that got you unstuck",
  pitfall: "The mistake you made, so you catch it next time",
};

/**
 * The five things a review can be about, as a row of chips.
 *
 * `pick` is choosing what this one review asks: one chip is lit, and the ones
 * the card itself rehearses carry a dot so the others read as "also possible".
 * `toggle` is setting what the card rehearses: any number lit, never none.
 */
export function TargetChips({ mode, selected, marked = [], disabled = false, onChange, className }: {
  mode: "pick" | "toggle";
  selected: ReviewTarget[];
  marked?: ReviewTarget[];
  disabled?: boolean;
  onChange(targets: ReviewTarget[]): void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1", className)} role={mode === "pick" ? "radiogroup" : "group"}>
      {REVIEW_TARGETS.map((target) => {
        const on = selected.includes(target);
        const last = mode === "toggle" && on && selected.length === 1;
        return (
          <button
            aria-checked={mode === "pick" ? on : undefined}
            aria-pressed={mode === "toggle" ? on : undefined}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-ui-sm transition-colors disabled:cursor-default",
              on ? "border-foreground/25 bg-accent text-foreground" : "border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground/85",
              disabled && !on && "opacity-50",
            )}
            disabled={disabled || last}
            key={target}
            onClick={() => onChange(mode === "pick" ? [target] : on ? selected.filter((entry) => entry !== target) : REVIEW_TARGETS.filter((entry) => entry === target || selected.includes(entry)))}
            role={mode === "pick" ? "radio" : undefined}
            title={last ? "A card has to rehearse at least one thing" : TARGET_HINT[target]}
            type="button"
          >
            {mode === "pick" && marked.includes(target) && <span className={cn("size-1 rounded-full", on ? "bg-foreground/60" : "bg-muted-foreground/50")} />}
            {REVIEW_TARGET_LABEL[target]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * What a solve taught, one part at a time.
 *
 * The same five parts a review can be about, as tabs — so the card reads as a
 * set of short notes rather than one long page, and each note carries its own
 * switch for whether reviews ask about it.
 */
export function CardNotes({ card, onTargets }: { card: ReviewCard; onTargets?: ((targets: ReviewTarget[]) => void) | undefined }) {
  const tabs = REVIEW_TARGETS.filter((target) => hasNote(card, target));
  const [tab, setTab] = useState<ReviewTarget>(() => card.targets.find((target) => tabs.includes(target)) ?? tabs[0] ?? "pattern");
  const on = card.targets.includes(tab);
  return (
    <div>
      {/* When the learner said what to remember, their words head the card:
          the reviews are aimed at them. */}
      {card.remember && (
        <p className="mb-3 text-ui leading-[1.6] text-foreground/85">
          <span className="text-muted-foreground">You wanted to remember </span>“{card.remember}”
        </p>
      )}
      <div className="flex items-center gap-3 border-b border-border/70">
        <div className="-mb-px flex min-w-0 gap-3 overflow-x-auto" role="tablist">
          {tabs.map((target) => (
            <button
              aria-selected={tab === target}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1.5 border-b-2 text-ui transition-colors",
                tab === target ? "border-foreground/70 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground/85",
              )}
              key={target}
              onClick={() => setTab(target)}
              role="tab"
              type="button"
            >
              {REVIEW_TARGET_LABEL[target]}
              {card.targets.includes(target) && <span className="size-1 rounded-full bg-[var(--success)]" title="Reviews ask about this" />}
            </button>
          ))}
        </div>
        {onTargets && (
          <label className="ml-auto flex shrink-0 items-center gap-1.5 text-ui-sm text-muted-foreground" title={on && card.targets.length === 1 ? "A card has to review at least one thing" : TARGET_HINT[tab]}>
            In reviews
            <Switch
              checked={on}
              disabled={on && card.targets.length === 1}
              onCheckedChange={(checked) => onTargets(checked ? REVIEW_TARGETS.filter((entry) => entry === tab || card.targets.includes(entry)) : card.targets.filter((entry) => entry !== tab))}
              size="sm"
            />
          </label>
        )}
      </div>
      <div className="pt-3 text-ui leading-[1.6] text-foreground/85">
        <Note card={card} target={tab} />
      </div>
    </div>
  );
}

function hasNote(card: ReviewCard, target: ReviewTarget): boolean {
  if (target === "pitfall") return card.pitfalls.length > 0;
  if (target === "turning-point") return Boolean(card.click.summary);
  return true;
}

function Note({ card, target }: { card: ReviewCard; target: ReviewTarget }) {
  if (target === "problem") {
    return (
      <>
        <p className="text-muted-foreground">What solving <span className="text-foreground/85">{card.questionTitle}</span> takes:</p>
        <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 marker:text-muted-foreground/50">
          {card.rubric.map((point, index) => <li key={index}>{point}</li>)}
        </ul>
      </>
    );
  }
  if (target === "pattern") {
    return (
      <div className="flex flex-col gap-2.5">
        <p className="font-medium text-foreground">{card.title}</p>
        <p>{card.insight}</p>
        <p><span className="text-muted-foreground">Reach for it when </span>{lowerFirst(card.trigger)}</p>
        {card.transfer.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {card.transfer.map((item, index) => <span className="rounded-md bg-[var(--color-background-elevated-secondary)] px-2 py-0.5 text-ui-sm text-foreground/80" key={index}>{item}</span>)}
          </div>
        )}
      </div>
    );
  }
  if (target === "concept") return <p>{card.invariant ?? card.insight}</p>;
  if (target === "turning-point") {
    return (
      <>
        <p>{card.click.summary}</p>
        <p className="mt-1 text-ui-sm text-muted-foreground">{card.independence === "assisted" ? "Got there with help." : card.independence === "independent" ? "Got there on your own." : null}</p>
        {card.click.diff && (
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-border bg-[var(--color-background-editor)] px-3 py-2 font-mono text-[11.5px] leading-[1.55]">
            {card.click.diff.split("\n").filter((line) => !/^[+-]?\s*$/.test(line)).map((line, index) => (
              <span className={cn("block", line.startsWith("+") && "text-[var(--success)]", line.startsWith("-") && "text-destructive")} key={index}>{line}</span>
            ))}
          </pre>
        )}
      </>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {card.pitfalls.map((pitfall, index) => (
        <li className="flex items-start gap-2" key={index}>
          <TriangleAlert className="mt-[4px] size-3 shrink-0 text-[var(--warning)]" />
          <span>{pitfall.mistake}<span className="text-muted-foreground"> — {lowerFirst(pitfall.fix)}</span></span>
        </li>
      ))}
    </ul>
  );
}

function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
}
