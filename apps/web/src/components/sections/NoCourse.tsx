import { Dots } from "@/components/Dots";
import { Reveal } from "@/components/Reveal";
import { Section } from "@/components/Section";

/** What the decision is actually made from. A sheet has access to none of it —
 *  which is not a criticism of sheets, it is the definition of one. */
const INPUTS = [
  "your ability map",
  "the attempt you just made",
  "everything you attempted before",
  "concepts you haven't touched in weeks",
  "the weakness that hasn't resolved yet",
  "abilities that have never been tested outside one shape of problem",
];

/**
 * The section that names the competition.
 *
 * Nobody's real alternative to Spar is "nothing". It is a roadmap, a sheet, a
 * 150-problem list, a course with modules — and all of those are the same object:
 * an order somebody chose once, for a person who is not you, and cannot revise
 * when you turn out to be strong at step 40 and lost at step 12.
 *
 * Set as one line rather than a card grid, because it is a claim, not a feature.
 */
export function NoCourse() {
  return (
    <Section bloom="tr">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-20">
        <Reveal>
          <p className="eyebrow">
            <span data-index>[04]</span>
            No roadmap, no sheet, no course
          </p>
          <h2 className="mt-5 max-w-[20ch] text-[length:var(--text-title)]">
            There is no list of 200 problems waiting for you.
          </h2>
          <p className="lede mt-6 max-w-[58ch]">
            A roadmap is an order somebody fixed once, for somebody who isn&rsquo;t you. It can&rsquo;t know
            you cleared step 40 in your sleep and have been quietly lost since step 12 — so it hands you the
            next item either way, and you find out months later.
          </p>
          <p className="mt-6 max-w-[58ch] text-[0.98rem] leading-relaxed text-muted">
            Spar has no fixed sequence to hand out. What you get next is decided each time, from what the
            evidence currently says — which means the path changes as fast as you do, and it changes for the
            reason you can read on the challenge itself.
          </p>
        </Reveal>

        <Reveal delay={120}>
          <div className="relative isolate h-full overflow-hidden rounded-2xl border border-line bg-surface p-6 sm:p-8">
            <Dots variant="panel" alpha={0.16} />
            <p className="font-mono text-[10.5px] tracking-[0.2em] text-ghost uppercase">Decided from</p>
            <ul className="mt-6 grid gap-2.5">
              {INPUTS.map((input) => (
                <li key={input} className="flex gap-3 text-[0.92rem] leading-snug text-muted">
                  <span aria-hidden className="mt-[0.55em] size-1 shrink-0 rounded-full bg-paper/50" />
                  {input}
                </li>
              ))}
            </ul>
            <p className="mt-7 border-t border-line pt-6 font-display text-[1.02rem] leading-snug text-paper">
              A sheet has access to none of this. That is what makes it a sheet.
            </p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
