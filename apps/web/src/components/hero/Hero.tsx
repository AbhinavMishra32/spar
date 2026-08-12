import { DownloadButton } from "@/components/DownloadButton";
import { AgentLine } from "@/components/hero/AgentLine";
import { DotField } from "@/components/hero/DotField";
import { ArrowGlyph } from "@/components/icons";
import { Shot } from "@/components/Shot";
import type { Release } from "@/lib/release";
import { site } from "@/lib/site";

/**
 * Two lines, and the second one is the claim.
 *
 * It says the mechanism rather than a mood: the exercise you get next is
 * written out of the attempt you just made. That is the whole product, and it
 * is the one thing no other practice site does.
 */
const HEADLINE = [
  ["Your", "next", "exercise,"],
  ["written", "from", "your", "last."],
];

export function Hero({ release }: { release: Release }) {
  return (
    <section id="top" className="relative isolate flex min-h-svh flex-col overflow-hidden pt-24 sm:pt-28">
      <DotField />
      <div className="hero-scrim" aria-hidden />

      <div className="shell relative z-10 flex flex-1 flex-col items-center justify-center py-10 text-center">
        <a href={site.releases} target="_blank" rel="noreferrer" className="chip">
          <span className="ml-1 font-mono text-[11px] tracking-wide text-paper">v{release.version}</span>
          <span className="hidden h-3.5 w-px bg-white/15 sm:block" />
          <span className="hidden sm:block">ten languages, and real problems from LeetCode</span>
          <span className="sm:hidden">ten languages, and LeetCode</span>
          <ArrowGlyph className="size-[13px] opacity-60" />
        </a>

        {/* No gradient fill here: a clipped background paints over the text
            shadow, and the shadow is the aberration. The words land one after
            another, in reading order across both lines. */}
        <h1 className="chromatic mt-7 text-[length:var(--text-display)] sm:mt-8">
          {HEADLINE.map((line, lineIndex) => (
            <span key={lineIndex} className="block">
              {line.map((word, wordIndex) => (
                <span
                  key={word}
                  className="rise mr-[0.24em] inline-block last:mr-0"
                  style={{
                    ["--rise-delay" as string]: `${160 + (lineIndex * 3 + wordIndex) * 75}ms`,
                  }}
                >
                  {word}
                </span>
              ))}
            </span>
          ))}
        </h1>

        <p className="lede mt-6 max-w-[54ch] sm:mt-8">
          Spar watches how the attempt actually goes — what you wrote, what you ran, where you stalled — and
          builds the next challenge around the one thing you couldn&rsquo;t do.{" "}
          <span className="text-paper">The tests decide the verdict. Never the model.</span>
        </p>

        <div className="mt-9 flex w-full flex-col items-center gap-3 sm:mt-10 sm:w-auto sm:flex-row">
          <DownloadButton builds={release.builds} className="w-full sm:w-auto" />
          <a href="#how" className="btn btn-ghost w-full sm:w-auto">
            See how it works
          </a>
        </div>

        <p className="mt-6 font-mono text-[10.5px] tracking-[0.14em] text-ghost uppercase sm:text-[11px]">
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
      <div className="relative z-10 mt-12 pt-4 sm:mt-16">
        <div className="mb-6 hidden sm:block">
          <AgentLine />
        </div>
        <div className="shell hero-window">
          <Shot
            shot="workspace"
            priority
            sizes="(max-width: 640px) 170vw, (max-width: 900px) 120vw, 1160px"
            alt="A Spar challenge open: the problem statement and sample cases on the left, the file being repaired in the editor, and the declared test cases below it."
          />
        </div>
      </div>
    </section>
  );
}
