/**
 * A LeetCode statement, turned into something Spar can render and reason over.
 *
 * Two jobs, and they are separate on purpose. `statementToMarkdown` is for the
 * learner: the problem pane renders markdown, and a statement pasted in as HTML
 * would either arrive as tag soup or have to be trusted enough to render, which
 * is not a trade a problem description is worth making.
 *
 * `parseExamples` is for the machine, and it is the more interesting one. A
 * LeetCode problem hands out its sample *inputs* through the API
 * (`exampleTestcaseList`) but never the expected outputs — those live only in the
 * statement, because on the site the judge computes them. So a problem cannot be
 * run locally at all until its examples have been read out of the prose. That is
 * what makes a source with no judge behind it usable, and it is why this parser
 * is held to the same standard as the client rather than treated as a nicety.
 */

/** Where the interesting part of an example block starts. LeetCode is consistent
 *  about the three labels and inconsistent about everything around them, so the
 *  labels are the anchor and the markup is stripped first. */
const EXAMPLE_BLOCK = /<pre>([\s\S]*?)<\/pre>/gi;

export type ParsedExample = { input: string; output: string; explanation: string };

/**
 * Every worked example in the statement, in order, with the markup removed but
 * the values left exactly as written. `input` is the whole argument list as one
 * string (`nums = [2,7,11,15], target = 9`); splitting it into arguments needs
 * the signature, which `splitExampleInput` does separately.
 */
export function parseExamples(html: string): ParsedExample[] {
  const examples: ParsedExample[] = [];
  for (const match of html.matchAll(EXAMPLE_BLOCK)) {
    const block = decodeEntities(stripTags(match[1] ?? "", { keepNewlines: true }));
    const input = labelled(block, "Input");
    const output = labelled(block, "Output");
    if (!input || !output) continue;
    examples.push({ input, output, explanation: labelled(block, "Explanation") ?? "" });
  }
  return examples;
}

/**
 * One label's value, up to the next label or the end of the block.
 *
 * Not a line-based read: an explanation routinely runs over several lines, and an
 * output can too when it is a matrix that the statement chose to wrap. Ending at
 * the next known label is what makes both cases come out whole.
 */
function labelled(block: string, label: string): string | null {
  const start = block.search(new RegExp(`^\\s*${label}\\s*:`, "im"));
  if (start < 0) return null;
  const afterLabel = block.slice(start).replace(new RegExp(`^\\s*${label}\\s*:`, "i"), "");
  const next = afterLabel.search(/^\s*(Input|Output|Explanation)\s*:/im);
  return (next < 0 ? afterLabel : afterLabel.slice(0, next)).trim();
}

/**
 * An example's argument list, split into one string per parameter, in signature
 * order.
 *
 * Split on the parameter names rather than on commas, because the values contain
 * commas — `nums = [2,7,11,15], target = 9` has four of them and one argument
 * boundary. The names come from the problem's own `metaData`, so this is exact
 * rather than heuristic wherever the statement uses the declared names, which is
 * LeetCode's own convention and is what its examples are generated from.
 *
 * Returns null rather than a guess when the names cannot be found: a
 * mis-segmented argument list produces a test that fails for a reason that has
 * nothing to do with the learner, which is worse than having no test.
 */
export function splitExampleInput(input: string, paramNames: string[]): string[] | null {
  if (!paramNames.length) return null;
  if (paramNames.length === 1) {
    /* A single parameter may be written either way — "nums = [1,2]" or just
       "[1,2]" — and both mean the same thing when there is nothing to confuse
       it with. */
    const assignment = new RegExp(`^\\s*${escape(paramNames[0] as string)}\\s*=\\s*`, "i");
    return [input.replace(assignment, "").trim()];
  }
  const positions = paramNames.map((name) => {
    const match = new RegExp(`(?:^|[,\\s])${escape(name)}\\s*=`, "i").exec(input);
    return match ? { name, at: match.index, end: match.index + match[0].length } : null;
  });
  if (positions.some((position) => position === null)) return null;
  const found = positions as Array<{ name: string; at: number; end: number }>;
  /* Declared order is the call order, so a statement that lists the arguments in
     a different order than the signature still produces a correct call. */
  const ordered = [...found].sort((left, right) => left.at - right.at);
  const values = new Map<string, string>();
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index] as { name: string; at: number; end: number };
    const stop = ordered[index + 1]?.at ?? input.length;
    values.set(current.name, input.slice(current.end, stop).replace(/,\s*$/, "").trim());
  }
  return paramNames.map((name) => values.get(name) ?? "");
}

