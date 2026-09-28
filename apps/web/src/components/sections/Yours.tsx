import { FeatureCard, FeatureSection, Intro } from "@/components/feature/Feature";
import { History, Judge, WhereItLives } from "@/components/spar/fragments";

/** What stays yours: the grading, the record, the data. */
export function Yours() {
  return (
    <FeatureSection id="yours">
      <Intro center title="Yours, end to end." />

      <div className="mt-16 grid gap-x-6 gap-y-14 md:mt-20 md:grid-cols-2 xl:grid-cols-3">
        <FeatureCard
          hue="ember"
          aspect="aspect-[6/5] [--fit:3.4]"
          
          title="Graded by tests."
          visual={<div className="absolute top-[8%] left-[7%]"><Judge /></div>}
        >
          Your code runs against visible and hidden cases. No model decides you passed.
        </FeatureCard>

        <FeatureCard
          hue="moss"
          aspect="aspect-[6/5] [--fit:3.4]"
          delay={80}
          title="Every run kept."
          visual={<div className="absolute top-[8%] left-[7%]"><History /></div>}
        >
          Passed, replaced or still open — the whole history, and why.
        </FeatureCard>

        <FeatureCard
          hue="smoke"
          className="md:col-span-2 xl:col-span-1"
          aspect="aspect-[6/5] md:aspect-[2/1] xl:aspect-[6/5] [--fit:3.4] md:[--fit:2.2] xl:[--fit:3.4]"
          delay={160}
          title="No telemetry."
          visual={<div className="absolute top-[20%] left-[7%]"><WhereItLives /></div>}
        >
          Keys in the system keychain. No analytics in the app or on this site.
        </FeatureCard>
      </div>
    </FeatureSection>
  );
}
