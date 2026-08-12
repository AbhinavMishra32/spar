import { Dots } from "@/components/Dots";
import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";
import { Spotlight } from "@/components/Spotlight";
import { cn } from "@/lib/cn";

function Card({
  children,
  dots,
  className,
}: {
  children: React.ReactNode;
  /** Which corner the card's own patch of field sits in. */
  dots?: "tr" | "bl";
  className?: string;
}) {
  return (
    <Spotlight className={cn("relative isolate flex h-full flex-col overflow-hidden", className)}>
      {dots ? (
        <Dots
          variant="bloom"
          alpha={0.15}
          x={dots === "tr" ? "94%" : "6%"}
          y={dots === "tr" ? "8%" : "92%"}
        />
      ) : null}
      {children}
    </Spotlight>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[1.28rem] leading-tight">{children}</h3>;
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="mt-3.5 text-[0.94rem] leading-relaxed text-muted">{children}</p>;
}

/** The shapes a generated challenge can take. The last one is the argument:
 *  none of the others could have been chosen off a shelf. */
const SHAPES = [
  "implement a missing function",
  "repair broken logic",
  "debug a small codebase",
  "work inside a generated backend service",
  "complete part of a game engine",
  "solve a problem whose edge cases target a weakness from an earlier attempt",
];

export function TheApp() {
  return (
    <Section bloom="tr">
      <SectionHead
        index="06"
        label="Generated challenges"
        title="And when the right problem doesn&rsquo;t exist, Spar writes it."
        lede="Sometimes a general question isn't precise enough. A challenge can be built around the exact ability Spar wants to test — and nobody else is getting your exercise, so there is nothing to look up."
      />

      <div className="mt-14 grid gap-4 md:grid-cols-12">
        <Reveal className="md:col-span-7">
          <Card dots="tr" className="p-6 sm:p-8 md:p-10">
            <Heading>A focused algorithm problem. Or a place to work.</Heading>
            <Body>
              Some abilities are best tested by a function. Others only show up inside something with more than
              one file in it, where recognising the problem is half the work.
            </Body>
            <ul className="mt-7 grid gap-2.5 border-t border-line pt-7">
              {SHAPES.map((shape) => (
                <li key={shape} className="flex gap-3 text-[0.93rem] leading-snug text-muted">
                  <span aria-hidden className="mt-[0.55em] size-1 shrink-0 rounded-full bg-paper/50" />
                  {shape}
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>

        <Reveal delay={90} className="md:col-span-5">
          <Card dots="bl" className="justify-between p-6 sm:p-8 md:p-10">
            <div>
              <Heading>The surroundings are there for a reason.</Heading>
              <Body>
                Spar isn&rsquo;t generating codebases because models can generate codebases. The environment
                exists to exercise something specific, and the complexity around it is part of what&rsquo;s
                being tested — noticing which part of an unfamiliar service is the broken one is a skill a
                function signature can&rsquo;t ask about.
              </Body>
            </div>
            <p className="mt-10 border-t border-line pt-7 font-display text-[1.06rem] leading-snug text-paper">
              Every generated challenge is built against one target, and says which.
            </p>
          </Card>
        </Reveal>
      </div>
    </Section>
  );
}
