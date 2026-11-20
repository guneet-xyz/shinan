import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import {
  maxPurgePaths,
  purgeMarker,
  purgeNameMarker,
  PurgeScanner,
} from "@shinan/core"
import type {
  PurgeForm,
  RepositoryPurgePreview,
  RepositoryPurgeResult,
} from "@shinan/core"
import {
  commitTexts,
  isBranchRef,
  joinIdentity,
  readAllObjects,
  readHistory,
  rewriteHistory,
  splitIdentity,
  treeEntryNames,
} from "@shinan/git"
import type { Git, HistoryCommit, HistoryItem } from "@shinan/git"

import type { Journal } from "./journal.js"
import type { FirstPush, PurgeRecord, Records } from "./push/records.js"
import type { PushService } from "./push/service.js"
import type { RepositoryStore } from "./store.js"
import { repositoryConfiguration, StoreError } from "./store.js"

/**
 * A purge as a history rewrite, in the Git container (Git-based catalog
 * plan §2.9, GC-8). A workspace owner's text is removed from every copy the
 * repository holds: file contents, paths, commit messages and identities,
 * and branch names, on every branch, with the same matching as M2's purge
 * (`PurgeScanner`). With the workspace's push lock held:
 *
 * 1. `git fast-export --all` is streamed through the scanner into
 *    `git fast-import` in a new repository in `.tmp/` (files, messages and
 *    identities get `purgeMarker`; names `purgeNameMarker`). A commit the
 *    purge leaves alone, with parents that kept theirs, keeps its ID.
 * 2. The new repository is checked: no object in it, nor any branch name,
 *    holds the text. Nothing unreachable is in it: only what fast-export
 *    read from the branches was written.
 * 3. The journal entries not yet acknowledged and the first-pusher record
 *    get the new branch names: the last steps that need the text.
 * 4. The purge's record is written (`swapping`), and the folders swapped:
 *    the old repository moves into `.tmp/`, the new one into its place.
 * 5. From the record, by commit IDs only (so a restart can do it, `recover`):
 *    the removed commits join `purged-commits`, which pre-receive refuses;
 *    each rewritten commit inherits the first pusher of the commit it
 *    replaces (D-066); the journal gets `repository.rewritten` and
 *    `repository.purged`; the record becomes `done`; the old repository is
 *    deleted.
 *
 * A repository that holds no copy is not rewritten; the journal and the
 * record are still cleaned, so running a purge again after a failure
 * finishes it without rewriting twice.
 */
export interface Purges {
  preview(workspaceId: string, text: string): Promise<RepositoryPurgePreview>
  purge(
    workspaceId: string,
    input: { purgeId: string; text: string },
  ): Promise<RepositoryPurgeResult>
  /**
   * After a restart, before `.tmp/` is emptied: puts a repository swapped
   * out mid-purge back in its place, or finishes a purge whose swap was
   * done (step 5).
   */
  recover(): Promise<void>
}

/** How long a purge waits for a push being checked before refusing as busy. */
const lockWaitMs = 30_000

/** Commits a `repository.rewritten` journal entry holds, well under its 1 MiB. */
const commitsPerEntry = 2000

/** How long one Git process of a purge may run: 10 minutes (plan §2.10). */
const processMs = 10 * 60 * 1000

/** How long matching may take in one preview or purge: 5 minutes. */
const matchingMs = 5 * 60 * 1000

