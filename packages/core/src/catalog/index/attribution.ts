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
 * A body section with the catalog revision that last changed it and that
 * revision's author. Trust labels (agent integrations) take a section's
 * author from here: from Shinan's records of who made each revision, never
 * from the text.
 */
export interface AttributedSection {
  anchor: string | null
  text: string
  changedRevision: number
  authorKind: ActorKind
  author: string
}

/**
 * Credits each section of a document's new text: a section whose text is
 * exactly as it was in the document's previous revision keeps its credit;
 * any other section (new, changed in any byte, or renamed, which changes its
 * anchor) is credited to `change`. Sections are matched by anchor, which is
 * unique within a body; the text before the first heading has none and
 * matches the previous text before the first heading.
 *
 * Applied to every revision of a document in order, starting from no
 * sections, this gives the same credits whether the previous credits come
 * from the stored index (when a revision is applied) or from replaying the
 * document's history (a rebuild).
 */
export function attributeSections(
  previous: readonly AttributedSection[],
  sections: readonly Pick<Section, "anchor" | "text">[],
  change: RevisionAuthor,
): AttributedSection[] {
  const before = new Map(previous.map((s) => [s.anchor, s]))
  return sections.map((section) => {
    const kept = before.get(section.anchor)
    if (kept && kept.text === section.text) return kept
    return {
      anchor: section.anchor,
      text: section.text,
      changedRevision: change.revision,
      authorKind: change.authorKind,
      author: change.author,
    }
  })
}
