import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";
import { Shot } from "@/components/Shot";
import { Spotlight } from "@/components/Spotlight";
import { cn } from "@/lib/cn";

/** The mechanical check every generated challenge has to survive. */
const PROOFS = [
  "the reference solution passes every test, visible and hidden",
  "deliberately broken solutions pass the visible tests — proving the visible suite is genuinely incomplete",
  "those broken versions fail the hidden tests",
  "the files, commands and language all agree with each other",
];

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
        lede="Spar keeps what you have proved and what it is guessing strictly apart, and never draws them the same way."
      />

      <div className="mt-14 grid gap-4 md:grid-cols-12">
        <Reveal className="md:col-span-7">
          <Card className="p-6 sm:p-8 md:p-10">
            <Heading>Challenges proven before you ever see them.</Heading>
            <Body>
              Every challenge is generated for the target Spar picked, so nobody else is getting your exercise
              and you can&rsquo;t look it up. Generated exercises have an obvious failure mode, so before one
              reaches you it has to survive a mechanical check:
            </Body>
            <ul className="mt-7 space-y-3.5 border-t border-line pt-7">
              {PROOFS.map((proof) => (
                <li key={proof} className="flex gap-3.5 text-[0.9rem] leading-relaxed text-muted">
                  <span aria-hidden className="mt-[0.42rem] size-1.5 shrink-0 rounded-full bg-paper/70" />
                  {proof}
                </li>
              ))}
            </ul>
            <p className="mt-7 text-[0.9rem] text-paper">
              A challenge that fails any of these never reaches you. You will never lose twenty minutes to a
              broken problem.
            </p>
          </Card>
        </Reveal>

        <Reveal delay={90} className="md:col-span-5">
          <Card className="justify-between p-6 sm:p-8 md:p-10">
            <div>
              <Heading>Verdicts nothing can talk out of you.</Heading>
              <Body>
                Your submission is graded by running the committed tests and reading the exit code. There is no
                model in that path. Nothing you say to the agent, and nothing it decides it likes about you,
                can turn a failing program into a passing submission — or the reverse.
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
              The page that answers &ldquo;what am I actually good at now&rdquo;. An <em>earned</em> ability is
              one your submissions have demonstrated more than once; an <em>uncertain</em> one is a hypothesis
              Spar hasn&rsquo;t confirmed. They are drawn differently and never merged.
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
              Every challenge is tagged with what it exercises. Hover any tag, anywhere in the app, and you get
              a straight answer about that concept: passed, failed, still open, and the attempts behind each.
              This is how you find out whether &ldquo;closures&rdquo; is a real gap or one bad afternoon.
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
              Every challenge Spar has ever written for you stays, filterable by open, passed or replaced —
              Spar swaps a challenge out when your evidence moves on before you got to it, and says so rather
              than quietly dropping it. A session you abandoned is still evidence.
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
                invents — chosen against the same target, tagged into the same ledger. On any turn that sets a
                challenge it has to search the source first, then either assign what it found or consciously
                write its own. It cannot skip the search.
              </Body>
            </div>
            <p className="mt-10 border-t border-line pt-7 text-[0.9rem] text-muted">
              Submit and it goes to that judge, against every hidden case the problem has. The verdict is
              theirs, and it lands on your account like any other submission.
            </p>
          </Card>
        </Reveal>
      </div>
    </Section>
  );
}
