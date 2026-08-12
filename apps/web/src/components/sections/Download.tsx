import { DownloadButton } from "@/components/DownloadButton";
import { Mark } from "@/components/Mark";
import { Reveal } from "@/components/Reveal";
import { Section } from "@/components/Section";
import { DotField } from "@/components/hero/DotField";
import { AppleGlyph, ArrowGlyph, LinuxGlyph, WindowsGlyph } from "@/components/icons";
import type { Release } from "@/lib/release";
import { site } from "@/lib/site";

const GLYPHS = { macOS: AppleGlyph, Windows: WindowsGlyph, Linux: LinuxGlyph };

/** The two things worth knowing before the download finishes. */
const NEEDS = [
  {
    title: "Sign in, and you're going",
    body: "Nothing to host, nothing to configure. Seven questions once, on your account rather than once per machine.",
  },
  {
    title: "A model to run the agent on",
    body: "The one thing Spar doesn't ship. A subscription you already have, a key, or Ollama on your own machine.",
  },
];

export function Download({ release }: { release: Release }) {
  return (
    <Section id="download">
      <Reveal>
        <div className="beam-border relative isolate overflow-hidden rounded-3xl border border-line bg-surface px-6 py-20 text-center sm:px-12 sm:py-24">
          {/* The page opened on the field and closes on it — the same dots, the
              same swell under the cursor, arcs and all. A CSS halftone stood in
              here before, and a still picture of the field in the one place the
              page is asking for something reads as the moment it gave up. */}
          <DotField spacing={30} radius={2.7} seat={null} arcZone={1} className="dot-field--panel" />
          <div className="panel-scrim" aria-hidden />

          <div className="relative">
            <Mark size={34} animated className="mx-auto" />
            <h2 className="mt-8 text-[length:var(--text-title)]">Get in the ring.</h2>
            <p className="lede mx-auto mt-5 max-w-[48ch]">
              Free, and the whole product is on GitHub.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <DownloadButton builds={release.builds} />
              <a href={site.repo} target="_blank" rel="noreferrer" className="btn btn-ghost">
                Read the source
                <ArrowGlyph className="size-[15px] opacity-70" />
              </a>
            </div>

            <p className="mt-6 font-mono text-[11px] tracking-[0.14em] text-ghost uppercase">
              <span className="shimmer">v{release.version} — free forever, no Spar subscription</span>
            </p>
          </div>
        </div>
      </Reveal>

      {/* Every build, as a manifest rather than as three cards. Three cards
          side by side ask you to compare them, and there is nothing to compare:
          you are on one of these machines and you want that row. A list with the
          version and the source above it reads the way a release page reads. */}
      <Reveal className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-3">
          <p className="font-mono text-[11px] tracking-[0.16em] text-faint uppercase">
            All builds — v{release.version}
          </p>
          <a
            href={site.releases}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.16em] text-ghost uppercase transition-colors hover:text-paper"
          >
            Checksums and notes on GitHub
            <ArrowGlyph className="size-3 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>

        <ul className="divide-y divide-line border-b border-line">
          {release.builds.map((build) => {
            const Glyph = GLYPHS[build.platform as keyof typeof GLYPHS];
            return (
              <li
                key={build.platform}
                className="flex flex-col gap-4 py-5 transition-colors hover:bg-white/[0.015] sm:flex-row sm:items-center sm:gap-6 sm:px-2"
              >
                <Glyph className="size-[17px] shrink-0 text-paper" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-[1.02rem] leading-none">{build.platform}</h3>
                  <p className="mt-2 font-mono text-[11px] tracking-[0.1em] text-ghost">{build.detail}</p>
                </div>
                <div className="flex shrink-0 items-center gap-5">
                  {build.alt ? (
                    <a
                      href={build.alt.href}
                      download=""
                      className="font-mono text-[11px] tracking-[0.1em] text-faint transition-colors hover:text-paper"
                    >
                      {build.alt.label}
                    </a>
                  ) : null}
                  <a
                    href={build.href}
                    download=""
                    className="group inline-flex items-center gap-1.5 text-[0.9rem] text-paper"
                  >
                    Download
                    <ArrowGlyph className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      </Reveal>

      <div className="mt-14 grid gap-10 md:grid-cols-2 md:gap-16">
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
