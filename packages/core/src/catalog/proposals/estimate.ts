import { utf8Length } from "../document/index.js"
import type { CatalogDocument } from "../document/index.js"

/** What a document's validation keeps (`CatalogValidation.counts`). */
export interface ValidationCounts {
  problems: number
  secrets: number
  references: number
}

/**
 * What a document is estimated to take in a catalog worker's memory, in
 * bytes (**proposed**, M2-4, recalibrated for #116): the parsed document,
 *
 *     3 × text bytes + 1,792 × facts + 2,048 × fact check groups
 *       + 256 × body sections + 128 × body links + 8 KiB,
 *
 * and, given its counts (`CatalogValidation.counts`), what its kept
 * validation holds,
 *
 *     256 × problems + 384 × secrets found + 256 × names referenced.
 *
 * The parse cache's budget counts the first part; the catalog's limit
 * (`catalogLimits`) both, from the validations a proposal makes, so any
 * output validation keeps is counted, however many problems or secrets a
 * document has. Messages quote at most the document's own text, which the
 * first part counts.
 *
 * Calibrated on Daedalus: Node's heap after parsing 300 documents of each
 * shape, text included, then validating them as the worker does, per
 * document; the estimate is above every shape measured.
 *
 * | Shape                                      | Text    | Problems, secrets, names | Heap     | Estimate | Ratio |
 * | ------------------------------------------ | ------- | ------------------------ | -------- | -------- | ----- |
 * | The least an entity holds                  | 0.1 KB  | 0, 0, 1                  | 7.3 KiB  | 9.2 KiB  | 1.25  |
 * | Small entity: 5 facts, 2 sections          | 0.4 KB  | 0, 0, 2                  | 15 KiB   | 21 KiB   | 1.40  |
 * | Typical entity: 6 facts, 43 sections       | 1.8 KB  | 1, 0, 2                  | 27 KiB   | 38 KiB   | 1.37  |
 * | 100 long-form facts in one check group     | 3.7 KB  | 100, 0, 1                | 163 KiB  | 221 KiB  | 1.35  |
 * | 100 facts, each in its own check group     | 11 KB   | 100, 0, 1                | 324 KiB  | 439 KiB  | 1.35  |
 * | 365 short facts                            | 5.8 KB  | 364, 0, 1                | 308 KiB  | 755 KiB  | 2.46  |
 * | Prose: 328 sections, each a dead link      | 39 KB   | 327, 0, 328              | 278 KiB  | 409 KiB  | 1.47  |
 * | Plain prose                                | 49 KB   | 0, 0, 1                  | 55 KiB   | 152 KiB  | 2.75  |
 * | 2,004 dead links, each to its own name     | 55 KB   | 1,997, 0, 1,998          | 1.0 MiB  | 1.4 MiB  | 1.40  |
 * | 2,004 dead links to one name               | 53 KB   | 1,997, 0, 2              | 605 KiB  | 913 KiB  | 1.51  |
 * | 1,000 suspected secrets (`pwd=…` lines)    | 14 KB   | 997, 997, 1              | 524 KiB  | 672 KiB  | 1.28  |
 *
 * Problems took 140 to 205 bytes each, a secret found about 300 bytes
 * beyond its problem, and a name referenced up to 210 bytes when no other
 * document references it. The kept secret scans (`SecretScans`) share the
 * validation's findings and problems.
 */
export function estimatedBytes(
  document: CatalogDocument,
  validation?: ValidationCounts,
): number {
  return (
    3 * utf8Length(document.text) +
    (document.kind === "entity"
      ? 1792 * document.facts.length + 2048 * document.groups.length
      : 0) +
    256 * document.body.sections.length +
    128 * document.body.links.length +
    8 * 1024 +
    (validation
      ? problemBytes * validation.problems +
        secretBytes * validation.secrets +
        referenceBytes * validation.references
      : 0)
  )
}

const problemBytes = 256
const secretBytes = 384
const referenceBytes = 256
