import { describe, expect, it } from "vitest";
import { normalizeStatementText } from "./statementText.js";

describe("statement line breaks", () => {
  it("repairs escaped sections even when host requirements have real newlines", () => {
    expect(normalizeStatementText(String.raw`Predict the mean.\n\n- Exclude test records.\n\n**Examples**\n\n1. **Input:** records` + "\n\n## How this must be solved\n\n- Preserve order."))
      .toBe("Predict the mean.\n\n- Exclude test records.\n\n**Examples**\n\n1. **Input:** records\n\n## How this must be solved\n\n- Preserve order.");
  });
  it("preserves code literals while repairing surrounding prose", () => {
    const source = 'Return `"\\n"`.\\n\\n**Examples**\\n\\n```python\nprint("\\n")\n```';
    expect(normalizeStatementText(source)).toBe('Return `"\\n"`.\n\n**Examples**\n\n```python\nprint("\\n")\n```');
  });
  it("leaves normal Markdown and discussion of escapes unchanged", () => {
    for (const source of ['Split on \\n characters.', 'Use `"\\n\\n"`.\n\n- Keep blank lines.', '## Examples\n\n```python\nprint("\\n")\n```']) {
      expect(normalizeStatementText(source)).toBe(source);
    }
  });
  it("is idempotent", () => {
    const source = String.raw`Return a mean.\n\n- Exclude held-out rows.`;
    expect(normalizeStatementText(normalizeStatementText(source))).toBe(normalizeStatementText(source));
  });
});
