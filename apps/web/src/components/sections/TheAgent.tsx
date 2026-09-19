import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";
import { Shot } from "@/components/Shot";
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
    title: "It can run your code and show you.",
    body: "When a bug is easier seen than described, the agent traces your own code and draws the steps into its reply — the line, the values, what changed on it — instead of telling you to add print statements and try again.",
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
        index="10"
        label="The training agent"
        title="One agent, with your whole history to read from."
        lede="Spar isn't a chatbot that happens to generate coding questions — the agent is what runs the training system, and it answers from the evidence. Scripted here, because from a landing page it can't have yours. Try the third question."
      />

      <div className="mt-14 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-5">
        <Reveal>
          <AgentDemo />
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
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

      <Reveal delay={260}>
        <div className="mt-16">
          <Shot
            shot="liveAgent"
            alt="A real Spar session with Maya Chen: the GPT-5.6 Luna agent explains the evidence from a first probe and writes a different second TypeScript challenge in the same workspace."
          />
          <p className="mt-4 max-w-[72ch] text-[0.9rem] leading-relaxed text-muted">
            A live session, captured from the desktop app rather than a mockup. The agent reads the first
            attempt, checks whether the next exercise would test transfer instead of repetition, and explains
            when its exact target did not validate cleanly. The model shown here is ChatGPT&rsquo;s GPT-5.6 Luna.
          </p>
        </div>
      </Reveal>
    </Section>
  );
}
