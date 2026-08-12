import { Footer } from "@/components/Footer";
import { Hero } from "@/components/hero/Hero";
import { Nav } from "@/components/Nav";
import { Download } from "@/components/sections/Download";
import { Edges } from "@/components/sections/Edges";
import { Faq } from "@/components/sections/Faq";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Languages } from "@/components/sections/Languages";
import { Models } from "@/components/sections/Models";
import { Sources } from "@/components/sections/Sources";
import { TheApp } from "@/components/sections/TheApp";
import { Workspace } from "@/components/sections/Workspace";

export default function Home() {
  return (
    <>
      <Nav />
      <main className="relative z-10">
        <Hero />
        <Languages />
        <Workspace />
        <HowItWorks />
        <TheApp />
        <Sources />
        <Models />
        <Edges />
        <Download />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
