/**
 * A line diff between two texts, by longest common subsequence.
 *
 * Small on purpose: the coach's notebook is a page of markdown, not a source
 * tree, so an O(n·m) table is a few thousand cells and a real diff library
 * would be all weight and no difference.
 */
export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

function lines(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
}

export function lineDiff(before: string | null | undefined, after: string | null | undefined): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  /* table[i][j]: the LCS length of a[i..] and b[j..]. Built from the end so
     the walk below can read it front to back. */
  const table: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ kind: "removed", text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: "added", text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++]! });
  while (j < b.length) out.push({ kind: "added", text: b[j++]! });
  return out;
}

export function diffCounts(diff: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.kind === "added") added += 1;
    else if (line.kind === "removed") removed += 1;
  }
  return { added, removed };
}
