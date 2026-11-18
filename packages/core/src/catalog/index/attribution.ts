import type { ActorKind } from "@shinan/db"

import type { Section } from "../document/index.js"
import { foundUnits, sectionWords, storedUnits } from "./provenance.js"
import type { Provenance } from "./provenance.js"

/** A catalog revision and who made it, as its record says. */
export interface RevisionAuthor {
  revision: number
  authorKind: ActorKind
  /** The author's written form (identity §8.7). */
  author: string
}

/**
 * A body section with two credits, both from Shinan's records of who made
 * each revision, never from claims in the text:
 *
 * - the revision that last changed it, and that revision's author;
 * - the least-trusted author whose words may be in it (`written_by`), from
 *   the document's provenance. Trust labels (agent integrations) use this
 *   one.
 */
export interface AttributedSection {
  anchor: string | null
  text: string
  changedRevision: number
  authorKind: ActorKind
  author: string
  leastTrustedKind: ActorKind
  leastTrusted: string
}

/**
 * Credits each section of a document's new text against the sections of its
 * previous revision, and records in `provenance` the words the revision
 * introduced:
 *
 * 1. A section with the same anchor and exactly the same text keeps its
 *    credits.
 * 2. A section whose exact text was a previous section left over by step 1
 *    keeps that section's credits, whatever its anchor now is. Anchors of
 *    repeated headings are numbered (`notes`, `notes-1`), so deleting one
 *    section can rename another without changing a byte of it. Among
 *    sections with the same text, the earliest are paired first.
 * 3. Any other section was last changed by `change`. Its least-trusted
 *    author is the least trusted of `change` and of the authors of every
 *    unit of its words (`provenance.ts`: word 3-grams) anyone introduced
 *    in any earlier revision of the document. So it is lifted to a
 *    more-trusted author only when no run of three words from less-trusted
 *    text remains: a person's own rewrite lifts it; rewrapping,
 *    punctuation, list markers, invisible characters, heading changes,
 *    copyedits that leave three words in a row, moving, splitting and
 *    restoring earlier text do not.
 *
 * When unsure, this errs towards the less-trusted credit. Applied to every
 * revision of a document in order, starting from no sections and an empty
 * provenance, it gives the same credits whether the previous credits and
 * provenance come from the stored index (when a revision is applied) or
 * from replaying the document's history (a rebuild).
 */
export function attributeSections(
  previous: readonly AttributedSection[],
  sections: readonly Pick<Section, "anchor" | "text">[],
  change: RevisionAuthor,
  provenance: Provenance,
): AttributedSection[] {
  const author = { kind: change.authorKind, author: change.author }
  const words = sections.map(sectionWords)
  const before = new Map<number, Set<string>>()
  for (const p of previous)
    for (const unit of storedUnits(sectionWords(p))) {
      const known = before.get(unit.hash)
      if (known) known.add(unit.words)
      else before.set(unit.hash, new Set([unit.words]))
    }
  provenance.introduce(
    before,
    words.flatMap((w) => storedUnits(w)),
    author,
  )

  const result: (AttributedSection | undefined)[] = sections.map(
    () => undefined,
  )
  const unused = new Set(previous.keys())
  const take = (j: number) => {
    unused.delete(j)
    return previous[j]!
  }
  // 1. Same anchor, same text.
  sections.forEach((section, i) => {
    const j = previous.findIndex(
      (p, k) =>
        unused.has(k) && p.anchor === section.anchor && p.text === section.text,
    )
    if (j >= 0) result[i] = { ...take(j), anchor: section.anchor }
  })
  // 2. Same text, another anchor.
  sections.forEach((section, i) => {
    if (result[i]) return
    const j = previous.findIndex(
      (p, k) => unused.has(k) && p.text === section.text,
    )
    if (j >= 0) result[i] = { ...take(j), anchor: section.anchor }
  })
  // 3. Changed or new.
  return sections.map((section, i) => {
    const kept = result[i]
    if (kept) return kept
    const least = provenance.leastTrusted(foundUnits(words[i]!), author)
    return {
      anchor: section.anchor,
      text: section.text,
      changedRevision: change.revision,
      authorKind: change.authorKind,
      author: change.author,
      leastTrustedKind: least.kind,
      leastTrusted: least.author,
    }
  })
}
