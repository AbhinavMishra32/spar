import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";

/** The three tabs under the editor, and what each one is for. */
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
      <div className="grid gap-14 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:gap-20">
        <SectionHead
          index="01"
          label="The workspace"
          title="A small project you open and work in."
          lede={
            <>
              Not a text box with a function signature in it. A file tree, a real editor, the problem
              statement, your test results and a terminal — in panes you can resize, in one window.
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
              While anything runs, the app animates its own logo instead of a borrowed spinner — a diagonal
              wave for work being produced, a slow breath for work being read.
            </p>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
