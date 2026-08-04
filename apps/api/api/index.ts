/* Vercel's function entry point, kept to one line on purpose.
 *
 * The handler itself lives in `src/vercel.ts` so it is typechecked and compiled
 * by the normal build like everything else — `tsconfig.json` only includes
 * `src/**`, so a handler written here would be checked by nothing and would have
 * to import TypeScript that Vercel cannot compile across workspace packages.
 * This file re-exports the built output, which the build command has produced by
 * the time Vercel bundles the function. */
export { default } from "../dist/vercel.js";
