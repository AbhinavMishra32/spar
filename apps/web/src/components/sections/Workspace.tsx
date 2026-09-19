import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";
import { Shot } from "@/components/Shot";

/** The three tabs under the editor, and what each one is for. */
const PANES = [
  {
    name: "Testcase",
    line: "What the visible cases declare — the call and the expected value — before you run anything.",
  },
  {
    name: "Test Result",
    line: "Per-case verdicts once you do, with the first failure already selected for you.",
  },
  {
    name: "Attempt",
    line: "The replay: every edit, every run and every remark, timestamped from the moment the attempt opened.",
  },
];

export function Workspace() {
  return (
    <Section id="app" bloom="bl">
      <div className="grid gap-14 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:gap-20">
        <SectionHead
          index="11"
          label="The workspace"
          title="Built around solving, not around chatting."
          lede={
            <>
              A file tree, a real editor, the problem statement, your results and a terminal — in panes you can
              resize, in one window. Chat is there when a conversation is useful. It isn&rsquo;t the product;
              the loop is: solve, understand, adapt, solve again.
            </>
          }
        />

        <div className="lg:pt-4">
          <p className="font-mono text-[11px] tracking-[0.16em] text-faint uppercase">
            The panel under the editor
          </p>
          <div className="mt-6 border-t border-line">
            {PANES.map((pane, index) => (
              <Reveal key={pane.name} delay={index * 80}>
                <div className="grid gap-2 border-b border-line py-6 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-6">
                  <p className="font-mono text-[12px] tracking-[0.08em] text-paper">{pane.name}</p>
                  <p className="text-[0.94rem] leading-relaxed text-muted">{pane.line}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={240}>
            <p className="mt-7 text-[0.94rem] leading-relaxed text-muted">
              A LeetCode or Codeforces problem opens in this same window, which is what keeps it from being an
              isolated event — the attempt is recorded here either way.
            </p>
          </Reveal>
        </div>
      </div>

      <div className="mt-16">
        <Reveal>
          <Shot
            shot="liveWorkspace"
            alt="Spar's live workspace showing a generated TypeScript prefix-sum challenge, the real file editor, visible test cases, and the GPT-5.6 Luna model indicator."
          />
          <p className="mt-4 max-w-[72ch] text-[0.9rem] leading-relaxed text-muted">
            This is the working surface: read the prompt, edit a real file, run the visible cases, ask the
            agent for a hint, and submit only when you are ready. A challenge is an executable little project,
            not a code block pasted into a chat.
          </p>
        </Reveal>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <Reveal delay={90}>
          <Shot
            shot="liveHome"
            alt="Spar Home showing Maya Chen's provisional rating, one solved challenge, one open session, and a baseline session ready to continue."
          />
          <p className="mt-4 text-[0.9rem] leading-relaxed text-muted">
            Home answers: where am I, what is open, and what should I continue?
          </p>
        </Reveal>
        <Reveal delay={150}>
          <Shot
            shot="liveHistory"
            alt="Spar History showing two fictional Maya Chen challenges, one passed and one open, with their concepts and source files."
          />
          <p className="mt-4 text-[0.9rem] leading-relaxed text-muted">
            History answers: what did I actually do, and what evidence did it leave?
          </p>
        </Reveal>
      </div>
    </Section>
  );
}
