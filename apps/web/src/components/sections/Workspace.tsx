import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";
import { Shot } from "@/components/Shot";

const PANES = [
  {
    name: "Testcase",
    line: "What the visible suite declares — the call and the expected value — before you run anything.",
  },
  {
    name: "Test Result",
    line: "Per-case verdicts once you do, with the first failure already selected for you.",
  },
  {
    name: "Attempt",
    line: "The replay: every edit and every run, timestamped from the moment the attempt opened.",
  },
];

export function Workspace() {
  return (
    <Section id="app">
      <SectionHead
        index="01"
        label="The workspace"
        title="A small project you open and work in."
        lede={
          <>
            Not a text box with a function signature in it. A file tree, a real editor, the problem statement,
            your test results and a terminal — in panes you can resize, in one window. The agent sits alongside
            it and says what it is about to do before each phase.
          </>
        }
      />

      <Reveal delay={90} className="mt-14">
        <Shot
          shot="workspace"
          priority
          alt="A Spar challenge open: the problem statement and sample cases on the left, the file being repaired in the editor, and the declared test cases below it."
        />
      </Reveal>

      <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
        {PANES.map((pane, index) => (
          <Reveal key={pane.name} delay={index * 90}>
            <div className="h-full bg-ink p-6">
              <p className="font-mono text-[11px] tracking-[0.16em] text-paper uppercase">{pane.name}</p>
              <p className="mt-3 text-[0.94rem] leading-relaxed text-muted">{pane.line}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
