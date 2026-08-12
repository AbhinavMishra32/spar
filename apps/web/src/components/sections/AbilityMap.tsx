import { Dots } from "@/components/Dots";
import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";
import { Shot } from "@/components/Shot";

/** What a challenge leaves behind. Every one of these is a thing the next
 *  decision can be made out of, which is why the list is worth printing. */
const EVIDENCE = [
  "concepts you've encountered",
  "abilities you've demonstrated",
  "areas where your understanding is uncertain",
  "recurring mistakes",
  "failed cases, and what caused them",
  "hints you needed",
  "previous attempts",
  "remarks you left while solving",
  "what improved in later problems",
];

/**
 * The learner model, and the one comparison that explains it.
 *
 * A topic percentage is not a small version of this — it is a different kind of
 * thing. "Sliding Window — Weak" cannot tell you what to do next, because every
 * possible next problem is equally consistent with it. The sentence underneath
 * names a specific failure, and only a few problems in the world are the right
 * answer to it. So the two are set side by side, and the second one is given the
 * room, because the difference between them is the product.
 */
export function AbilityMap() {
  return (
    <Section id="abilities" bloom="tr">
      <SectionHead
        index="01"
        label="Your ability map"
        title="A living map of what you can actually do."
        lede="Every challenge contributes evidence. Over time it stops being a list of problems and becomes a description of you."
      />

      <div className="mt-14 grid gap-4 md:grid-cols-12">
        {/* The comparison, given the width. Nothing else on the page has to
            land as hard as this does. */}
        <Reveal className="md:col-span-7">
          <div className="relative isolate flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface p-6 sm:p-8 md:p-10">
            <Dots variant="bloom" x="86%" y="8%" alpha={0.17} />
            <p className="font-mono text-[10.5px] tracking-[0.2em] text-ghost uppercase">Not this</p>
            <p className="mt-4 font-mono text-[1.05rem] text-faint line-through decoration-faint/40">
              Sliding Window — Weak
            </p>

            <div className="mt-8 border-t border-line pt-8">
              <p className="font-mono text-[10.5px] tracking-[0.2em] text-paper uppercase">This</p>
              <p className="mt-4 font-display text-[clamp(1.1rem,1.7vw,1.35rem)] leading-snug text-paper">
                You recognise variable-size window problems reliably and maintain frequency state correctly.
                Your recent failures happen when validity has to be restored through repeated shrinking.
              </p>
            </div>

            <p className="mt-8 text-[0.94rem] leading-relaxed text-muted">
              The first sentence is consistent with every sliding-window problem ever written, so it cannot
              choose one. The second rules out almost all of them. That is the whole difference, and it is what
              decides what Spar gives you next.
            </p>
          </div>
        </Reveal>

        <Reveal delay={90} className="md:col-span-5">
          <div className="relative isolate flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface p-6 sm:p-8 md:p-10">
            <Dots variant="floor" alpha={0.13} />
            <h3 className="text-[1.28rem] leading-tight">What it is built from</h3>
            <ul className="mt-6 grid gap-2.5">
              {EVIDENCE.map((item) => (
                <li key={item} className="flex gap-3 text-[0.92rem] leading-snug text-muted">
                  <span aria-hidden className="mt-[0.55em] size-1 shrink-0 rounded-full bg-paper/50" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-8 border-t border-line pt-7 text-[0.9rem] leading-relaxed text-muted">
              None of it is a self-assessment. Every belief in the map points back at the attempts that
              produced it.
            </p>
          </div>
        </Reveal>

        {/* The hover card is a small piece of UI and reads fine in the narrow
            column. The ability page is a whole screen, so it gets the wide one —
            at five columns its own type was too small to make out. */}
        <Reveal className="md:col-span-5">
          <div className="flex h-full flex-col rounded-2xl border border-line bg-surface p-6 sm:p-8 md:p-10">
            <h3 className="text-[1.28rem] leading-tight">Every belief can be opened.</h3>
            <p className="mt-3.5 text-[0.94rem] leading-relaxed text-muted">
              Hover any concept anywhere in the app: passed, failed, still open, and the attempts behind each.
              This is how you find out whether &ldquo;closures&rdquo; is a real gap or one bad afternoon.
            </p>
            <div className="mt-8">
              <Shot
                shot="hovercard"
                sizes="(max-width: 900px) 100vw, 480px"
                alt="A hover card over a concept tag showing a Steady verdict with four passed, one failed and three open."
              />
            </div>
          </div>
        </Reveal>

        <Reveal delay={90} className="md:col-span-7">
          <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface p-6 pb-0 sm:p-8 sm:pb-0 md:p-10 md:pb-0">
            <h3 className="text-[1.28rem] leading-tight">Demonstrated, or still uncertain.</h3>
            <p className="mt-3.5 text-[0.94rem] leading-relaxed text-muted">
              What your submissions have shown more than once is kept strictly apart from what Spar is still
              guessing — and the two are never drawn the same way.
            </p>
            <div className="mt-8 -mb-px translate-y-2">
              <Shot
                shot="ability"
                sizes="(max-width: 900px) 100vw, 620px"
                alt="An ability page: the claim, its status, evidence counts, the concepts it covers and the challenges that earned it."
              />
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
