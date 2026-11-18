import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { eq, schema } from "@shinan/db"

import {
  asAgent,
  asPerson,
  newPerson,
  testDatabase,
} from "../../../test/helpers.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import { appendCatalogRevision } from "../revisions.js"
import type { RevisionActor } from "../revisions.js"
import { compareWorkspaceIndex, rebuildWorkspaceIndex } from "./indexer.js"

/**
 * Random histories, applied revision by revision, must index exactly as a
 * rebuild from the stored text does, `written_by` and word provenance
 * included (architecture §5.2, rules 3 and 5).
 */

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

let owner: Person
let actors: RevisionActor[]

beforeAll(async () => {
  owner = await newPerson(db, "owner")
})

/** A small, seeded random number generator (mulberry32). */
function random(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const words =
  "run the deploy script only after queue has drained then check dashboard for errors before you continue ask owner never skip backups notes steps".split(
    " ",
  )
const headings = ["Notes", "Steps", "Cautions", "Notes", "History"]

interface Section {
  heading: string | null
  lines: string[]
}

function render(id: string, sections: Section[]): string {
  const body = sections
    .map((s) =>
      s.heading === null
        ? `${s.lines.join("\n")}\n`
        : `## ${s.heading}\n\n${s.lines.join("\n")}\n`,
    )
    .join("\n")
  return `---
id: ${id}
type: project
title: ${id}
summary: A project.
status: active
owner: person/guneet
---

${body}`
}

async function runHistory(seed: number) {
  const workspaceId = (
    await createWorkspace(asPerson(db, owner), { name: `Seed ${seed}` })
  ).workspace.id
  const agentCtx = await asAgent(db, owner, workspaceId)
  if (agentCtx.actor.kind !== "agent") throw new Error("Expected an agent")
  actors = [
    {
      kind: "person",
      personId: owner.id,
      agentId: null,
      agentSessionId: null,
      label: owner.handle,
      confidence: "recorded",
    },
    {
      kind: "agent",
      personId: owner.id,
      agentId: agentCtx.actor.agentId,
      agentSessionId: null,
      label: `${owner.handle} via ${agentCtx.actor.agentHandle}`,
      confidence: "recorded",
    },
    {
      kind: "shinan",
      personId: null,
      agentId: null,
      agentSessionId: null,
      label: "shinan",
      confidence: "recorded",
    },
  ]
  const next = random(seed)
  const pick = <T>(list: readonly T[]) =>
    list[Math.floor(next() * list.length)]!
  const sentence = () =>
    Array.from({ length: 2 + Math.floor(next() * 9) }, () => pick(words)).join(
      " ",
    )

  const docs = Array.from({ length: 4 }, (_, i) => ({
    id: `project/p${i}`,
    documentId: undefined as string | undefined,
    sections: [
      { heading: null, lines: [sentence()] },
      { heading: pick(headings), lines: [sentence(), sentence()] },
    ] as Section[],
    history: [] as Section[][],
  }))

  for (let revision = 0; revision < 60; revision++) {
    const doc = pick(docs)
    const s = doc.sections
    const op = Math.floor(next() * 9)
    const at = Math.floor(next() * s.length)
    const target = s[at]!
    if (op === 0) s.push({ heading: pick(headings), lines: [sentence()] })
    else if (op === 1 && s.length > 1) s.splice(Math.max(1, at), 1)
    else if (op === 2) target.lines[0] = sentence()
    else if (op === 3)
      // Rewrap: join and split the lines differently.
      target.lines = target.lines
        .join(" ")
        .split(" ")
        .reduce<string[]>((lines, word, i) => {
          if (i % 4 === 0) lines.push(word)
          else lines[lines.length - 1] += ` ${word}`
          return lines
        }, [])
    else if (op === 4 && target.heading !== null)
      target.heading = pick(headings)
    else if (op === 5 && s.length > 2) {
      const [moved] = s.splice(Math.max(1, at), 1)
      s.splice(1 + Math.floor(next() * (s.length - 1)), 0, moved!)
    } else if (op === 6 && doc.history.length > 0)
      // Restore an earlier body, as a revert does.
      doc.sections = structuredClone(pick(doc.history))
    else if (op === 7) target.lines.push(sentence())
    else target.lines = target.lines.map((l) => `${l}.`)
    doc.history.push(structuredClone(doc.sections))
    const actor = pick(actors)
    const applied = await db.transaction((tx) =>
      appendCatalogRevision(tx, workspaceId, actor, [
        {
          ...(doc.documentId ? { documentId: doc.documentId } : {}),
          text: render(doc.id, doc.sections),
        },
      ]),
    )
    doc.documentId ??= applied.documentIds[0]
  }
  return workspaceId
}

describe("random histories", () => {
  it.each([42, 1, 7, 99, 1234])(
    "index the same applied or rebuilt (seed %i)",
    async (seed) => {
      const workspaceId = await runHistory(seed)
      const compared = await db.transaction((tx) =>
        compareWorkspaceIndex(tx, workspaceId),
      )
      expect(compared.differences).toEqual([])

      const credits = async () =>
        db
          .select({
            documentId: schema.catalogIndexSections.documentId,
            position: schema.catalogIndexSections.position,
            kind: schema.catalogIndexSections.leastTrustedKind,
            author: schema.catalogIndexSections.leastTrusted,
          })
          .from(schema.catalogIndexSections)
          .where(eq(schema.catalogIndexSections.workspaceId, workspaceId))
          .orderBy(
            schema.catalogIndexSections.documentId,
            schema.catalogIndexSections.position,
          )
      const before = await credits()
      await db.transaction((tx) => rebuildWorkspaceIndex(tx, workspaceId))
      expect(await credits()).toEqual(before)
    },
    60_000,
  )
})
