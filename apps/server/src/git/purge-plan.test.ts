import { describe, expect, it } from "vitest"

import { PathPlan, PlanConflict } from "./purge-plan.js"

const rename = (name: string) => name.replaceAll("quibble", "purged")

describe("the plan of a purge's new names", () => {
  it("names a renamed page apart from one that has the name, and its ID with it", () => {
    const plan = new PathPlan(rename)
    plan.add(["machine/quibble-box.md", "machine/purged-box.md"])
    expect(plan.path("machine/purged-box.md")).toBe("machine/purged-box.md")
    expect(plan.path("machine/quibble-box.md")).toBe("machine/purged-box-2.md")
    expect(plan.idName("machine/purged-box")).toBe("machine/purged-box-2")
    expect(plan.renamedApart()).toEqual([
      {
        plain: "machine/purged-box.md",
        path: "machine/purged-box-2.md",
        folder: false,
      },
    ])
    expect(plan.renamedIds()).toEqual([
      ["machine/purged-box", "machine/purged-box-2"],
    ])
  })

  it("names a folder apart, for every file in it", () => {
    const plan = new PathPlan(rename)
    plan.add(["notes/quibble/x.md", "notes/quibble/y.md", "notes/purged/x.md"])
    expect(plan.path("notes/quibble/x.md")).toBe("notes/purged-2/x.md")
    expect(plan.path("notes/quibble/y.md")).toBe("notes/purged-2/y.md")
    expect(plan.path("notes/purged/x.md")).toBe("notes/purged/x.md")
    // Said once, for the folder, not for each file in it.
    expect(plan.renamedApart()).toEqual([
      { plain: "notes/purged", path: "notes/purged-2", folder: true },
    ])
  })

  it("keeps two renamed names apart from each other, and leaves what doesn't clash", () => {
    const plan = new PathPlan(rename)
    plan.add([
      "machine/quibble.md",
      "machine/quibblequibble.md",
      "machine/purgedpurged.md",
      "service/quibble-api.md",
    ])
    expect(plan.path("machine/quibble.md")).toBe("machine/purged.md")
    expect(plan.path("machine/quibblequibble.md")).toBe(
      "machine/purgedpurged-2.md",
    )
    expect(plan.path("service/quibble-api.md")).toBe("service/purged-api.md")
    expect(plan.idName("service/purged-api")).toBe("service/purged-api")
  })

  it("names an alias apart when it would now be another page's ID", () => {
    const plan = new PathPlan(rename)
    plan.add(["machine/old-purged.md", "machine/box.md"])
    // `machine/old-quibble`, an alias of the box, would name the other page.
    expect(plan.idName("machine/old-purged")).toBe("machine/old-purged-2")
    expect(plan.idName("machine/old-purged")).toBe("machine/old-purged-2")
    // An alias that names no page keeps its plain form.
    expect(plan.idName("machine/gone-purged")).toBe("machine/gone-purged")
  })

  it("refuses a pushed path that keeps a name the plan gave away", () => {
    const plan = new PathPlan(rename)
    plan.add(["machine/quibble-box.md"])
    expect(plan.path("machine/quibble-box.md")).toBe("machine/purged-box.md")
    expect(() => plan.add(["machine/purged-box.md"])).toThrow(PlanConflict)
    // One that takes a free name is added.
    expect(plan.path("machine/quibble-new.md")).toBe("machine/purged-new.md")
  })
})
