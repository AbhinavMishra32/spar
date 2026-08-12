import { Mark } from "@/components/Mark";
import { Reveal } from "@/components/Reveal";
import { cn } from "@/lib/cn";

/**
 * A section's opening: its index, its label, its claim.
 *
 * The index is not decoration. The page is long and every section looks like
 * the one before it in a black-and-hairlines system, so `[03]` is how you keep
 * your place in it.
 */
export function SectionHead({
  index,
  label,
  title,
  lede,
  className,
}: {
  index: string;
  label: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  className?: string;
}) {
  return (
    <Reveal className={cn("max-w-[64ch]", className)}>
      <p className="eyebrow">
        <Mark size={11} className="opacity-60" />
        <span data-index>[{index}]</span>
        {label}
      </p>
      <h2 className="mt-5 text-[length:var(--text-title)]">{title}</h2>
      {lede ? <p className="lede mt-6">{lede}</p> : null}
    </Reveal>
  );
}

/** A page section: the hairline and crosshairs at its top, the column inside. */
export function Section({
  id,
  children,
  className,
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("edge relative overflow-hidden", className)}>
      <span className="section-dots" aria-hidden />
      <div className="shell relative py-24 md:py-32">{children}</div>
    </section>
  );
}
