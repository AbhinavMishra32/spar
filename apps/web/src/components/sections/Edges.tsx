import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";

/**
 * The limits, on the page rather than in a footnote.
 *
 * Lifted from the README's own "being straight about the edges" section. A
 * landing page that only lists what a thing does is the reason nobody believes
 * landing pages, and every one of these is something you would find out in the
 * first ten minutes anyway.
 */
const EDGES = [
  {
    label: "Hosting",
    body: "There is no Spar-operated service. You deploy the API — a few commands on Vercel — or run it locally. Your account and the canonical copy of your history live wherever you put it.",
  },
  {
    label: "Signing",
    body: "Builds are not code-signed yet, so your operating system will say so in its usual alarming way. On a Mac, right-click and choose Open the first time. Signed builds are next on the list.",
  },
  {
    label: "Platforms",
    body: "macOS is the polished one. The Windows and Linux builds are real, but the Mac is where the window chrome, materials and window controls have had the attention.",
  },
  {
    label: "Sources",
    body: "Two that work: LeetCode and Codeforces. HackerRank and CodeChef appear in the app as planned sources, and are labelled that way rather than dressed up as integrations.",
  },
  {
    label: "Updates",
    body: "Opt-in. Packaged builds only check for updates when SPAR_ENABLE_UPDATES=1 is set. Otherwise you download new versions yourself.",
  },
];

export function Edges() {
  return (
    <Section>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-20">
        <div>
          <SectionHead
            index="06"
            label="The edges"
            title="What it doesn't do yet."
            lede="Worth knowing before you download, rather than after."
          />
        </div>

        <ul className="border-t border-line">
          {EDGES.map((edge, index) => (
            <Reveal key={edge.label} delay={index * 60}>
              <li className="grid gap-2 border-b border-line py-6 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-8">
                <span className="font-mono text-[11px] tracking-[0.16em] text-faint uppercase sm:pt-1">
                  {edge.label}
                </span>
                <p className="text-[0.95rem] leading-relaxed text-muted">{edge.body}</p>
              </li>
            </Reveal>
          ))}
        </ul>
      </div>
    </Section>
  );
}
