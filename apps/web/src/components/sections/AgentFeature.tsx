import { FeatureSection, Plate } from "@/components/feature/Feature";
import { Reveal } from "@/components/Reveal";
import { AgentTurn, ToolRow } from "@/components/spar/fragments";

const POINTS = [
  { title: "Talk to it like a coach.", body: "Ask for something simpler, a hint, or the case you keep missing." },
  { title: "It changes the plan, not just the reply.", body: "Every new challenge is drafted, validated and published before it lands." },
];

/** The agent, as one split: what it does on the left, the turn on the right. */
export function AgentFeature() {
  return (
    <FeatureSection id="agent">
      <div className="grid items-center gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <Reveal>
          <p className="feature-eyebrow">The agent</p>
          <h2 className="mt-4 text-[length:var(--text-title)]">A coach that writes the next problem.</h2>
          <dl className="mt-10 grid gap-7">
            {POINTS.map((point) => (
              <div key={point.title}>
                <dt className="text-paper">{point.title}</dt>
                <dd className="mt-1.5 text-faint">{point.body}</dd>
              </div>
            ))}
          </dl>
        </Reveal>

        <Reveal delay={100}>
          <Plate hue="dusk" className="aspect-[6/5] [--fit:2.6]">
            <div className="absolute top-[15%] left-[5%]"><AgentTurn /></div>
            <div className="absolute right-[6%] bottom-[9%]"><ToolRow text="Validation passed · reference 31/31" delay={2000} /></div>
          </Plate>
        </Reveal>
      </div>
    </FeatureSection>
  );
}
