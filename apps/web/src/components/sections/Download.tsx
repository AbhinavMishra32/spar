import { DownloadButton } from "@/components/DownloadButton";
import { Mark } from "@/components/Mark";
import { Reveal } from "@/components/Reveal";
import { Section } from "@/components/Section";
import { AppleGlyph, ArrowGlyph, LinuxGlyph, WindowsGlyph } from "@/components/icons";
import { downloads, site } from "@/lib/site";

const GLYPHS = { macOS: AppleGlyph, Windows: WindowsGlyph, Linux: LinuxGlyph };

/** The two things worth knowing before the download finishes. */
const NEEDS = [
  {
    title: "Sign in, and you're going",
    body: "Nothing to host and nothing to configure. You answer seven questions once — on your account, not once per machine — and Spar makes its opening call from there.",
  },
  {
    title: "A model to run the agent on",
    body: "The one thing Spar doesn't ship. Sign in with a subscription you already have, paste a key, or point it at Ollama and keep the whole thing on your machine.",
  },
];

export function Download() {
  return (
    <Section id="download">
      <Reveal>
        <div className="beam-border relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-16 text-center sm:px-12">
          {/* A quiet echo of the hero, so the page closes where it opened. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.55]"
            style={{
              backgroundImage:
                "radial-gradient(circle at center, rgba(255,255,255,0.16) 1.2px, transparent 1.3px)",
              backgroundSize: "30px 30px",
              maskImage: "radial-gradient(60% 70% at 50% 50%, transparent 20%, #000 90%)",
            }}
          />

          <div className="relative">
            <Mark size={34} animated className="mx-auto" />
            <h2 className="mt-8 text-[length:var(--text-title)]">Get in the ring.</h2>
            <p className="lede mx-auto mt-5 max-w-[48ch]">
              Free, and the whole product is on GitHub — the desktop app, the API and the deterministic
              challenge compiler.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <DownloadButton />
              <a href={site.repo} target="_blank" rel="noreferrer" className="btn btn-ghost">
                Read the source
                <ArrowGlyph className="size-[15px] opacity-70" />
              </a>
            </div>

            <p className="mt-6 font-mono text-[11px] tracking-[0.14em] text-ghost uppercase">
              <span className="shimmer">v{site.version} — free forever, no Spar subscription</span>
            </p>
          </div>
        </div>
      </Reveal>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {downloads.map((build, index) => {
          const Glyph = GLYPHS[build.platform as keyof typeof GLYPHS];
          return (
            <Reveal key={build.platform} delay={index * 80}>
              <div className="flex h-full flex-col rounded-2xl border border-line bg-surface p-7">
                <Glyph className="size-5 text-paper" />
                <h3 className="mt-5 text-[1.1rem]">{build.platform}</h3>
                <p className="mt-1.5 font-mono text-[11px] tracking-[0.1em] text-ghost">{build.detail}</p>
                <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-5">
                  <a
                    href={build.href}
                    download=""
                    className="group inline-flex items-center gap-1.5 text-[0.9rem] text-paper"
                  >
                    Download
                    <ArrowGlyph className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </a>
                  {build.alt ? (
                    <a
                      href={build.alt.href}
                      download=""
                      className="text-[0.9rem] text-faint transition-colors hover:text-paper"
                    >
                      {build.alt.label}
                    </a>
                  ) : null}
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>

      <div className="mt-16 grid gap-10 border-t border-line pt-12 md:grid-cols-2 md:gap-16">
        {NEEDS.map((need, index) => (
          <Reveal key={need.title} delay={index * 90}>
            <h3 className="text-[1.1rem]">{need.title}</h3>
            <p className="mt-3 text-[0.94rem] leading-relaxed text-muted">{need.body}</p>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
