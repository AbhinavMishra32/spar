import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";

const STEPS = [
  {
    title: "You answer seven questions, once.",
    body: "Where you are in your career, what you want to get better at, where you tend to get stuck, which language, which model. The one about getting stuck is worth answering properly — “I can read async code but I never know what actually needs awaiting” gives Spar somewhere to start, and “I'm bad at algorithms” doesn't.",
  },
  {
    title: "Spar makes an opening call.",
    body: "It has no evidence about you yet, so it treats everything you said as a hypothesis rather than a fact, picks something to probe, and tells you what it is about to do and why before it does it.",
  },
  {
    title: "You work, and Spar watches.",
    body: "Edits, runs, the tests you ran and what they said, how long you sat on each part. A clock runs while the attempt is open, because every moment in the replay of your solve is measured from that zero.",
  },
  {
    title: "The tests decide. Then it tells you what it learned.",
    body: "Not a score — a statement about what your attempt is evidence of, and what it wants to check next. That becomes the target for your next challenge.",
  },
];

export function HowItWorks() {
  return (
    <Section id="how">
      <SectionHead
        index="02"
        label="How it works"
        title="Closer to sparring with someone who has been watching you."
        lede="Practice sites hand everyone the same ladder. Get stuck on the same thing four times and the site will happily let you get stuck a fifth. Spar is built the other way round."
      />

      <ol className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-2">
        {STEPS.map((step, index) => (
          <Reveal key={step.title} delay={(index % 2) * 90}>
            <li className="flex h-full flex-col gap-4 bg-ink p-6 sm:p-8 md:p-10">
              <span className="font-mono text-[11px] tracking-[0.2em] text-ghost">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-[1.32rem] leading-tight">{step.title}</h3>
              <p className="text-[0.95rem] leading-relaxed text-muted">{step.body}</p>
            </li>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}
