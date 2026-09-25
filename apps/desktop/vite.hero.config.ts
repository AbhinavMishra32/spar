import { readFileSync } from "node:fs";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The landing page's hero: the renderer, playing `src/hero/recording.json`.
 *
 * Built into the web app's public folder, where the hero frames it. The aliases
 * are the whole of the difference from the app's own build — each one swaps an
 * interactive or heavyweight dependency for what the film actually draws.
 *
 *   pnpm --filter @spar/desktop hero:dev     # watch it at localhost:5174
 *   pnpm --filter @spar/desktop hero:build   # write apps/web/public/hero
 */
const root = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.resolve(root, "src/renderer");

/** The pages the film never navigates to. App imports every page up front, so
 *  each is swapped for a module whose exports render nothing — the largest cut
 *  there is, and the one aliasing can't make, because it is per file. */
const UNSEEN = ["Ability", "Auth", "Baseline", "Challenge", "Challenges", "Onboarding", "Problems", "Sessions", "Settings", "Track", "Tracks", "Visualizer"]
  .map((name) => path.join(renderer, "components/pages", `${name}Page.tsx`));

function unseenPages(): Plugin {
  return {
    name: "hero-unseen-pages",
    enforce: "pre",
    load(id) {
      if (!UNSEEN.includes(id)) return null;
      const names = [...readFileSync(id, "utf8").matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map((match) => match[1]);
      return names.map((name) => `export const ${name} = () => null;`).join("\n");
    },
  };
}

export default defineConfig({
  base: "./",
  root: "src/hero",
  plugins: [unseenPages(), react(), tailwindcss()],
  resolve: {
    /* The workspace packages' source, not their last build: the film is built
       on its own, and nothing else here runs their compile first. */
    conditions: ["development", ...defaultClientConditions],
    alias: [
      { find: "@monaco-editor/react", replacement: path.resolve(root, "src/hero/StaticEditor.tsx") },
      { find: "@/lib/highlight", replacement: path.resolve(root, "src/hero/highlight.ts") },
      { find: "@", replacement: renderer },
    ],
  },
  optimizeDeps: { exclude: ["web-tree-sitter"] },
  build: {
    outDir: path.resolve(root, "../web/public/hero"),
    emptyOutDir: true,
    target: "es2022",
    reportCompressedSize: true,
  },
  server: { port: 5174, strictPort: true },
});
