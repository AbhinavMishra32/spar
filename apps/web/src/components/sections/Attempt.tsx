import { Dots } from "@/components/Dots";
import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";
import { Shot } from "@/components/Shot";

/** The attempt, as the training system sees it. A verdict is one line of this. */
const CONTEXT = [
  { title: "Your implementation", note: "as it stands, not as it ended" },
  { title: "Which cases passed", note: "and which ones didn't" },
  { title: "How the code changed", note: "every edit, in order" },
  { title: "What you tried before", note: "including the approaches you abandoned" },
  { title: "The abilities in play", note: "what this problem was set to test" },
  { title: "Your history with them", note: "what the last few attempts proved" },
];

/**
 * The section that earns the ability map.
 *
 * Accepted and Wrong Answer are the same two words for everyone who ever
 * submitted, which is exactly why they cannot describe anybody. The claim here
 * is narrow and checkable: the thing generating your next problem has the
 * attempt itself, not its summary.
 *
 * The remark is quoted at full size because it is the one input the machine
 * cannot infer. Everything else on this page is Spar observing you; this is you
 * telling it something, in the middle of the attempt, while it is still true.
 */
export function Attempt() {
  return (
    <Section bloom="bl">
      <SectionHead
        index="02"
        label="What an attempt leaves behind"
        title="Accepted and Wrong Answer describe everybody. They can&rsquo;t describe you."
        lede="A final verdict is the smallest possible summary of half an hour's work. While you solve, Spar has the attempt itself."
      />

      <div className="mt-14 grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-20">
        <div>
          <p className="font-mono text-[11px] tracking-[0.16em] text-faint uppercase">
            In context, while you work
          </p>
          <div className="mt-6 border-t border-line">
            {CONTEXT.map((item, index) => (
              <Reveal key={item.title} delay={index * 60}>
                <div className="grid gap-1 border-b border-line py-5 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:gap-6">
                  <p className="text-[0.98rem] text-paper">{item.title}</p>
                  <p className="text-[0.92rem] leading-relaxed text-muted">{item.note}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={360}>
            <p className="mt-7 max-w-[62ch] text-[0.94rem] leading-relaxed text-muted">
              The point isn&rsquo;t to judge you from one result. It&rsquo;s to work out what actually broke
              down — and a verdict on its own can&rsquo;t tell a wrong idea from a right idea with one case
              missed.
            </p>
          </Reveal>
        </div>

        <div className="lg:pt-9">
          <Reveal>
            {/* The one input Spar cannot observe: you, saying what you're
                unsure about, while you are still unsure about it. */}
            <div className="relative isolate overflow-hidden rounded-2xl border border-line bg-surface p-6 sm:p-7">
              <Dots variant="panel" alpha={0.17} step={26} />
              <p className="font-mono text-[10.5px] tracking-[0.2em] text-ghost uppercase">
                Leave a remark, mid-attempt
              </p>
              <p className="mt-5 font-display text-[1.12rem] leading-snug text-paper">
                &ldquo;I know this probably needs a changing window, but I&rsquo;m not sure when shrinking
                should stop.&rdquo;
              </p>
              <p className="mt-6 border-t border-line pt-6 text-[0.9rem] leading-relaxed text-muted">
                That goes into the attempt history with everything else. Spar can be wrong about why you
                stalled; this is how you tell it.
              </p>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface p-6 pb-0 sm:p-7 sm:pb-0">
              <h3 className="text-[1.12rem] leading-tight">Nothing is thrown away.</h3>
              <p className="mt-3 text-[0.92rem] leading-relaxed text-muted">
                Every challenge stays — open, passed or replaced. A session you abandoned is still evidence.
              </p>
              <div className="mt-7 -mb-px translate-y-2">
                <Shot
                  shot="history"
                  sizes="(max-width: 1100px) 100vw, 420px"
                  alt="The challenges page: every challenge with its status, session, concepts, test-run counts and a preview of the file."
                />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