/**
 * The statement as markdown.
 *
 * Written as a small ordered set of replacements rather than a parser: the input
 * is one site's own template output, the tag vocabulary it uses is short, and a
 * general HTML parser would be a dependency and a new failure mode for no gain.
 * The ordering is the part that matters — code spans are protected before
 * emphasis is applied, so a `<code>` holding an asterisk does not turn into
 * italics halfway through the constraints.
 */
export function statementToMarkdown(html: string): string {
  if (!html.trim()) return "";
  let text = html;
  // Structure first, while the tags are still there to key off.
  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  /* The tag name has to end at the `>` or at a space. `<(p|div)[^>]*>` also
     matches `<pre>` — "p" followed by "re" — which silently ate every example
     block in the statement and left its contents to be flattened as prose. */
  text = text.replace(/<\/(p|div)>/gi, "\n\n");
  text = text.replace(/<(p|div)(\s[^>]*)?>/gi, "");
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, body: string) => `\n\n${"#".repeat(Number(level))} ${inline(body)}\n\n`);
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, body: string) => `- ${inline(body).trim()}\n`);
  text = text.replace(/<\/?(ul|ol)[^>]*>/gi, "\n");
  // Fenced blocks keep their newlines and take no inline formatting at all.
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_match, body: string) => `\n\n\`\`\`\n${decodeEntities(stripTags(body, { keepNewlines: true })).trim()}\n\`\`\`\n\n`);
  text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, (_match, alt: string, src: string) => `![${alt}](${src})`);
  text = text.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, (_match, src: string) => `![](${src})`);
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, body: string) => `[${inline(body)}](${href})`);
  text = inline(text);
  text = decodeEntities(text);
  text = stripTags(text, { keepNewlines: true });
  // Collapse the blank-line debris the replacements above leave behind.
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Inline formatting, applied after the block structure and before entities are
 *  decoded — so a literal `&lt;code&gt;` in a statement stays literal. */
function inline(html: string): string {
  return html
    /* Scripts before code spans, not after. Constraints are written as
       `<code>2 &lt;= n &lt;= 10<sup>4</sup></code>`, and a code span that
       strips its own markup first turns 10^4 into 104 — a different number, in
       the one part of a statement where the numbers are the whole content. */
    .replace(/<sup(\s[^>]*)?>([\s\S]*?)<\/sup>/gi, (_match, _attrs: string, body: string) => `^${stripTags(body, { keepNewlines: false })}`)
    .replace(/<sub(\s[^>]*)?>([\s\S]*?)<\/sub>/gi, (_match, _attrs: string, body: string) => `_${stripTags(body, { keepNewlines: false })}`)
    .replace(/<code(\s[^>]*)?>([\s\S]*?)<\/code>/gi, (_match, _attrs: string, body: string) => `\`${decodeEntities(stripTags(body, { keepNewlines: false })).replace(/`/g, "'")}\``)
    .replace(/<(strong|b)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, _attrs: string, body: string) => `**${body.trim()}**`)
    .replace(/<(em|i)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, _attrs: string, body: string) => `*${body.trim()}*`);
}

function stripTags(html: string, options: { keepNewlines: boolean }): string {
  const text = html.replace(/<[^>]+>/g, "");
  return options.keepNewlines ? text : text.replace(/\s*\n\s*/g, " ");
}

/** The entities LeetCode statements actually contain. `&nbsp;` becomes a plain
 *  space rather than U+00A0: the non-breaking space is invisible in the pane and
 *  breaks every string comparison a test case tries to make. */
const ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'",
  "&ldquo;": "“", "&rdquo;": "”", "&lsquo;": "‘", "&rsquo;": "’",
  "&hellip;": "…", "&mdash;": "—", "&ndash;": "–", "&times;": "×", "&le;": "≤", "&ge;": "≥", "&ne;": "≠", "&infin;": "∞",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => {
      const known = ENTITIES[entity.toLowerCase()];
      if (known) return known;
      const numeric = /^&#(\d+);$/.exec(entity);
      return numeric ? String.fromCodePoint(Number(numeric[1])) : entity;
    });
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
