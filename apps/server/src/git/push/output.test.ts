import { describe, expect, it } from "vitest"

import { sizeOver } from "./checks.js"
import { verdictLines } from "./output.js"

// What a push's answer says next depends on where its problems are
// (product review of GC-3a).

const problem = (code: string, where = "x.md:1") =>
  ({ code, where, message: "a message" }) as Parameters<
    typeof verdictLines
  >[0]["problems"][number]

describe("a push's answer", () => {
  it("says to fix problems of refs or main in new commits", () => {
    expect(
      verdictLines({
        problems: [problem("ref-name-invalid", "ref refs/heads/a+b")],
        warnings: [],
        checkOnly: false,
      }),
    ).toEqual([
      "Shinan refused this push. Nothing was changed.",
      "1 blocking problem:",
      "  ref refs/heads/a+b  ref-name-invalid  a message",
      "Fix them in new commits and push again. The shinan skill explains each code.",
    ])
  })

  it.each([
    "secret",
    "symlink",
    "submodule",
    "file-too-large",
    "commit-too-large",
    "path-not-portable",
    "tree-too-large",
  ])(
    "says to rewrite the commits for %s, which a new commit cannot fix",
    (code) => {
      const lines = verdictLines({
        problems: [problem("ref-name-invalid"), problem(code)],
        warnings: [],
        checkOnly: false,
      })
      expect(lines).toContain(
        "These problems are in commits not yet in Shinan: rewrite them (git rebase -i origin/main), then push again. A new commit on top won't help. The shinan skill explains each code.",
      )
      expect(
        lines.includes(
          "If a value is not a secret, a workspace owner can allow its fingerprint in workspace settings (Catalog).",
        ),
      ).toBe(code === "secret")
    },
  )

  it("steers a by-not-first-pusher refusal away from claiming another agent's fact checks", () => {
    expect(
      verdictLines({
        problems: [problem("by-not-first-pusher")],
        warnings: [],
        checkOnly: false,
      }).slice(-2),
    ).toEqual([
      "Fix them in new commits and push again. The shinan skill explains each code.",
      "by-not-first-pusher: name yourself only on fact checks you made. For another agent's, merge its pushed branch; don't rebase, cherry-pick or squash it.",
    ])
    expect(
      verdictLines({
        problems: [problem("ref-name-invalid")],
        warnings: [],
        checkOnly: false,
      }).join("\n"),
    ).not.toContain("name yourself")
  })

  it("reads as a check, not a refusal, for a check-only push", () => {
    expect(
      verdictLines({ problems: [], warnings: [], checkOnly: true }),
    ).toEqual([
      "Shinan checked this push (check only): no blocking problems. Nothing was changed.",
    ])
    expect(
      verdictLines({
        problems: [problem("ref-name-invalid")],
        warnings: [],
        checkOnly: true,
      }).slice(0, 2),
    ).toEqual([
      "Shinan checked this push (check only). Nothing was changed.",
      "1 blocking problem:",
    ])
  })

  it("says nothing for a clean push, and accepts one with warnings", () => {
    expect(
      verdictLines({ problems: [], warnings: [], checkOnly: false }),
    ).toEqual([])
    expect(
      verdictLines({
        problems: [],
        warnings: [problem("secret-suspected")],
        checkOnly: false,
      }),
    ).toEqual([
      "Shinan accepted this push.",
      "1 warning (does not block):",
      "  x.md:1  secret-suspected  a message",
    ])
  })
})

describe("a size over a limit", () => {
  it("reads as more than the limit", () => {
    const mib = 1024 * 1024
    expect(sizeOver(1.5 * mib, mib)).toBe("1.5 MiB")
    expect(sizeOver(1_100_000, mib)).toBe("1.05 MiB")
    expect(sizeOver(mib + 1, mib)).toBe("1,048,577 bytes")
  })
})
