import { lstatSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { findPushSecrets } from "@shinan/core"
import type { PushCheckCode, pushLimits, PushSecretFinding } from "@shinan/core"
import {
  MAX_TREE_OBJECT_BYTES,
  newCommits,
  openCatFile,
  parseCommit,
} from "@shinan/git"
import type { CatFile, Git } from "@shinan/git"

import { clashingNames, nameProblem } from "./names.js"

/** One line of `pre-receive`'s input: a ref's old and new commit. */
export interface RefUpdate {
  ref: string
  /** Null: the ref did not exist. */
  old: string | null
  /** Null: the push deletes the ref. */
  new: string | null
}

export type RefKind = "create" | "update" | "forced-update" | "delete"

/** A problem a check found: where, which code, and what to say. */
export interface Problem {
  code: PushCheckCode
  /** A path and line, a commit, a ref, or nothing for the whole push. */
  where: string
  message: string
}

export interface CheckResult {
  problems: Problem[]
  warnings: Problem[]
  /** Each update's kind, in the order Git listed them. */
  kinds: RefKind[]
  /** For each update, the commits it brings that no ref had before. */
  commitsByRef: string[][]
  newCommits: number
  newObjects: number
  /** Secrets found, refused or warned about: counted, never shown. */
  secrets: number
  /** Positions of the updates whose branch names hold a secret: never stored. */
  secretNames: number[]
}

export interface CheckInput {
  git: Git
  gitDir: string
  /** The quarantine variables of the push, for reading what it sent. */
  env: Record<string, string>
  updates: RefUpdate[]
  /** Fingerprints of the values the workspace's owners allowed (GQ-2). */
  allowedValues: ReadonlySet<string>
  /** Commits a purge removed. */
  purged: ReadonlySet<string>
  /** Whether a push may change `main` (GC-3b's checks of `main`). */
  openMain: boolean
  /** When the checks must have finished. */
  deadline: number
  /** The limits; `pushLimits` but in tests. */
  limits: PushLimits
}

export type PushLimits = { -readonly [K in keyof typeof pushLimits]: number }

/** The checks ran out of time (`too-slow`). */
export class TooSlowError extends Error {
  override name = "TooSlowError"
}

const branchName = /^[A-Za-z0-9._/-]+$/

/** The text of `name`, quoted when it holds anything but plain characters. */
export function shown(name: string): string {
  const short = name.length > 200 ? `${name.slice(0, 200)}…` : name
  return /^[\x21-\x7e\u00a0-\uffff ]*$/.test(short) && !/^ | $/.test(short)
    ? short
    : JSON.stringify(short)
}

/**
 * The checks of every push, on any branch (Git-based catalog plan §2.5,
 * checks 1 to 3), and the limits that keep a repository readable (#165):
 *
 * 1. **Refs:** only branches, with names of at most 100 letters, digits,
 *    `.`, `_`, `/` and `-`; `main` never deleted and only fast-forwarded;
 *    at most 100 branches; no commit a purge removed.
 * 2. **Objects** new to the repository: at most 1,000 commits, each at
 *    most 64 KiB; files at most 1 MiB (from their size, never inflated);
 *    no symbolic links or submodules; folder names every system can check
 *    out; at most 20,000 entries in a folder, 200,000 reached from a
 *    commit's tree; the repository under 1 GiB.
 * 3. **Secrets** in every new file, commit message and ref name: a
 *    near-certain credential refuses the push unless its owners allowed the
 *    value; weaker signs warn.
 *
 * "New" means reachable from no ref before the push, so history already
 * checked is not read again.
 */
export async function checkPush(input: CheckInput): Promise<CheckResult> {
  const { git, gitDir, env, limits } = input
  const problems: Problem[] = []
  const warnings: Problem[] = []
  let secrets = 0
  const tick = () => {
    if (Date.now() > input.deadline) throw new TooSlowError()
  }
  const report = (finding: PushSecretFinding, where: string, what: string) => {
    secrets++
    if (finding.severity === "blocking") {
      problems.push({
        code: "secret",
        where,
        message: `${what} looks like a ${finding.kind} (value not shown; fingerprint sha256:${finding.fingerprint})`,
      })
    } else {
      warnings.push({
        code: "secret-suspected",
        where,
        message: `${what} may hold a secret: ${finding.kind} (value not shown; fingerprint sha256:${finding.fingerprint})`,
      })
    }
  }

  // 1. Refs.
  const secretNames: number[] = []
  const kinds: RefKind[] = []
  for (const update of input.updates) {
    kinds.push(await kindOf(git, gitDir, env, update))
  }
  let creates = 0
  let deletes = 0
  input.updates.forEach((update, i) => {
    const kind = kinds[i]!
    if (kind === "create") creates++
    if (kind === "delete") deletes++
    // A ref's name is checked for secrets first: one that holds a secret is
    // never shown, in any problem.
    const findings = findPushSecrets(update.ref, input.allowedValues)
    for (const finding of findings) {
      report(finding, "ref (name not shown)", "the ref's name")
    }
    if (findings.length > 0) secretNames.push(i)
    const where =
      findings.length > 0 ? "ref (name not shown)" : `ref ${shown(update.ref)}`
    if (!update.ref.startsWith("refs/heads/")) {
      problems.push({
        code: "ref-not-branch",
        where,
        message:
          "only branches (refs/heads/…) can be pushed: no tags or other refs",
      })
      return
    }
    const name = update.ref.slice("refs/heads/".length)
    if (name.length > limits.refNameLength || !branchName.test(name)) {
      problems.push({
        code: "ref-name-invalid",
        where,
        message: `a branch name is at most ${limits.refNameLength} letters, digits, ".", "_", "/" and "-"`,
      })
    }
    if (update.ref === "refs/heads/main") {
      if (kind === "delete" || kind === "forced-update") {
        problems.push({
          code: "main-not-fast-forward",
          where: "ref refs/heads/main",
          message:
            kind === "delete"
              ? "main cannot be deleted"
              : "main only moves forward: fetch, then merge or rebase your own commits onto origin/main",
        })
      } else if (!input.openMain) {
        problems.push({
          code: "main-not-open",
          where: "ref refs/heads/main",
          message:
            "pushes to main are not open yet: push your work to a branch for now",
        })
      }
    }
  })
  if (creates > deletes) {
    const branches = (
      await git.run(["for-each-ref", "--format=%(refname)", "refs/heads/"], {
        gitDir,
        env,
      })
    ).stdout
      .toString("utf8")
      .split("\n")
      .filter(Boolean).length
    if (branches + creates - deletes > limits.branches) {
      problems.push({
        code: "too-many-branches",
        where: "",
        message: `the repository already has ${branches} branches, and holds at most ${limits.branches}: delete merged ones (git push origin --delete <branch>)`,
      })
    }
  }

  const changing = input.updates.some((u) => u.new !== null)
  if (changing && repositoryBytes(gitDir) > limits.repositoryBytes) {
    problems.push({
      code: "repository-full",
      where: "",
      message: `the repository is larger than ${limits.repositoryBytes / 1024 / 1024 / 1024} GiB: only branch deletions are accepted until it is cleaned up`,
    })
  }

  // 2. New commits and objects.
  const tips = [
    ...new Set(input.updates.flatMap((u) => (u.new === null ? [] : [u.new]))),
  ]
  const fresh = await newCommits(git, gitDir, tips, {
    env,
    limit: limits.newCommits,
  })
  const result: CheckResult = {
    problems,
    warnings,
    kinds,
    commitsByRef: [],
    newCommits: fresh.commits.length,
    newObjects: 0,
    secrets: 0,
    secretNames,
  }
  if (fresh.truncated) {
    problems.push({
      code: "too-many-commits",
      where: "",
      message: `the push brings more than ${limits.newCommits} new commits: push in parts`,
    })
    return { ...result, secrets }
  }
  tick()
  for (const commit of fresh.commits) {
    if (input.purged.has(commit)) {
      problems.push({
        code: "purged-commit",
        where: `commit ${commit.slice(0, 12)}`,
        message:
          "this commit was removed by a purge: fetch, then reset your branch onto the new history",
      })
    }
  }
  // Each ref's own new commits, in the order Git listed the refs, for the
  // first-pusher record.
  for (const update of input.updates) {
    result.commitsByRef.push(
      update.new === null
        ? []
        : (
            await newCommits(git, gitDir, [update.new], {
              env,
              limit: limits.newCommits,
            })
          ).commits,
    )
  }

  const objects = await newObjects(git, gitDir, env, tips)
  result.newObjects = objects.length
  const reader = openCatFile(git, gitDir, {
    env,
    maxObjectBytes: MAX_TREE_OBJECT_BYTES,
  })
  try {
    const counts = new Map<string, number>()
    for (const object of objects) {
      tick()
      if (object.type === "commit") {
        await checkCommit(object, reader, input, problems, report, counts)
      } else if (object.type === "blob") {
        if (object.size > limits.fileBytes) {
          problems.push({
            code: "file-too-large",
            where: shown(object.path),
            message: `a new file is at most ${limits.fileBytes / 1024 / 1024} MiB; this one is ${(object.size / 1024 / 1024).toFixed(1)} MiB`,
          })
          continue
        }
        const read = await reader.read(object.oid)
        if (typeof read === "string")
          throw new Error(`Blob ${object.oid}: ${read}`)
        const text = read.content.toString("utf8")
        for (const finding of findPushSecrets(text, input.allowedValues)) {
          report(
            finding,
            `${shown(object.path)}:${lineOf(text, finding.range.start)}`,
            "a value here",
          )
        }
        // Long files must not hold the event loop for long.
        if (object.size > 64 * 1024) await yieldTurn()
      } else if (object.type === "tree") {
        await checkTree(object, reader, problems, limits)
      } else {
        problems.push({
          code: "ref-not-branch",
          where: `object ${object.oid.slice(0, 12)}`,
          message: "tags cannot be pushed",
        })
      }
    }
  } finally {
    await reader.close()
  }
  return { ...result, secrets }
}

interface NewObject {
  oid: string
  type: string
  size: number
  path: string
}

/** The objects the push brings that no ref reached before, with a path each. */
async function newObjects(
  git: Git,
  gitDir: string,
  env: Record<string, string>,
  tips: string[],
): Promise<NewObject[]> {
  if (tips.length === 0) return []
  const listed = (
    await git.run(["rev-list", "--objects", ...tips, "--not", "--all"], {
      gitDir,
      env,
    })
  ).stdout.toString("utf8")
  const paths = new Map<string, string>()
  for (const line of listed.split("\n")) {
    if (line === "") continue
    const space = line.indexOf(" ")
    const oid = space < 0 ? line : line.slice(0, space)
    if (!paths.has(oid)) paths.set(oid, space < 0 ? "" : line.slice(space + 1))
  }
  if (paths.size === 0) return []
  const info = (
    await git.run(
      ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
      { gitDir, env, input: [...paths.keys()].join("\n") + "\n" },
    )
  ).stdout.toString("utf8")
  const objects: NewObject[] = []
  for (const line of info.split("\n")) {
    const [oid, type, size] = line.split(" ")
    if (!oid || !type || size === undefined) continue
    objects.push({ oid, type, size: Number(size), path: paths.get(oid) ?? "" })
  }
  return objects
}

async function kindOf(
  git: Git,
  gitDir: string,
  env: Record<string, string>,
  update: RefUpdate,
): Promise<RefKind> {
  if (update.old === null) return "create"
  if (update.new === null) return "delete"
  const { exitCode } = await git.run(
    ["merge-base", "--is-ancestor", update.old, update.new],
    { gitDir, env, okExitCodes: [0, 1] },
  )
  return exitCode === 0 ? "update" : "forced-update"
}

async function checkCommit(
  object: NewObject,
  reader: CatFile,
  input: CheckInput,
  problems: Problem[],
  report: (finding: PushSecretFinding, where: string, what: string) => void,
  counts: Map<string, number>,
): Promise<void> {
  const { limits } = input
  const where = `commit ${object.oid.slice(0, 12)}`
  if (object.size > limits.commitBytes) {
    problems.push({
      code: "commit-too-large",
      where,
      message: `a commit, with its message, is at most ${limits.commitBytes / 1024} KiB`,
    })
    return
  }
  const read = await reader.read(object.oid)
  if (typeof read === "string") throw new Error(`Commit ${object.oid}: ${read}`)
  const commit = parseCommit(object.oid, read.content)
  const text = read.content.toString("utf8")
  const offset = text.indexOf("\n\n") + 2
  for (const finding of findPushSecrets(text, input.allowedValues)) {
    report(
      finding,
      `${where}${finding.range.start >= offset ? `:${lineOf(text.slice(offset), finding.range.start - offset)}` : ""}`,
      finding.range.start >= offset
        ? "the commit message"
        : "the commit's author or committer",
    )
  }
  const reached = await entriesReached(
    commit.tree,
    reader,
    counts,
    limits.treeEntries,
  )
  if (reached > limits.treeEntries) {
    problems.push({
      code: "tree-too-large",
      where,
      message: `its files and folders, counting each folder every place it appears, are more than ${limits.treeEntries.toLocaleString("en")} entries: no catalog needs that many`,
    })
  }
}

async function checkTree(
  object: NewObject,
  reader: CatFile,
  problems: Problem[],
  limits: PushLimits,
): Promise<void> {
  const folder =
    object.path === "" ? "the top folder" : `${shown(object.path)}/`
  const base = object.path === "" ? "" : `${object.path}/`
  if (object.size > MAX_TREE_OBJECT_BYTES) {
    problems.push({
      code: "tree-too-large",
      where: object.path === "" ? "" : shown(object.path),
      message: `${folder} is too large to read`,
    })
    return
  }
  const read = await reader.read(object.oid)
  if (typeof read === "string") throw new Error(`Tree ${object.oid}: ${read}`)
  const entries = treeEntries(read.content)
  if (entries.length > limits.folderEntries) {
    problems.push({
      code: "tree-too-large",
      where: object.path === "" ? "" : shown(object.path),
      message: `${folder} holds ${entries.length.toLocaleString("en")} entries; a folder holds at most ${limits.folderEntries.toLocaleString("en")}`,
    })
  }
  for (const entry of entries) {
    const path = `${base}${entry.name.toString("utf8")}`
    if (entry.mode === "120000") {
      problems.push({
        code: "symlink",
        where: shown(path),
        message: "a symbolic link: commit a file instead",
      })
    } else if (entry.mode === "160000") {
      problems.push({
        code: "submodule",
        where: shown(path),
        message: "a submodule: remove it",
      })
    }
    const problem = nameProblem(entry.name)
    if (problem) {
      problems.push({
        code: "path-not-portable",
        where: shown(path),
        message: `this name ${problem}, so it cannot be checked out on Windows or macOS`,
      })
    }
  }
  for (const [a, b] of clashingNames(
    entries.map((e) => e.name.toString("utf8")),
  )) {
    problems.push({
      code: "path-not-portable",
      where: shown(`${base}${b}`),
      message: `Windows and macOS see this name and ${shown(a)} as one`,
    })
  }
}

interface Entry {
  mode: string
  name: Buffer
  oid: string
}

function treeEntries(content: Buffer): Entry[] {
  const entries: Entry[] = []
  let at = 0
  while (at < content.length) {
    const space = content.indexOf(0x20, at)
    const nul = content.indexOf(0, space + 1)
    if (space < 0 || nul < 0) throw new Error("A tree Shinan cannot read")
    // Shinan's repositories use SHA-1: 20-byte object IDs.
    const idLength = 20
    entries.push({
      mode: content.subarray(at, space).toString("latin1").padStart(6, "0"),
      name: content.subarray(space + 1, nul),
      oid: content.subarray(nul + 1, nul + 1 + idLength).toString("hex"),
    })
    at = nul + 1 + idLength
  }
  return entries
}

/**
 * How many entries a walk of `tree` visits, counting each subtree every
 * place it appears; stops counting past `cap`. Subtrees' counts are kept,
 * so a folder repeated 50,000 times is read once.
 */
async function entriesReached(
  tree: string,
  reader: CatFile,
  counts: Map<string, number>,
  cap: number,
): Promise<number> {
  const known = counts.get(tree)
  if (known !== undefined) return known
  const read = await reader.read(tree)
  if (typeof read === "string") {
    // Larger than any tree read: a refusal of its own reports it.
    counts.set(tree, cap + 1)
    return cap + 1
  }
  let total = 0
  for (const entry of treeEntries(read.content)) {
    total++
    if (entry.mode === "040000") {
      total += await entriesReached(entry.oid, reader, counts, cap)
    }
    if (total > cap) break
  }
  counts.set(tree, total)
  return total
}

function lineOf(text: string, offset: number): number {
  let line = 1
  for (
    let i = text.indexOf("\n");
    i >= 0 && i < offset;
    i = text.indexOf("\n", i + 1)
  )
    line++
  return line
}

/** The repository's size on disk: its objects, the push's quarantine included. */
export function repositoryBytes(gitDir: string): number {
  let total = 0
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) total += lstatSync(path).size
    }
  }
  walk(join(gitDir, "objects"))
  return total
}

const yieldTurn = () => new Promise<void>((resolve) => setImmediate(resolve))
