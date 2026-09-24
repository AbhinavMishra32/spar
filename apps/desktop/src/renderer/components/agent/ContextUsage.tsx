import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ProviderId, SubscriptionUsage, UsageWindow } from "../../../shared/api";
import { useContextUsage, type ContextReading } from "../../hooks/use-context-usage";
import { useProviders } from "../../hooks/use-providers";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ProviderGlyph } from "../common/ProviderGlyph";

/**
 * The indicator that sits beside the model name: a ring for how full the context
 * window is, and — on hover — the two numbers behind it plus whatever the
 * connected subscription has left.
 *
 * This is Aside's `model-adjacent-indicator`, down to the ring geometry, the
 * row metrics and the reversed first row. Two readings share one popover there
 * because they answer the same question at two scales: the window is what stops
 * *this* turn, the quota is what stops the afternoon. Splitting them into two
 * controls would make the learner ask twice.
 */
export function ContextUsage({ sessionId }: { sessionId?: string | undefined }) {
  const usage = useContextUsage(sessionId);
  const { inventory } = useProviders();

  const provider = inventory?.providers.find((entry) => entry.id === inventory.defaultModel.provider);
  const subscription = provider?.kind === "subscription" && provider.state === "connected" ? provider : null;
  const { windows, refresh } = useSubscriptionUsage(subscription?.id);

  return (
    <ContextUsageIndicator
      onOpen={refresh}
      subscription={subscription ? { id: subscription.id, name: subscription.name } : null}
      usage={usage}
      windows={windows}
    />
  );
}

/**
 * The indicator itself, given its readings rather than reading them. Split from
 * the wrapper above so the harness can hold it at a fixed state — every number
 * on it comes from a live turn, which is not a thing a page can be opened at.
 */
