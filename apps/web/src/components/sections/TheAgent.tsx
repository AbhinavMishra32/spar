import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";
import { AgentDemo } from "@/components/sections/AgentDemo";

const POINTS = [
  {
    title: "It says what it is about to do.",
    body: "Before each phase, in words, so you are never watching a spinner wondering what is happening. Its thinking is labelled by what it was actually doing, not by how long it took.",
  },
  {
    title: "It can ask you things back.",
    body: "Mid-attempt, about what you were trying, where you expected the value to change. The answer is evidence too.",
  },
  {
    title: "It is not the judge.",
    body: "It proposes what you practise and explains what your work shows. It is never the authority on whether your code is correct — that line runs down the middle of the product.",
  },
];

export function TheAgent() {
  return (
    <Section id="agent">
      <SectionHead
        index="04"
        label="The agent"
        title="Ask it why, and it has to answer from the evidence."
        lede="The panel below is a transcript, not a live model — the answers are the ones the app gives, and it can't have your history from here. Try the third question."
      />

      <div className="mt-14 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-5">
        <Reveal>
          <AgentDemo />
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          {POINTS.map((point, index) => (
            <Reveal key={point.title} delay={90 + index * 80}>
              <div className="h-full rounded-2xl border border-line bg-surface p-6">
                <h3 className="text-[1.02rem] leading-snug">{point.title}</h3>
                <p className="mt-3 text-[0.89rem] leading-relaxed text-muted">{point.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}
