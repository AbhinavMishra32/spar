import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";

/**
 * The one number, and the reason it is allowed to exist.
 *
 * A single figure for a person's ability is the thing this page spends a
 * section arguing against — a topic percentage tells you nothing about what you
 * can do. The rating survives that argument on one condition, which is the
 * condition the app actually enforces: it is derived from the map rather than
 * replacing it, and every move it has ever made has a sentence attached saying
 * what moved it. A number you can interrogate is not the same object as a score.
 *
 * The two contest scales are here because they are the question everybody asks
 * and the honest answer is an approximation: Spar has never played anybody, so
 * what is converted is the proficiency underneath rather than the number on top,
 * and the result is rounded to the nearest fifty so it cannot be read as a
 * measurement.
 */
const MOVES = [
  { at: "1240 → 1284", line: "Two unaided passes on medium graph problems. Still provisional until five more attempts land." },
  { at: "1130 → 1240", line: "Repaired a loop boundary without a hint, after failing the same shape twice last week." },
  { at: "1155 → 1130", line: "A hidden case on empty input. The approach was right and the boundary was not." },
];

export function Rating() {
  return (
    <Section id="rating" bloom="tr">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] lg:gap-16">
        <SectionHead
          index="02"
          label="Where you stand"
          title="One number, and it owes you an explanation."
          lede={
            <>
              Your Spar Rating is the confidence-weighted mean of every ability on the map — so it moves
              because something you can do changed, not because you solved more things.
            </>
          }
        />

        <Reveal className="lg:pt-3">
          <div className="rounded-2xl border border-line bg-surface p-7">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <p className="font-display text-[clamp(2.6rem,6vw,3.6rem)] leading-none">1284</p>
              <p className="pb-1 font-mono text-[11px] tracking-[0.16em] text-faint uppercase">
                Provisional
              </p>
            </div>
            {/* The approximations, plainly labelled as approximations. */}
            <div className="mt-6 grid gap-x-8 gap-y-2 border-t border-line pt-5 sm:grid-cols-2">
              <p className="text-[0.9rem] text-muted">
                ≈ <span className="text-paper">1650</span> on LeetCode
              </p>
              <p className="text-[0.9rem] text-muted">
                ≈ <span className="text-paper">1450</span> on Codeforces
              </p>
            </div>
            <p className="mt-4 text-[0.86rem] leading-relaxed text-faint">
              Both rounded to the nearest fifty, because Spar has never played a contest. What converts is
              the proficiency underneath, not the figure on top.
            </p>
          </div>

          <p className="mt-8 font-mono text-[11px] tracking-[0.16em] text-faint uppercase">
            Every move, with what moved it
          </p>
          <div className="mt-5 border-t border-line">
            {MOVES.map((move) => (
              <div key={move.at} className="grid gap-2 border-b border-line py-5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6">
                <p className="font-mono text-[12px] tracking-[0.06em] text-paper tabular-nums">{move.at}</p>
                <p className="text-[0.92rem] leading-relaxed text-muted">{move.line}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-[52ch] text-[0.92rem] leading-relaxed text-muted">
            This is the difference between a rating and a score. A score is a fact about you that you cannot
            argue with. This one names the attempt behind every point it ever gave you.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}
