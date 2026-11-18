import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  blockList,
  blockMap,
  entryLines,
  flowMap,
  scalar,
  yamlScalar,
} from "./write.js"
import { parseYaml } from "./yaml.js"

/** Reads a scalar written by `yamlScalar` back, in block or flow context. */
function readBack(text: string, flow: boolean) {
  const result = parseYaml(flow ? `[${text}]` : `k: ${text}`, 0)
  expect(result.problems).toEqual([])
  const node = result.node
  if (node?.kind === "list")
    return node.items.length === 1 ? node.items[0] : undefined
  if (node?.kind === "map")
    return node.entries.length === 1 ? node.entries[0]?.value : undefined
  return undefined
}

describe("yamlScalar: canonical scalars", () => {
  it.each([
    ["1.10", '"1.10"'],
    ["128", '"128"'],
    ["-5", '"-5"'],
    ["0x10", '"0x10"'],
    ["1e3", '"1e3"'],
    ["+12", '"+12"'],
    [".5", '".5"'],
    ["true", '"true"'],
    ["False", '"False"'],
    ["null", '"null"'],
    ["NULL", '"NULL"'],
    ["~", '"~"'],
    [".inf", '".inf"'],
    [".NaN", '".NaN"'],
    ["", '""'],
    [" padded", '" padded"'],
    ["a: b", '"a: b"'],
    ["ends:", '"ends:"'],
    ["x #y", '"x #y"'],
    ["#comment", '"#comment"'],
    ["- dash", '"- dash"'],
    ["two\nlines", '"two\\nlines"'],
    ["tab\there", '"tab\\there"'],
    ["@at", '"@at"'],
    ["{brace}", '"{brace}"'],
    ["'quoted'", "\"'quoted'\""],
  ])("quotes %j", (value, written) => {
    expect(yamlScalar(value, false)).toBe(written)
  })

  it.each([
    "no",
    "on",
    "yes",
    "2026-11-14",
    "2026-11-14T09:30Z",
    "128 GiB",
    "93%",
    "v0.3.1",
    "https://github.com/guneet-xyz/dockyard",
    "guneet via opencode-daedalus",
    "machine/musashi",
    "Metadata lags after a resize",
    "T-12",
    "é🙂",
  ])("leaves %j plain", (value) => {
    expect(yamlScalar(value, false)).toBe(value)
  })

  it("quotes flow indicators only inside flow collections", () => {
    expect(yamlScalar("a, b", false)).toBe("a, b")
    expect(yamlScalar("a, b", true)).toBe('"a, b"')
    expect(yamlScalar("[x]y", true)).toBe('"[x]y"')
  })

  it("writes numbers and booleans as the parser reads them back", () => {
    expect(yamlScalar(128, false)).toBe("128")
    expect(yamlScalar(-0.5, true)).toBe("-0.5")
    expect(yamlScalar(1e21, false)).toBe("1e+21")
    expect(yamlScalar(true, false)).toBe("true")
    expect(() => yamlScalar(Infinity, false)).toThrow()
  })

  it("escapes characters YAML does not allow raw or would hide", () => {
    expect(yamlScalar("a\u0085b", false)).toBe('"a\\u0085b"')
    expect(yamlScalar("a\u2028b", false)).toBe('"a\\u2028b"')
    expect(yamlScalar("\ufeffbom", false)).toBe('"\\ufeffbom"')
    expect(yamlScalar("nb\u00a0sp", false)).toBe('"nb\\u00a0sp"')
  })

  it("reads back every string, number and boolean exactly, in both contexts", () => {
    const value = fc.oneof(
      fc.string({ unit: "binary", maxLength: 40 }),
      fc.string({
        unit: fc.constantFrom(
          ..."abc 019.:#-'\"{}[],&*!|>%@`?/~+eE\n\t".split(""),
        ),
        maxLength: 12,
      }),
      fc.integer(),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.boolean(),
    )
    fc.assert(
      fc.property(value, fc.boolean(), (v, flow) => {
        const node = readBack(yamlScalar(v, flow), flow)
        expect(node?.kind).toBe("scalar")
        if (node?.kind !== "scalar") return
        // -0 is written as 0, which is the same value as text.
        expect(node.value).toEqual(
          typeof v === "number" && Object.is(v, -0) ? 0 : v,
        )
      }),
      { numRuns: 2000 },
    )
    // 2,000 runs: about a second alone, 10 s or more on a busy machine.
  }, 60_000)
})

describe("canonical blocks", () => {
  it("writes groups, state maps and lists of facts as block YAML", () => {
    const group = blockMap([
      ["checked", scalar("2026-11-14")],
      ["by", scalar("guneet")],
      [
        "observed",
        blockMap([
          [
            "disk.data.size",
            flowMap([
              ["value", scalar("128 GiB")],
              ["via", scalar("filesystem")],
            ]),
          ],
          ["endpoint", blockList([scalar("https://a"), scalar("https://b")])],
        ]),
      ],
    ])
    expect(entryLines("facts", blockList([group]), 0)).toEqual([
      "facts:",
      "  - checked: 2026-11-14",
      "    by: guneet",
      "    observed:",
      "      disk.data.size: { value: 128 GiB, via: filesystem }",
      "      endpoint:",
      "        - https://a",
      "        - https://b",
    ])
  })
})
