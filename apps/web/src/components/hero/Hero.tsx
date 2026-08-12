import { DownloadButton } from "@/components/DownloadButton";
import { DotField } from "@/components/hero/DotField";
import { ArrowGlyph } from "@/components/icons";
import { site } from "@/lib/site";

const HEADLINE = ["Practice", "that", "fights", "back."];

export function Hero() {
  return (
    <section id="top" className="relative isolate flex min-h-svh flex-col justify-center overflow-hidden">
      <DotField />
      <div className="hero-scrim" aria-hidden />

      <div className="shell relative z-10 flex flex-col items-center pt-28 pb-24 text-center">
        <a href={site.releases} target="_blank" rel="noreferrer" className="chip">
          <span className="ml-1 font-mono text-[11px] tracking-wide text-paper">v{site.version}</span>
          <span className="h-3.5 w-px bg-white/15" />
          <span>ten languages, and real problems from LeetCode</span>
          <ArrowGlyph className="size-[13px] opacity-60" />
        </a>

        {/* No gradient fill here: a clipped background paints over the text
            shadow, and the shadow is the aberration. The words land one after
            another because the line is four beats long and reading it that way
            is the joke. */}
        <h1 className="chromatic mt-8 text-[length:var(--text-display)]">
          {HEADLINE.map((word, index) => (
            <span
              key={word}
              className="rise mr-[0.26em] inline-block last:mr-0"
              style={{ ["--rise-delay" as string]: `${160 + index * 85}ms` }}
            >
              {word}
            </span>
          ))}
        </h1>

        <p className="lede mt-7 max-w-[58ch]">
          Spar watches how an attempt actually goes — what you wrote, what you ran, where you stalled — and
          writes your next exercise against the one thing you couldn&rsquo;t do.{" "}
          <span className="text-paper">The tests decide the verdict. Never the model.</span>
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <DownloadButton />
          <a href="#how" className="btn btn-ghost">
            See how it works
          </a>
        </div>

        <p className="mt-7 font-mono text-[11px] tracking-[0.14em] text-ghost uppercase">
          macOS · Windows · Linux — free, and{" "}
          <a href="#download" className="text-faint underline-offset-4 transition hover:text-paper hover:underline">
            every build is here
          </a>
        </p>
      </div>

      {/* A hairline down to the fold, with the mark's own dot travelling it. */}
      <div className="relative z-10 flex justify-center pb-10" aria-hidden>
        <span className="scroll-cue" />
      </div>
    </section>
  );
}
