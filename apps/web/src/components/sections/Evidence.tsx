import { FeatureCard, FeatureSection } from "@/components/feature/Feature";
import { Reveal } from "@/components/Reveal";
import { Beliefs, ConceptPeek, RatingCard, RatingMove, Toolbar, Verdict } from "@/components/spar/fragments";

/** What Spar knows about you, and where it learned it. */
export function Evidence() {
  return (
    <FeatureSection id="abilities">
      <Reveal>
        <p className="mx-auto max-w-[34ch] text-center text-[clamp(1.5rem,3vw,2.35rem)] leading-[1.25] font-medium tracking-[-0.02em] text-balance">
          A roadmap is an order somebody fixed once, for somebody who isn&rsquo;t you.{" "}
          <span className="text-faint">Spar picks your next problem from how your last attempts actually went.</span>
        </p>
      </Reveal>

      <div className="mt-20 grid gap-x-6 gap-y-14 md:mt-28 md:grid-cols-2 xl:grid-cols-3">
        <FeatureCard
          hue="ember"
          title="Every attempt is evidence."
          visual={
            <>
              <div className="absolute top-[27%] left-[6%]"><Verdict /></div>
              <div className="absolute top-[8%] left-[7%]"><Toolbar /></div>
            </>
          }
        >
          Which case broke, on which input, after how many tries — kept, not graded and forgotten.
        </FeatureCard>

        <FeatureCard
          hue="dusk"
          delay={80}
          title="A map of what you can do."
          visual={
            <>
              <div className="absolute top-[9%] left-[7%]"><Beliefs /></div>
              <div className="absolute right-[6%] bottom-[5%]"><ConceptPeek /></div>
            </>
          }
        >
          Concepts, each with the attempts behind it, marked where Spar still needs evidence.
        </FeatureCard>

        <FeatureCard
          className="md:col-span-2 xl:col-span-1"
          aspect="aspect-[4/3] md:aspect-[2/1] xl:aspect-[7/6]"
          hue="amber"
          delay={160}
          title="A rating that explains itself."
          visual={
            <>
              <div className="absolute top-[9%] left-[7%]"><RatingCard /></div>
              <div className="absolute right-[6%] bottom-[7%]"><RatingMove /></div>
            </>
          }
        >
          Every move says what caused it, with rough Codeforces and LeetCode equivalents.
        </FeatureCard>
      </div>
    </FeatureSection>
  );
}
