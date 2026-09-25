import { FeatureCard, FeatureSection, Intro } from "@/components/feature/Feature";
import { Drafting, Found, Said, StageTree } from "@/components/spar/fragments";

/** Where the next problem comes from. */
export function NextMove() {
  return (
    <FeatureSection id="how">
      <Intro eyebrow="What happens next" title="Your next problem is a decision." />

      <div className="mt-16 grid gap-x-6 gap-y-14 md:mt-20 md:grid-cols-2 xl:grid-cols-3">
        <FeatureCard
          hue="tide"
          title="Found where it already exists."
          visual={
            <>
              <div className="absolute top-[27%] left-[7%]"><Found /></div>
              <div className="absolute top-[7%] right-[6%]"><Said>I lose the invariant when a window shrinks</Said></div>
            </>
          }
        >
          LeetCode and Codeforces first, when a real problem already trains the thing.
        </FeatureCard>

        <FeatureCard
          hue="moss"
          delay={80}
          title="Written when it doesn’t."
          visual={
            <>
              <div className="absolute top-[21%] left-[7%]"><Drafting /></div>
              <div className="absolute top-[6%] right-[6%]"><Said delay={150}>simpler question</Said></div>
            </>
          }
        >
          A challenge for exactly your gap, with its own tests, in the language you train in.
        </FeatureCard>

        <FeatureCard
          className="md:col-span-2 xl:col-span-1"
          aspect="aspect-[4/3] md:aspect-[2/1] xl:aspect-[7/6]"
          hue="smoke"
          delay={160}
          title="Checked before you see it."
          visual={<div className="absolute top-[8%] left-[5%]"><StageTree /></div>}
        >
          A reference must pass every test and a plausible wrong answer must fail one. If not, it&rsquo;s repaired.
        </FeatureCard>
      </div>
    </FeatureSection>
  );
}
