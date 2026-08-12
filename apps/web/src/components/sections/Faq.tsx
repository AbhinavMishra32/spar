import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";

const QUESTIONS = [
  {
    q: "Is there anything to set up?",
    a: "Download it, sign in, answer seven questions, and Spar sets your first challenge. The only thing to choose is which model the agent runs on. The repository is open source because the product is; you are not expected to assemble it.",
  },
  {
    q: "How is this different from a roadmap or a problem sheet?",
    a: "A sheet is an order somebody fixed once, for somebody who isn't you, and it can't revise itself when you turn out to be fine at step 40 and lost at step 12. Spar has no fixed sequence — each challenge is decided from your ability map, your recent attempts and the failure that just happened, and the app tells you which of those it acted on.",
  },
  {
    q: "How long before it actually knows anything about me?",
    a: "The first session is mostly Spar finding out. It gets sharper the way evidence does: a handful of attempts narrow it down, and by the tenth the beliefs are specific enough to be worth arguing with. Anything it hasn't confirmed is marked uncertain rather than presented as fact.",
  },
  {
    q: "Is there a subscription?",
    a: "No. Spar is free, and it doesn't resell model access — you bring a model you already pay for or run yourself. That is the only thing you ever pay for, and a local model costs nothing.",
  },
  {
    q: "Can the agent be talked into passing me?",
    a: "No. Submissions are graded by executing the committed cases and reading the exit code, with no model in that path. Nothing you say to the agent can turn a failing program into a passing one, or the reverse.",
  },
  {
    q: "What if a generated problem is broken?",
    a: "It never reaches you. Before a challenge is shown, the reference solution has to pass every case, deliberately broken versions have to pass the visible cases and fail the hidden ones, and the files and commands have to agree. Anything that fails those checks is thrown away rather than set.",
  },
  {
    q: "Does it work with LeetCode?",
    a: "Yes, and with Codeforces. You sign in on their own page, so Spar never sees your password. A selected problem opens in the Spar workspace and submits to that judge against every hidden case — the verdict lands on your account there, and the attempt stays here as evidence.",
  },
  {
    q: "Where does my code go?",
    a: "Challenge files, your in-flight attempt and your settings stay on your machine; keys go to the system keychain. Your account and learning history sit on Spar's backend so they survive a reinstall. The challenge and your conversation go to your model provider, because that is what running a model means — run Ollama if that matters.",
  },
  {
    q: "Is there any telemetry?",
    a: "None. Spar has no analytics and no telemetry, and this site has neither.",
  },
];

export function Faq() {
  return (
    <Section id="faq" bloom="bl">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-20">
        <SectionHead index="11" label="Questions" title="The ones worth asking." />

        <div className="border-t border-line">
          {QUESTIONS.map((item, index) => (
            <Reveal key={item.q} delay={index * 50}>
              {/* <details> rather than a state machine: it is keyboard operable,
                  findable by the browser's own in-page search, and correct with
                  no JavaScript at all. */}
              <details className="faq group border-b border-line">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-8 py-6 text-[1.02rem] leading-snug">
                  {item.q}
                  <span aria-hidden className="faq-mark mt-1 shrink-0 text-faint">
                    +
                  </span>
                </summary>
                <p className="max-w-[68ch] pb-7 text-[0.94rem] leading-relaxed text-muted">{item.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}
