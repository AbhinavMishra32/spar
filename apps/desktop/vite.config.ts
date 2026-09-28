import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.dirname(fileURLToPath(import.meta.url));
/* base must be relative. A packaged build is loaded over file://, where Vite's
   default absolute "/assets/..." resolves against the filesystem root instead of
   the app directory: every script and stylesheet 404s and the window comes up
   blank. Dev never shows it, because there the same paths are served over http. */
export default defineConfig({
  base: "./",
  root: "src/renderer",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(root, "src/renderer") } },
  optimizeDeps: {
    /* Dev only, and not optional there. Tree-sitter locates its own runtime with
       `new URL("web-tree-sitter.wasm", import.meta.url)` — no leading `./`, so
       esbuild's pre-bundle treats it as a bare package specifier, cannot resolve
       it, and the module it hands back never starts. The failure is silent from
       the outside: `highlight()` catches it and returns one uncoloured span, so
       every snippet in the app renders as flat grey text and it reads like a
       styling choice. Served straight from node_modules the relative URL
       resolves against the real file and needs no rewriting at all. */
    exclude: ["web-tree-sitter"],
  },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    /* The app, and the transparent layer the onboarding draws on outside its
       window. A second page rather than a route in the first, so the overlay
       does not load Monaco and the whole app to draw some dots. */
    rollupOptions: { input: { index: path.resolve(root, "src/renderer/index.html"), arrival: path.resolve(root, "src/renderer/arrival.html") } },
  },
  server: { port: 5173, strictPort: true },
});
