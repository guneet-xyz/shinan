import { describe, expect, it } from "vitest"

import {
  dockyard,
  domainSchema,
  guneetDev,
  musashi,
  startHere,
} from "../../../test/catalog-documents.js"
import {
  applyOperations,
  expectationOf,
  maxFacts,
  maxOperations,
} from "./apply.js"
import type { ApplyResult, OperationProblem } from "./apply.js"
import { readCatalog } from "./catalog.js"
import type {
  CatalogOperation,
  CheckInput,
  FactExpectation,
  FactInput,
  PresentFact,
} from "./operations.js"
import { maxDocumentBytes } from "./parse.js"
import { validateChange } from "./validate.js"

const by = "guneet via opencode-daedalus"

function apply(
  documents: string[],
  operations: CatalogOperation[],
): Extract<ApplyResult, { applied: true }> {
  const result = applyOperations(documents, operations, { by })
  if (!result.applied)
    throw new Error(`Not applied: ${JSON.stringify(result.problems, null, 2)}`)
  for (const change of result.changes) expect(change.after.problems).toEqual([])
  for (const entity of result.after.entities.values())
    expect(entity.problems).toEqual([])
  return result
}

function textOf(result: Extract<ApplyResult, { applied: true }>, id: string) {
  const document = result.after.documents.find((d) => d.id === id)
  if (!document) throw new Error(`No document ${id}`)
  return document.text
}

/** Applies operations to one document and returns its new text. */
function edit(document: string, ...operations: CatalogOperation[]): string {
  const id = readCatalog([document]).documents[0]?.id ?? ""
  return textOf(apply([document], operations), id)
}

function refused(
  documents: string[],
  operations: CatalogOperation[],
): OperationProblem[] {
  const result = applyOperations(documents, operations, { by })
  if (result.applied) throw new Error("Expected the proposal to be refused")
  return result.problems
}

/** Replaces exactly one occurrence, failing if the text does not hold it once. */
function swap(text: string, from: string, to: string): string {
  expect(text.split(from).length - 1).toBe(1)
  return text.replace(from, () => to)
}

/** The current fact with this identity, as an expectation. */
function current(
  document: string,
  identity: string,
  schemas: string[] = [],
): PresentFact {
  const catalog = readCatalog([...schemas, document])
  const entity = [...catalog.entities.values()][0]
  const fact = entity?.facts.find((f) => f.identity === identity)
  if (!fact) throw new Error(`No fact ${identity}`)
  return expectationOf(fact)
}

const check: CheckInput = {
  checked: "2026-11-16",
  scope: "df -h on the data disk",
  source: "Read-only SSH",
}
const checkLines = `  - checked: 2026-11-16
    by: guneet via opencode-daedalus
    scope: df -h on the data disk
    source: Read-only SSH
`
/** The check of Musashi's second group, as an operation sends it. */
const growCheck: CheckInput = {
  checked: "2026-11-14",
  scope:
    "Online data-disk grow; partition, filesystem and fstab after the change",
  source: "https://git.guneet.dev/infra/musashi/issues/93",
}
const endOfFacts = "---\n\n# Musashi"

describe("round trip (architecture §5.2, rule 5)", () => {
  it("leaves every byte unchanged when there are no operations", () => {
    const documents = [dockyard, musashi, domainSchema, guneetDev, startHere]
    const result = apply(documents, [])
    expect(result.changes).toEqual([])
    expect(result.after.documents.map((d) => d.text)).toEqual(documents)
  })

  it("reports a no-op as no change", () => {
    const result = apply(
      [musashi],
      [
        {
          op: "recheck-facts",
          document: "machine/musashi",
          facts: [current(musashi, "disk.data.free|observed")],
          check: growCheck,
        },
      ],
    )
    expect(result.changes).toEqual([])
  })
})

