import { describe, expect, it } from "vitest"

import { openCatFile } from "./cat-file.js"
import { diffTreesPage, listTree } from "./read.js"
import { createGit } from "./run.js"
import { createFixtureRepository } from "./testing.js"
import { walkTreeDiff } from "./tree-walk.js"
import { writeCommit } from "./write.js"
import type { CommitFile } from "./write.js"

const git = createGit()
const identity = { name: "T", email: "t@example.com", time: 1_790_000_000 }

/** A small deterministic random source, so failures can be replayed. */
function random(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31
    return state / 2 ** 31
  }
}

// Names chosen to meet Git's ordering rules: `a.b` sorts before the folder
// `a/` but after the file `a`; `a-b`, `a~`, `a b` and `a0` sit around them.
const names = ["a", "a.b", "a-b", "a0", "a~", "a b", "b", "z.md"]

function files(next: () => number): CommitFile[] {
  const out = new Map<string, CommitFile>()
  const add = (prefix: string, depth: number) => {
    for (const name of names) {
      const roll = next()
      if (roll < 0.35) continue
      const path = prefix + name
      if (roll < 0.55 && depth < 3) add(`${path}/`, depth + 1)
      else if (![...out.keys()].some((p) => p.startsWith(`${path}/`))) {
        const mode =
          next() < 0.15 ? "120000" : next() < 0.2 ? "100755" : "100644"
        out.set(path, { path, content: `${Math.floor(next() * 3)}\n`, mode })
      }
    }
  }
  add("", 0)
  // A file and a folder of the same name cannot both be there.
  return [...out.values()].filter(
    (f) => ![...out.keys()].some((p) => p.startsWith(`${f.path}/`)),
  )
}

describe("the tree walk", () => {
  it("finds exactly what git diff-tree finds, in its order", async () => {
    const repository = await createFixtureRepository(git)
    try {
      const next = random(163)
      for (let round = 0; round < 40; round++) {
        const from = await writeCommit(git, repository.gitDir, {
          files: files(next),
          message: "from\n",
          identity,
        })
        const to = await writeCommit(git, repository.gitDir, {
          files: files(next),
          message: "to\n",
          identity,
        })
        const ours = (
          await diffTreesPage(git, repository.gitDir, from, to)
        ).changes.map(
          (c) =>
            `${c.oldMode ?? "000000"} ${c.newMode ?? "000000"} ${c.oldOid ?? "0".repeat(40)} ${c.newOid ?? "0".repeat(40)} ${c.status[0]!.toUpperCase()}\t${c.path}`,
        )
        const raw = (
          await git.run(
            [
              "diff-tree",
              "-r",
              "-z",
              "--raw",
              "--no-renames",
              "--full-index",
              from,
              to,
            ],
            { gitDir: repository.gitDir },
          )
        ).stdout
          .toString("utf8")
          .split("\0")
          .filter(Boolean)
        const theirs: string[] = []
        for (let i = 0; i < raw.length; i += 2) {
          theirs.push(`${raw[i]!.slice(1)}\t${raw[i + 1]}`)
        }
        expect(ours, `round ${round}`).toEqual(theirs)
      }
    } finally {
      repository.remove()
    }
  }, 120_000)
})

describe("the tree walk's limits", () => {
  it("refuses a tree object larger than its reader takes, saying so", async () => {
    const repository = await createFixtureRepository(git)
    try {
      const commit = await writeCommit(git, repository.gitDir, {
        files: [{ path: "a/b.md", content: "x" }],
        message: "m\n",
        identity,
      })
      const [entry] = await listTree(git, repository.gitDir, commit, {
        recursive: false,
      })
      const reader = openCatFile(git, repository.gitDir, { maxObjectBytes: 10 })
      try {
        await expect(
          walkTreeDiff(reader, null, entry!.oid, () => {}),
        ).rejects.toMatchObject({ stderr: "tree object too large" })
      } finally {
        await reader.close()
      }
    } finally {
      repository.remove()
    }
  })
})
