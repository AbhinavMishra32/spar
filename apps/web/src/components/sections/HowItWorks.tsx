import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";

const STEPS = [
  {
    title: "You answer seven questions, once.",
    body: "Career, goal, where you get stuck, language, model. Answer the stuck one properly — “I never know what actually needs awaiting” gives Spar somewhere to start. “I'm bad at algorithms” doesn't.",
  },
  {
    title: "Spar makes an opening call.",
    body: "No evidence about you yet, so everything you said is a hypothesis rather than a fact. It picks something to probe, and says what it is doing before it does it.",
  },
  {
    title: "You work, and Spar watches.",
    body: "Edits, runs, what the tests said, how long you sat on each part. The clock runs from the moment the attempt opens.",
  },
  {
    title: "The tests decide. Then it tells you what it learned.",
    body: "Not a score. A statement about what your attempt is evidence of, and what it wants to check next — which becomes your next challenge.",
  },
];

export function HowItWorks() {
  return (
    <Section id="how">
      <SectionHead
        index="02"
        label="How it works"
        title="Closer to sparring with someone who has been watching you."
        lede="Practice sites hand everyone the same ladder. Get stuck on the same thing four times and the site will happily let you get stuck a fifth."
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
