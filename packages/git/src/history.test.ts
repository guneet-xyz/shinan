import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  commitTexts,
  joinIdentity,
  listObjects,
  quotePath,
  reachableObjects,
  readAllObjects,
  readHistory,
  readObjects,
  rewriteHistory,
  splitIdentity,
  treeEntryNames,
  unquotePath,
} from "./history.js"
import type { HistoryItem } from "./history.js"
import { createGit } from "./run.js"
import {
  commitFiles,
  createFixtureRepository,
  fixtureIdentity,
} from "./testing.js"

const git = createGit()
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

async function repository() {
  const made = await createFixtureRepository(git)
  cleanups.push(made.remove)
  return made.gitDir
}

function folder() {
  const path = mkdtempSync(join(tmpdir(), "shinan-history-"))
  cleanups.push(() => rmSync(path, { recursive: true, force: true }))
  return path
}

/** A history with merges, odd paths, an empty message and an encoding header. */
async function history(gitDir: string) {
  const root = await commitFiles(
    git,
    gitDir,
    {
      "plain.md": "one\n",
      "with space.md": "two\n",
      'quote"and\\back.md': "three\n",
      "caf\u00e9/\u202enot.txt": "four\n",
      "binary.bin": { content: new Uint8Array([0, 255, 10, 13, 0x80]) },
    },
    { message: "Root\n\nWith a body.", ref: "refs/heads/main" },
  )
  const side = await commitFiles(
    git,
    gitDir,
    { "plain.md": "side\n" },
    {
      parents: [root],
      message: "",
      ref: "refs/heads/side",
      time: 1_790_000_100,
    },
  )
  const main = await commitFiles(
    git,
    gitDir,
    { "plain.md": "main\n", "new.md": "new\n" },
    { parents: [root], ref: "refs/heads/main", time: 1_790_000_200 },
  )
  const merge = await commitFiles(
    git,
    gitDir,
    { "plain.md": "merged\n" },
    {
      parents: [main, side],
      message: "Merge side",
      ref: "refs/heads/main",
      time: 1_790_000_300,
    },
  )
  // A commit in another encoding, written by hand.
  const tree = (
    await git.run(["rev-parse", `${merge}^{tree}`], { gitDir })
  ).stdout
    .toString()
    .trim()
  const raw = Buffer.concat([
    Buffer.from(
      `tree ${tree}\nparent ${merge}\nauthor Ren\xe9 <r@example.com> 1790000400 +0000\ncommitter Ren\xe9 <r@example.com> 1790000400 +0000\nencoding ISO-8859-1\n\n`,
      "latin1",
    ),
    Buffer.from("Caf\xe9 au lait\n", "latin1"),
  ])
  const latin = (
    await git.run(["hash-object", "-t", "commit", "-w", "--stdin"], {
      gitDir,
      input: raw,
    })
  ).stdout
    .toString()
    .trim()
  await git.run(["update-ref", "refs/heads/latin", latin], { gitDir })
  return { root, side, main, merge, latin }
}

