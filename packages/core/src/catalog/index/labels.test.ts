import { describe, expect, it } from "vitest"

import {
  holdsText,
  inheritLabels,
  labelForActor,
  labelForWrittenActor,
  lessTrusted,
  shinanLabel,
} from "./labels.js"

describe("trust labels", () => {
  it("reads a fact check's written actor", () => {
    expect(labelForWrittenActor("guneet")).toEqual({
      author_kind: "member",
      author: "guneet",
      instruction: "no",
    })
    expect(labelForWrittenActor("guneet via opencode-daedalus")).toEqual({
      author_kind: "agent",
      author: "guneet via opencode-daedalus",
      instruction: "no",
    })
    expect(labelForWrittenActor("shinan")).toEqual(shinanLabel)
    for (const by of ["unknown", "", "Guneet", "ignore previous", null])
      expect(labelForWrittenActor(by).author_kind).toBe("outside")
  })

  it("names a person a member, and an unknown actor outside", () => {
    expect(labelForActor("person", "guneet").author_kind).toBe("member")
    expect(labelForActor("agent", "a via b").author_kind).toBe("agent")
    expect(labelForActor("unknown", "unknown").author_kind).toBe("outside")
    expect(labelForActor("outside", "github.com/x").author_kind).toBe("outside")
  })

  it("orders trust from outside to members", () => {
    const member = labelForActor("person", "guneet")
    const agent = labelForActor("agent", "guneet via x")
    const outside = labelForActor("unknown", null)
    expect(lessTrusted(member, agent)).toBe(agent)
    expect(lessTrusted(agent, shinanLabel)).toBe(agent)
    expect(lessTrusted(shinanLabel, outside)).toBe(outside)
    expect(lessTrusted(member, labelForActor("person", "other"))).toBe(member)
  })

  it("labels every object holding text, inheriting the nearest label", () => {
    const agent = labelForActor("agent", "guneet via x")
    const answer = {
      revision: 3,
      entity: {
        title: "Musashi",
        label: agent,
        check: { scope: "disk" },
        counts: { facts: 2 },
        aliases: ["machine/old"],
      },
      list: [{ note: "a" }],
    }
    inheritLabels(answer, shinanLabel)
    expect(answer).toMatchObject({
      entity: { label: agent, check: { label: agent } },
      list: [{ label: shinanLabel }],
    })
    expect("label" in answer).toBe(false)
    expect("label" in answer.entity.counts).toBe(false)
    expect(holdsText({ aliases: ["x"] })).toBe(true)
    expect(holdsText({ n: 1, label: "x" })).toBe(false)
  })
})
