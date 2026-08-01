/**
 * Reads the visible test files as *cases* rather than as source. Challenges are
 * generated against `node:test` + `node:assert`, so a case is a `test("name", …)`
 * block and its assertions are `assert.<method>(actual, expected)` calls.
 *
 * Extraction is best-effort by design: anything that does not match cleanly is
 * reported as unparsed so the caller can show the file verbatim instead of
 * presenting a half-read case as if it were the whole contract.
 */

export type CaseAssertion = { call: string; expected: string; method: string };

export type DeclaredCase = {
  id: string;
  ordinal: number;
  name: string;
  file: string;
  assertions: CaseAssertion[];
};

export type DeclaredCases = { parsed: boolean; cases: DeclaredCase[] };

const TEST_BLOCK = /\b(?:test|it)\s*\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`]*)`)/g;
const ASSERTION = /\bassert\s*\.\s*(strictEqual|deepStrictEqual|equal|deepEqual|notStrictEqual|ok|match|throws)\s*\(/g;

export function declaredCases(files: Record<string, string>, order: string[]): DeclaredCases {
  const cases: DeclaredCase[] = [];
  let ordinal = 0;

  for (const file of order) {
    const source = files[file];
    if (!source) continue;

    const blocks = [...source.matchAll(TEST_BLOCK)];
    for (const [index, block] of blocks.entries()) {
      const name = block[1] ?? block[2] ?? block[3] ?? "";
      const start = block.index ?? 0;
      const end = blocks[index + 1]?.index ?? source.length;
      ordinal += 1;
      cases.push({
        id: `${file}:${ordinal}`,
        ordinal,
        name: unescape(name),
        file,
        assertions: assertionsIn(source.slice(start, end)),
      });
    }
  }

  return { parsed: cases.length > 0, cases };
}

function assertionsIn(body: string): CaseAssertion[] {
  const found: CaseAssertion[] = [];
  ASSERTION.lastIndex = 0;
  for (let match = ASSERTION.exec(body); match; match = ASSERTION.exec(body)) {
    const open = body.indexOf("(", match.index + match[0].length - 1);
    const parsed = splitArguments(body, open + 1);
    if (!parsed) continue;
    ASSERTION.lastIndex = parsed.end + 1;
    const [call, expected] = parsed.arguments;
    if (!call) continue;
    found.push({
      method: match[1] ?? "strictEqual",
      call: compact(call),
      expected: compact(expected ?? ""),
    });
  }
  return found;
}

/** Splits a call's top-level arguments, ignoring commas inside nested brackets and strings. */
function splitArguments(source: string, start: number): { arguments: string[]; end: number } | null {
  const values: string[] = [];
  let cursor = start;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === "]" || character === "}") depth -= 1;
    else if (character === ")") {
      if (depth === 0) {
        values.push(source.slice(cursor, index).trim());
        return { arguments: values, end: index };
      }
      depth -= 1;
    } else if (character === "," && depth === 0) {
      values.push(source.slice(cursor, index).trim());
      cursor = index + 1;
    }
  }
  return null;
}

/** Collapses a multi-line argument onto one line so it fits a case row. */
function compact(value: string): string {
  return value.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

function unescape(value: string): string {
  return value.replace(/\\(["'`\\])/g, "$1");
}