export function createPurges(options: {
  store: RepositoryStore
  journal: Journal
  records: Records
  push: PushService
}): Purges {
  const { store, journal, records, push } = options
  const git = store.git
  const temporary = join(store.root, ".tmp")

  const preview = async (
    workspaceId: string,
    text: string,
  ): Promise<RepositoryPurgePreview> => {
    const gitDir = repositoryOf(store, workspaceId)
    const scanner = new PurgeScanner(text, { limitMs: matchingMs })
    const onMain = await reachable(git, gitDir, "refs/heads/main")
    const result: RepositoryPurgePreview = {
      commits: { main: 0, branches: 0 },
      files: { main: 0, branches: 0 },
      messages: { main: 0, branches: 0 },
      branchNames: 0,
      currentFiles: [],
      currentFilesMore: 0,
      acrossLines: 0,
      structure: [],
      alsoWrittenAs: [],
      journalEntries: 0,
    }
    const holding = new Set<number>()
    const forms = new Map<PurgeForm, number>()
    const files = { main: new Set<string>(), branches: new Set<string>() }
    const count = (value: Buffer) => {
      for (const form of scanner.formsIn(value))
        forms.set(form, (forms.get(form) ?? 0) + 1)
      const found = scanner.places(value)
      if (found.acrossLines) result.acrossLines++
      return found.count > 0
    }
    const refs = new Set<string>()
    await readHistory(
      git,
      gitDir,
      async (item) => {
        await scanner.pause()
        if (item.kind === "blob") {
          if (count(item.data)) holding.add(item.mark)
          return
        }
        refs.add(item.ref)
        if (item.kind !== "commit") return
        const side = onMain.has(item.oid) ? "main" : "branches"
        const message = commitParts(item).some((part) => count(part))
        let held = message
        for (const change of item.changes) {
          if (change.op === "deleteall") continue
          const inName = count(change.path)
          const inContent =
            change.op === "M" && holding.has(markNumber(change.dataref))
          if (!inName && !inContent) continue
          held = true
          files[side].add(renamePath(scanner, change.path))
        }
        if (message) result.messages[side]++
        if (held) result.commits[side]++
      },
      { timeoutMs: processMs },
    )
    for (const ref of refs) {
      if (ref !== "refs/heads/main" && scanner.holds(Buffer.from(ref)))
        result.branchNames++
    }
    // A path on both sides counts on `main`.
    for (const path of files.main) files.branches.delete(path)
    result.files = { main: files.main.size, branches: files.branches.size }

    // The files on `main` now, as the catalog shows them.
    const current: { path: string; title: string | null }[] = []
    if (await store.main(workspaceId)) {
      await readTreeBlobs(
        git,
        gitDir,
        "refs/heads/main",
        async (path, content) => {
          await scanner.pause()
          const name = Buffer.from(path, "utf8")
          if (!scanner.holds(content) && !scanner.holds(name)) return
          const shown = renamePath(scanner, name)
          current.push({
            path: shown,
            title: path.endsWith(".md") ? scanner.title(content) : null,
          })
          for (const where of scanner.structure(content))
            result.structure.push({ path: shown, where })
        },
      )
    }
    current.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    result.currentFiles = current.slice(0, maxPurgePaths)
    result.currentFilesMore = current.length - result.currentFiles.length
    result.structure = result.structure.slice(0, maxPurgePaths)
    result.alsoWrittenAs = [...forms].map(([form, places]) => ({
      form,
      places,
    }))
    result.journalEntries = journalHolding(journal, workspaceId, scanner)
    return result
  }

  /** Step 5, from the record alone: everything after the swap. */
  const finish = async (workspaceId: string, record: PurgeRecord) => {
    records.addPurgedCommits(workspaceId, record.removed)
    const inherited: FirstPush[] = []
    for (const [old, now] of record.rewritten) {
      const first = records.firstPush(workspaceId, old)
      inherited.push(
        first
          ? { ...first, commit: now, replaces: old }
          : {
              commit: now,
              push: null,
              ref: null,
              by: "shinan",
              at: record.at,
              replaces: old,
            },
      )
    }
    // Journal first, then the record, as for a push: the record is made
    // whole from the journal at start.
    for (let at = 0; at < record.rewritten.length; at += commitsPerEntry) {
      await journal.append("repository.rewritten", {
        workspaceId,
        purge: record.purgeId,
        commits: inherited.slice(at, at + commitsPerEntry).map((f) => ({
          commit: f.commit,
          replaces: f.replaces!,
          ref: f.ref,
        })),
      })
    }
    records.addFirstPushes(workspaceId, inherited)
    await journal.append("repository.purged", {
      workspaceId,
      purge: record.purgeId,
      refs: record.refs,
      counts: {
        commits: record.counts.commits,
        rewrittenCommits: record.rewritten.length,
        removedCommits: record.removed.length,
        files: record.counts.files,
        messages: record.counts.messages,
        renamedBranches: record.renamedBranches,
        journalEntries: record.counts.journalEntries,
      },
    })
    records.writePurge(workspaceId, { ...record, phase: "done" })
  }

  /**
   * Finishes the workspace's purges whose swap was done but not what
   * follows it (a failure, or a stop, in step 5): a record still
   * `swapping` whose branches are the repository's. One whose branches are
   * not never swapped, and is abandoned.
   */
  const finishPending = async (workspaceId: string) => {
    for (const record of records.purges(workspaceId)) {
      if (record.phase !== "swapping") continue
      const now = store.exists(workspaceId)
        ? await refsWithCommits(git, store.pathOf(workspaceId))
        : []
      const key = (refs: { ref: string; commit: string }[]) =>
        refs
          .map((r) => `${r.ref} ${r.commit}`)
          .sort()
          .join("\n")
      if (now.length > 0 && key(now) === key(record.refs)) {
        push.rewritten(workspaceId)
        await finish(workspaceId, record)
      } else {
        records.writePurge(workspaceId, { ...record, phase: "abandoned" })
      }
    }
  }

  const purge = async (
    workspaceId: string,
    input: { purgeId: string; text: string },
  ): Promise<RepositoryPurgeResult> => {
    const target = repositoryOf(store, workspaceId)
    const scanner = new PurgeScanner(input.text, { limitMs: matchingMs })
    const release = await push.exclusive(workspaceId, lockWaitMs)
    if (!release)
      throw new StoreError(
        409,
        "busy",
        "A push to this catalog is being checked; try again in a minute",
      )
    mkdirSync(temporary, { recursive: true, mode: 0o700 })
    const folder = mkdtempSync(join(temporary, "purge-"))
    try {
      await finishPending(workspaceId)
      const earlier = records.purge(workspaceId, input.purgeId)
      if (earlier && earlier.phase !== "abandoned") {
        throw new StoreError(
          409,
          "purge-id-used",
          "That purge has run already; start a new one",
        )
      }
      writeFileSync(
        join(folder, "state.json"),
        JSON.stringify({ workspaceId, purgeId: input.purgeId }),
      )
      const fresh = join(folder, "new.git")
      await git.run([
        "init",
        "--quiet",
        "--bare",
        "--template=",
        "--initial-branch=main",
        "--object-format=sha1",
        fresh,
      ])
      for (const [key, value] of repositoryConfiguration(store.hooksDirectory))
        await git.run(["config", key, value], { gitDir: fresh })

      const branches = branchNames(await refsOf(git, target), (ref) =>
        scanner.rename(ref),
      )
      const counts = { commits: 0, files: new Set<string>(), messages: 0 }
      const holding = new Set<number>()
      const change = async (item: HistoryItem): Promise<HistoryItem> => {
        await scanner.pause()
        if (item.kind === "blob") {
          const data = scanner.replace(item.data, purgeMarker)
          if (data !== item.data) holding.add(item.mark)
          return { ...item, data }
        }
        const ref = branches.get(item.ref) ?? item.ref
        if (item.kind === "reset") return { ...item, ref }
        const changed = rewriteCommit(scanner, item, holding, counts.files)
        if (changed.messages) counts.messages++
        if (changed.held) counts.commits++
        return { ...changed.commit, ref }
      }
      const written = await rewriteHistory(git, target, fresh, change, {
        temporaryDir: folder,
        timeoutMs: processMs,
      })
      const rewritten = [...written.commits].filter(([old, now]) => old !== now)
      const renamedBranches = [...branches].filter(([a, b]) => a !== b).length

      // The text is in no object, name or branch of the new repository;
      // anything else stops the purge before the swap.
      await git.run(["repack", "-a", "-d", "-q"], {
        gitDir: fresh,
        timeoutMs: processMs,
      })
      await git.run(["prune", "--expire=now"], { gitDir: fresh })
      const kept = new Set<string>()
      await readAllObjects(
        git,
        fresh,
        async (object) => {
          await scanner.pause()
          if (object.type === "commit") kept.add(object.oid)
          if (objectHolds(scanner, object.type, object.content))
            throw new Error("A purge's new repository still holds the text")
        },
        { timeoutMs: processMs },
      )
      for (const { ref } of written.refs)
        if (scanner.holds(Buffer.from(ref)))
          throw new Error("A purge's new repository still holds the text")

      const rename = (ref: string) => branches.get(ref) ?? scanner.rename(ref)
      const journalEntries = journal.renameRefs(workspaceId, rename)
      records.renameRefs(workspaceId, rename)
      // The groups ever on `main` (the `by` rule's revert rule), as the
      // purge left them on `main`.
      records.purgeMainGroups(
        workspaceId,
        (text) =>
          scanner.replace(Buffer.from(text), purgeMarker).toString("utf8"),
        (text) => scanner.holds(Buffer.from(text)),
      )

      const result: RepositoryPurgeResult = {
        purgeId: input.purgeId,
        rewritten: false,
        commits: counts.commits,
        rewrittenCommits: rewritten.length,
        removedCommits: 0,
        files: counts.files.size,
        messages: counts.messages,
        renamedBranches,
        journalEntries,
      }
      // Commits the old repository holds that the new one does not, and
      // whether any object of the old one holds the text, reachable or not.
      const removed: string[] = []
      let oldHolds = false
      await readAllObjects(
        git,
        target,
        async (object) => {
          await scanner.pause()
          if (object.type === "commit" && !kept.has(object.oid))
            removed.push(object.oid)
          if (!oldHolds && objectHolds(scanner, object.type, object.content))
            oldHolds = true
        },
        { timeoutMs: processMs },
      )
      // Nothing the repository holds has the text: no swap.
      if (!oldHolds && rewritten.length === 0 && renamedBranches === 0)
        return result

      const record: PurgeRecord = {
        purgeId: input.purgeId,
        phase: "swapping",
        at: new Date().toISOString(),
        rewritten,
        removed,
        refs: written.refs.map(({ ref, commit }) => ({ ref, commit })),
        renamedBranches,
        counts: {
          commits: counts.commits,
          files: counts.files.size,
          messages: counts.messages,
          journalEntries,
        },
      }
      records.writePurge(workspaceId, record)
      renameSync(target, join(folder, "old.git"))
      renameSync(fresh, target)
      push.rewritten(workspaceId)
      await finish(workspaceId, record)
      return { ...result, rewritten: true, removedCommits: removed.length }
    } finally {
      release()
      rmSync(folder, { recursive: true, force: true })
    }
  }

  const recover = async () => {
    let names: string[] = []
    try {
      names = readdirSync(temporary)
    } catch {
      // No `.tmp/` yet.
    }
    for (const name of names) {
      if (!name.startsWith("purge-")) continue
      const folder = join(temporary, name)
      let state: { workspaceId: string; purgeId: string }
      try {
        state = JSON.parse(
          readFileSync(join(folder, "state.json"), "utf8"),
        ) as { workspaceId: string; purgeId: string }
      } catch {
        continue
      }
      const target = store.pathOf(state.workspaceId)
      const fresh = join(folder, "new.git")
      // Stopped between the two renames: the new repository goes in.
      if (
        !existsSync(target) &&
        existsSync(fresh) &&
        existsSync(join(folder, "old.git"))
      )
        renameSync(fresh, target)
    }
    for (const workspaceId of records.purgedWorkspaces())
      await finishPending(workspaceId)
  }

  return { preview, purge, recover }
}

