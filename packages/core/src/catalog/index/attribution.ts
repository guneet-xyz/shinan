import type { ActorKind } from "@shinan/db"

import type { Section } from "../document/index.js"

/** A catalog revision and who made it, as its record says. */
export interface RevisionAuthor {
  revision: number
  authorKind: ActorKind
  /** The author's written form (identity §8.7). */
  author: string
}

/**
 * A body section with two credits, both from Shinan's records of who made
 * each revision, never from the text:
 *
 * - the revision that last changed it, and that revision's author;
 * - the least-trusted author who wrote any of it: the least trusted of
 *   everyone who changed the section since it first appeared. Trust labels
 *   (agent integrations) use this one, so a person who fixes a typo in an
 *   agent's section, renames its heading or moves it does not make the
 *   agent's text look like the person's.
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
 * How far text from each kind of actor is trusted, least first: outside
 * actors, unknown ones (imported text), agents, Shinan itself, then people.
 */
const trust: Record<ActorKind, number> = {
  outside: 0,
  unknown: 1,
  agent: 2,
  shinan: 3,
  person: 4,
}

/**
 * Credits each section of a document's new text against the sections of its
 * previous revision:
 *
 * 1. A section with the same anchor and exactly the same text keeps its
 *    credits.
 * 2. A section whose exact text was a previous section left over by step 1
 *    keeps that section's credits, whatever its anchor now is. Anchors of
 *    repeated headings are numbered (`notes`, `notes-1`), so deleting one
 *    section can rename another without changing a byte of it. Among
 *    sections with the same text, the earliest are paired first.
 * 3. Any other section was last changed by `change`. Its least-trusted
 *    author is the least trusted of `change` and of every previous section
 *    it shares a non-blank line with (a heading counts, without its `#`
 *    markers): words an agent wrote keep the agent's credit when a person
 *    edits them, renames their heading, moves them or splits the section.
 *    A section with no line from before is credited to `change` alone.
 *
 * When unsure, this errs towards the less-trusted credit. Applied to every
 * revision of a document in order, starting from no sections, it gives the
 * same credits whether the previous credits come from the stored index
 * (when a revision is applied) or from replaying the document's history (a
 * rebuild).
 */
export function attributeSections(
  previous: readonly AttributedSection[],
  sections: readonly Pick<Section, "anchor" | "text">[],
  change: RevisionAuthor,
): AttributedSection[] {
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
  const before = previous.map((p) => ({ credit: p, lines: linesOf(p.text) }))
  return sections.map((section, i) => {
    const kept = result[i]
    if (kept) return kept
    let least = { kind: change.authorKind, author: change.author }
    const lines = linesOf(section.text)
    for (const { credit, lines: old } of before) {
      if (trust[credit.leastTrustedKind] >= trust[least.kind]) continue
      if ([...lines].some((l) => old.has(l)))
        least = { kind: credit.leastTrustedKind, author: credit.leastTrusted }
    }
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

/** A text's non-blank lines, trimmed, headings without their `#` markers. */
function linesOf(text: string): Set<string> {
  return new Set(
    text
      .split(/\r\n|\r|\n/)
      .map((l) => l.replace(/^\s{0,3}#{1,6}(?=\s|$)/, "").trim())
      .filter((l) => l !== ""),
  )
}
