import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";
import { Shot } from "@/components/Shot";
import { Spotlight } from "@/components/Spotlight";
import { cn } from "@/lib/cn";

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Spotlight className={cn("flex h-full flex-col", className)}>{children}</Spotlight>;
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[1.28rem] leading-tight">{children}</h3>;
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="mt-3.5 text-[0.94rem] leading-relaxed text-muted">{children}</p>;
}

export function TheApp() {
  return (
    <Section>
      <SectionHead
        index="03"
        label="What's in it"
        title="Every claim on this page has a page in the app that shows its working."
        lede="What you have proved and what it is guessing are kept strictly apart, and never drawn the same way."
      />

      <div className="mt-14 grid gap-4 md:grid-cols-12">
        <Reveal className="md:col-span-7">
          <Card className="p-6 sm:p-8 md:p-10">
            <Heading>Written for you, and nobody else.</Heading>
            <Body>
              Every challenge is generated against the target Spar picked for you, so nobody else is getting
              your exercise and there is nothing to look up. The files, the commands and the language all have
              to agree before it is set — and the suite has to survive the check above.
            </Body>
            <p className="mt-7 border-t border-line pt-7 font-display text-[1.06rem] leading-snug text-paper">
              You will never lose twenty minutes to a broken problem.
            </p>
          </Card>
        </Reveal>

        <Reveal delay={90} className="md:col-span-5">
          <Card className="justify-between p-6 sm:p-8 md:p-10">
            <div>
              <Heading>Verdicts nothing can talk out of you.</Heading>
              <Body>
                Graded by running the committed tests and reading the exit code. No model in that path —
                nothing you say to the agent can turn a failing program into a passing submission, or the
                reverse.
              </Body>
            </div>
            <p className="mt-10 border-t border-line pt-7 font-display text-[1.06rem] leading-snug text-paper">
              A tutor that can be talked into agreeing with you is not measuring anything.
            </p>
          </Card>
        </Reveal>

        <Reveal className="md:col-span-5">
          <Card className="overflow-hidden p-6 pb-0 sm:p-8 sm:pb-0 md:p-10 md:pb-0">
            <Heading>The ability ledger.</Heading>
            <Body>
              An <em>earned</em> ability is one your submissions have demonstrated more than once. An{" "}
              <em>uncertain</em> one is a hypothesis Spar hasn&rsquo;t confirmed yet.
            </Body>
            <div className="mt-8 -mb-px translate-y-2">
              <Shot
                shot="ability"
                sizes="(max-width: 900px) 100vw, 480px"
                alt="An ability page: the claim, its status, evidence counts, the concepts it covers and the challenges that earned it."
              />
            </div>
          </Card>
        </Reveal>

        <Reveal delay={90} className="md:col-span-7">
          <Card className="p-6 sm:p-8 md:p-10">
            <Heading>Concepts you can interrogate.</Heading>
            <Body>
              Hover any concept tag, anywhere in the app: passed, failed, still open, and the attempts behind
              each. This is how you find out whether &ldquo;closures&rdquo; is a real gap or one bad afternoon.
            </Body>
            <div className="mt-8">
              <Shot
                shot="hovercard"
                sizes="(max-width: 900px) 100vw, 620px"
                alt="A hover card over a concept tag showing a Steady verdict with four passed, one failed and three open."
              />
            </div>
          </Card>
        </Reveal>

        <Reveal className="md:col-span-7">
          <Card className="overflow-hidden p-6 pb-0 sm:p-8 sm:pb-0 md:p-10 md:pb-0">
            <Heading>Nothing is thrown away.</Heading>
            <Body>
              Every challenge stays, filterable by open, passed or replaced. A session you abandoned is still
              evidence.
            </Body>
            <div className="mt-8 -mb-px translate-y-2">
              <Shot
                shot="history"
                sizes="(max-width: 900px) 100vw, 680px"
                alt="The challenges page: every generated challenge with its status, session, concepts, test-run counts and a preview of the file."
              />
            </div>
          </Card>
        </Reveal>

        <Reveal delay={90} className="md:col-span-5">
          <Card className="justify-between p-6 sm:p-8 md:p-10">
            <div>
              <Heading>Real problems, when a real problem fits.</Heading>
              <Body>
                Connect LeetCode or Codeforces and the agent can set you real problems alongside the ones it
                invents — against the same target, in the same ledger.
              </Body>
            </div>
            <p className="mt-10 border-t border-line pt-7 text-[0.9rem] text-muted">
              Submit and it goes to that judge, against every hidden case. The verdict is theirs, and it lands
              on your account there.
            </p>
          </Card>
        </Reveal>
      </div>
    </Section>
  );
}
