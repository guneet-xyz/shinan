import { describe, expect, it } from "vitest"

import { parseCatalogDocument } from "../document/index.js"
import { estimatedBytes } from "./estimate.js"

function machine(facts: string): string {
  return `---\nid: machine/m\ntype: machine\ntitle: M\nsummary: M.\nowner: person/guneet\nfacts:\n${facts}---\n\n# M\n`
}

describe("the catalog worker's memory estimate", () => {
  it("counts fact check groups as well as facts", () => {
    let oneGroup =
      "  - checked: 2026-11-14\n    by: guneet\n    scope: All\n    source: ssh\n    observed:\n"
    let ownGroups = ""
    for (let k = 0; k < 100; k++) {
      oneGroup += `      x${k}: v${k}\n`
      ownGroups += `  - checked: 2026-11-14\n    by: guneet\n    scope: Check ${k}\n    source: ssh\n    observed:\n      x${k}: v${k}\n`
    }
    const one = parseCatalogDocument(machine(oneGroup))
    const own = parseCatalogDocument(machine(ownGroups))
    expect(one.kind === "entity" && one.facts.length).toBe(100)
    expect(own.kind === "entity" && own.groups.length).toBe(100)
    // 99 more groups, at 2 KiB each, beyond the longer text.
    expect(estimatedBytes(own) - estimatedBytes(one)).toBeGreaterThanOrEqual(
      99 * 2048,
    )
  })
})
