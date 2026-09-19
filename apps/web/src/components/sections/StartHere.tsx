import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";

const STEPS = [
  {
    number: "01",
    title: "Connect a backend and a model",
    body: "Spar keeps your account and learning history on the backend you choose. The training agent can use a subscription sign-in, an API key, an OpenAI-compatible endpoint, or a local Ollama/LM Studio model. Provider credentials live in your operating system keychain.",
  },
  {
    number: "02",
    title: "Tell it where you get stuck",
    body: "Onboarding is the first calibration signal. “I lose the invariant when a window shrinks” is a useful target; “I want to get better” is too broad. You can change language and focus later as the evidence gets sharper.",
  },
  {
    number: "03",
    title: "Work in a real challenge",
    body: "Read the statement, inspect the starter files, write a plan, edit the file, and run visible cases. The attempt records the path you took, including questions and recovery, not only the final answer.",
  },
  {
    number: "04",
    title: "Submit to the executable judge",
    body: "Spar runs the committed cases and reports each result. The model is deliberately out of this path, so an eloquent explanation cannot turn a failing program into a passing one.",
  },
  {
    number: "05",
    title: "Use the next target as feedback",
    body: "After the attempt, the agent explains what the evidence supports and chooses a move: reinforce, isolate, transfer, or move on. History and abilities retain the receipt so the next session starts with context.",
  },
] as const;

export function StartHere() {
  return (
    <Section id="start" bloom="tr">
      <SectionHead
        index="08"
        label="Start here"
        title="From install to a useful session, without guessing what matters."
        lede="Spar is easiest to understand as a loop with five moves. Connect the pieces, give the first calibration honest signal, and let the product earn its next recommendation from the way you work."
      />

      <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-2 lg:grid-cols-5">
        {STEPS.map((step, index) => (
          <Reveal key={step.number} delay={index * 70} className="h-full">
            <li className="flex h-full flex-col bg-surface p-6 sm:p-7">
              <span className="font-mono text-[11px] tracking-[0.18em] text-faint">{step.number}</span>
              <h3 className="mt-8 text-[1.04rem] leading-snug">{step.title}</h3>
              <p className="mt-4 text-[0.88rem] leading-relaxed text-muted">{step.body}</p>
            </li>
          </Reveal>
        ))}
      </ol>

      <div className="mt-12 grid gap-8 border-t border-line pt-8 text-[0.93rem] leading-relaxed text-muted md:grid-cols-3">
        <Reveal>
          <p className="font-mono text-[11px] tracking-[0.16em] text-faint uppercase">What you bring</p>
          <p className="mt-3">A language, a real sticking point, and the willingness to leave an honest trail while you solve.</p>
        </Reveal>
        <Reveal delay={80}>
          <p className="font-mono text-[11px] tracking-[0.16em] text-faint uppercase">What Spar records</p>
          <p className="mt-3">Edits, runs, questions, failures, submissions, challenge history, concepts, and the evidence behind each ability claim.</p>
        </Reveal>
        <Reveal delay={160}>
          <p className="font-mono text-[11px] tracking-[0.16em] text-faint uppercase">What stays deterministic</p>
          <p className="mt-3">Challenge validation, file access, execution, persistence, limits, and the final pass/fail verdict.</p>
        </Reveal>
      </div>
    </Section>
  );
}
