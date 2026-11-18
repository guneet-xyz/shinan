import { utf8Length } from "../document/index.js"
import type { CatalogDocument } from "../document/index.js"

/**
 * What a parsed document is estimated to take in a catalog worker's
 * memory, in bytes (**proposed**, M2-4):
 *
 *     3 × text bytes + 1,792 × facts + 256 × body sections
 *       + 128 × body links + 16 KiB
 *
 * Calibrated on Daedalus (Node's heap after parsing 400 documents of each
 * shape, per document) so that it is above every shape measured:
 *
 * | Shape                                  | Text   | Heap    | Estimate |
 * | -------------------------------------- | ------ | ------- | -------- |
 * | Typical entity: 6 facts, 43 sections   | 4.2 KB | 19 KiB  | 47 KiB   |
 * | 100 long-form facts                    | 3.7 KB | 128 KiB | 202 KiB  |
 * | 365 short facts                        | 5.2 KB | 203 KiB | 671 KiB  |
 * | Prose: 329 sections, 327 links         | 55 KB  | 54 KiB  | 300 KiB  |
 * | A list of 2,004 links                  | 55 KB  | 20 KiB  | 431 KiB  |
 *
 * The #112 review measured 170 KiB for 5.2 KB entities of 100 facts, and
 * 34 KiB for typical 4.9 KB entities: both below their estimates.
 */
export function estimatedBytes(document: CatalogDocument): number {
  return (
    3 * utf8Length(document.text) +
    1792 * (document.kind === "entity" ? document.facts.length : 0) +
    256 * document.body.sections.length +
    128 * document.body.links.length +
    16 * 1024
  )
}
