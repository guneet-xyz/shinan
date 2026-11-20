import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { readCatalog, validateCatalog, validateChange } from "@shinan/core"
import type { ProblemCode } from "@shinan/core"

import {
  currentTypesReference,
  expectedTypesReference,
} from "../scripts/types-reference.js"
import { exampleDocuments, examplePerson } from "../test/example.js"
import { skillDirectory } from "./index.js"

/**
 * Every validation code Shinan has, by its type: adding a code to core
 * without adding it here fails the type check, and this test then wants it
 * in `references/changing.md`.
 */
const validationCodes = {
  "too-large": true,
  "unreadable-path": true,
  "frontmatter-invalid": true,
  "body-invalid": true,
  "read-failed": true,
  "field-missing": true,
  "field-invalid": true,
  "date-invalid": true,
  "facts-invalid": true,
  "fact-invalid": true,
  cardinality: true,
  "schema-invalid": true,
  "start-here-invalid": true,
  "type-unknown": true,
  "id-duplicate": true,
  "reference-unresolved": true,
  "reference-type": true,
  "fact-check-missing": true,
  "fact-check-incomplete": true,
  "fact-check-invalid": true,
  "checked-in-future": true,
  "unchecked-not-imported": true,
  "planned-without-task": true,
  "identity-duplicate": true,
  "schema-breaks-entities": true,
  secret: true,
  "secret-suspected": true,
  "task-status": true,
  "key-not-in-schema": true,
  "check-older": true,
  "start-here-retired": true,
  "start-here-discrepancy": true,
  "owner-not-member": true,
} satisfies Record<ProblemCode, true>

/**
 * The push checks' own codes: GC-3's `pushCheckCodes` (#191, #193), copied
 * until it is on `main`, when this list is replaced by its keys.
 */
const pushCodes = [
  "ref-not-branch",
  "ref-name-invalid",
  "main-not-fast-forward",
  "too-many-branches",
  "purged-commit",
  "symlink",
  "submodule",
  "file-too-large",
  "commit-too-large",
  "too-many-commits",
  "tree-too-large",
  "path-not-portable",
  "secret",
  "repository-full",
  "busy",
  "too-slow",
  "check-only",
  "push-option-unknown",
  "check-failed",
  "secret-suspected",
  "path-not-allowed",
  "path-id-mismatch",
  "id-disappeared",
  "by-not-first-pusher",
  "catalog-too-large",
  "main-too-many-commits",
]

const changingFile = join(skillDirectory, "references", "changing.md")

describe("the skill's references", () => {
  it("lists the built-in types as the code defines them", async () => {
    // `pnpm --filter @shinan/skill generate` writes the file again.
    expect(await currentTypesReference()).toBe(await expectedTypesReference())
  })

  it("explains exactly the codes a push can be refused or warned with", async () => {
    const changing = await readFile(changingFile, "utf8")
    const listed = new Set(
      [...changing.matchAll(/^\| `([a-z-]+)` +\|/gm)].map((m) => m[1]!),
    )
    expect([...listed].sort()).toEqual(
      [...new Set([...Object.keys(validationCodes), ...pushCodes])].sort(),
    )
  })

  it("has an example change that validates, with a fact check naming the agent that pushes it", () => {
    const [before, after] = exampleDocuments()
    const context = { now: new Date("2026-11-19T00:00:00Z") }
    const old = readCatalog([examplePerson, before])
    expect(validateCatalog(old, context).problems).toEqual([])
    const next = readCatalog([examplePerson, after])
    const result = validateChange(
      { before: old, after: next, changed: [next.documents[1]!] },
      context,
    )
    expect(result.problems).toEqual([])
    expect(after).toMatch(/^ {4}by: alex via opencode-build-1$/m)
    expect(after).toMatch(/^ {2}- checked: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/m)
  })
})