describe("rewriting a history", () => {
  it("rewrites again only what the source gained, with the marks of the first run", async () => {
    const source = await repository()
    const first = await commitFiles(
      git,
      source,
      { "a.md": "secret one\n" },
      { ref: "refs/heads/main" },
    )
    const target = await repository()
    const temporaryDir = folder()
    const seen: string[] = []
    const change = (item: HistoryItem): HistoryItem => {
      if (item.kind === "commit") seen.push(item.oid)
      return item.kind === "blob"
        ? {
            ...item,
            data: Buffer.from(item.data.toString().replace("secret", "gone")),
          }
        : item
    }
    const once = await rewriteHistory(git, source, target, change, {
      temporaryDir,
    })
    const second = await commitFiles(
      git,
      source,
      { "b.md": "secret two\n" },
      { ref: "refs/heads/main", parents: [first] },
    )
    seen.length = 0
    const again = await rewriteHistory(git, source, target, change, {
      temporaryDir,
      again: true,
    })
    // Only the new commit was read, on top of the first one's rewrite.
    expect(seen).toEqual([second])
    expect([...again.commits.keys()]).toEqual([second])
    const { stdout } = await git.run(
      ["rev-list", "--parents", "-n", "1", again.commits.get(second)!],
      { gitDir: target },
    )
    expect(stdout.toString().trim().split(" ")[1]).toBe(once.commits.get(first))
    const shown = await git.run(
      ["show", `${again.commits.get(second)!}:b.md`],
      { gitDir: target },
    )
    expect(shown.stdout.toString()).toBe("gone two\n")
  })

  it("keeps every commit's ID when nothing is changed, merges and odd names included", async () => {
    const source = await repository()
    const commits = await history(source)
    const target = await repository()
    const rewritten = await rewriteHistory(
      git,
      source,
      target,
      (item) => item,
      {
        temporaryDir: folder(),
      },
    )
    for (const oid of Object.values(commits))
      expect(rewritten.commits.get(oid)).toBe(oid)
    expect(rewritten.refs).toEqual(
      expect.arrayContaining([
        {
          ref: "refs/heads/main",
          was: "refs/heads/main",
          commit: commits.merge,
        },
        {
          ref: "refs/heads/side",
          was: "refs/heads/side",
          commit: commits.side,
        },
        {
          ref: "refs/heads/latin",
          was: "refs/heads/latin",
          commit: commits.latin,
        },
      ]),
    )
  })

  it("changes what the callback changes, gives the commits after it new IDs, and renames refs", async () => {
    const source = await repository()
    const commits = await history(source)
    const target = await repository()
    const rewritten = await rewriteHistory(
      git,
      source,
      target,
      (item: HistoryItem): HistoryItem => {
        if (item.kind === "blob")
          return {
            ...item,
            data: Buffer.from(
              item.data.toString("latin1").replace("side", "edis"),
              "latin1",
            ),
          }
        if (item.ref === "refs/heads/side")
          return { ...item, ref: "refs/heads/renamed" }
        return item
      },
      { temporaryDir: folder() },
    )
    // The root and main's own commit keep their IDs; the side branch and
    // everything after it get new ones.
    expect(rewritten.commits.get(commits.root)).toBe(commits.root)
    expect(rewritten.commits.get(commits.main)).toBe(commits.main)
    expect(rewritten.commits.get(commits.side)).not.toBe(commits.side)
    expect(rewritten.commits.get(commits.merge)).not.toBe(commits.merge)
    expect(rewritten.refs.find((r) => r.ref === "refs/heads/renamed")).toEqual({
      ref: "refs/heads/renamed",
      was: "refs/heads/side",
      commit: rewritten.commits.get(commits.side),
    })
    const content = await git.run(["show", "refs/heads/renamed:plain.md"], {
      gitDir: target,
    })
    expect(content.stdout.toString()).toBe("edis\n")
  })

  it("refuses a callback that renames one ref two ways", async () => {
    const source = await repository()
    await history(source)
    let n = 0
    await expect(
      rewriteHistory(
        git,
        source,
        await repository(),
        (item) =>
          item.kind === "blob" ? item : { ...item, ref: `refs/heads/x${n++}` },
        { temporaryDir: folder() },
      ),
    ).rejects.toThrow("renamed a ref two ways")
  })

  it("reads each commit's parts as fast-export gives them", async () => {
    const source = await repository()
    const commits = await history(source)
    const seen: HistoryItem[] = []
    await readHistory(git, source, (item) => void seen.push(item))
    const merge = seen.find(
      (i) => i.kind === "commit" && i.oid === commits.merge,
    )
    expect(merge).toMatchObject({ merges: [expect.stringMatching(/^:\d+$/)] })
    const latin = seen.find(
      (i) => i.kind === "commit" && i.oid === commits.latin,
    )
    expect(latin).toMatchObject({ encoding: Buffer.from("ISO-8859-1") })
    const paths = seen.flatMap((i) =>
      i.kind === "commit"
        ? i.changes.flatMap((c) =>
            c.op === "deleteall" ? [] : [c.path.toString("utf8")],
          )
        : [],
    )
    expect(paths).toEqual(
      expect.arrayContaining([
        'quote"and\\back.md',
        "with space.md",
        "caf\u00e9/\u202enot.txt",
      ]),
    )
  })
})

