import { getRelease } from "@/lib/release";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/hero/Hero";
import { Nav } from "@/components/Nav";
import { Download } from "@/components/sections/Download";
import { Faq } from "@/components/sections/Faq";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Languages } from "@/components/sections/Languages";
import { Models } from "@/components/sections/Models";
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
      <Nav />
      <main className="relative z-10">
        <Hero release={release} />
        <Languages />
        <Workspace />
        <HowItWorks />
        <TheApp />
        <TheAgent />
        <Sources />
        <Models />
        <Download release={release} />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