/** The workspace's repository folder, which must exist. */
function repositoryOf(store: RepositoryStore, workspaceId: string): string {
  if (!store.exists(workspaceId))
    throw new StoreError(404, "not-found", "Not found")
  return store.pathOf(workspaceId)
}

/** The commits reachable from `ref`. */
async function reachable(
  git: Git,
  gitDir: string,
  ref: string,
): Promise<Set<string>> {
  const { stdout } = await git.run(
    ["rev-list", "--end-of-options", ref, "--"],
    {
      gitDir,
      timeoutMs: processMs,
      maxOutputBytes: 256 * 1024 * 1024,
    },
  )
  return new Set(stdout.toString("utf8").split("\n").filter(Boolean))
}

async function refsWithCommits(
  git: Git,
  gitDir: string,
): Promise<{ ref: string; commit: string }[]> {
  const { stdout } = await git.run(
    ["for-each-ref", "--format=%(objectname) %(refname)"],
    { gitDir },
  )
  return stdout
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(" ")
      return { ref: line.slice(space + 1), commit: line.slice(0, space) }
    })
}

async function refsOf(git: Git, gitDir: string): Promise<string[]> {
  const { stdout } = await git.run(["for-each-ref", "--format=%(refname)"], {
    gitDir,
  })
  return stdout.toString("utf8").split("\n").filter(Boolean)
}

