import { getRelease } from "@/lib/release";
import { Boot } from "@/components/Boot";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/hero/Hero";
import { Nav } from "@/components/Nav";
import { SmoothScroll } from "@/components/SmoothScroll";
import { AbilityMap } from "@/components/sections/AbilityMap";
import { Attempt } from "@/components/sections/Attempt";
import { Download } from "@/components/sections/Download";
import { Faq } from "@/components/sections/Faq";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { LadderField } from "@/components/sections/Ladder";
import { Languages } from "@/components/sections/Languages";
import { Models } from "@/components/sections/Models";
import { NoCourse } from "@/components/sections/NoCourse";
import { ProofRun } from "@/components/sections/Proof";
import { Sources } from "@/components/sections/Sources";
import { TheAgent } from "@/components/sections/TheAgent";
import { TheApp } from "@/components/sections/TheApp";
import { Workspace } from "@/components/sections/Workspace";

/* The page is static, rebuilt on a timer, so the version it advertises follows
   GitHub without anyone editing this repository. */
export const revalidate = 3600;

export default async function Home() {
  const release = await getRelease();

  return (
    <>
      <Boot />
      <SmoothScroll />
      <Nav />
      <main className="relative z-10">
        {/* The order is the argument: what Spar knows about you, where that
            knowledge comes from, what it does with it, where the problems come
            from, and only then the app the whole thing happens in. */}
        <Hero release={release} />
        <Languages />
        <LadderField />
        <AbilityMap />
        <Attempt />
        <HowItWorks />
        <NoCourse />
        <Sources />
        <TheApp />
        <ProofRun />
        <TheAgent />
        <Workspace />
        <Models />
        <Download release={release} />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