describe("set-fact (catalog §4.2)", () => {
  it("replaces a fact by identity, moving it to a new group for its new check", () => {
    const text = edit(musashi, {
      op: "set-fact",
      document: "machine/musashi",
      fact: { key: "disk.data.free", state: "observed", value: "70 GiB" },
      check,
      expect: current(musashi, "disk.data.free|observed"),
    })
    let expected = swap(musashi, "      disk.data.free: 74 GiB\n", "")
    expected = swap(
      expected,
      endOfFacts,
      `${checkLines}    observed:\n      disk.data.free: 70 GiB\n${endOfFacts}`,
    )
    expect(text).toBe(expected)
  })

  it("replaces a fact where it stands when its check matches its group's", () => {
    const text = edit(musashi, {
      op: "set-fact",
      document: "machine/musashi",
      fact: { key: "disk.data.free", state: "observed", value: "70 GiB" },
      check: growCheck,
      expect: current(musashi, "disk.data.free|observed"),
    })
    expect(text).toBe(
      swap(musashi, "disk.data.free: 74 GiB", "disk.data.free: 70 GiB"),
    )
  })

  it("merges a new fact into a group whose check matches in every field", () => {
    const text = edit(musashi, {
      op: "set-fact",
      document: "machine/musashi",
      fact: { key: "disk.data.used", state: "observed", value: "54 GiB" },
      check: growCheck,
      expect: { identity: "disk.data.used|observed", absent: true },
    })
    expect(text).toBe(
      swap(
        musashi,
        "      disk.data.free: 74 GiB\n",
        "      disk.data.free: 74 GiB\n      disk.data.used: 54 GiB\n",
      ),
    )
  })

  it("does not merge into a group that differs in one field", () => {
    const text = edit(musashi, {
      op: "set-fact",
      document: "machine/musashi",
      fact: { key: "disk.data.used", state: "observed", value: "54 GiB" },
      check: { ...growCheck, limits: "Not the root disk" },
      expect: { identity: "disk.data.used|observed", absent: true },
    })
    expect(text).toContain(
      "    limits: Not the root disk\n    observed:\n      disk.data.used: 54 GiB\n---",
    )
  })

  it("adds a second observation beside the first when `via` differs", () => {
    const text = edit(musashi, {
      op: "set-fact",
      document: "machine/musashi",
      fact: {
        key: "disk.data.size",
        state: "observed",
        value: "128 GiB",
        via: "lsblk",
      },
      check,
      expect: { identity: "disk.data.size|observed|via=lsblk", absent: true },
    })
    const entity = readCatalog([text]).entities.get("machine/musashi")
    expect(
      entity?.facts.filter((f) => f.key === "disk.data.size").map((f) => f.via),
    ).toEqual(["filesystem", "instance-metadata", "lsblk"])
    expect(text).toContain(
      "      disk.data.size: { value: 128 GiB, via: lsblk }\n",
    )
  })

  it("adds a value of a multi-valued key, turning one value into a list", () => {
    const sameCheck: CheckInput = {
      checked: "2026-11-14",
      scope: "Checkouts on Daedalus and Musashi and their revisions",
      source:
        "Local git on Daedalus; filtered SSH reads on Musashi (infra/musashi#85)",
      limits:
        "The Daedalus infrastructure checkout's submodule was not initialized, so it was not read",
    }
    const text = edit(
      dockyard,
      {
        op: "set-fact",
        document: "project/dockyard",
        fact: { key: "provides", state: "observed", to: "service/registry-ui" },
        check: sameCheck,
        expect: {
          identity: "provides|observed|to=service/registry-ui",
          absent: true,
        },
      },
      {
        op: "set-fact",
        document: "project/dockyard",
        fact: {
          key: "checkout-on",
          state: "observed",
          to: "machine/takezo",
          attributes: { path: "/srv/dockyard" },
        },
        check: sameCheck,
        expect: {
          identity: "checkout-on|observed|to=machine/takezo|path=/srv/dockyard",
          absent: true,
        },
      },
    )
    let expected = swap(
      dockyard,
      "      provides: service/container-registry\n",
      "      provides:\n        - service/container-registry\n        - service/registry-ui\n",
    )
    expected = swap(
      expected,
      "/mnt/musashi/stacks/dockyard/dockyard }\n",
      "/mnt/musashi/stacks/dockyard/dockyard }\n        - { to: machine/takezo, path: /srv/dockyard }\n",
    )
    expect(text).toBe(expected)
  })

  it("quotes text that would read as a number, a boolean or null", () => {
    const values = ["1.10", "true", "null", "~", "0x10", "no"]
    const text = edit(
      musashi,
      ...values.map((value, i): CatalogOperation => ({
        op: "set-fact",
        document: "machine/musashi",
        fact: { key: `label.n${i}`, state: "observed", value },
        check,
        expect: { identity: `label.n${i}|observed`, absent: true },
      })),
    )
    expect(text).toContain(
      '      label.n0: "1.10"\n      label.n1: "true"\n      label.n2: "null"\n      label.n3: "~"\n      label.n4: "0x10"\n      label.n5: no\n',
    )
    const facts =
      readCatalog([text]).entities.get("machine/musashi")?.facts ?? []
    expect(
      facts.filter((f) => f.key.startsWith("label.")).map((f) => f.value),
    ).toEqual(values)
  })

  it("writes numbers and booleans as values, and a long form in canonical order", () => {
    const text = edit(musashi, {
      op: "set-fact",
      document: "machine/musashi",
      fact: {
        key: "cpu.count",
        state: "observed",
        value: 2,
        task: "T-3",
        note: "Small on purpose",
        via: "nproc",
      },
      check,
      expect: { identity: "cpu.count|observed|via=nproc", absent: true },
    })
    expect(text).toContain(
      "      cpu.count: { value: 2, via: nproc, note: Small on purpose, task: T-3 }\n",
    )
  })

  it("writes the actor's written form as `by`, and refuses a caller's", () => {
    const text = edit(musashi, {
      op: "set-fact",
      document: "machine/musashi",
      fact: { key: "role", state: "observed", value: "production" },
      check,
      expect: { identity: "role|observed", absent: true },
    })
    expect(text).toContain(
      `${checkLines}    observed:\n      role: production\n`,
    )
    expect(
      refused(
        [musashi],
        [
          {
            op: "set-fact",
            document: "machine/musashi",
            fact: { key: "role", state: "observed", value: "production" },
            check: { ...check, by: "someone-else" } as CheckInput,
            expect: { identity: "role|observed", absent: true },
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid", code: "operation-invalid" }])
  })

  it("quotes fact keys that would read as null or a boolean", () => {
    const text = edit(musashi, {
      op: "set-fact",
      document: "machine/musashi",
      fact: { key: "null", state: "observed", value: "x" },
      check,
      expect: { identity: "null|observed", absent: true },
    })
    expect(text).toContain('      "null": x\n')
  })

  it("creates the `facts` field when there is none", () => {
    const bare = swap(
      guneetDev,
      guneetDev.slice(
        guneetDev.indexOf("facts:"),
        guneetDev.indexOf("---\n\n#"),
      ),
      "",
    )
    const text = edit(bare, {
      op: "set-fact",
      document: "domain/guneet-dev",
      fact: { key: "registrar", state: "unknown", note: "Not looked up" },
      expect: { identity: "registrar|unknown", absent: true },
    })
    expect(text).toBe(
      swap(
        bare,
        "owner: person/guneet\n",
        "owner: person/guneet\nfacts:\n  - unknown:\n      registrar: Not looked up\n",
      ),
    )
  })
})

describe("known values settle unknown facts (catalog §4.2, §4.8)", () => {
  const service = `---
id: service/shinan
type: service
title: Shinan
summary: The shared project memory.
status: active
owner: person/guneet
facts:
  - unknown:
      environment: Not decided
      endpoint: More may exist
      runs-on: { to: machine/musashi, note: Not deployed yet }
      depends-on: Not traced
---
`
  const set = (
    key: string,
    value: Record<string, string>,
  ): CatalogOperation => ({
    op: "set-fact",
    document: "service/shinan",
    fact: { key, state: "observed", ...value },
    check,
    expect: {
      identity: `${key}|observed${"to" in value ? `|to=${value.to}` : ""}${key === "endpoint" ? `|value=${value.value}` : ""}`,
      absent: true,
    },
  })
  const unknowns = (text: string) =>
    readCatalog([text])
      .entities.get("service/shinan")
      ?.facts.filter((f) => f.state === "unknown")
      .map((f) => f.identity)

  it("removes the unknown fact of a single-valued key", () => {
    expect(
      unknowns(edit(service, set("environment", { value: "production" }))),
    ).toEqual([
      "endpoint|unknown",
      "runs-on|unknown|to=machine/musashi",
      "depends-on|unknown",
    ])
  })

  it("removes a relation's unknown fact that names the same target, and only that", () => {
    expect(
      unknowns(edit(service, set("runs-on", { to: "machine/musashi" }))),
    ).toEqual(["environment|unknown", "endpoint|unknown", "depends-on|unknown"])
    expect(
      unknowns(edit(service, set("runs-on", { to: "machine/daedalus" }))),
    ).toHaveLength(4)
  })

  it("keeps the unknown fact of a multi-valued key, and of a relation with no target", () => {
    expect(
      unknowns(
        edit(service, set("endpoint", { value: "https://shinan.guneet.dev" })),
      ),
    ).toHaveLength(4)
    expect(
      unknowns(edit(service, set("depends-on", { to: "service/postgres" }))),
    ).toHaveLength(4)
  })
})

describe("a change of state (catalog §4.2, §4.4)", () => {
  const planned = current(guneetDev, "expires_on|planned", [domainSchema])

  it("removes the planned fact it names and writes the new one", () => {
    const result = apply(
      [domainSchema, guneetDev],
      [
        {
          op: "set-fact",
          document: "domain/guneet-dev",
          fact: { key: "expires_on", state: "observed", value: "2027-11-15" },
          check,
          expect: { identity: "expires_on|observed", absent: true },
          supersedes: planned,
        },
      ],
    )
    const text = textOf(result, "domain/guneet-dev")
    let expected = swap(
      guneetDev,
      "  - planned:\n      expires_on: { value: 2027-11-15, task: T-12 }\n",
      "",
    )
    expected = swap(
      expected,
      "---\n\n# guneet.dev",
      `${checkLines}    observed:\n      expires_on: 2027-11-15\n---\n\n# guneet.dev`,
    )
    expect(text).toBe(expected)
  })

  it("leaves a planned fact beside the new one when not named", () => {
    const result = apply(
      [domainSchema, guneetDev],
      [
        {
          op: "set-fact",
          document: "domain/guneet-dev",
          fact: { key: "expires_on", state: "observed", value: "2027-11-15" },
          check,
          expect: { identity: "expires_on|observed", absent: true },
        },
      ],
    )
    expect(
      result.after.entities
        .get("domain/guneet-dev")
        ?.facts.map((f) => f.identity),
    ).toContain("expires_on|planned")
  })

  it("supersedes only a fact of the same key", () => {
    const problems = refused(
      [domainSchema, guneetDev],
      [
        {
          op: "set-fact",
          document: "domain/guneet-dev",
          fact: { key: "registrar", state: "intended", value: "Cloudflare" },
          check,
          expect: { identity: "registrar|intended", absent: true },
          supersedes: planned,
        },
      ],
    )
    expect(problems).toMatchObject([
      { operation: 0, kind: "invalid", code: "operation-invalid" },
    ])
  })
})

describe("accepted discrepancies (catalog §4.7)", () => {
  const accepted = musashi
    .replace(
      "disk.data.size: { value: 128 GiB, via: filesystem }",
      "disk.data.size: { value: 128 GiB, via: filesystem, accepted: person/guneet }",
    )
    .replace(
      "        note: Metadata lags after a resize\n",
      "        note: Metadata lags after a resize\n        accepted: person/guneet\n",
    )
  const metadata = () =>
    current(accepted, "disk.data.size|observed|via=instance-metadata")
  const discrepancy = (text: string) => {
    const entity = readCatalog([text]).entities.get("machine/musashi")
    return entity?.facts
      .filter((f) => f.key === "disk.data.size")
      .map((f) => [f.via, f.value, f.accepted, f.note])
  }

  it("keeps the acceptance through a recheck that changes no value", () => {
    const text = edit(accepted, {
      op: "set-fact",
      document: "machine/musashi",
      fact: {
        key: "disk.data.size",
        state: "observed",
        value: "64 GB",
        via: "instance-metadata",
      },
      check,
      expect: metadata(),
    })
    expect(discrepancy(text)).toEqual([
      ["filesystem", "128 GiB", "person/guneet", undefined],
      [
        "instance-metadata",
        "64 GB",
        "person/guneet",
        "Metadata lags after a resize",
      ],
    ])
    // Its group's only fact: the group keeps its place and its text.
    expect(
      edit(accepted, {
        op: "recheck-facts",
        document: "machine/musashi",
        facts: [metadata()],
        check,
      }),
    ).toContain(
      "    source: Read-only SSH\n    observed:\n      disk.data.size:\n        value: 64 GB\n        via: instance-metadata\n        note: Metadata lags after a resize\n        accepted: person/guneet\n  - unknown:",
    )
  })

  it("removes it from every fact of the discrepancy when a value changes", () => {
    const text = edit(accepted, {
      op: "set-fact",
      document: "machine/musashi",
      fact: {
        key: "disk.data.size",
        state: "observed",
        value: "128 GB",
        via: "instance-metadata",
      },
      check,
      expect: metadata(),
    })
    expect(discrepancy(text)).toEqual([
      ["filesystem", "128 GiB", undefined, undefined],
      ["instance-metadata", "128 GB", undefined, undefined],
    ])
    expect(text).toContain(
      "disk.data.size: { value: 128 GiB, via: filesystem }",
    )
  })

  it("removes it when a fact leaves the discrepancy", () => {
    const text = edit(accepted, {
      op: "remove-fact",
      document: "machine/musashi",
      expect: metadata(),
    })
    expect(discrepancy(text)).toEqual([
      ["filesystem", "128 GiB", undefined, undefined],
    ])
  })

  it("refuses `accepted` sent with a fact: Shinan writes it", () => {
    expect(
      refused(
        [musashi],
        [
          {
            op: "set-fact",
            document: "machine/musashi",
            fact: {
              key: "disk.data.size",
              state: "observed",
              value: "64 GB",
              via: "instance-metadata",
              accepted: "person/guneet",
            } as FactInput,
            check,
            expect: current(
              musashi,
              "disk.data.size|observed|via=instance-metadata",
            ),
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid", code: "operation-invalid" }])
  })

  const accept = (
    expect = [
      current(musashi, "disk.data.size|observed|via=filesystem"),
      current(musashi, "disk.data.size|observed|via=instance-metadata"),
    ],
  ): CatalogOperation => ({
    op: "accept-discrepancy",
    document: "machine/musashi",
    key: "disk.data.size",
    note: "Metadata lags after a resize",
    expect,
  })

  it("accepts a discrepancy only when a person approves, naming that person", () => {
    const result = applyOperations([musashi], [accept()], {
      by,
      acceptedBy: "person/guneet",
    })
    if (!result.applied) throw new Error(JSON.stringify(result.problems))
    const text = result.changes[0]?.after.text ?? ""
    expect(discrepancy(text)).toEqual([
      [
        "filesystem",
        "128 GiB",
        "person/guneet",
        "Metadata lags after a resize",
      ],
      [
        "instance-metadata",
        "64 GB",
        "person/guneet",
        "Metadata lags after a resize",
      ],
    ])
    expect(
      readCatalog([text]).entities.get("machine/musashi") &&
        text.includes(
          "disk.data.size: { value: 128 GiB, via: filesystem, note: Metadata lags after a resize, accepted: person/guneet }",
        ),
    ).toBe(true)
    expect(refused([musashi], [accept()])).toMatchObject([
      { kind: "invalid", code: "needs-approval" },
    ])
    expect(
      applyOperations([musashi], [accept()], {
        by,
        acceptedBy: "machine/musashi",
      }),
    ).toMatchObject({ applied: false, problems: [{ code: "needs-approval" }] })
  })

  it("accepts only the discrepancy as the operation saw it", () => {
    const one = [current(musashi, "disk.data.size|observed|via=filesystem")]
    expect(
      applyOperations([musashi], [accept(one)], {
        by,
        acceptedBy: "person/guneet",
      }),
    ).toMatchObject({ applied: false, problems: [{ code: "changed" }] })
  })
})

describe("remove-fact and recheck-facts (catalog §4.3, §4.5)", () => {
  it("drops a state map, then a group, then `facts`, when they are left empty", () => {
    const unknown = (identity: string): CatalogOperation => ({
      op: "remove-fact",
      document: "machine/musashi",
      expect: current(musashi, identity),
    })
    expect(edit(musashi, unknown("recovery.tested|unknown"))).toBe(
      swap(
        musashi,
        "      recovery.tested: The rebuild runbook has not been run\n",
        "",
      ),
    )
    expect(
      edit(
        musashi,
        unknown("recovery.tested|unknown"),
        unknown("network.public_ipv6|unknown"),
      ),
    ).toBe(
      swap(
        musashi,
        "  - unknown:\n      network.public_ipv6: Reachability not tested\n      recovery.tested: The rebuild runbook has not been run\n",
        "",
      ),
    )
    const single = `---\nid: machine/x\ntype: machine\ntitle: X\nsummary: S.\nstatus: active\nowner: person/guneet\nfacts:\n  - unknown:\n      role: Not asked\n---\n`
    expect(
      edit(single, {
        op: "remove-fact",
        document: "machine/x",
        expect: current(single, "role|unknown"),
      }),
    ).toBe(
      `---\nid: machine/x\ntype: machine\ntitle: X\nsummary: S.\nstatus: active\nowner: person/guneet\n---\n`,
    )
  })

  it("moves rechecked facts to the new group, keeping their text", () => {
    const text = edit(musashi, {
      op: "recheck-facts",
      document: "machine/musashi",
      facts: [
        current(musashi, "platform.arch|observed"),
        current(musashi, "disk.data.size|observed|via=filesystem"),
      ],
      check,
    })
    let expected = swap(musashi, "      platform.arch: aarch64\n", "")
    expected = swap(
      expected,
      "      disk.data.size: { value: 128 GiB, via: filesystem }\n",
      "",
    )
    expected = swap(
      expected,
      endOfFacts,
      `${checkLines}    observed:\n      platform.arch: aarch64\n      disk.data.size: { value: 128 GiB, via: filesystem }\n${endOfFacts}`,
    )
    expect(text).toBe(expected)
  })

  it("keeps a moved fact apart from a group that already has its single-valued key", () => {
    const text = edit(
      musashi,
      {
        op: "recheck-facts",
        document: "machine/musashi",
        facts: [current(musashi, "disk.data.size|observed|via=filesystem")],
        check,
      },
      {
        op: "recheck-facts",
        document: "machine/musashi",
        facts: [
          current(musashi, "disk.data.size|observed|via=instance-metadata"),
        ],
        check,
      },
    )
    const entity = readCatalog([text]).entities.get("machine/musashi")
    const groups = entity?.facts
      .filter((f) => f.key === "disk.data.size")
      .map((f) => f.group)
    expect(new Set(groups).size).toBe(2)
    expect(
      entity?.facts
        .filter((f) => f.key === "disk.data.size")
        .every((f) => f.check?.checked?.text === "2026-11-16"),
    ).toBe(true)
  })

  it("refuses to recheck a planned fact", () => {
    expect(
      refused(
        [domainSchema, guneetDev],
        [
          {
            op: "recheck-facts",
            document: "domain/guneet-dev",
            facts: [current(guneetDev, "expires_on|planned", [domainSchema])],
            check,
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid" }])
  })
})

describe("expectations and conflicts (catalog §8.5)", () => {
  const free = current(musashi, "disk.data.free|observed")
  const setFree = (expect: FactExpectation): CatalogOperation => ({
    op: "set-fact",
    document: "machine/musashi",
    fact: { key: "disk.data.free", state: "observed", value: "70 GiB" },
    check,
    expect,
  })

  it("applies operations whose expectations hold even if other parts of the entity changed", () => {
    const first = edit(musashi, setFree(free))
    const second = edit(first, {
      op: "recheck-facts",
      document: "machine/musashi",
      facts: [current(musashi, "platform.arch|observed")],
      check,
    })
    expect(second).toContain(
      "      disk.data.free: 70 GiB\n      platform.arch: aarch64\n",
    )
  })

  it("refuses an operation whose fact changed, whose check changed, or that is gone", () => {
    const changed = edit(musashi, setFree(free))
    expect(refused([changed], [setFree(free)])).toMatchObject([
      {
        operation: 0,
        kind: "conflict",
        code: "fact-changed",
        documentId: "machine/musashi",
      },
    ])
    const rechecked = edit(musashi, {
      op: "recheck-facts",
      document: "machine/musashi",
      facts: [free],
      check,
    })
    expect(refused([rechecked], [setFree(free)])).toMatchObject([
      { code: "fact-changed" },
    ])
    const removed = edit(musashi, {
      op: "remove-fact",
      document: "machine/musashi",
      expect: free,
    })
    expect(refused([removed], [setFree(free)])).toMatchObject([
      { code: "fact-missing" },
    ])
    expect(
      refused([musashi], [setFree({ identity: free.identity, absent: true })]),
    ).toMatchObject([{ code: "fact-exists" }])
  })

  it("refuses a fact whose identity is not the one named", () => {
    expect(
      refused(
        [musashi],
        [setFree({ ...free, identity: "disk.data.free|observed|via=df" })],
      ),
    ).toMatchObject([{ kind: "conflict", code: "identity-changed" }])
  })

  it("refuses an operation it does not know", () => {
    expect(
      refused([musashi], [{ op: "rename" } as unknown as CatalogOperation]),
    ).toMatchObject([{ kind: "invalid", code: "operation-invalid" }])
  })

  it("applies all or nothing, listing every problem", () => {
    const result = applyOperations(
      [musashi, dockyard],
      [
        {
          op: "set-field",
          document: "project/dockyard",
          field: "title",
          value: "Harbor",
          expect: { value: "Dockyard" },
        },
        setFree({ identity: free.identity, absent: true }),
        {
          op: "set-field",
          document: "machine/nowhere",
          field: "title",
          value: "X",
          expect: { value: "Y" },
        },
      ],
      { by },
    )
    expect(result.applied).toBe(false)
    if (result.applied) return
    expect(result.problems.map((p) => [p.operation, p.code])).toEqual([
      [1, "fact-exists"],
      [2, "document-missing"],
    ])
  })
})

describe("entity fields, retire and change of ID (catalog §2.3, §2.4)", () => {
  it("changes a field's value in place and quotes it where needed", () => {
    expect(
      edit(dockyard, {
        op: "set-field",
        document: "project/dockyard",
        field: "title",
        value: "true",
        expect: { value: "Dockyard" },
      }),
    ).toBe(swap(dockyard, "title: Dockyard\n", 'title: "true"\n'))
    expect(
      edit(dockyard, {
        op: "set-field",
        document: "project/dockyard",
        field: "status",
        value: "deprecated",
        expect: { value: "active" },
      }),
    ).toBe(swap(dockyard, "status: active\n", "status: deprecated\n"))
  })

  it("refuses a field that changed meanwhile, or one this operation does not change", () => {
    expect(
      refused(
        [dockyard],
        [
          {
            op: "set-field",
            document: "project/dockyard",
            field: "title",
            value: "X",
            expect: { value: "Old" },
          },
        ],
      ),
    ).toMatchObject([{ kind: "conflict", code: "changed" }])
    expect(
      refused(
        [dockyard],
        [
          {
            op: "set-field",
            document: "project/dockyard",
            field: "status",
            value: "retired",
            expect: { value: "active" },
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid" }])
    expect(
      refused(
        [dockyard],
        [
          {
            op: "set-field",
            document: "project/dockyard",
            field: "decision_state",
            value: "accepted",
            expect: { value: null },
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid", code: "operation-invalid" }])
    expect(
      refused(
        [dockyard],
        [
          {
            op: "set-field",
            document: "project/dockyard",
            field: "owner",
            value: null,
            expect: { value: "person/guneet" },
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid" }])
  })

  it("changes a decision's fields, adding them in Shinan's order", () => {
    const decision = `---
id: decision/no-git-mirror
type: decision
title: No Git mirror for now
summary: Revisions stay in PostgreSQL.
status: active
owner: person/guneet
decision_state: proposed
---
`
    expect(
      edit(
        decision,
        {
          op: "set-field",
          document: "decision/no-git-mirror",
          field: "decision_state",
          value: "accepted",
          expect: { value: "proposed" },
        },
        {
          op: "set-field",
          document: "decision/no-git-mirror",
          field: "decided_on",
          value: "2026-11-16",
          expect: { value: null },
        },
      ),
    ).toBe(
      swap(
        decision,
        "decision_state: proposed\n",
        "decision_state: accepted\ndecided_on: 2026-11-16\n",
      ),
    )
  })

  it("retires an entity and names its replacement after its owner", () => {
    expect(
      edit(dockyard, {
        op: "retire",
        document: "project/dockyard",
        replacedBy: "project/harbor",
        expect: { status: "active" },
      }),
    ).toBe(
      swap(
        dockyard,
        "status: active\nowner: person/guneet\n",
        "status: retired\nowner: person/guneet\nreplaced_by: project/harbor\n",
      ),
    )
  })

  it("changes an ID, keeping the old one as an alias", () => {
    const result = apply(
      [musashi],
      [
        {
          op: "change-id",
          document: "machine/musashi",
          id: "machine/musashi-prod",
        },
        {
          op: "set-field",
          document: "machine/musashi-prod",
          field: "title",
          value: "Musashi (production)",
          expect: { value: "Musashi" },
        },
      ],
    )
    expect(textOf(result, "machine/musashi-prod")).toBe(
      swap(
        swap(musashi, "id: machine/musashi\n", "id: machine/musashi-prod\n"),
        "title: Musashi\nsummary: Azure VM that runs the shared production stacks.\nstatus: active\nowner: person/guneet\n",
        "title: Musashi (production)\nsummary: Azure VM that runs the shared production stacks.\nstatus: active\nowner: person/guneet\naliases: [machine/musashi]\n",
      ),
    )
  })

  it("adds to existing aliases in their style, and changing back swaps the alias", () => {
    const block = swap(
      musashi,
      "owner: person/guneet\n",
      "owner: person/guneet\naliases:\n  - machine/takezo\n",
    )
    const moved = textOf(
      apply(
        [block],
        [
          {
            op: "change-id",
            document: "machine/musashi",
            id: "machine/musashi-2",
          },
        ],
      ),
      "machine/musashi-2",
    )
    expect(moved).toContain(
      "aliases:\n  - machine/takezo\n  - machine/musashi\n",
    )
    const back = textOf(
      apply(
        [moved],
        [
          {
            op: "change-id",
            document: "machine/musashi-2",
            id: "machine/musashi",
          },
        ],
      ),
      "machine/musashi",
    )
    expect(back).toContain("id: machine/musashi\n")
    expect(back).toContain(
      "aliases:\n  - machine/takezo\n  - machine/musashi-2\n",
    )
  })

  it("refuses a taken ID, another type, and the old ID afterwards", () => {
    expect(
      refused(
        [musashi, dockyard],
        [
          {
            op: "change-id",
            document: "project/dockyard",
            id: "machine/musashi",
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid" }])
    const other = swap(
      musashi,
      "id: machine/musashi",
      "id: machine/takezo",
    ).replace("title: Musashi", "title: Takezo")
    expect(
      refused(
        [musashi, other],
        [
          {
            op: "change-id",
            document: "machine/musashi",
            id: "machine/takezo",
          },
        ],
      ),
    ).toMatchObject([{ kind: "conflict", code: "document-exists" }])
    const problems = refused(
      [musashi],
      [
        {
          op: "change-id",
          document: "machine/musashi",
          id: "machine/musashi-2",
        },
        {
          op: "set-field",
          document: "machine/musashi",
          field: "title",
          value: "X",
          expect: { value: "Musashi" },
        },
      ],
    )
    expect(problems).toMatchObject([{ operation: 1, code: "document-missing" }])
    expect(problems[0]?.message).toContain("machine/musashi-2")
  })
})

describe("edit-body (catalog §2.5)", () => {
  const cautions =
    readCatalog([dockyard]).documents[0]?.body.sections.find(
      (s) => s.anchor === "cautions",
    )?.text ?? ""

  it("replaces one section, leaving the rest of the body", () => {
    const text = edit(dockyard, {
      op: "edit-body",
      document: "project/dockyard",
      section: "cautions",
      text: "## Cautions\n\nNever push to the registry from Daedalus.",
      expect: { text: cautions },
    })
    expect(text).toBe(
      swap(
        dockyard,
        cautions,
        "## Cautions\n\nNever push to the registry from Daedalus.\n",
      ),
    )
  })

  it("adds a missing section at the end, and removes one with empty text", () => {
    const added = edit(musashi, {
      op: "edit-body",
      document: "machine/musashi",
      section: "cautions",
      text: "## Cautions\n\nNo reboots during backups.\n",
      expect: { absent: true },
    })
    expect(added).toBe(
      `${musashi}\n## Cautions\n\nNo reboots during backups.\n`,
    )
    expect(
      edit(dockyard, {
        op: "edit-body",
        document: "project/dockyard",
        section: "cautions",
        text: "",
        expect: { text: cautions },
      }),
    ).toBe(swap(dockyard, cautions, ""))
  })

  it("replaces the whole body", () => {
    const body = readCatalog([musashi]).documents[0]?.body.text ?? ""
    const text = edit(musashi, {
      op: "edit-body",
      document: "machine/musashi",
      text: "\n# Musashi\n",
      expect: { text: body },
    })
    expect(text).toBe(swap(musashi, body, "\n# Musashi\n"))
  })

  it("refuses a section that changed or is gone", () => {
    expect(
      refused(
        [dockyard],
        [
          {
            op: "edit-body",
            document: "project/dockyard",
            section: "cautions",
            text: "x",
            expect: { text: "old" },
          },
        ],
      ),
    ).toMatchObject([{ kind: "conflict", code: "changed" }])
    expect(
      refused(
        [dockyard],
        [
          {
            op: "edit-body",
            document: "project/dockyard",
            section: "gone",
            text: "x",
            expect: { text: "old" },
          },
        ],
      ),
    ).toMatchObject([{ kind: "conflict", code: "changed" }])
    expect(
      refused(
        [dockyard],
        [
          {
            op: "edit-body",
            document: "project/dockyard",
            section: "cautions",
            text: "## Cautions\n",
            expect: { absent: true },
          },
        ],
      ),
    ).toMatchObject([{ kind: "conflict" }])
  })
})

describe("creating documents", () => {
  it("writes a new entity in canonical style, with its facts", () => {
    const result = apply(
      [],
      [
        {
          op: "create-entity",
          id: "service/shinan",
          title: "Shinan",
          summary: "Shared project memory: 1.10 and up.",
          owner: "person/guneet",
          facts: [
            {
              fact: {
                key: "endpoint",
                state: "intended",
                value: "https://shinan.guneet.dev",
              },
              check,
            },
            {
              fact: {
                key: "endpoint",
                state: "intended",
                value: "https://shinan.example",
              },
              check,
            },
            {
              fact: {
                key: "deployment.version",
                state: "unknown",
                note: "Not deployed",
              },
            },
            {
              fact: {
                key: "runs-on",
                state: "planned",
                to: "machine/musashi",
                task: "T-4",
              },
            },
          ],
          body: "# Shinan\n\nSee [Musashi](machine/musashi).",
        },
      ],
    )
    expect(textOf(result, "service/shinan")).toBe(`---
id: service/shinan
type: service
title: Shinan
summary: "Shared project memory: 1.10 and up."
status: active
owner: person/guneet
facts:
${checkLines}    intended:
      endpoint:
        - https://shinan.guneet.dev
        - https://shinan.example
  - unknown:
      deployment.version: Not deployed
    planned:
      runs-on: { to: machine/musashi, task: T-4 }
---

# Shinan

See [Musashi](machine/musashi).
`)
    expect(result.changes.map((c) => [c.before, c.after.id])).toEqual([
      [null, "service/shinan"],
    ])
  })

  it("refuses an ID that is taken, as an ID or an alias", () => {
    const create = (id: string): CatalogOperation => ({
      op: "create-entity",
      id,
      title: "T",
      summary: "S",
      owner: "person/guneet",
    })
    expect(refused([dockyard], [create("project/dockyard")])).toMatchObject([
      { kind: "conflict", code: "document-exists" },
    ])
    const aliased = swap(
      musashi,
      "owner: person/guneet\n",
      "owner: person/guneet\naliases: [machine/old]\n",
    )
    expect(refused([aliased], [create("machine/old")])).toMatchObject([
      { code: "document-exists" },
    ])
    expect(refused([], [create("Machine/X")])).toMatchObject([
      { kind: "invalid" },
    ])
  })

  it("creates a type schema and entities of the type in one proposal, schema first", () => {
    const result = apply(
      [],
      [
        {
          op: "create-entity",
          id: "domain/guneet-dev",
          title: "guneet.dev",
          summary: "The team's main domain.",
          owner: "person/guneet",
          facts: [
            {
              fact: {
                key: "nameservers",
                state: "observed",
                value: "ada.ns.cloudflare.com",
              },
              check,
            },
            {
              fact: {
                key: "nameservers",
                state: "observed",
                value: "bob.ns.cloudflare.com",
              },
              check,
            },
          ],
        },
        {
          op: "create-schema",
          type: "domain",
          title: "Domain",
          summary:
            "A DNS domain the team owns, and where it is registered and served.",
          owner: "person/guneet",
          keys: {
            registrar: {},
            expires_on: { recheck: "30d" },
            nameservers: { many: true, recheck: "90d" },
            "served-by": {
              relation: ["service"],
              many: true,
              inverse: "domains",
            },
            "configured-by": { relation: ["project"], inverse: "domains" },
          },
          required: ["registrar", "served-by"],
          sections: ["Role", "Cautions"],
          body: "# Domain\n",
        },
      ],
    )
    expect(textOf(result, "schema/domain")).toBe(`---
id: schema/domain
title: Domain
summary: A DNS domain the team owns, and where it is registered and served.
status: active
owner: person/guneet
keys:
  registrar: {}
  expires_on: { recheck: 30d }
  nameservers: { many: true, recheck: 90d }
  served-by: { relation: [service], many: true, inverse: domains }
  configured-by: { relation: [project], inverse: domains }
required: [registrar, served-by]
sections: [Role, Cautions]
---

# Domain
`)
    expect(
      result.after.entities
        .get("domain/guneet-dev")
        ?.facts.map((f) => f.identity),
    ).toEqual([
      "nameservers|observed|value=ada.ns.cloudflare.com",
      "nameservers|observed|value=bob.ns.cloudflare.com",
    ])
    expect(result.changes.map((c) => c.after.id)).toEqual([
      "schema/domain",
      "domain/guneet-dev",
    ])
  })

  it("adds, changes and removes a type schema key", () => {
    const keyOf = (key: string) => {
      const d = readCatalog([domainSchema]).schemas[0]
      const k = d?.keys.find((x) => x.key === key)
      return {
        many: k?.many,
        relation: k?.relation,
        identifiedBy: k?.identifiedBy,
        inverse: k?.inverse,
        recheck: k?.recheck,
      }
    }
    const text = edit(
      domainSchema,
      {
        op: "set-schema-key",
        document: "schema/domain",
        key: "dnssec",
        options: { recheck: "180d" },
        expect: { absent: true },
      },
      {
        op: "set-schema-key",
        document: "schema/domain",
        key: "expires_on",
        options: { recheck: "14d" },
        expect: { options: keyOf("expires_on") },
      },
      {
        op: "set-schema-key",
        document: "schema/domain",
        key: "registrar",
        options: null,
        expect: { options: keyOf("registrar") },
      },
    )
    let expected = swap(domainSchema, "  registrar: {}\n", "")
    expected = swap(
      expected,
      "expires_on: { recheck: 30d }",
      "expires_on: { recheck: 14d }",
    )
    expected = swap(
      expected,
      "inverse: domains }\nrequired",
      "inverse: domains }\n  dnssec: { recheck: 180d }\nrequired",
    )
    expect(text).toBe(expected)
    expect(
      refused(
        [domainSchema],
        [
          {
            op: "set-schema-key",
            document: "schema/domain",
            key: "registrar",
            options: {},
            expect: { absent: true },
          },
        ],
      ),
    ).toMatchObject([{ kind: "conflict", code: "changed" }])
  })

  it("writes and changes the start-here document", () => {
    const created = apply(
      [],
      [
        {
          op: "create-start-here",
          title: "Start here",
          owner: "person/guneet",
          people: [{ to: "project/dockyard", note: "The registry." }],
          agents: [],
        },
      ],
    )
    expect(textOf(created, "start-here")).toBe(`---
id: start-here
title: Start here
owner: person/guneet
people:
  - to: project/dockyard
    note: The registry.
agents: []
---
`)
    const doc = readCatalog([startHere]).startHere
    const steps = (doc?.agents ?? []).map((s) =>
      s.target.kind === "entity"
        ? { to: s.target.id, note: s.note }
        : s.target.kind === "list"
          ? { list: s.target.list, note: s.note }
          : { url: s.target.url, note: s.note },
    )
    const text = edit(startHere, {
      op: "set-start-here-path",
      path: "agents",
      steps: [
        {
          list: "waiting-for-approval",
          note: "What is waiting: check before proposing.",
        },
      ],
      expect: { steps },
    })
    expect(text).toBe(
      swap(
        startHere,
        startHere.slice(
          startHere.indexOf("agents:"),
          startHere.indexOf("---\n\n#"),
        ),
        'agents:\n  - list: waiting-for-approval\n    note: "What is waiting: check before proposing."\n',
      ),
    )
    expect(
      edit(startHere, {
        op: "set-field",
        document: "start-here",
        field: "summary",
        value: null,
        expect: {
          value:
            "The paths through this workspace's catalog for people and agents.",
        },
      }),
    ).toBe(
      swap(
        startHere,
        "summary: The paths through this workspace's catalog for people and agents.\n",
        "",
      ),
    )
  })
})

describe("documents in other styles keep their style", () => {
  it("edits a CRLF document with CRLF lines", () => {
    const crlf = musashi.replace(/\n/g, "\r\n")
    const text = edit(crlf, {
      op: "set-fact",
      document: "machine/musashi",
      fact: { key: "disk.data.used", state: "observed", value: "54 GiB" },
      check,
      expect: { identity: "disk.data.used|observed", absent: true },
    })
    expect(text.replace(/\r\n/g, "")).not.toContain("\n")
    expect(text).toContain(
      "    source: Read-only SSH\r\n    observed:\r\n      disk.data.used: 54 GiB\r\n---",
    )
  })

  it("edits flow maps and lists, four-space indents and zero-indented lists", () => {
    const styled = `---
id: service/x
type: service
title: X
summary: S.
status: active
owner: person/guneet
facts:
- checked: 2026-11-14   # first check
  by: guneet
  scope: s
  source: s
  observed: { environment: production, endpoint: [https://a, https://b] }
-   planned:
        runs-on:
            to: machine/musashi
            task: T-1
---
`
    const read = (id: string) => current(styled, id)
    const text = edit(
      styled,
      {
        op: "set-fact",
        document: "service/x",
        fact: { key: "endpoint", state: "observed", value: "https://c, d" },
        check: { checked: "2026-11-14", scope: "s", source: "s" },
        expect: {
          identity: "endpoint|observed|value=https://c, d",
          absent: true,
        },
      },
      {
        op: "remove-fact",
        document: "service/x",
        expect: read("environment|observed"),
      },
    )
    expect(text).toContain(
      "- checked: 2026-11-14   # first check\n  by: guneet\n  scope: s\n  source: s\n  observed: { endpoint: [https://a, https://b] }\n",
    )
    expect(text).toContain(
      `- checked: 2026-11-14\n  by: guneet via opencode-daedalus\n  scope: s\n  source: s\n  observed:\n    endpoint: https://c, d\n---`,
    )

    const own = styled.replace("  by: guneet\n", `  by: ${by}\n`)
    const inFlow = edit(own, {
      op: "set-fact",
      document: "service/x",
      fact: { key: "endpoint", state: "observed", value: "https://c, d" },
      check: { checked: "2026-11-14", scope: "s", source: "s" },
      expect: {
        identity: "endpoint|observed|value=https://c, d",
        absent: true,
      },
    })
    expect(inFlow).toContain(
      'observed: { environment: production, endpoint: [https://a, https://b, "https://c, d"] }',
    )
    const removed = edit(own, {
      op: "remove-fact",
      document: "service/x",
      expect: current(own, "environment|observed"),
    })
    expect(removed).toContain(
      "  observed: { endpoint: [https://a, https://b] }\n",
    )

    const moved = edit(styled, {
      op: "set-fact",
      document: "service/x",
      fact: { key: "runs-on", state: "observed", to: "machine/musashi" },
      check,
      expect: { identity: "runs-on|observed|to=machine/musashi", absent: true },
      supersedes: read("runs-on|planned|to=machine/musashi"),
    })
    expect(moved).not.toContain("planned")
    expect(moved).toContain(`- checked: 2026-11-16\n  by: ${by}\n`)
  })
})

describe("documents that cannot be edited", () => {
  it("cannot address a document whose frontmatter cannot be read", () => {
    const broken = swap(musashi, "title: Musashi\n", "title: [Musashi\n")
    expect(
      refused(
        [broken],
        [
          {
            op: "set-field",
            document: "machine/musashi",
            field: "title",
            value: "X",
            expect: { value: "Musashi" },
          },
        ],
      ),
    ).toMatchObject([{ code: "document-missing" }])
  })

  it("refuses a result longer than 64 KiB", () => {
    const body = readCatalog([musashi]).documents[0]?.body.text ?? ""
    expect(
      refused(
        [musashi],
        [
          {
            op: "edit-body",
            document: "machine/musashi",
            text: "x".repeat(maxDocumentBytes),
            expect: { text: body },
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid", code: "too-large" }])
  })

  it("refuses an operation whose result would not read as intended", () => {
    expect(
      refused(
        [domainSchema],
        [
          {
            op: "set-schema-key",
            document: "schema/domain",
            key: "x",
            options: { identifiedBy: ["path"] },
            expect: { absent: true },
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid", code: "result-invalid" }])
    expect(
      refused(
        [musashi],
        [
          {
            op: "set-fact",
            document: "machine/musashi",
            fact: { key: "role", state: "observed", value: "x" },
            expect: { identity: "role|observed", absent: true },
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid", code: "operation-invalid" }])
  })
})

describe("validation of the result (catalog §8.3)", () => {
  const person = `---
id: person/guneet
type: person
title: Guneet
summary: The owner.
status: active
owner: person/guneet
---
`
  const stub = (id: string) =>
    `---\nid: ${id}\ntype: ${id.split("/")[0]}\ntitle: Stub\nsummary: A stub.\nstatus: active\nowner: person/guneet\n---\n`
  const documents = [person, musashi, stub("service/ingress")]
  const validate = (operations: CatalogOperation[]) => {
    const result = apply(documents, operations)
    return validateChange(
      {
        before: result.before,
        after: result.after,
        changed: result.changes.map((c) => c.after),
      },
      { now: Date.parse("2026-11-18T00:00:00Z") },
    )
  }

  it("runs on what the operations wrote: a valid change passes", () => {
    expect(
      validate([
        {
          op: "set-fact",
          document: "machine/musashi",
          fact: { key: "disk.data.free", state: "observed", value: "70 GiB" },
          check,
          expect: current(musashi, "disk.data.free|observed"),
        },
      ]).blocked,
    ).toBe(false)
  })

  it("blocks what the operations allow but the catalog does not: a check in the future, a broken reference", () => {
    const result = validate([
      {
        op: "set-fact",
        document: "machine/musashi",
        fact: { key: "on-network", state: "observed", to: "service/nowhere" },
        check: { ...check, checked: "2027-01-01" },
        expect: {
          identity: "on-network|observed|to=service/nowhere",
          absent: true,
        },
      },
    ])
    expect(result.blocked).toBe(true)
    expect(result.problems.map((p) => p.code).sort()).toEqual([
      "checked-in-future",
      "reference-unresolved",
    ])
  })
})

describe("review fixes (#108)", () => {
  const folded = swap(
    musashi,
    "summary: Azure VM that runs the shared production stacks.\n",
    "summary: >-\n  Azure VM that runs\n  the shared production stacks.\n",
  )

  it("replaces a block scalar's value cleanly, keeping its final line break", () => {
    expect(
      edit(folded, {
        op: "set-field",
        document: "machine/musashi",
        field: "summary",
        value: "Azure VM.",
        expect: {
          value: "Azure VM that runs the shared production stacks.",
        },
      }),
    ).toBe(
      musashi.replace(
        "Azure VM that runs the shared production stacks.",
        "Azure VM.",
      ),
    )
    // A comment at column 0 after the value stays its own line.
    const commented = swap(
      musashi,
      "title: Musashi\n",
      "title: |\n  Musashi\n# the display name\n",
    )
    expect(
      edit(commented, {
        op: "set-field",
        document: "machine/musashi",
        field: "title",
        value: "New",
        expect: { value: "Musashi\n" },
      }),
    ).toBe(swap(commented, "title: |\n  Musashi\n", "title: New\n"))
    for (const style of ["|", ">-", "|+"]) {
      const text = swap(
        musashi,
        "      disk.data.free: 74 GiB\n",
        `      disk.data.free: ${style}\n        74 GiB\n# free space\n`,
      )
      const after = edit(text, {
        op: "set-fact",
        document: "machine/musashi",
        fact: { key: "disk.data.free", state: "observed", value: "70 GiB" },
        check: growCheck,
        expect: current(text, "disk.data.free|observed"),
      })
      expect(after).toContain("      disk.data.free: 70 GiB\n# free space\n")
    }
  })

  it("conflicts when a planned fact's `remove`, task or note changed", () => {
    const planned = `---
id: service/x
type: service
title: X
summary: S.
status: active
owner: person/guneet
facts:
  - planned:
      endpoint: { value: https://a, task: T-1 }
---
`
    const stale = current(planned, "endpoint|planned|value=https://a")
    for (const changed of [
      "{ value: https://a, task: T-1, remove: true }",
      "{ value: https://a, task: T-2 }",
      "{ value: https://a, task: T-1, note: Later }",
    ]) {
      const now = planned.replace("{ value: https://a, task: T-1 }", changed)
      expect(
        refused(
          [now],
          [{ op: "remove-fact", document: "service/x", expect: stale }],
        ),
      ).toMatchObject([{ kind: "conflict", code: "fact-changed" }])
      expect(
        refused(
          [now],
          [
            {
              op: "set-fact",
              document: "service/x",
              fact: { key: "endpoint", state: "intended", value: "https://a" },
              check,
              expect: {
                identity: "endpoint|intended|value=https://a",
                absent: true,
              },
              supersedes: stale,
            },
          ],
        ),
      ).toMatchObject([{ kind: "conflict", code: "fact-changed" }])
    }
  })

  it("supersedes only a planned or unknown fact, and only with an intended or observed one", () => {
    const both = swap(
      musashi,
      "      disk.root.used: 93%\n",
      "      disk.root.used: 93%\n    intended:\n      platform.arch: aarch64\n",
    )
    const setArch = (
      state: "observed" | "planned" | "unknown",
      supersedes: PresentFact,
    ): CatalogOperation => ({
      op: "set-fact",
      document: "machine/musashi",
      fact:
        state === "unknown"
          ? { key: "network.public_ipv6", state, note: "?" }
          : {
              key: "platform.arch",
              state,
              value: "x86_64",
              ...(state === "planned" ? { task: "T-1" } : {}),
            },
      ...(state === "observed" ? { check } : {}),
      expect: {
        identity:
          state === "unknown"
            ? "network.public_ipv6|unknown"
            : `platform.arch|${state}`,
        absent: true,
      },
      supersedes,
    })
    // An observation taking away the intended fact.
    expect(
      refused(
        [both],
        [setArch("observed", current(both, "platform.arch|intended"))],
      ),
    ).toMatchObject([{ kind: "invalid" }])
    // A plan taking away an observation.
    expect(
      refused(
        [both],
        [setArch("planned", current(both, "platform.arch|observed"))],
      ),
    ).toMatchObject([{ kind: "invalid" }])
  })

  it("does not bring a retired entity back with set-field", () => {
    const retired = swap(
      dockyard,
      "status: active\n",
      "status: retired\nreplaced_by: project/harbor\n",
    )
    expect(
      refused(
        [retired],
        [
          {
            op: "set-field",
            document: "project/dockyard",
            field: "status",
            value: "active",
            expect: { value: "retired" },
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid", code: "operation-invalid" }])
  })

  it("keeps a section's heading, and the text before the first heading without one", () => {
    const cautions =
      readCatalog([dockyard]).documents[0]?.body.sections.find(
        (s) => s.anchor === "cautions",
      )?.text ?? ""
    expect(
      refused(
        [dockyard],
        [
          {
            op: "edit-body",
            document: "project/dockyard",
            section: "cautions",
            text: "No heading any more.\n",
            expect: { text: cautions },
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid" }])
    expect(
      refused(
        [dockyard],
        [
          {
            op: "edit-body",
            document: "project/dockyard",
            section: "cautions",
            text: "## Warnings\n\nRenamed.\n",
            expect: { text: cautions },
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid" }])
  })

  it("edits the body of a document that ends right after its frontmatter", () => {
    const bare =
      "---\nid: machine/x\ntype: machine\ntitle: X\nsummary: S.\nstatus: active\nowner: person/guneet\n---"
    expect(
      edit(bare, {
        op: "edit-body",
        document: "machine/x",
        text: "# X\n",
        expect: { text: "" },
      }),
    ).toBe(`${bare}\n# X\n`)
    expect(
      edit(bare, {
        op: "edit-body",
        document: "machine/x",
        section: "notes",
        text: "## Notes\n",
        expect: { absent: true },
      }),
    ).toBe(`${bare}\n## Notes\n`)
  })

  it("keeps a moved fact's comment, and rechecks a whole group in place", () => {
    const commented = swap(
      musashi,
      "      platform.arch: aarch64\n",
      "      platform.arch: aarch64 # from uname -m\n",
    )
    expect(
      edit(commented, {
        op: "recheck-facts",
        document: "machine/musashi",
        facts: [current(commented, "platform.arch|observed")],
        check,
      }),
    ).toContain(
      `${checkLines}    observed:\n      platform.arch: aarch64 # from uname -m\n---`,
    )
    const group = [
      "platform.vm_size|observed",
      "platform.arch|observed",
      "disk.root.used|observed",
    ]
    const text = edit(musashi, {
      op: "recheck-facts",
      document: "machine/musashi",
      facts: group.map((g) => current(musashi, g)),
      check,
    })
    expect(text).toBe(
      swap(
        musashi,
        "  - checked: 2026-11-13 # a fact check group\n    by: guneet via opencode-daedalus\n    scope: Read-only check of the VM platform\n    source: Read-only SSH and Azure instance metadata (workspace issue 101)\n    limits: Public IPs and network security group not inspected\n",
        "  - checked: 2026-11-16 # a fact check group\n    by: guneet via opencode-daedalus\n    scope: df -h on the data disk\n    source: Read-only SSH\n",
      ),
    )
  })

  it("refuses malformed operations instead of throwing", () => {
    const malformed = [
      null,
      { op: "set-fact" },
      {
        op: "remove-fact",
        document: "machine/musashi",
        expect: { identity: 7, value: "x", check: null },
      },
      {
        op: "set-field",
        document: "machine/musashi",
        field: "title",
        value: { a: 1 },
        expect: { value: "Musashi" },
      },
      { op: "recheck-facts", document: "machine/musashi", facts: "all", check },
      { op: "__proto__" },
    ]
    for (const operation of malformed)
      expect(
        refused([musashi], [operation as unknown as CatalogOperation]),
      ).toMatchObject([{ kind: "invalid", code: "operation-invalid" }])
  })

  it("caps the operations and the facts in a proposal", () => {
    const many = Array.from(
      { length: maxOperations + 1 },
      (): CatalogOperation => ({
        op: "set-field",
        document: "machine/musashi",
        field: "title",
        value: "X",
        expect: { value: "Musashi" },
      }),
    )
    expect(refused([musashi], many)).toMatchObject([{ code: "too-many" }])
    expect(
      refused(
        [musashi],
        [
          {
            op: "recheck-facts",
            document: "machine/musashi",
            facts: Array.from({ length: maxFacts + 1 }, () =>
              current(musashi, "platform.arch|observed"),
            ),
            check,
          },
        ],
      ),
    ).toMatchObject([{ code: "too-many" }])
  })

  it("rechecks every fact of the largest trial entity in one operation", () => {
    const entity = readCatalog([musashi]).entities.get("machine/musashi")
    const facts = (entity?.facts ?? []).map(expectationOf)
    const result = apply(
      [musashi],
      [{ op: "recheck-facts", document: "machine/musashi", facts, check }],
    )
    const after = result.after.entities.get("machine/musashi")
    expect(
      after?.facts.every((f) => f.check?.checked?.text === "2026-11-16"),
    ).toBe(true)
  })
})

describe("follow-ups from the review of #108 (#113)", () => {
  const service = (facts: string) => `---
id: service/x
type: service
title: X
summary: S.
status: active
owner: person/guneet
facts:
${facts}---
`

  it("keeps a comment with the first value when a key becomes a list", () => {
    const text = service(`  - checked: 2026-11-14
    by: ${by}
    scope: s
    source: s
    observed:
      endpoint: https://a # main endpoint
      environment: production
`)
    expect(
      edit(text, {
        op: "set-fact",
        document: "service/x",
        fact: { key: "endpoint", state: "observed", value: "https://b" },
        check: { checked: "2026-11-14", scope: "s", source: "s" },
        expect: { identity: "endpoint|observed|value=https://b", absent: true },
      }),
    ).toBe(
      swap(
        text,
        "      endpoint: https://a # main endpoint\n",
        "      endpoint:\n        - https://a # main endpoint\n        - https://b\n",
      ),
    )
  })

  it("keeps a comment before the next entry when a state map on the dash line goes", () => {
    const text = service(`  - planned:
      endpoint: { value: https://a, task: T-1 }
    # about unknowns
    unknown:
      environment: Not decided
`)
    const removed = edit(text, {
      op: "remove-fact",
      document: "service/x",
      expect: current(text, "endpoint|planned|value=https://a"),
    })
    expect(removed).toBe(
      swap(
        text,
        "  - planned:\n      endpoint: { value: https://a, task: T-1 }\n    # about unknowns\n",
        "  - # about unknowns\n",
      ),
    )
    // The group stays editable: add to it, then remove it with its comment.
    const added = edit(removed, {
      op: "set-fact",
      document: "service/x",
      fact: { key: "provided-by", state: "unknown", note: "Not asked" },
      expect: { identity: "provided-by|unknown", absent: true },
    })
    expect(added).toContain(
      "  - # about unknowns\n    unknown:\n      environment: Not decided\n      provided-by: Not asked\n",
    )
    const emptied = edit(
      added,
      {
        op: "remove-fact",
        document: "service/x",
        expect: current(added, "environment|unknown"),
      },
      {
        op: "remove-fact",
        document: "service/x",
        expect: current(added, "provided-by|unknown"),
      },
    )
    expect(emptied).not.toContain("facts:")
    // Without a comment between, the next entry moves up to the dash.
    const plain = text.replace("    # about unknowns\n", "")
    expect(
      edit(plain, {
        op: "remove-fact",
        document: "service/x",
        expect: current(plain, "endpoint|planned|value=https://a"),
      }),
    ).toContain("  - unknown:\n      environment: Not decided\n")
  })

  it("refuses a section edit that adds headings", () => {
    const body = `---
id: machine/x
type: machine
title: X
summary: S.
status: active
owner: person/guneet
---

## A

a

## B

b
`
    const a =
      readCatalog([body]).documents[0]?.body.sections.find(
        (s) => s.anchor === "a",
      )?.text ?? ""
    for (const text of ["## A\n\na\n\n## C\n\nc\n", "## A\n\na\n\n## B\n\nb\n"])
      expect(
        refused(
          [body],
          [
            {
              op: "edit-body",
              document: "machine/x",
              section: "a",
              text,
              expect: { text: a },
            },
          ],
        ),
      ).toMatchObject([{ kind: "invalid", code: "operation-invalid" }])
    expect(
      refused(
        [body],
        [
          {
            op: "edit-body",
            document: "machine/x",
            section: "c",
            text: "## C\n\nc\n\n## D\n",
            expect: { absent: true },
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid" }])
    // A body that starts with its first heading has no text before it.
    const headed = body.replace("---\n\n## A", "---\n## A")
    expect(
      refused(
        [headed],
        [
          {
            op: "edit-body",
            document: "machine/x",
            section: null,
            text: "Intro.\n\n## Z\n",
            expect: { absent: true },
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid" }])
  })

  it("refuses a relation attribute named like a fact check's field", () => {
    for (const name of ["by", "checked", "scope", "source", "limits"]) {
      const problems = refused(
        [dockyard],
        [
          {
            op: "set-fact",
            document: "project/dockyard",
            fact: {
              key: "checkout-on",
              state: "observed",
              to: "machine/takezo",
              attributes: { path: "/srv/dockyard", [name]: "guneet" },
            },
            check,
            expect: {
              identity:
                "checkout-on|observed|to=machine/takezo|path=/srv/dockyard",
              absent: true,
            },
          },
        ],
      )
      expect(problems).toMatchObject([
        { kind: "invalid", code: "operation-invalid" },
      ])
      expect(problems[0]?.message).toContain("fact check")
    }
  })

  it("refuses JavaScript object member names as fact keys and schema keys", () => {
    for (const key of ["constructor", "hasOwnProperty", "prototype"]) {
      expect(
        refused(
          [domainSchema],
          [
            {
              op: "set-schema-key",
              document: "schema/domain",
              key,
              options: {},
              expect: { absent: true },
            },
          ],
        ),
      ).toMatchObject([{ kind: "invalid", code: "operation-invalid" }])
      expect(
        refused(
          [musashi],
          [
            {
              op: "set-fact",
              document: "machine/musashi",
              fact: { key, state: "observed", value: "x" },
              check,
              expect: { identity: `${key}|observed`, absent: true },
            },
          ],
        ),
      ).toMatchObject([{ kind: "invalid", code: "operation-invalid" }])
    }
    const schema = swap(
      domainSchema,
      "  registrar: {}\n",
      "  registrar: {}\n  constructor: {}\n",
    )
    expect(readCatalog([schema]).documents[0]?.problems).toMatchObject([
      { code: "schema-invalid" },
    ])
    const entity = swap(
      musashi,
      "      platform.arch: aarch64\n",
      "      constructor: x\n",
    )
    expect(readCatalog([entity]).documents[0]?.problems).toMatchObject([
      { code: "fact-invalid" },
    ])
  })
})

describe("a section edit leaves the other sections as they were (#114)", () => {
  const body = `---
id: machine/x
type: machine
title: X
summary: S.
status: active
owner: person/guneet
---

intro

## A

a

## B

b
`
  const sectionText = (anchor: string | null) =>
    readCatalog([body]).documents[0]?.body.sections.find((s) =>
      anchor === null ? s.heading === null : s.anchor === anchor,
    )?.text ?? ""
  const anchors = (text: string) =>
    readCatalog([text]).documents[0]?.body.sections.map((s) => s.anchor)

  it("refuses new text that leaves a code block open over the sections after it", () => {
    expect(
      refused(
        [body],
        [
          {
            op: "edit-body",
            document: "machine/x",
            section: "a",
            text: "## A\n\n```\ncode\n",
            expect: { text: sectionText("a") },
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid", code: "result-invalid" }])
    expect(
      refused(
        [body],
        [
          {
            op: "edit-body",
            document: "machine/x",
            section: null,
            text: "```\n",
            expect: { text: sectionText(null) },
          },
        ],
      ),
    ).toMatchObject([{ kind: "invalid", code: "result-invalid" }])
    // At the end of the body, an open fence swallows nothing.
    const added = edit(body, {
      op: "edit-body",
      document: "machine/x",
      section: "c",
      text: "## C\n\n~~~\n",
      expect: { absent: true },
    })
    expect(anchors(added)).toEqual([null, "a", "b", "c"])
  })

  it("still allows a closed code block, and removing a section", () => {
    const fenced = edit(body, {
      op: "edit-body",
      document: "machine/x",
      section: "a",
      text: "## A\n\n```\n## not a heading\n```\n",
      expect: { text: sectionText("a") },
    })
    expect(anchors(fenced)).toEqual([null, "a", "b"])
    const removed = edit(body, {
      op: "edit-body",
      document: "machine/x",
      section: "a",
      text: "",
      expect: { text: sectionText("a") },
    })
    expect(anchors(removed)).toEqual([null, "b"])
  })
})

describe("a comment on a key's own line (#114)", () => {
  it("stays there when the key gains a second value", () => {
    const text = `---
id: service/x
type: service
title: X
summary: S.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-14
    by: ${by}
    scope: s
    source: s
    observed:
      endpoint: # on key
        https://a
---
`
    expect(
      edit(text, {
        op: "set-fact",
        document: "service/x",
        fact: { key: "endpoint", state: "observed", value: "https://b" },
        check: { checked: "2026-11-14", scope: "s", source: "s" },
        expect: { identity: "endpoint|observed|value=https://b", absent: true },
      }),
    ).toBe(
      swap(
        text,
        "      endpoint: # on key\n        https://a\n",
        "      endpoint: # on key\n        - https://a\n        - https://b\n",
      ),
    )
  })
})