/**
 * Each ref's name after the purge: the text replaced in branch names
 * (`main` keeps its name whatever it holds), and a name that would be
 * invalid or taken made unique (`purged-2`, …).
 */
export function branchNames(
  refs: readonly string[],
  rename: (ref: string) => string,
): Map<string, string> {
  const names = new Map<string, string>()
  const taken = new Set(refs)
  for (const ref of refs) {
    if (ref === "refs/heads/main" || !ref.startsWith("refs/heads/")) {
      names.set(ref, ref)
      continue
    }
    const branch = rename(ref.slice("refs/heads/".length))
    let next = `refs/heads/${branch}`
    if (next === ref) {
      names.set(ref, ref)
      continue
    }
    if (!isBranchRef(next)) next = `refs/heads/${purgeNameMarker}`
    for (let n = 2; taken.has(next) || !isBranchRef(next); n++)
      next = `refs/heads/${purgeNameMarker}-${n}`
    taken.add(next)
    names.set(ref, next)
  }
  return names
}

function markNumber(dataref: string): number {
  return /^:(\d+)$/.test(dataref) ? Number(dataref.slice(1)) : -1
}

/** A path with the text replaced in each of its names. */
function renamePath(scanner: PurgeScanner, path: Buffer): string {
  return path
    .toString("utf8")
    .split("/")
    .map((part) => scanner.rename(part))
    .join("/")
}