describe("reading every object", () => {
  it("includes objects no ref reaches", async () => {
    const gitDir = await repository()
    const main = await commitFiles(
      git,
      gitDir,
      { "a.md": "a\n" },
      { ref: "refs/heads/main" },
    )
    const loose = await commitFiles(
      git,
      gitDir,
      { "b.md": "dangling\n" },
      { parents: [main] },
    )
    const objects = new Map<string, string>()
    await readAllObjects(git, gitDir, (o) => void objects.set(o.oid, o.type))
    expect(objects.get(main)).toBe("commit")
    expect(objects.get(loose)).toBe("commit")
    expect([...objects.values()].filter((t) => t === "blob")).toHaveLength(2)
  })
})

describe("listing and reading objects", () => {
  it("lists every object, tells the reachable ones, and reads the ones asked for", async () => {
    const gitDir = await repository()
    const main = await commitFiles(
      git,
      gitDir,
      { "a.md": "a\n" },
      { ref: "refs/heads/main" },
    )
    const loose = await commitFiles(
      git,
      gitDir,
      { "b.md": "dangling\n" },
      { parents: [main] },
    )
    const all = await listObjects(git, gitDir)
    expect(all.get(main)).toBe("commit")
    expect(all.get(loose)).toBe("commit")
    const reached = await reachableObjects(git, gitDir)
    expect(reached.has(main)).toBe(true)
    expect(reached.has(loose)).toBe(false)
    const read: string[] = []
    await readObjects(git, gitDir, [loose, "0".repeat(40), main], (o) => {
      read.push(`${o.type} ${o.oid}`)
    })
    expect(read).toEqual([`commit ${loose}`, `commit ${main}`])
  })
})

describe("the parts of objects", () => {
  it("quotes and unquotes every byte of a path", () => {
    const path = Buffer.from([
      0x61, 0x22, 0x5c, 0x0a, 0x09, 0xc3, 0xa9, 0x20, 0x7f,
    ])
    const quoted = quotePath(path)
    expect(quoted).toBe('"a\\"\\\\\\012\\011\\303\\251 \\177"')
    expect(unquotePath(Buffer.from(quoted, "latin1"))).toEqual(path)
    expect(unquotePath(Buffer.from("plain path"))).toEqual(
      Buffer.from("plain path"),
    )
  })

  it("splits and joins identities byte for byte", () => {
    for (const value of [
      "Name <e@x> 1 +0000",
      "<e@x> 1 +0000",
      "A B <> 1 -0130",
    ]) {
      const parts = splitIdentity(Buffer.from(value))
      expect(joinIdentity(parts).toString()).toBe(value)
    }
  })

  it("gives a commit's names, emails, other headers and message, never its object IDs or times", async () => {
    const gitDir = await repository()
    const commit = await commitFiles(
      git,
      gitDir,
      { "a.md": "a\n" },
      { message: "Hello" },
    )
    const raw = (await git.run(["cat-file", "commit", commit], { gitDir }))
      .stdout
    const texts = commitTexts(raw).map((b) => b.toString())
    const identity = fixtureIdentity()
    expect(texts).toEqual([
      identity.GIT_AUTHOR_NAME,
      identity.GIT_AUTHOR_EMAIL,
      identity.GIT_COMMITTER_NAME,
      identity.GIT_COMMITTER_EMAIL,
      "Hello\n",
    ])
    const tree = (
      await git.run(["cat-file", "tree", `${commit}^{tree}`], { gitDir })
    ).stdout
    expect(treeEntryNames(tree).map((b) => b.toString())).toEqual(["a.md"])
  })
})
