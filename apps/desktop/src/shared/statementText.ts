/** Recover double-escaped Markdown line breaks without changing code literals.
 * Old saved challenges need the same repair as newly authored statements.
 */
export function normalizeStatementText(source: string): string {
  // Preserve inline code and fenced examples, including their literal \\n strings.
  const parts = source.split(/(`{3,}[\s\S]*?`{3,}|~{3,}[\s\S]*?~{3,}|(`+)[\s\S]*?\2)/g);
  const prose = parts.filter((_, index) => index % 3 === 0).join("");
  // Only repair a recognizable escaped document, not prose discussing escapes.
  if (!/\\n(?:\\n|\s*(?:[-*+] |\d+[.)] |#{1,6} |\*\*(?:Examples|Constraints|Input|Output|Explanation)))/.test(prose)) return source;
  return parts.map((part, index) => index % 3 === 0 ? part.replace(/\\r\\n|\\n/g, "\n") : index % 3 === 1 ? part : "").join("");
}
