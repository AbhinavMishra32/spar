import { Reveal } from "@/components/Reveal";
import { cn } from "@/lib/cn";

export type Hue = "ember" | "tide" | "moss" | "dusk" | "amber" | "smoke";

/** A plate of light for a fragment of the app to float on. */
export function Plate({ hue, className, children }: { hue: Hue; className?: string; children: React.ReactNode }) {
  return (
    <div aria-hidden className={cn("plate", `plate--${hue}`, className)}>
      <span className="plate-glow" />
      <span className="plate-field" />
      {children}
    </div>
  );
}

/**
 * One feature: the plate, the app on it, and a sentence underneath.
 *
 * The fragment is decoration as far as a screen reader is concerned — the
 * caption says what it shows — so the plate is hidden and the caption is the
 * content.
 */
export function FeatureCard({
  hue,
  title,
  children,
  visual,
  aspect = "aspect-[4/3] md:aspect-[7/6]",
  delay,
  className,
}: {
  hue: Hue;
  title: string;
  children: React.ReactNode;
  visual: React.ReactNode;
  aspect?: string;
  delay?: number;
  className?: string;
}) {
  return (
    <Reveal delay={delay} className={className}>
      <Plate hue={hue} className={aspect}>
        {visual}
      </Plate>
      <p className="feature-caption">
        <strong>{title}</strong> {children}
      </p>
    </Reveal>
  );
}

/** A section's opening, the way the cards want it: a quiet label, one line, a
 *  short second line in the muted voice. */
export function Intro({
  eyebrow,
  title,
  lede,
  center,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  center?: boolean;
  className?: string;
}) {
  return (
    <Reveal className={cn("max-w-[46rem]", center && "mx-auto text-center", className)}>
      {eyebrow ? (
        <p className="feature-eyebrow">
          {eyebrow}
          <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="m6 3.5 4.5 4.5L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </p>
      ) : null}
      <h2 className="mt-4 text-[length:var(--text-title)]">{title}</h2>
      {lede ? <p className="mt-6 text-[clamp(1.02rem,1.3vw,1.18rem)] leading-relaxed text-faint">{lede}</p> : null}
    </Reveal>
  );
}

/** The column every card section sits in, with the page's hairline on top. */
export function FeatureSection({ id, children, className }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("edge relative isolate", className)}>
      <span className="section-dots" aria-hidden />
      <div className="shell relative py-24 md:py-36">{children}</div>
    </section>
  );
}
