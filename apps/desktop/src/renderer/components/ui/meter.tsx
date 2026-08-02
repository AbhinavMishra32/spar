import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type MeterBand = { key: string; value: number; className: string; label: string };

/**
 * A proportional bar, drawn as separated bands rather than one gradient so the
 * parts stay countable — the whole point is reading how much of each, not just
 * how far along.
 *
 * Bands grow from zero on mount. Progress that is simply *there* on the first
 * frame reads as a static graphic; a short grow says it was measured.
 */
export function Meter({
  bands,
  className,
  height = "0.5rem",
  total: given,
  animate = true,
}: {
  bands: MeterBand[];
  className?: string;
  height?: string;
  /** Denominator when the bands are a fraction of a known whole. */
  total?: number;
  /**
   * Off when the meter is one of many. A single bar growing is a measurement
   * settling; a list of them growing together is a page that shudders on mount.
   */
  animate?: boolean;
}) {
  const sum = bands.reduce((acc, band) => acc + band.value, 0);
  const total = Math.max(given ?? sum, sum);
  const [grown, setGrown] = useState(!animate);

  useEffect(() => {
    if (!animate) return;
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, [animate]);

  return (
    <div
      className={cn("flex w-full gap-[2px] overflow-hidden rounded-full bg-[var(--color-background-elevated-secondary)]", className)}
      style={{ height }}
    >
      {total === 0
        ? null
        : bands
            .filter((band) => band.value > 0)
            .map((band, index) => (
              <span
                key={band.key}
                className={cn("h-full rounded-full transition-[width] duration-[520ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none", band.className)}
                style={{
                  width: grown ? `${(band.value / total) * 100}%` : "0%",
                  // Bands settle in sequence, so the eye reads them as ordered
                  // rather than as one block arriving.
                  transitionDelay: `${index * 55}ms`,
                }}
                title={`${band.label}: ${band.value}`}
              />
            ))}
    </div>
  );
}

/** Legend entry that carries its own swatch, so the colours never drift apart. */
export function MeterKey({ band, className }: { band: MeterBand; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-ui text-muted-foreground", className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", band.className)} />
      <span className="tabular-nums text-foreground/80">{band.value}</span>
      {band.label}
    </span>
  );
}
