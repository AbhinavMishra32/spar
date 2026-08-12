import { Dots } from "@/components/Dots";
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

/** A page section: the hairline and crosshairs at its top, the column inside.
 *
 *  `bloom` puts a second field of dots somewhere in the section behind the
 *  content — the top wash is on every section and would be wallpaper if it were
 *  the only place dots appeared. Give it a corner: "tr", "bl" or "br". */
export function Section({
  id,
  bloom,
  children,
  className,
}: {
  id?: string;
  bloom?: "tr" | "bl" | "br";
  children: React.ReactNode;
  className?: string;
}) {
  const at = { tr: ["96%", "14%"], bl: ["4%", "88%"], br: ["96%", "86%"] }[bloom ?? "tr"];

  return (
    <section id={id} className={cn("edge relative isolate overflow-hidden", className)}>
      <span className="section-dots" aria-hidden />
      {bloom ? <Dots variant="bloom" alpha={0.13} x={at[0]} y={at[1]} /> : null}
      <div className="shell relative py-24 md:py-32">{children}</div>
    </section>
  );
}
