import fc from "fast-check"
import { afterAll, describe, expect, it } from "vitest"

import { asPerson, newPerson, testDatabase } from "../../../test/helpers.js"
import { createMemoryGit } from "../../../test/memory-git.js"
import { createWorkspace } from "../../identity/workspaces.js"
import { compareWorkspaceIndex, updateWorkspaceIndex } from "./indexer.js"
import { listDocuments, readTexts } from "./source.js"

/**
 * D-006 for updates: whatever pushes reach `main`, and however many arrive
 * between two index jobs, an update from the diff gives exactly the rows a
 * rebuild from `main` gives. The pushes change entities, type schema
 * documents (custom types, an extended built-in type, two documents for
 * one type, a document changing the type it describes), the start-here
 * document, documents that move between kinds, unreadable text, and
 * deletions.
 */

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

const schemaOf = (id: string, describes: string, keys: string) => `---
id: schema/${id}
title: ${describes}
summary: The ${describes} type.
status: active
owner: person/guneet
keys:
${keys}
---

# ${describes}
`

const entityOf = (
  id: string,
  type: string,
  facts: string,
  body = "Some words.",
) => `---
id: ${id}
type: ${type}
title: ${id}
summary: An entity.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-01
    by: guneet
    scope: A look
    source: A source
    observed:
${facts}
---

# ${id}

${body}

## Notes

Linked to [the other](domain/b).
`

/** Each path's possible contents; `null` deletes it. */
const variants: Record<string, (string | null)[]> = {
  "schema/domain.md": [
    null,
    schemaOf(
      "domain",
      "domain",
      "  registrar: {}\n  expires_on: { recheck: 30d }",
    ),
    schemaOf("domain", "domain", "  registrar: {}\n  tags: { many: true }"),
    schemaOf("area", "area", "  size: {}"),
  ],
  "schema/zz-domain.md": [
    null,
    schemaOf("domain", "domain", "  registrar: { recheck: 7d }"),
  ],
  "schema/machine.md": [
    null,
    schemaOf("machine", "machine", "  ups: { recheck: 10d }"),
    "---\nid: schema/machine\nkeys: [broken\n---\n",
  ],
  "domain/a.md": [
    null,
    entityOf(
      "domain/a",
      "domain",
      "      registrar: Cloudflare\n      tags: main",
    ),
    entityOf("domain/a", "area", "      size: large"),
    entityOf("domain/a", "machine", "      ups: big\n      role: Host"),
  ],
  "domain/b.md": [
    null,
    entityOf("domain/b", "domain", "      expires_on: 2026-12-01"),
    entityOf("domain/b", "domain", "      registrar: Other", "Other words."),
  ],
  "machine/m.md": [
    null,
    entityOf("machine/m", "machine", "      ups: small"),
    entityOf("machine/m", "machine", "      role: Worker"),
    // A document that becomes a type schema document.
    schemaOf("domain", "domain", "  registrar: {}"),
  ],
  "start-here.md": [
    null,
    "---\nid: start-here\ntitle: Start\nagents:\n  - to: domain/a\n    note: Read it.\n---\n",
  ],
  "notes.md": [null, "No frontmatter at all.", new Array(70_000).join("x")],
}
const paths = Object.keys(variants)

const push = fc.dictionary(fc.constantFrom(...paths), fc.nat(), {
  minKeys: 1,
  maxKeys: 4,
})
const pushes = fc.array(fc.record({ push, index: fc.boolean() }), {
  minLength: 1,
  maxLength: 8,
})

describe("an update from the diff", () => {
  it("equals a rebuild from main, over random pushes", async () => {
    await fc.assert(
      fc.asyncProperty(pushes, async (steps) => {
        const git = createMemoryGit()
        // A person may create only a few workspaces a day: one each.
        const owner = await newPerson(db, "owner")
        const { workspace } = await createWorkspace(asPerson(db, owner), {
          name: "Property",
        })
        const workspaceId = workspace.id
        git.create(workspaceId)
        await updateWorkspaceIndex(db, git, workspaceId)
        for (const [i, step] of steps.entries()) {
          git.push(
            workspaceId,
            Object.fromEntries(
              Object.entries(step.push).map(([path, n]) => {
                const options = variants[path]!
                return [path, options[n % options.length]!]
              }),
            ),
          )
          // Some updates of `main` arrive while the last job still waits.
          if (!step.index && i < steps.length - 1) continue
          const update = await updateWorkspaceIndex(db, git, workspaceId)
          expect(update.outcome).not.toBe("rebuilt")
          const main = (await git.getRepository(workspaceId))!.main
          const texts = await readTexts(
            git,
            workspaceId,
            main,
            await listDocuments(git, workspaceId, main),
          )
          const compared = await db.transaction((tx) =>
            compareWorkspaceIndex(tx, workspaceId, texts),
          )
          expect(compared.differences).toEqual([])
        }
      }),
      { numRuns: 40 },
    )
  }, 300_000)
})
