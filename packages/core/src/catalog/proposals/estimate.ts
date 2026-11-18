import { utf8Length } from "../document/index.js"
import type { CatalogDocument } from "../document/index.js"

/**
 * What a parsed document is estimated to take in a catalog worker's
 * memory, with its share of the kept validation (#116), in bytes
 * (**proposed**, M2-4, recalibrated for #116):
 *
 *     3 × text bytes + 1,792 × facts + 2,048 × fact check groups
 *       + 256 × body sections + 320 × body links + 8 KiB
 *
 * Calibrated on Daedalus (Node's heap after parsing 400 documents of each
 * shape, text included, then validating them, per document) so that it is
 * above every shape measured. The shapes are at their worst for the
 * validation: each fact is outside its type's schema and each link goes
 * nowhere, so each has a warning.
 *
 * | Shape                                    | Text    | Parsed  | Validation | Estimate |
 * | ---------------------------------------- | ------- | ------- | ---------- | -------- |
 * | The least an entity holds                | 0.1 KB  | 5.2 KiB | 0.6 KiB    | 8.9 KiB  |
 * | Small entity: 5 facts, 2 sections        | 0.4 KB  | 12 KiB  | 0.9 KiB    | 21 KiB   |
 * | Typical entity: 6 facts, 43 sections     | 1.8 KB  | 23 KiB  | 1.2 KiB    | 37 KiB   |
 * | 100 long-form facts in one check group   | 3.7 KB  | 138 KiB | 20 KiB     | 196 KiB  |
 * | 100 facts, each in its own check group   | 11 KB   | 293 KiB | 20 KiB     | 414 KiB  |
 * | 365 short facts                          | 5.8 KB  | 230 KiB | 71 KiB     | 666 KiB  |
 * | Prose: 329 sections, 327 links           | 38 KB   | 131 KiB | 55 KiB     | 302 KiB  |
 * | A list of 2,004 links                    | 48 KB   | 279 KiB | 340 KiB    | 778 KiB  |
 *
 * A link going nowhere costs about 170 bytes of validation, so links count
 * 320 bytes (128 before #116); the kept validation adds 1 to 20 KiB for
 * the other shapes. The fixed part is 8 KiB (16 KiB before #116): the
 * least an entity holds measured 5.8 KiB. The tightest shape is 100 facts
 * in one check group, at 1.24 times its heap. The kept validation holds
 * the documents and their problems, not the resolved catalog
 * (`CatalogValidation`); a proposal's own catalogs come and go within it.
 */
export function estimatedBytes(document: CatalogDocument): number {
  return (
    3 * utf8Length(document.text) +
    (document.kind === "entity"
      ? 1792 * document.facts.length + 2048 * document.groups.length
      : 0) +
    256 * document.body.sections.length +
    320 * document.body.links.length +
    8 * 1024
  )
}
