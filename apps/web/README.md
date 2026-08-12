# @spar/web

Spar's landing page. A single static route — no data fetching, no database, no
workspace dependencies — so it builds on its own and deploys on its own.

```bash
corepack pnpm dev:web      # http://localhost:4319
corepack pnpm --filter @spar/web build
corepack pnpm --filter @spar/web test
```

## Changing the font

Spar's face is expected to change, so exactly one file names a typeface:
[`src/lib/fonts.ts`](src/lib/fonts.ts). Everything else reads three CSS
variables — `--face-brand` for the wordmark and display lines, `--face-sans` for
what you read, `--face-mono` for labels — and `globals.css` binds those to the
`font-display` / `font-sans` / `font-mono` utilities once.

To swap the brand face, change its loader:

```ts
import { Inter_Tight } from "next/font/google";

const brand = Inter_Tight({
  weight: ["600"],
  subsets: ["latin"],
  variable: "--face-brand",
  display: "swap",
});
```

A face you host yourself is the same shape from `next/font/local`, pointing at
files under `public/fonts/`.

Retune `metrics` in the same file while you are there. Faces are not
interchangeable at identical settings — `--brand-tracking` and `--brand-weight`
live next to the loader because a swap that keeps the old tracking reads as the
wrong font rather than as a different one.

## What's where

| Path | |
| --- | --- |
| `src/lib/site.ts` | Version, links, download URLs, the provider and language lists. Bumping `VERSION` moves every download link with it, and a test holds that. |
| `src/lib/fonts.ts` | The three typefaces and their metric knobs. |
| `src/app/globals.css` | The theme: one black ground, a greyscale ramp, hairline rails, and the red/cyan pair reserved for aberration fringing. Also the effects — beams, border beam, shimmer, reveal. |
| `src/components/hero/` | The dot field. `dotFieldShader.ts` is the fragment shader; `DotField.tsx` drives it. |
| `src/components/Mark.tsx` | The five-by-five mark, geometry copied from the desktop app's icon renderer and pinned by `Mark.test.ts`. |
| `src/components/providers.tsx` | Provider marks, ported from the desktop app's `ProviderGlyph` so the logos here match the ones in Settings. |
| `src/components/sections/` | One file per section, in page order. |

## The hero

The field is Spar's mark at page scale, drawn as a WebGL2 fragment shader.
Dots swell under the pointer; each is drawn once per colour channel with the
copies pushed apart along the line from the cursor, which leaves the fringe a
fast lens does. A click sends a band out from where you pressed, and when
nobody has pointed at it yet the swell wanders the field on its own.

Two things in the shader look like mistakes and are not. The three channel
copies share a radius — giving red a larger one is the obvious way to write it
and turns the whole field orange, because the biggest channel ends up outermost
everywhere. And every offset is a fraction of the dot's own radius, because a
flat 2px split tears a 1.5px resting dot into three separate coloured ones.

Where there is no WebGL2 the element keeps a plain CSS dot grid, and
`prefers-reduced-motion` stops the wave, the drift and the ripple while leaving
the swell.
