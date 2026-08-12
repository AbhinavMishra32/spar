import { Wordmark } from "@/components/Mark";
import { site } from "@/lib/site";

export default function Home() {
  return (
    <main className="relative z-10">
      <section className="shell flex min-h-svh flex-col justify-center py-32">
        <Wordmark size={26} />
        <h1 className="fade-tail mt-10 text-[length:var(--text-display)]">
          A coding gym that
          <br />
          writes your next round.
        </h1>
        <p className="lede mt-7 max-w-[46ch]">{site.description}</p>
      </section>
    </main>
  );
}
