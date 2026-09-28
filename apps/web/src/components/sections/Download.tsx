import { DownloadButton } from "@/components/DownloadButton";
import { Mark } from "@/components/Mark";
import { Reveal } from "@/components/Reveal";
import { Section } from "@/components/Section";
import { AppleGlyph, ArrowGlyph, LinuxGlyph, WindowsGlyph } from "@/components/icons";
import type { Release } from "@/lib/release";
import { site } from "@/lib/site";

const GLYPHS = { macOS: AppleGlyph, Windows: WindowsGlyph, Linux: LinuxGlyph };

export function Download({ release }: { release: Release }) {
  return (
    <Section id="download">
      <Reveal>
        {/* The last plate on the page, lit like the others: the same light
            through the same dots, with the one thing it asks for on it. */}
        <div className="plate plate--dusk relative isolate px-6 py-20 text-center sm:px-12 sm:py-24">
          <span className="plate-glow" aria-hidden />
          <span className="plate-field" aria-hidden />

          <div className="relative">
            <Mark size={30} animated className="mx-auto" />
            <h2 className="mt-7 text-[length:var(--text-title)]">Get in the ring.</h2>
            <p className="mx-auto mt-4 max-w-[40ch] text-[clamp(1.02rem,1.3vw,1.15rem)] leading-relaxed text-white/60">
              Free, and the whole product is on GitHub.
            </p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <DownloadButton builds={release.builds} />
              <a href={site.repo} target="_blank" rel="noreferrer" className="btn btn-ghost">
                Read the source
                <ArrowGlyph className="size-[15px] opacity-70" />
              </a>
            </div>

            <p className="mt-6 text-[13px] text-white/40">v{release.version} · macOS, Windows and Linux</p>
          </div>
        </div>
      </Reveal>

      {/* Every build, one card per machine. Which one is yours is obvious;
          the card just has to make that one easy to hit. */}
      <Reveal className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-1">
          <p className="text-[0.9rem] text-faint">All builds · v{release.version}</p>
          <a
            href={site.releases}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-1.5 text-[0.9rem] text-faint transition-colors hover:text-paper"
          >
            Checksums on GitHub
            <ArrowGlyph className="size-3 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>

        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {release.builds.map((build) => {
            const Glyph = GLYPHS[build.platform as keyof typeof GLYPHS];
            return (
              <li
                key={build.platform}
                className="build-card"
              >
                <Glyph aria-hidden className="build-card-ghost" />
                <span className="build-card-mark">
                  <Glyph className="size-[42%] text-paper" />
                </span>
                <h3 className="mt-5 text-[1.1rem] leading-none">{build.platform}</h3>
                <p className="mt-2 text-[0.88rem] text-faint">{build.detail}</p>
                <div className="mt-6 flex items-center gap-4">
                  <a href={build.href} download="" className="build-card-download group">
                    Download
                    <ArrowGlyph className="size-3.5 rotate-90 transition-transform group-hover:translate-y-0.5" />
                  </a>
                  {build.alt ? (
                    <a href={build.alt.href} download="" className="text-[0.85rem] text-faint transition-colors hover:text-paper">
                      {build.alt.label}
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Reveal>
    </Section>
  );
}
