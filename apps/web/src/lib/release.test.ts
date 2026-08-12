import { describe, expect, it } from "vitest";
import { buildsFromAssets, fallbackRelease } from "./release";

/** The real asset list from a release, which is what the matcher has to survive. */
const ASSETS = [
  "latest-linux.yml",
  "latest-mac.yml",
  "latest.yml",
  "Spar-9.9.9-amd64.deb",
  "Spar-9.9.9-arm64-mac.zip",
  "Spar-9.9.9-arm64-mac.zip.blockmap",
  "Spar-9.9.9-arm64.dmg",
  "Spar-9.9.9-arm64.dmg.blockmap",
  "Spar-9.9.9-mac.zip",
  "Spar-9.9.9-x64.exe",
  "Spar-9.9.9-x64.exe.blockmap",
  "Spar-9.9.9-x86_64.AppImage",
  "Spar-9.9.9.dmg",
  "Spar-9.9.9.dmg.blockmap",
].map((name) => ({ name, browser_download_url: `https://example.test/${name}` }));

/**
 * The version is no longer a constant anyone maintains — it comes from the
 * latest release. What has to hold instead is that each build is picked out of
 * that release's asset list correctly, whatever version is in the middle of the
 * filenames, and that the blockmaps and update manifests sitting beside them are
 * never mistaken for a download.
 */
describe("picking builds out of a release", () => {
  const builds = buildsFromAssets("9.9.9", ASSETS);
  const href = (platform: string) => builds.find((b) => b.platform === platform)!.href;

  it("covers the three platforms once each", () => {
    expect(builds.map((b) => b.platform)).toEqual(["macOS", "Windows", "Linux"]);
  });

  it("takes the installer, not the blockmap beside it", () => {
    expect(href("macOS")).toContain("Spar-9.9.9-arm64.dmg");
    expect(href("Windows")).toContain("Spar-9.9.9-x64.exe");
    expect(href("Linux")).toContain("Spar-9.9.9-x86_64.AppImage");
    for (const build of builds) {
      expect(build.href).not.toContain(".blockmap");
      expect(build.href).not.toContain(".yml");
    }
  });

  it("offers the Intel dmg without mistaking it for the arm64 one", () => {
    const mac = builds.find((b) => b.platform === "macOS")!;
    expect(mac.alt?.href).toContain("Spar-9.9.9.dmg");
    expect(mac.alt?.href).not.toContain("arm64");
  });

  it("falls back to the release the app was built at", () => {
    const fallback = fallbackRelease();
    expect(fallback.live).toBe(false);
    expect(fallback.version).toMatch(/^\d+\.\d+\.\d+/);
    for (const build of fallback.builds) {
      expect(build.href).toContain(`v${fallback.version}`);
      expect(build.href).toContain(`Spar-${fallback.version}`);
    }
  });
});
