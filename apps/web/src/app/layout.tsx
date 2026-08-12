import type { Metadata, Viewport } from "next";
import { fontClassName, fontStyle } from "@/lib/fonts";
import { site } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s — ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  keywords: [
    "coding practice",
    "adaptive practice",
    "LeetCode alternative",
    "programming exercises",
    "AI tutor",
    "developer training",
  ],
  authors: [{ name: "Abhinav Mishra", url: site.repo }],
  openGraph: {
    type: "website",
    url: site.url,
    siteName: site.name,
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontClassName} style={fontStyle}>
      <body className="bg-ink text-paper antialiased">
        {/* Both are decoration and neither scrolls: the column rails behind the
            page, the grain over it. */}
        <div className="rails" aria-hidden />
        {children}
        <div className="grain" aria-hidden />
      </body>
    </html>
  );
}
