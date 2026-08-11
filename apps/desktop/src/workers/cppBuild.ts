import path from "node:path";

export type CppStage = { bin: string; args: string[] };
export type CppPlan = { stages: CppStage[]; binaries: string[] } | { error: string };

const COMPILER = "clang++";
const FLAGS = ["-std=c++20", "-O2", "-Wall", "-Wextra", "-pedantic"];

/**
 * C++ ships no test runner, so a "test file" is simply a translation unit with
 * its own `main`. Two of them cannot be linked into one program, and the
 * question compiler validates by adding hidden test files to the same file set
 * as the visible ones — so each test source is built and run as its own binary
 * against the shared implementation.
 *
 * Discovery is by convention rather than one hardcoded path. The agent writes
 * these layouts, and a single fixed path it fails to guess makes the challenge
 * unbuildable for a reason no compiler diagnostic would ever explain.
 *
 * Pure on purpose: the caller owns the filesystem, so the plan is testable
 * without one.
 */
export function planCppBuild(input: { files: string[]; outputDir: string; command: "test" | "run" }): CppPlan {
  const entries = input.files.map((file) => ({ physical: file.replace(/^\.\/+/, ""), canonical: normalize(file) })).filter((entry) => !entry.canonical.startsWith(".spar/")).sort((a,b)=>a.canonical.localeCompare(b.canonical));
  const aliases = new Map<string,string[]>();
  for (const entry of entries) aliases.set(entry.canonical,[...(aliases.get(entry.canonical)??[]),entry.physical]);
  const collision = [...aliases].find(([,paths])=>new Set(paths).size>1);
  if(collision)return{error:`Workspace path collision: ${collision[1].map(value=>JSON.stringify(value)).join(" and ")} both identify ${collision[0]}. Normalize persisted workspace paths to forward slashes before building; no compiler was started.\n`};
  const files = entries.map((entry) => entry.physical);
  const sources = files.filter((file) => /\.(cpp|cc|cxx)$/.test(file));
  const testSources = sources.filter(isTestSource);
  const librarySources = sources.filter((file) => !isTestSource(file) && path.posix.basename(normalize(file)) !== "main.cpp");
  const include = includeFlags(files);

  const compile = (binary: string, inputs: string[]): CppStage => ({ bin: COMPILER, args: [...FLAGS, ...include, "-o", binary, ...inputs] });

  if (input.command === "run") {
    const entry = sources.find((file) => path.posix.basename(normalize(file)) === "main.cpp");
    if (!entry) return { error: `No C++ entrypoint found. Provide main.cpp defining int main(). Files seen: ${files.join(", ") || "none"}.\n` };
    const binary = path.join(input.outputDir, "solution");
    return { stages: [compile(binary, [entry, ...librarySources]), { bin: binary, args: [] }], binaries: [binary] };
  }

  if (!testSources.length) {
    return { error: `No C++ test sources found. Put each test in its own file under tests/ (for example tests/visible.test.cpp), each defining its own int main() that returns non-zero when an expectation fails. Files seen: ${files.join(", ") || "none"}.\n` };
  }

  const binaries = testSources.map((_, index) => path.join(input.outputDir, `test-${index}`));
  return {
    stages: testSources.flatMap((source, index) => [compile(binaries[index]!, [source, ...librarySources]), { bin: binaries[index]!, args: [] }]),
    binaries,
  };
}

function normalize(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function isTestSource(file: string): boolean {
  const canonical=normalize(file);
  return /(^|\/)tests?\//.test(canonical) || /[._-]test\.(cpp|cc|cxx)$/.test(canonical) || /(^|\/)test[^/]*\.(cpp|cc|cxx)$/.test(canonical);
}

/**
 * A test includes the implementation's header by bare name. Without a search
 * path covering wherever that header actually sits, the most ordinary C++
 * layout there is fails to compile — which is exactly what it used to do.
 */
function includeFlags(files: string[]): string[] {
  const directories = new Set<string>(["."]);
  for (const physical of files) {
    const file=normalize(physical);
    if (!/\.(h|hpp|hh|hxx)$/.test(file)) continue;
    const directory = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".";
    directories.add(directory);
  }
  for (const conventional of ["src", "include", "lib"]) {
    if (files.some((file) => normalize(file).startsWith(`${conventional}/`))) directories.add(conventional);
  }
  return [...directories].sort().map((directory) => `-I${directory}`);
}
