import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({ root: "src/renderer", plugins: [react(),tailwindcss()], resolve:{alias:{"@":path.resolve(root,"src/renderer")}}, build: { outDir: "../../dist/renderer", emptyOutDir: true }, server: { port: 5173, strictPort: true } });
