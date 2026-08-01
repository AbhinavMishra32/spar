import { defineConfig } from "vitest/config";
export default defineConfig({test:{include:["src/main/**/*.test.ts"],environment:"node"}});