export function ContextUsageIndicator({
  usage,
  subscription,
  windows,
  onOpen,
}: {
  usage: ContextReading | null;
  subscription: { id: ProviderId; name: string } | null;
  windows: UsageWindow[];
  /** Called each time the popover opens. Quota is the one reading here that
   *  nothing pushes, so looking at it is the cue to go and check. */
  onOpen?(): void;
}) {
  const used = usage?.usedTokens ?? 0;
  const total = usage?.totalTokens ?? 0;
  /* Clamped rather than trusted: a provider that reports a prompt larger than
     the window it accepted would otherwise draw an arc past its own circle. */
  const percent = Math.max(0, Math.min(100, total > 0 ? (used / total) * 100 : 0));
  const whole = Math.round(percent);

  /* Nothing has run and nothing is rationed — an empty ring would be reporting a
     reading rather than the absence of one. */
  if (!usage && windows.length === 0) return null;

  return (
    <Tooltip onOpenChange={(open) => { if (open) onOpen?.(); }}>
      <TooltipTrigger asChild>
        <button
          aria-label="Context usage"
          className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground"
          data-testid="model-adjacent-indicator"
          type="button"
        >
          <RadialProgress percent={percent} />
        </button>
      </TooltipTrigger>

      {/* The tooltip's own inline row becomes a stack of full-width rows: the
          padding moves off the box and onto each row, so the separator can run
          edge to edge. */}
      <TooltipContent className="min-w-60 flex-col items-stretch gap-0 px-0 py-1.5 tabular-nums">
        {usage && (
          <UsageRow
            className="flex-row-reverse"
            label={total > 0 ? `${abbreviate(used)}/${abbreviate(total)} tokens` : undefined}
            value={`${whole}% Full`}
          />
        )}

        {subscription && windows.length > 0 && (
          <>
            {usage && <Separator className="my-1" />}
            <div className="flex items-center gap-1 px-3 py-2 text-muted-foreground">
              <ProviderGlyph className="size-3" provider={subscription.id} />
              <p className="text-xs leading-none">{subscription.name}</p>
            </div>
            {windows.map((window) => {
              const left = Math.max(100 - Math.round(window.usedPercent), 0);
              return (
                <UsageRow
                  key={window.kind}
                  label={WINDOW_LABELS[window.kind]}
                  value={
                    <>
                      {/* A dot rather than a coloured number: the figure still
                          has to be read against the one above it, and recolouring
                          it would make two rows of the same kind look like two
                          different kinds of thing. */}
                      {left < 30 && (
                        <span className={cn("mr-1 inline-block size-2 shrink-0 rounded-full bg-amber-400", left < 10 && "bg-red-400")} />
                      )}
                      {`${left}% left`}
                    </>
                  }
                />
              );
            })}
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** One line of the popover. `items-start` rather than centre because a label
 *  that wraps should hang off the top of its figure, not straddle it. */
function UsageRow({ className, label, value }: { className?: string; label?: ReactNode; value: ReactNode }) {
  return (
    <div className={cn("flex items-start justify-between gap-1 px-3 py-1 text-[13px] font-medium", className)}>
      <p className="text-muted-foreground">{label}</p>
      <p className="shrink-0 text-right">{value}</p>
    </div>
  );
}

/**
 * The ring. Drawn on a 16px box with a 6px radius, so the 2px stroke sits a
 * pixel clear of the edge on both sides, and rotated back a quarter turn so the
 * arc starts at twelve o'clock. The track is the same stroke at a tenth
 * strength — the fill is meant to be legible at a glance, not precise.
 */
export function RadialProgress({ percent, className }: { percent: number; className?: string }) {
  const circumference = 2 * Math.PI * RADIUS;
  const offset = circumference * (1 - percent / 100);
  return (
    <svg className={cn("size-4", className)} role="img" viewBox="0 0 16 16">
      <circle cx="8" cy="8" fill="none" opacity="0.1" r={RADIUS} stroke="currentColor" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        fill="none"
        opacity="0.7"
        r={RADIUS}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={offset}
        strokeLinecap="round"
        strokeWidth="2"
        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
      />
    </svg>
  );
}

const RADIUS = 6;

const WINDOW_LABELS: Record<UsageWindow["kind"], string> = {
  "five-hour": "5 hours",
  weekly: "Weekly",
};

const UNITS = [
  { suffix: "G", size: 1e9 },
  { suffix: "M", size: 1e6 },
  { suffix: "K", size: 1e3 },
] as const;

/** Token counts to one significant place past their unit. Six figures of
 *  precision on a number that moves by thousands is noise. */
export function abbreviate(value: number): string {
  const unit = UNITS.find(({ size }) => value >= size);
  return unit ? `${Math.round(value / unit.size)}${unit.suffix}` : `${value}`;
}

/**
 * A subscription's remaining quota, in the order the popover lists it.
 *
 * Read while the composer is mounted rather than on opening the tooltip: for
 * ChatGPT this is a cached reading taken off the last turn's own response
 * headers, and for Claude it is a call that only goes out when the cache is
 * stale, so asking early costs nothing and means the dot is already right the
 * first time it is looked at.
 */
function useSubscriptionUsage(provider: ProviderId | undefined) {
  const [usage, setUsage] = useState<SubscriptionUsage | null>(null);
  /* When the reading on screen was taken, not when one was last asked for: a
     call that failed leaves the old figure up, and that figure is as stale as it
     was before, so the next hover should still go and look. */
  const read = useRef(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  /* A fresh read per hover, because quota moves while Spar is not the thing
     spending it — another client on the same subscription, or a turn that ran in
     a different window. Held off for USAGE_STALE_MS so that running the pointer
     back and forth across the toolbar is one call and not ten; for Claude this
     is a network round trip that refreshes an OAuth token. */
  const refresh = useCallback(() => {
    const api = window.spar;
    if (!api || !provider) return;
    if (Date.now() - read.current < USAGE_STALE_MS) return;
    void api.providerUsage(provider)
      .then((value) => {
        if (!live.current) return;
        read.current = Date.now();
        setUsage(value);
      })
      .catch(() => undefined);
  }, [provider]);

  /* The first read is not waited for. The dot that warns a window is nearly
     spent has to be right before it is hovered, or it is not a warning. */
  useEffect(() => {
    setUsage(null);
    read.current = 0;
    refresh();
  }, [refresh]);

  const windows = usage?.windows ?? [];
  const ordered = (["five-hour", "weekly"] as const).flatMap((kind) => {
    const entry = windows.find((window) => window.kind === kind);
    return entry ? [entry] : [];
  });
  return { windows: ordered, refresh };
}

/** How long a quota reading is treated as current. Long enough that a pointer
 *  crossing the toolbar does not fetch, short enough that a reading looked at
 *  twice a minute apart is a reading taken twice. */
const USAGE_STALE_MS = 5_000;
