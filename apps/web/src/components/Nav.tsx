"use client";

import { useEffect, useState } from "react";
import { Wordmark } from "@/components/Mark";
import { GitHubGlyph } from "@/components/icons";
import { nav, site } from "@/lib/site";

/**
 * Transparent over the hero, and a blurred bar once you have scrolled past it.
 * The dot field is the first thing the page shows; a chrome bar sitting on top
 * of it from the first pixel would be the second.
 */
export function Nav() {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="nav" data-stuck={stuck}>
      <div className="shell flex h-16 items-center justify-between gap-6">
        <a href="#top" aria-label={`${site.name}, back to top`} className="shrink-0">
          <Wordmark size={21} />
        </a>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Sections">
          {nav.map((item) => (
            <a key={item.href} href={item.href} className="nav-link">
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={site.repo}
            className="nav-link hidden items-center gap-2 px-2 sm:flex"
            target="_blank"
            rel="noreferrer"
          >
            <GitHubGlyph className="size-[17px]" />
            <span className="sr-only sm:not-sr-only">GitHub</span>
          </a>
          <a href="#download" className="btn btn-primary h-10 px-5 text-[0.88rem]">
            Download
          </a>
        </div>
      </div>
    </header>
  );
}
