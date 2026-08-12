import { describe, expect, it } from "vitest";
import { REPO, VERSION, downloads, site } from "./site";

/**
 * Cutting a release means bumping `VERSION` and nothing else. That only holds
 * if every download URL is derived from it, so this is the seam that keeps the
 * buttons from quietly pointing at the previous release forever.
 */
describe("the download links", () => {
  it("covers the three platforms once each", () => {
    expect(downloads.map((build) => build.platform)).toEqual(["macOS", "Windows", "Linux"]);
  });

  it("points every asset at this version's release", () => {
    const links = downloads.flatMap((build) => [build.href, ...(build.alt ? [build.alt.href] : [])]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.startsWith(`${REPO}/releases/download/v${VERSION}/`)).toBe(true);
      // electron-builder names every artefact after the version too, so a link
      // that carries the right tag and the wrong filename is still a 404.
      expect(link).toContain(`Spar-${VERSION}`);
    }
  });

  it("agrees with the version the page prints", () => {
    expect(site.version).toBe(VERSION);
    expect(site.releases.startsWith(REPO)).toBe(true);
  });
});
