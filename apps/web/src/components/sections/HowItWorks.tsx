import { Dots } from "@/components/Dots";
import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";

/** The four moves. Only one of them is what a topic percentage can produce. */
const MOVES = [
  {
    name: "Reinforce",
    title: "Again, at the same weakness.",
    body: "The ability is real and it isn't holding yet. Another problem aimed at the same thing, close enough that the same failure has somewhere to repeat itself.",
  },
  {
    name: "Isolate",
    title: "Smaller, to find out what you actually think.",
    body: "When it isn't clear which part broke, Spar strips the problem down until only one thing is being asked. A simpler challenge is a diagnostic, not a demotion.",
  },
  {
    name: "Transfer",
    title: "The same ability, somewhere unrecognisable.",
    body: "You solved it once. Whether you can find it again when the problem doesn't look like the last one is a different question, and the only way to answer it is to ask.",
  },
  {
    name: "Move on",
    title: "Stop drilling something you can do.",
    body: "Once recent evidence supports the ability, grinding it further costs you the session and teaches Spar nothing. Most practice sites have no way to know when to stop.",
  },
];

export function HowItWorks() {
  return (
    <Section id="how" bloom="br">
      <SectionHead
        index="03"
        label="What happens next"
        title="Your next challenge is a decision, not a category."
        lede="After an attempt, Spar doesn't ask a model for another medium sliding-window problem. It reads the ability map, the history behind it and the failure that just happened, and picks a move."
      />

      <ol className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-2">
        {MOVES.map((move, index) => (
          <Reveal key={move.name} delay={(index % 2) * 90}>
            <li className="relative isolate flex h-full flex-col gap-4 overflow-hidden bg-ink p-6 sm:p-8 md:p-10">
              {/* Each cell keeps its own corner of the field, alternating side
                  to side so the four of them read as one surface. */}
              <Dots
                variant="bloom"
                alpha={0.15}
                x={index % 2 === 0 ? "8%" : "92%"}
                y={index < 2 ? "10%" : "90%"}
              />
              <span className="font-mono text-[11px] tracking-[0.2em] text-ghost uppercase">{move.name}</span>
              <h3 className="text-[1.32rem] leading-tight">{move.title}</h3>
              <p className="text-[0.95rem] leading-relaxed text-muted">{move.body}</p>
            </li>
          </Reveal>
        ))}
      </ol>

      <Reveal delay={180}>
        <p className="lede mt-12 max-w-[62ch]">
          Which is why the next challenge is connected to the last hundred rather than generated in isolation.
        </p>
      </Reveal>
    </Section>
  );
}
