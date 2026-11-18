/**
 * A line diff of two texts, for comparing an earlier catalog revision with
 * the current one (human experience, an entity page: History). The longest
 * common subsequence of lines, after the common start and end are set
 * aside; for very different long texts it gives up and shows one replaced
 * by the other.
 */
export interface DiffLine {
  kind: "same" | "removed" | "added"
  text: string
}

/** The most line pairs compared; beyond it, the texts are shown as replaced. */
const maxCells = 4_000_000

export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const head = a.slice(0, start).map(same)
  const tail = a.slice(endA).map(same)
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  return [...head, ...middle(midA, midB), ...tail]
}

function same(text: string): DiffLine {
  return { kind: "same", text }
}

function splitLines(text: string): string[] {
  if (text === "") return []
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === "") lines.pop()
  return lines
}

function middle(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  if (n === 0) return b.map((text) => ({ kind: "added", text }))
  if (m === 0) return a.map((text) => ({ kind: "removed", text }))
  if (n * m > maxCells)
    return [
      ...a.map((text): DiffLine => ({ kind: "removed", text })),
      ...b.map((text): DiffLine => ({ kind: "added", text })),
    ]
  // lengths[i * (m + 1) + j]: the longest common subsequence of a[i..] and b[j..].
  const lengths = new Uint32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lengths[i * (m + 1) + j] =
        a[i] === b[j]
          ? lengths[(i + 1) * (m + 1) + j + 1]! + 1
          : Math.max(
              lengths[(i + 1) * (m + 1) + j]!,
              lengths[i * (m + 1) + j + 1]!,
            )
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(same(a[i]!))
      i++
      j++
    } else if (
      lengths[(i + 1) * (m + 1) + j]! >= lengths[i * (m + 1) + j + 1]!
    ) {
      out.push({ kind: "removed", text: a[i++]! })
    } else {
      out.push({ kind: "added", text: b[j++]! })
    }
  }
  while (i < n) out.push({ kind: "removed", text: a[i++]! })
  while (j < m) out.push({ kind: "added", text: b[j++]! })
  return out
}
