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
export default defineConfig({ base: "./", root: "src/renderer", plugins: [react(),tailwindcss()], resolve:{alias:{"@":path.resolve(root,"src/renderer")}}, build: { outDir: "../../dist/renderer", emptyOutDir: true }, server: { port: 5173, strictPort: true } });
