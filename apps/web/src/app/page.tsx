import { Hero } from "@/components/hero/Hero";
import { Nav } from "@/components/Nav";

export default function Home() {
  return (
    <>
      <Nav />
      <main className="relative z-10">
        <Hero />
      </main>
    </>
  );
}
