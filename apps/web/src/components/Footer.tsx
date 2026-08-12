import { Mark } from "@/components/Mark";
import { GitHubGlyph } from "@/components/icons";
import { REPO, site } from "@/lib/site";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { label: "How it works", href: "#how" },
      { label: "The app", href: "#app" },
      { label: "Models", href: "#models" },
      { label: "Download", href: "#download" },
    ],
  },
  {
    heading: "Source",
    links: [
      { label: "Repository", href: REPO },
      { label: "Releases", href: `${REPO}/releases` },
      { label: "Issues", href: `${REPO}/issues` },
      { label: "Licence", href: `${REPO}#readme` },
    ],
  },
  {
    heading: "Docs",
    links: [
      { label: "Architecture", href: `${REPO}/blob/main/docs/architecture.md` },
      { label: "Threat model", href: `${REPO}/blob/main/docs/threat-model.md` },
      { label: "Practice sources", href: `${REPO}/blob/main/docs/practice-sources.md` },
      { label: "Releasing", href: `${REPO}/blob/main/docs/releasing.md` },
    ],
  },
];

export function Footer() {
  return (
    <footer className="edge relative overflow-hidden">
      <div className="shell pt-20 pb-10">
        <div className="grid gap-12 md:grid-cols-[minmax(0,1fr)_auto] md:gap-20">
          <div className="max-w-[34ch]">
            <Mark size={26} />
            <p className="mt-6 text-[0.95rem] leading-relaxed text-muted">{site.tagline}</p>
            <a
              href={site.repo}
              target="_blank"
              rel="noreferrer"
              className="mt-7 inline-flex items-center gap-2 text-[0.9rem] text-faint transition-colors hover:text-paper"
            >
              <GitHubGlyph className="size-4" />
              AbhinavMishra32/spar
            </a>
          </div>

          <nav className="grid grid-cols-2 gap-x-12 gap-y-10 sm:grid-cols-3" aria-label="Footer">
            {COLUMNS.map((column) => (
              <div key={column.heading}>
                <p className="font-mono text-[10px] tracking-[0.2em] text-ghost uppercase">
                  {column.heading}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        {...(link.href.startsWith("#") ? {} : { target: "_blank", rel: "noreferrer" })}
                        className="text-[0.9rem] text-muted transition-colors hover:text-paper"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-16 flex flex-col gap-3 border-t border-line pt-7 text-[0.82rem] text-ghost sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Spar — no analytics, no telemetry.</p>
          <p className="font-mono text-[11px] tracking-[0.12em] uppercase">
            The tests decide the verdict. Never the model.
          </p>
        </div>
      </div>

      {/* The wordmark as the floor of the page, cropped by the fold. */}
      <p
        aria-hidden
        className="pointer-events-none -mb-[0.24em] w-full text-center font-display leading-[0.78] text-white/[0.045] select-none"
        style={{ fontSize: "clamp(5rem, 21vw, 19rem)", letterSpacing: "-0.05em" }}
      >
        Spar
      </p>
    </footer>
  );
}
