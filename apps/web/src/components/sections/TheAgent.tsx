import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";
import { AgentDemo } from "@/components/sections/AgentDemo";

const POINTS = [
  {
    title: "It looks things up.",
    body: "Your ability map, one ability's history, the attempts behind it, this challenge's state, the failing cases. Fetched when they matter, rather than pasted into one enormous transcript that gets worse the longer you use it.",
  },
  {
    title: "It comes back knowing.",
    body: "Close the app and the evidence stays. Tomorrow doesn't open with “what level are you at” — you already answered that, by solving things.",
  },
  {
    title: "It is not the judge.",
    body: "It decides what you practise and what to look at next. It is never the authority on whether your code is correct.",
  },
];

export function TheAgent() {
  return (
    <Section id="agent" bloom="br">
      <SectionHead
        index="08"
        label="The training agent"
        title="One agent, with your whole history to read from."
        lede="Spar isn't a chatbot that happens to generate coding questions — the agent is what runs the training system, and it answers from the evidence. Scripted here, because from a landing page it can't have yours. Try the third question."
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
