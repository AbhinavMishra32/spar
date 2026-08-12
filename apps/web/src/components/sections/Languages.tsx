import { Dots } from "@/components/Dots";
import { Mark } from "@/components/Mark";
import { languages } from "@/lib/site";

/**
 * The strip under the hero.
 *
 * Every site this one is measured against puts customer logos here. Spar has
 * none to put, and inventing social proof is the one thing a page like this
 * must not do — so the strip says the true thing instead: these are the
 * languages a challenge can be set in.
 */
export function Languages() {
  const run = [...languages, ...languages];

  return (
    <section className="edge relative isolate overflow-hidden py-9" aria-label="Supported languages">
      {/* The strip sits directly under the hero's field, so it keeps a band of
          the same grid rather than reading as the point the dots stop. */}
      <Dots variant="panel" alpha={0.12} />
      <div className="shell flex flex-col gap-6 md:flex-row md:items-center">
        <p className="shrink-0 font-mono text-[11px] tracking-[0.18em] text-faint uppercase">
          Challenges are set in
        </p>

        <div className="marquee-mask relative min-w-0 flex-1">
          <div className="marquee gap-10 pr-10">
            {run.map((language, index) => (
              <span
                key={`${language}-${index}`}
                className="flex shrink-0 items-center gap-2.5 font-display text-[1.05rem] whitespace-nowrap text-faint"
                // The second run is the first one again, for the seam.
                aria-hidden={index >= languages.length}
              >
                <Mark size={11} className="opacity-45" />
                {language}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
