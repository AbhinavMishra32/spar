/**
 * Every typeface on this site, in one file.
 *
 * Spar's face is expected to change. So nothing else in the codebase names a
 * typeface: the whole site reads type through three CSS variables — `--face-brand`
 * for the wordmark and display lines, `--face-sans` for everything you read, and
 * `--face-mono` for labels and code — plus the two metric knobs below. The
 * stylesheet maps those onto the `font-display` / `font-sans` / `font-mono`
 * utilities once, in `globals.css`, and never mentions a font name again.
 *
 * ## Changing the font
 *
 * Edit the three loaders. Nothing else. `app/layout.tsx` spreads whatever this
 * file exports onto `<html>`, and the rest of the site follows.
 *
 * A Google face is a one-line swap:
 *
 * ```ts
 * import { Inter_Tight } from "next/font/google";
 * const brand = Inter_Tight({ weight: ["600"], subsets: ["latin"], variable: "--face-brand", display: "swap" });
 * ```
 *
 * A face you host yourself is the same shape, from `next/font/local`:
 *
 * ```ts
 * import localFont from "next/font/local";
 * const brand = localFont({
 *   src: [{ path: "../../public/fonts/Whatever-SemiBold.woff2", weight: "600", style: "normal" }],
 *   variable: "--face-brand",
 *   display: "swap",
 * });
 * ```
 *
 * ## The metric knobs
 *
 * Faces are not interchangeable at the same settings — a swap that keeps the old
 * tracking usually reads as loose or cramped rather than as a different font. So
 * the two values a display face actually needs retuning are variables too, set
 * here beside the loader that made them necessary rather than buried in the CSS.
 */
import { Geist, Geist_Mono, Poppins } from "next/font/google";
import type { CSSProperties } from "react";

/** The wordmark and the display headlines. Matches the desktop app's `--font-spar`. */
const brand = Poppins({
  weight: ["500", "600"],
  subsets: ["latin"],
  variable: "--face-brand",
  display: "swap",
});

/** Body copy, navigation, buttons — everything that is read rather than looked at. */
const sans = Geist({
  subsets: ["latin"],
  variable: "--face-sans",
  display: "swap",
});

/** Section labels, keycaps, filenames, terminal lines. */
const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--face-mono",
  display: "swap",
});

/**
 * Retuned per face. Poppins is a geometric sans with generous sidebearings, so
 * display sizes are pulled in; a face with tighter defaults wants less negative
 * tracking, and a grotesque usually wants none.
 */
interface BrandMetrics extends CSSProperties {
  /** Tracking for anything set in the brand face at display size. */
  "--brand-tracking": string;
  /** Weight the wordmark is drawn at. Must be one of the weights loaded above. */
  "--brand-weight": string;
}

const metrics: BrandMetrics = {
  "--brand-tracking": "-0.035em",
  "--brand-weight": "600",
};

/** Goes on `<html>`: the three font variables plus their metric knobs. */
export const fontClassName = `${brand.variable} ${sans.variable} ${mono.variable}`;
export const fontStyle: CSSProperties = metrics;
