import { defineConfig } from "vitest/config";
export default defineConfig({test:{include:["src/main/**/*.test.ts","src/workers/**/*.test.ts","src/shared/**/*.test.ts"],environment:"node"}});
