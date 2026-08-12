"use client";

import { useEffect, useState } from "react";
import { AppleGlyph, DownloadGlyph, LinuxGlyph, WindowsGlyph } from "@/components/icons";
import { cn } from "@/lib/cn";
import { downloads } from "@/lib/site";

type Platform = "macOS" | "Windows" | "Linux";

function detect(): Platform | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad/.test(ua)) return "macOS";
  if (/Win/.test(ua)) return "Windows";
  if (/Linux|X11|Android/.test(ua)) return "Linux";
  return null;
}

const GLYPHS = { macOS: AppleGlyph, Windows: WindowsGlyph, Linux: LinuxGlyph };

/**
 * One button that points at the build for the machine you are on.
 *
 * It renders as a plain "Download Spar" on the server and names your platform
 * once it has mounted — a guess made during hydration would either mismatch or
 * force the whole hero to be client-rendered for one word.
 *
 * On a Mac it offers the Apple silicon build, which is the common case and the
 * wrong one for an Intel Mac; every build is listed under #download, and the
 * link beside this button goes straight there.
 */
export function DownloadButton({ className }: { className?: string }) {
  const [platform, setPlatform] = useState<Platform | null>(null);

  useEffect(() => setPlatform(detect()), []);

  const build = downloads.find((entry) => entry.platform === platform);
  const Glyph = platform ? GLYPHS[platform] : DownloadGlyph;

  return (
    <a
      href={build?.href ?? "#download"}
      className={cn("btn btn-primary", className)}
      {...(build ? { download: "" } : {})}
    >
      <Glyph className="size-[15px] opacity-80" />
      {platform ? `Download for ${platform}` : "Download Spar"}
    </a>
  );
}
