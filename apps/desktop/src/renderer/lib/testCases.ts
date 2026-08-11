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

/**
 * The cases a sourced problem publishes, in the same shape the parser produces.
 *
 * No parsing: they arrived structured from the source and travel on the challenge.
 * Rendered as the call the source's own starter declares — `maxProfit([7,1,5,3,6,4])`
 * — because that is how the problem page states it and how the learner will type
 * it. When the source published no signature there is no call to write, so the
 * arguments stand on their own.
 */
export function sourcedCases(source: { entryName: string; slug: string; cases: Array<{ name: string; input: string[]; expected: string }> }): DeclaredCases {
  const cases = source.cases.map((item, index) => ({
    id: `${source.slug}:${index + 1}`,
    ordinal: index + 1,
    name: item.name,
    file: "",
    assertions: [{
      method: "deepStrictEqual",
      call: source.entryName ? `${source.entryName}(${item.input.join(", ")})` : item.input.join(", "),
      expected: item.expected,
    }],
  }));
  return { parsed: cases.length > 0, cases };
}

export function declaredCases(files: Record<string, string>, order: string[]): DeclaredCases {
  const cases: DeclaredCase[] = [];
  let ordinal = 0;

  for (const file of order) {
    const source = files[file];
    if (!source) continue;

    const blocks = [...source.matchAll(TEST_BLOCK)];
    /* No `test(…)` blocks: this is a C++ suite, which declares its cases as
       `check(…)` calls instead. Read those rather than falling through to showing
       the file — a C++ challenge's cases are as structured as a JavaScript one's,
       and the panel was showing source code to anyone working in C++. */
    if (!blocks.length) {
      for (const item of cppCases(source)) {
        ordinal += 1;
        cases.push({ ...item, id: `${file}:${ordinal}`, ordinal, file });
      }
      continue;
    }
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

/**
 * The cases in a generated C++ suite.
 *
 * Every one is a `check("name", spar::render(solution.entry(arg0, …)), "expected")`
 * call preceded by the declarations of the arguments it passes, because a C++
 * signature takes its containers by reference and a temporary will not bind to
 * one. So the call as written names locals, and reading the case means putting
 * their values back into it — `maxProfit({7, 1, 5, 3, 6, 4})` is the case, and
 * `solution.maxProfit(arg0)` is only how it had to be spelled.
 */
const CHECK_CALL = /\bcheck\s*\(/g;
const ARGUMENT = /^\s*(?:[\w:]+(?:\s*<[^;]*>)?[\s&*]+)(arg\d+)\s*=\s*([\s\S]*?);\s*$/gm;

function cppCases(source: string): Array<Pick<DeclaredCase, "name" | "assertions">> {
  const found: Array<Pick<DeclaredCase, "name" | "assertions">> = [];
  CHECK_CALL.lastIndex = 0;
  let previousEnd = 0;

  for (let match = CHECK_CALL.exec(source); match; match = CHECK_CALL.exec(source)) {
    const open = match.index + match[0].length;
    const parsed = splitArguments(source, open);
    if (!parsed) continue;
    CHECK_CALL.lastIndex = parsed.end + 1;
    const [name, actual, expected] = parsed.arguments;
    /* The name is always a literal in a generated suite, which is also what tells
       a call apart from the declaration of `check` itself — that one is in every
       file and names its parameters, not a case. */
    if (!name?.trim().startsWith('"') || !actual) continue;

    // The arguments this case builds are declared between the previous case and this one.
    const preamble = source.slice(previousEnd, match.index);
    const values = new Map<string, string>();
    ARGUMENT.lastIndex = 0;
    for (let argument = ARGUMENT.exec(preamble); argument; argument = ARGUMENT.exec(preamble)) {
      values.set(argument[1] ?? "", compact(argument[2] ?? ""));
    }
    previousEnd = parsed.end;

    const call = compact(actual)
      .replace(/^spar::render\s*\(/, "")
      .replace(/\)$/, "")
      .replace(/^solution\./, "")
      .replace(/\barg\d+\b/g, (argument) => values.get(argument) ?? argument);
    found.push({
      name: literal(name) || `Case ${found.length + 1}`,
      assertions: [{ method: "deepStrictEqual", call, expected: literal(expected ?? "") }],
    });
  }
  /* Synthetic native challenges written before the case-output contract used
     ordinary assert(...). A successful C/C++ assertion is deliberately silent,
     but it still declares a real case. Keep this compatibility reader separate
     from the generated check(...) grammar: it is only used when no named checks
     were found, so a modern suite cannot accidentally get every condition twice. */
  return found.length ? found : nativeAssertCases(source);
}

const NATIVE_ASSERT = /\bassert\s*\(/g;
const LOCAL_ASSIGNMENT = /\b(?:const\s+)?(?:[\w:]+(?:\s*<[^;{}]+>)?[\s&*]+)([A-Za-z_]\w*)\s*=\s*([^;]+);/g;

function nativeAssertCases(source: string): Array<Pick<DeclaredCase, "name" | "assertions">> {
  const found: Array<Pick<DeclaredCase, "name" | "assertions">> = [];
  NATIVE_ASSERT.lastIndex = 0;
  for (let match = NATIVE_ASSERT.exec(source); match; match = NATIVE_ASSERT.exec(source)) {
    const parsed = splitArguments(source, match.index + match[0].length);
    if (!parsed) continue;
    NATIVE_ASSERT.lastIndex = parsed.end + 1;
    const expression = parsed.arguments[0]?.trim();
    if (!expression) continue;
    const equality = splitTopLevelEquality(expression);
    let actual = equality?.actual ?? expression;
    /* Put a named setup value back into the assertion. In the affected legacy
       workspace, `TraceResult r1 = run_trace(2); assert(r1.loopVarAfter == 3)`
       should read as the meaningful input `run_trace(2).loopVarAfter`, not the
       implementation-detail local `r1.loopVarAfter`. */
    const locals = new Map<string, string>();
    const prefix = source.slice(0, match.index);
    LOCAL_ASSIGNMENT.lastIndex = 0;
    for (let local = LOCAL_ASSIGNMENT.exec(prefix); local; local = LOCAL_ASSIGNMENT.exec(prefix)) {
      locals.set(local[1] ?? "", compact(local[2] ?? ""));
    }
    actual = actual.replace(/^\s*([A-Za-z_]\w*)\b/, (whole, name: string) => locals.has(name) ? `(${locals.get(name)})` : whole);
    found.push({
      name: equality ? `${compact(actual)} equals ${compact(equality.expected)}` : compact(actual),
      assertions: [{
        method: equality?.operator === "!=" ? "notStrictEqual" : equality ? "strictEqual" : "ok",
        call: compact(actual),
        expected: compact(equality?.expected ?? "true"),
      }],
    });
  }
  return found;
}

/** Finds == or != outside calls/containers/strings. Native generated tests use
 * these comparisons overwhelmingly; keeping the scanner structural avoids
 * splitting an operator inside a function argument or string literal. */
function splitTopLevelEquality(source: string): { actual: string; expected: string; operator: "==" | "!=" } | null {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < source.length - 1; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") depth -= 1;
    else if (depth === 0) {
      const operator = source.slice(index, index + 2);
      if (operator === "==" || operator === "!=") {
        return { actual: source.slice(0, index), expected: source.slice(index + 2), operator };
      }
    }
  }
  return null;
}

/** A C++ string literal as its text. Anything else — a named constant, an
 *  expression — is shown as written, because that is what the case says. */
function literal(value: string): string {
  const text = value.trim();
  return /^".*"$/s.test(text) ? unescape(text.slice(1, -1)) : text;
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
