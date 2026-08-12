import { DownloadButton } from "@/components/DownloadButton";
import { DotField } from "@/components/hero/DotField";
import { Shot } from "@/components/Shot";
import type { Release } from "@/lib/release";

/**
 * Two imperatives on the same verb, and the second one is the offer.
 *
 * The complaint the whole product answers is not that practice is hard, it is
 * that nobody can tell which problem is worth the next hour — so you pick one
 * and hope. Naming that first is what makes the second line an answer rather
 * than a slogan; the rest of the page is the argument that Spar can do the
 * picking.
 */
const HEADLINE = [
  ["Stop", "guessing."],
  ["Solve", "the", "right", "problems."],
];

/**
 * Four things: the line, a sentence, a way in, and the app.
 *
 * It used to be seven — a version chip, the headline, a three-line paragraph,
 * two buttons, a platform list, and the agent narrating underneath. Every one
 * of them was true, and the stack of them was noise, which is its own kind of
 * untrue: a hero that lists everything says nothing on it matters more than
 * anything else. The version and the platform list moved to the download
 * section, which is where somebody who wants them is already going.
 *
 * The one mono line that survives is the claim the rest of the page exists to
 * earn, so it is the last thing read before the app itself comes up.
 */
export function Hero({ release }: { release: Release }) {
  return (
    <section id="top" className="relative isolate flex min-h-svh flex-col overflow-hidden pt-24 sm:pt-28">
      <DotField />
      <div className="hero-scrim" aria-hidden />

      <div className="shell relative z-10 flex flex-1 flex-col items-center justify-center py-10 text-center">
        {/* No gradient fill here: a clipped background paints over the text
            shadow, and the shadow is the aberration. The words land one after
            another, in reading order across both lines. */}
        <h1 className="chromatic text-[length:var(--text-display)]">
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

        <p className="lede mt-7 max-w-[52ch] sm:mt-8">
          Spar learns how you solve — where you stall, what you reach for first, which case breaks your
          approach — and picks or writes the one problem worth your next hour.
        </p>

        <div className="mt-9 flex w-full flex-col items-center gap-3 sm:mt-10 sm:w-auto sm:flex-row">
          <DownloadButton builds={release.builds} className="w-full sm:w-auto" />
          <a href="#how" className="btn btn-ghost w-full sm:w-auto">
            See how it works
          </a>
        </div>

        <p className="mt-8 font-mono text-[10.5px] tracking-[0.2em] text-faint uppercase sm:text-[11px]">
          LeetCode. Codeforces. Spar-generated challenges. One training system.
        </p>
      </div>

      {/* The app itself, rising into the fold. The perspective and the fade are
          doing one job between them: making the bottom of the viewport read as
          somewhere the page continues, rather than as where it stops. */}
      <div className="relative z-10 mt-12 sm:mt-16">
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
