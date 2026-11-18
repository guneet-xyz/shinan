import { describe, expect, it } from "vitest"

import { applyOperations } from "./apply.js"
import { readCatalog } from "./catalog.js"
import type { CatalogDocument } from "./model.js"
import { parseCatalogDocument } from "./parse.js"
import {
  prepareCatalogValidation,
  validateChange,
  validateChangeFully,
  validateChangeIncrementally,
} from "./validate.js"

/**
 * Validating a proposal on a large catalog (#116): with the validation of
 * the revision it is based on, a one-field change validates only the
 * documents it can affect, and gives the same result as validating
 * everything.
 *
 * 1,000 documents by default, to keep the test run short; set
 * SHINAN_SCALE_DOCUMENTS to measure larger catalogs (times are printed).
 */
const size = Number(process.env.SHINAN_SCALE_DOCUMENTS ?? 1000)
const measure = process.env.SHINAN_SCALE_DOCUMENTS !== undefined

const check = (scope: string) =>
  `  - checked: 2026-11-14\n    by: guneet via opencode-daedalus\n    scope: ${scope}\n    source: Read-only SSH\n`

const body = (title: string, links: string[]) => `# ${title}

${title} is part of the fleet. It is described here at the length a real
catalog page has: what it does, who relies on it, and what to be careful of.
See ${links.map((l) => `[${l}](${l})`).join(", ")}.

## Cautions

Every deployment change needs the owner's approval. Do not restart it during
the working day; the services on it have no standby. Read the runbook first.

## Notes

- Backups run nightly to the shared storage.
- Its configuration lives in the infrastructure repository.
- Monitoring alerts go to the operations channel.
`

/** A catalog of `n` documents: people, machines, services, projects and runbooks referencing each other. */
function catalogTexts(n: number): string[] {
  const machines = Math.max(1, Math.floor(n * 0.35))
  const services = Math.max(1, Math.floor(n * 0.3))
  const projects = Math.max(1, Math.floor(n * 0.2))
  const runbooks = Math.max(1, n - 4 - machines - services - projects)
  const texts: string[] = []
  for (const handle of ["guneet", "ana"])
    texts.push(`---
id: person/${handle}
type: person
title: ${handle}
summary: A member.
status: active
owner: person/${handle}
facts:
${check("Membership")}    observed:
      member: ${handle}
---

# ${handle}
`)
  texts.push(`---
id: schema/rack
title: Rack
summary: A rack in the server room.
status: active
owner: person/guneet
keys:
  position: {}
  holds: { relation: [machine], inverse: racks }
---

# Rack
`)
  for (let i = 0; i < machines; i++)
    texts.push(`---
id: machine/m${i}
type: machine
title: Machine ${i}
summary: Machine number ${i} of the fleet.
status: active
owner: person/${i % 2 ? "ana" : "guneet"}
facts:
${check("Platform and disks")}    observed:
      role: Worker ${i}
      environment: production
      access.method: SSH
      platform.os: Ubuntu 24.04
      disk.data.size: ${i} GiB
      disk.data.free: ${i % 50} GiB
      configured-by: project/p${i % projects}
  - unknown:
      access.address: Not checked
---

${body(`Machine ${i}`, [`project/p${i % projects}`, `service/s${i % services}`])}`)
  for (let i = 0; i < services; i++)
    texts.push(`---
id: service/s${i}
type: service
title: Service ${i}
summary: Service number ${i}.
status: active
owner: person/guneet
facts:
${check("Compose file")}    intended:
      endpoint: https://s${i}.example.com
      environment: production
      runs-on: machine/m${i % machines}
      depends-on: service/s${(i + 1) % services}
---

${body(`Service ${i}`, [`machine/m${i % machines}`])}`)
  for (let i = 0; i < projects; i++)
    texts.push(`---
id: project/p${i}
type: project
title: Project ${i}
summary: Project number ${i}.
status: active
owner: person/ana
facts:
${check("Repository")}    observed:
      repository: https://git.example.com/p${i}
      provides: service/s${i % services}
      checkout-on: { to: machine/m${i % machines}, path: /srv/p${i} }
---

${body(`Project ${i}`, [`service/s${i % services}`])}`)
  for (let i = 0; i < runbooks; i++)
    texts.push(`---
id: runbook/r${i}
type: runbook
title: Runbook ${i}
summary: How to do task ${i}.
status: active
owner: person/guneet
facts:
${check("Last run")}    observed:
      last_successful_run: 2026-11-01
      changes_deployment: "no"
      applies-to: machine/m${i % machines}
---

${body(`Runbook ${i}`, [`machine/m${i % machines}`, "start-here"])}`)
  texts.push(`---
id: start-here
title: Start here
owner: person/guneet
people:
  - to: machine/m0
    note: The first machine.
agents:
  - to: runbook/r0
    note: Read it before acting.
---
`)
  return texts
}

function time<T>(run: () => T): { value: T; ms: number } {
  const start = performance.now()
  const value = run()
  return { value, ms: performance.now() - start }
}

describe("validation on a large catalog", () => {
  it(`validates a one-field change on ${size} documents from the base revision's validation`, () => {
    const documents: CatalogDocument[] = catalogTexts(size).map((t) =>
      parseCatalogDocument(t),
    )
    expect(documents).toHaveLength(size)
    const context = {
      now: Date.UTC(2026, 10, 20, 12),
      memberHandles: new Set(["guneet", "ana"]),
    }
    const applied = time(() =>
      applyOperations(
        documents,
        [
          {
            op: "set-field",
            document: "machine/m7",
            field: "title",
            value: "Machine seven",
            expect: { value: "Machine 7" },
          },
        ],
        { by: "guneet" },
      ),
    )
    if (!applied.value.applied) throw new Error("The change did not apply")
    const { before, after, changes } = applied.value
    const change = {
      before,
      after,
      changed: changes.map((c) => c.after),
      texts: [{ label: "The explanation", text: "A clearer title." }],
    }

    const full = time(() => validateChangeFully(change, context))
    const prepared = time(() =>
      prepareCatalogValidation(readCatalog(documents), context),
    )
    const base = prepared.value
    const incremental = time(() =>
      validateChangeIncrementally(change, context, base),
    )
    const unprepared = time(() => validateChange(change, context))
    // Another proposal against the same base: its indexes are built.
    const repeated = time(() => validateChange(change, context, base))

    expect(incremental.value.result).toEqual(full.value)
    expect(unprepared.value).toEqual(full.value)
    expect(full.value.problems).toEqual([])
    // Only the written document and those naming it were validated again.
    const again = after.documents.filter(
      (d) => incremental.value.after.entries.get(d) !== base.entries.get(d),
    )
    const naming = after.documents.filter((d) =>
      /machine\/m7(?![0-9])/.test(d.text),
    )
    expect(new Set(again)).toEqual(new Set(naming))
    expect(again.length).toBeLessThan(20)

    if (measure)
      console.info(
        [
          `${size} documents, one-field change:`,
          `applyOperations ${applied.ms.toFixed(0)} ms`,
          `full validation (two catalogs) ${full.ms.toFixed(0)} ms`,
          `validation of the base revision ${prepared.ms.toFixed(0)} ms`,
          `validateChange with the base ${incremental.ms.toFixed(1)} ms (${again.length} documents validated again)`,
          `the same against the same base again ${repeated.ms.toFixed(1)} ms`,
          `validateChange without a base ${unprepared.ms.toFixed(0)} ms`,
        ].join("\n  "),
      )
  }, 600_000)
})
