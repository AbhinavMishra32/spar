/**
 * Workspace paths are protocol values, not host filesystem paths.
 *
 * Persisting `path.relative()` directly made a checkpoint written on Windows
 * carry backslashes. On macOS those are ordinary filename characters, so a
 * restored `src\solution.cpp` could sit beside `src/solution.cpp`. Keep one
 * representation everywhere outside the final filesystem resolution step.
 */
export function canonicalWorkspacePath(value: string): string {
  if (value.includes("\0")) throw new Error("Workspace path contains a null byte");
  const slashed = value.replace(/\\/g, "/");
  if (slashed.startsWith("/") || /^[A-Za-z]:\//.test(slashed)) throw new Error("Workspace path must be relative");
  const parts = slashed.split("/").filter((part) => part && part !== ".");
  if (!parts.length) throw new Error("Workspace path is empty");
  if (parts.includes("..")) throw new Error("Workspace path escapes workspace root");
  return parts.join("/");
}