/** The parts of a commit that hold text: the message, and each identity's name and email. */
function commitParts(commit: HistoryCommit): Buffer[] {
  const parts = [commit.message]
  for (const identity of [commit.author, commit.committer]) {
    if (!identity) continue
    const { name, email } = splitIdentity(identity)
    parts.push(name, email)
  }
  if (commit.encoding) parts.push(commit.encoding)
  return parts
}

/** A commit with the text replaced; whether it held it, and in its message or identities. */
function rewriteCommit(
  scanner: PurgeScanner,
  commit: HistoryCommit,
  holding: ReadonlySet<number>,
  files: Set<string>,
): { commit: HistoryCommit; held: boolean; messages: boolean } {
  const identity = (value: Buffer | null) => {
    if (!value) return value
    const parts = splitIdentity(value)
    const name = scanner.replace(parts.name, purgeMarker)
    const email = scanner.replace(parts.email, purgeMarker)
    if (name === parts.name && email === parts.email) return value
    return joinIdentity({ name, email, when: parts.when })
  }
  const message = scanner.replace(commit.message, purgeMarker)
  const author = identity(commit.author)
  const committer = identity(commit.committer)!
  const messages =
    message !== commit.message ||
    author !== commit.author ||
    committer !== commit.committer
  let held = messages
  const changes = commit.changes.map((change) => {
    if (change.op === "deleteall") return change
    const renamed = renamePath(scanner, change.path)
    const path = Buffer.from(renamed, "utf8")
    const inName = !path.equals(change.path)
    const inContent =
      change.op === "M" && holding.has(markNumber(change.dataref))
    if (inName || inContent) {
      held = true
      files.add(renamed)
    }
    return inName ? { ...change, path } : change
  })
  return {
    commit: { ...commit, message, author, committer, changes },
    held,
    messages,
  }
}

/** Whether an object holds the text where people or agents wrote it. */
function objectHolds(
  scanner: PurgeScanner,
  type: string,
  content: Buffer,
): boolean {
  if (type === "blob") return scanner.holds(content)
  if (type === "tree")
    return treeEntryNames(content).some((name) => scanner.holds(name))
  if (type === "commit")
    return commitTexts(content).some((part) => scanner.holds(part))
  // Shinan refuses tags; a purge's repository never has one.
  return true
}

/** How many of a workspace's journal entries not yet acknowledged hold the text. */
function journalHolding(
  journal: Journal,
  workspaceId: string,
  scanner: PurgeScanner,
): number {
  let count = 0
  for (let after = 0; ;) {
    const entries = journal.read(after, 1000)
    if (entries.length === 0) return count
    for (const entry of entries) {
      after = entry.number
      if (entry.data.workspaceId !== workspaceId) continue
      let held = false
      JSON.stringify(entry.data, (key, value: unknown) => {
        if (
          key === "ref" &&
          typeof value === "string" &&
          scanner.holds(Buffer.from(value))
        )
          held = true
        return value
      })
      if (held) count++
    }
  }
}

/** Each file of `ref`'s tree, read one at a time. */
async function readTreeBlobs(
  git: Git,
  gitDir: string,
  ref: string,
  onFile: (path: string, content: Buffer) => Promise<void>,
): Promise<void> {
  const { stdout } = await git.run(
    ["ls-tree", "-r", "-z", "--end-of-options", ref],
    { gitDir, timeoutMs: processMs, maxOutputBytes: 64 * 1024 * 1024 },
  )
  const entries = stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t")
      const [, type, oid] = line.slice(0, tab).split(" ")
      return { type, oid: oid!, path: line.slice(tab + 1) }
    })
    .filter((e) => e.type === "blob")
  const wanted = new Map<string, string[]>()
  for (const e of entries)
    wanted.set(e.oid, [...(wanted.get(e.oid) ?? []), e.path])
  const { stdout: objects } = await git.run(["cat-file", "--batch"], {
    gitDir,
    input: [...wanted.keys()].map((oid) => `${oid}\n`).join(""),
    timeoutMs: processMs,
    maxOutputBytes: 1024 * 1024 * 1024,
  })
  let at = 0
  while (at < objects.length) {
    const end = objects.indexOf(0x0a, at)
    const [oid, , size] = objects
      .subarray(at, end)
      .toString("latin1")
      .split(" ")
    const content = objects.subarray(end + 1, end + 1 + Number(size))
    at = end + 1 + Number(size) + 1
    for (const path of wanted.get(oid!) ?? []) await onFile(path, content)
  }
}
