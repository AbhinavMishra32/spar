import { DownloadButton } from "@/components/DownloadButton";
import { AgentLine } from "@/components/hero/AgentLine";
import { DotField } from "@/components/hero/DotField";
import { ArrowGlyph } from "@/components/icons";
import { Shot } from "@/components/Shot";
import { site } from "@/lib/site";

const HEADLINE = ["Practice", "that", "fights", "back."];

export function Hero() {
  return (
    <section id="top" className="relative isolate flex min-h-svh flex-col overflow-hidden pt-28 pb-0">
      <DotField />
      <div className="hero-scrim" aria-hidden />

      <div className="shell relative z-10 flex flex-1 flex-col items-center justify-center pt-8 text-center">
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

        <p className="mt-6 font-mono text-[11px] tracking-[0.14em] text-ghost uppercase">
          macOS · Windows · Linux — free, and{" "}
          <a
            href="#download"
            className="text-faint underline-offset-4 transition hover:text-paper hover:underline"
          >
            every build is here
          </a>
        </p>
      </div>

      {/* The app itself, rising into the fold. The perspective and the fade are
          doing one job between them: making the bottom of the viewport read as
          somewhere the page continues, rather than as where it stops. */}
      <div className="relative z-10 mt-16 pt-4">
        <div className="mb-6">
          <AgentLine />
        </div>
        <div className="shell hero-window">
          <Shot
            shot="workspace"
            priority
            sizes="(max-width: 900px) 130vw, 1160px"
            alt="A Spar challenge open: the problem statement and sample cases on the left, the file being repaired in the editor, and the declared test cases below it."
          />
        </div>
      </div>
    </section>
  );
}
