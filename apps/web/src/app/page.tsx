import { getRelease } from "@/lib/release";
import { Boot } from "@/components/Boot";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/hero/Hero";
import { Nav } from "@/components/Nav";
import { SmoothScroll } from "@/components/SmoothScroll";
import { AgentFeature } from "@/components/sections/AgentFeature";
import { Download } from "@/components/sections/Download";
import { Evidence } from "@/components/sections/Evidence";
import { Faq } from "@/components/sections/Faq";
import { Languages } from "@/components/sections/Languages";
import { NextMove } from "@/components/sections/NextMove";
import { Providers } from "@/components/sections/Providers";
import { Yours } from "@/components/sections/Yours";

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
        {/* What Spar knows about you, what it does with it, who does the
            work, and what stays yours. Every section shows the app. */}
        <Hero release={release} />
        <Languages />
        <Evidence />
        <NextMove />
        <AgentFeature />
        <Providers />
        <Yours />
        <Download release={release} />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
