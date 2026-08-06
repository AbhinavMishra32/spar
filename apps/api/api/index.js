/* Vercel's function entry point, kept to one line on purpose.
 *
 * The handler itself lives in `src/vercel.ts` so it is typechecked and compiled
 * by the normal build like everything else — `tsconfig.json` only includes
 * `src/**`, so a handler written here would be checked by nothing and would have
 * to import TypeScript that Vercel cannot compile across workspace packages.
 * This file re-exports the built output, which the build command has produced by
 * the time Vercel bundles the function.
 *
 * Deliberately JavaScript, not TypeScript. As a .ts file Vercel typechecked it
 * and demanded a declaration for `../dist/vercel.js`, which forced declaration
 * emit on for the whole package — and that could not be done, because Better
 * Auth's inferred instance type is not nameable from outside the pnpm store
 * (TS2742). A re-export has nothing worth typechecking anyway.
 */
export { default } from "../dist/vercel.js";
