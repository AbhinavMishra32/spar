import pkg from "../../package.json";
import { REPO } from "./site";

/**
 * The latest release, from GitHub, at build time.
 *
 * The version used to be a constant here that a human had to remember to bump.
 * That is exactly the kind of thing nobody remembers: cut v0.3.1 and the site
 * quietly goes on offering v0.3.0 until someone notices. So the page asks
 * GitHub instead, and revalidates — a release published an hour ago is on the
 * site without anyone touching this repository.
 *
 * Assets are matched by shape rather than by name, because the only part of an
 * electron-builder filename that moves is the version in the middle of it.
 *
 * If GitHub is unreachable or rate-limits the build, the app's own package
 * version is the fallback. It is bumped by the release process, so the worst
 * case is the same answer the hardcoded constant used to give.
 */

const API = "https://api.github.com/repos/AbhinavMishra32/spar/releases/latest";

/** An hour. Long enough to never trouble the API, short enough that a release
 *  is live on the site the same morning it is cut. */
const REVALIDATE = 3600;

export type Build = {
  platform: "macOS" | "Windows" | "Linux";
  detail: string;
  href: string;
  /** Second build for the same platform, where one exists. */
  alt?: { label: string; href: string };
};

export type Release = {
  version: string;
  builds: Build[];
  /** False when this came from the fallback rather than from GitHub. */
  live: boolean;
};

type Asset = { name: string; browser_download_url: string };

/** How each build is recognised, whatever version is in the middle of its name. */
const SHAPES = {
  macArm: /-arm64\.dmg$/,
  macIntel: /^Spar-[\d.]+\.dmg$/,
  windows: /-x64\.exe$/,
  linuxAppImage: /\.AppImage$/,
  linuxDeb: /\.deb$/,
} as const;

function release(version: string, url: (shape: keyof typeof SHAPES) => string | undefined): Build[] {
  const asset = (shape: keyof typeof SHAPES) =>
    url(shape) ?? `${REPO}/releases/latest`;
  const intel = url("macIntel");
  const deb = url("linuxDeb");

  return [
    {
      platform: "macOS",
      detail: "Apple silicon · M1 and later",
      href: asset("macArm"),
      ...(intel ? { alt: { label: "Intel", href: intel } } : {}),
    },
    { platform: "Windows", detail: "x64 installer", href: asset("windows") },
    {
      platform: "Linux",
      detail: "AppImage, x86_64",
      href: asset("linuxAppImage"),
      ...(deb ? { alt: { label: ".deb", href: deb } } : {}),
    },
  ];
}

/** What the page falls back to: the version this app was built at. */
export function fallbackRelease(): Release {
  const version = pkg.version;
  const at = (file: string) => `${REPO}/releases/download/v${version}/${file}`;
  const names: Record<keyof typeof SHAPES, string> = {
    macArm: `Spar-${version}-arm64.dmg`,
    macIntel: `Spar-${version}.dmg`,
    windows: `Spar-${version}-x64.exe`,
    linuxAppImage: `Spar-${version}-x86_64.AppImage`,
    linuxDeb: `Spar-${version}-amd64.deb`,
  };
  return { version, builds: release(version, (shape) => at(names[shape])), live: false };
}

/** Picks each build out of a release's asset list by shape. */
export function buildsFromAssets(version: string, assets: readonly Asset[]): Build[] {
  return release(version, (shape) => assets.find((asset) => SHAPES[shape].test(asset.name))?.browser_download_url);
}

export async function getRelease(): Promise<Release> {
  try {
    const response = await fetch(API, {
      headers: { accept: "application/vnd.github+json" },
      next: { revalidate: REVALIDATE },
    });
    if (!response.ok) return fallbackRelease();

    const data = (await response.json()) as { tag_name?: string; assets?: Asset[] };
    const version = data.tag_name?.replace(/^v/, "");
    if (!version || !data.assets?.length) return fallbackRelease();

    return { version, builds: buildsFromAssets(version, data.assets), live: true };
  } catch {
    // A landing page that fails to build because GitHub had a bad minute is a
    // worse outcome than one advertising last week's version.
    return fallbackRelease();
  }
}
