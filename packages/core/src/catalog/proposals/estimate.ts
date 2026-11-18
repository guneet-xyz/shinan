import { utf8Length } from "../document/index.js"
import type { CatalogDocument } from "../document/index.js"

/**
 * What a parsed document is estimated to take in a catalog worker's
 * memory, in bytes (**proposed**, M2-4):
 *
 *     3 × text bytes + 1,792 × facts + 2,048 × fact check groups
 *       + 256 × body sections + 128 × body links + 16 KiB
 *
 * Calibrated on Daedalus (Node's heap after parsing 400 documents of each
 * shape, text included, per document) so that it is above every shape
 * measured:
 *
 * | Shape                                    | Text   | Heap    | Estimate |
 * | ---------------------------------------- | ------ | ------- | -------- |
 * | Typical entity: 6 facts, 43 sections     | 4.2 KB | 28 KiB  | 52 KiB   |
 * | 100 long-form facts in one check group   | 3.7 KB | 144 KiB | 204 KiB  |
 * | 100 facts, each in its own check group   | 11 KB  | 305 KiB | 423 KiB  |
 * | 365 short facts                          | 5.2 KB | 237 KiB | 673 KiB  |
 * | Prose: 329 sections, 327 links           | 55 KB  | 185 KiB | 301 KiB  |
 * | A list of 2,004 links                    | 55 KB  | 312 KiB | 429 KiB  |
 *
 * A check group costs about 1.6 KiB beyond its facts (the #112 review
 * measured 1.3 to 1.4 KiB). The review also measured 170 KiB for 5.2 KB
 * entities of 100 facts and 34 KiB for typical 4.9 KB entities: both below
 * their estimates. At the catalog's limit (`catalogLimits`, 320 MiB), a
 * one-field change peaked at 404 MiB of heap for 1,606 documents of 100
 * facts in one group, and 339 MiB for 775 documents of 100 single-fact
 * groups; both applied in a worker with a 640 MiB heap.
 */
export function estimatedBytes(document: CatalogDocument): number {
  return (
    3 * utf8Length(document.text) +
    (document.kind === "entity"
      ? 1792 * document.facts.length + 2048 * document.groups.length
      : 0) +
    256 * document.body.sections.length +
    128 * document.body.links.length +
    16 * 1024
  )
}
