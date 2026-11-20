import {
  existsSync,
  mkdirSync,
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
  PurgeEncoding,
  PurgeForm,
  RepositoryPurgePreview,
  RepositoryPurgeResult,
  RepositoryPurgeStatus,
} from "@shinan/core"
import { createLimitedLog, errorSummary } from "@shinan/db"
import type { LimitedLog } from "@shinan/db"
import {
  commitTexts,
  isBranchRef,
  joinIdentity,
  listObjects,
  reachableObjects,
  readHistory,
  readObjects,
  rewriteHistory,
  splitIdentity,
  treeEntryNames,
} from "@shinan/git"
import type { Git, HistoryCommit, HistoryItem } from "@shinan/git"

import type { Journal } from "./journal.js"
import type { RepositoryGate } from "./prune.js"
import type { FirstPush, PurgeRecord, Records } from "./push/records.js"
import type { PushService } from "./push/service.js"
import type { RepositoryStore } from "./store.js"
import { repositoryConfiguration, StoreError } from "./store.js"

/**
 * A purge as a history rewrite, in the Git container (Git-based catalog
 * plan §2.9, GC-8). A workspace owner's text is removed from every copy the
 * repository holds: file contents, paths, commit messages and identities,
 * and branch names, on every branch, with the same matching as M2's purge
 * (`PurgeScanner`). A purge is a job (`start`, then `status`), since a
 * large history takes minutes. It runs in two parts:
 *
 * **Without the push lock**, so pushes go on meanwhile:
 * 1. A scan of everything the repository holds: the history, as
 *    `git fast-export --all` gives it, and every object no branch reaches.
 *    If nothing holds the text, the purge ends here: no rewrite.
 * 2. `git fast-export --all` is streamed through the scanner into
 *    `git fast-import` in a new repository in `.tmp/` (files, messages and
 *    identities get `purgeMarker`, and catalog IDs and names
 *    `purgeNameMarker`). A commit the purge leaves alone, with parents that
 *    kept theirs, keeps its ID.
 * 3. The new repository is checked: no file, commit or name in it, nor any
 *    branch name, holds the text; nothing unreachable is in it.
 *
 * **With the push lock** (pushes meanwhile are refused at once, "Shinan is
 * removing text from this catalog's history"), for seconds: if a push moved
 * a branch during the first part, steps 2 and 3 are done again here. Then:
 * 4. The journal entries not yet acknowledged, the first-pusher record and
 *    the record of groups ever on `main` lose the text: the last steps that
 *    need it.
 * 5. The purge's record (`swapping`, with a keyed hash of the text) is
 *    written; Git processes on the repository are ended and held back
 *    (`gate.drain`), so no clone gets the old history after the owner is
 *    told it is removed; the folders are swapped; the record says
 *    `swapped`; the old repository is deleted.
 * 6. From the record alone (so a restart or a retry can do it): the
 *    removed commits join `purged-commits`, which pre-receive refuses; each
 *    rewritten commit inherits the first pusher of the commit it replaces
 *    (D-066); the journal gets `repository.rewritten` and
 *    `repository.purged`; the record becomes `done`.
 *
 * While a record is `swapping` or `swapped`, every push is refused, so a
 * failure in step 6 never lets a removed commit back (review of #197); it
 * is retried every minute and at start (`finishPending`).
 */
export interface Purges {
  preview(workspaceId: string, text: string): Promise<RepositoryPurgePreview>
  /** Starts a purge as a job; refused `busy` while another of the repository runs. */
  start(
    workspaceId: string,
    input: { purgeId: string; text: string },
  ): RepositoryPurgeStatus
  status(workspaceId: string, purgeId: string): RepositoryPurgeStatus
  /** Whether `text` is purge `purgeId`'s text, by its keyed hash. */
  isText(workspaceId: string, purgeId: string, text: string): boolean
  /** Runs a purge to its end (what `start` runs). */
  run(
    workspaceId: string,
    input: { purgeId: string; text: string },
  ): Promise<RepositoryPurgeResult>
  /**
   * After a restart, before `.tmp/` is emptied: puts a repository swapped
   * out mid-purge back in its place, and finishes every purge whose swap
   * was done (step 6).
   */
  recover(): Promise<void>
  /** Retries step 6 of unfinished purges every `intervalMs`; returns a function that stops it. */
  keepFinishing(intervalMs?: number): () => void
}

/** How long a purge waits for a push being checked before refusing as busy. */
const lockWaitMs = 30_000

/** How long a purge's swap waits for the Git processes it ends. */
const drainMs = 10_000

/** Commits a `repository.rewritten` journal entry holds, well under its 1 MiB. */
const commitsPerEntry = 2000

/** How long one Git process of a purge may run. */
const processMs = 60 * 60 * 1000

/** How long matching may take in one preview or purge, in all. */
const matchingMs = 30 * 60 * 1000

/** How long a finished purge's status is kept in memory; the record keeps the rest. */
const statusMs = 24 * 60 * 60 * 1000

export function createPurges(options: {
  store: RepositoryStore
  journal: Journal
  records: Records
  push: PushService
  gate?: RepositoryGate
  log?: LimitedLog
}): Purges {
  const { store, journal, records, push } = options
  const log = options.log ?? createLimitedLog()
  const git = store.git
  const temporary = join(store.root, ".tmp")
  const folderOf = (purgeId: string) => join(temporary, `purge-${purgeId}`)
  /** Purges running in this process, and recent outcomes. */
  const jobs = new Map<
    string,
    { workspaceId: string; status: RepositoryPurgeStatus; at: number }
  >()

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
      mayAppearEncoded: [],
      journalEntries: 0,
    }
    const holding = new Set<number>()
    const forms = new Map<PurgeForm, number>()
    const encodings = new Map<PurgeEncoding, number>()
    const files = { main: new Set<string>(), branches: new Set<string>() }
    const names = new Map<string, boolean>()
    const count = (value: Buffer) => {
      for (const form of scanner.formsIn(value))
        forms.set(form, (forms.get(form) ?? 0) + 1)
      const found = scanner.places(value)
      if (found.acrossLines) result.acrossLines++
      for (const encoding of scanner.encodingsIn(value))
        encodings.set(encoding, (encodings.get(encoding) ?? 0) + 1)
      return found.count > 0
    }
    /** A path, matched once however many commits name it. */
    const pathHolds = (path: Buffer) => {
      const key = path.toString("latin1")
      let held = names.get(key)
      if (held === undefined) names.set(key, (held = count(path)))
      return held
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
          const inName = pathHolds(change.path)
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
    result.mayAppearEncoded = [...encodings].map(([encoding, places]) => ({
      encoding,
      places,
    }))
    result.journalEntries = journalHolding(journal, workspaceId, scanner)
    return result
  }

  /**
   * Step 1: whether anything the repository holds has the text, reachable
   * or not. The history is read once as fast-export gives it (each blob and
   * commit once, each path once); objects no branch reaches are read whole.
   */
  const holdsAnywhere = async (gitDir: string, scanner: PurgeScanner) => {
    let found = false
    const names = new Map<string, boolean>()
    const nameHolds = (name: Buffer) => {
      const key = name.toString("latin1")
      let held = names.get(key)
      if (held === undefined) names.set(key, (held = scanner.holds(name)))
      return held
    }
    await readHistory(
      git,
      gitDir,
      async (item) => {
        if (found) return
        await scanner.pause()
        if (item.kind === "blob") found = scanner.holds(item.data)
        else if (
          item.ref !== "refs/heads/main" &&
          nameHolds(Buffer.from(item.ref))
        )
          found = true
        else if (item.kind === "commit")
          found =
            commitParts(item).some((part) => scanner.holds(part)) ||
            item.changes.some(
              (c) =>
                c.op !== "deleteall" &&
                c.path
                  .toString("latin1")
                  .split("/")
                  .some((n) => nameHolds(Buffer.from(n, "latin1"))),
            )
      },
      { timeoutMs: processMs },
    )
    if (found) return true
    const all = await listObjects(git, gitDir, { timeoutMs: processMs })
    const reached = await reachableObjects(git, gitDir, {
      timeoutMs: processMs,
    })
    const unreachable = [...all.keys()].filter((oid) => !reached.has(oid))
    await readObjects(
      git,
      gitDir,
      unreachable,
      async (object) => {
        await scanner.pause()
        if (
          !found &&
          objectHolds(scanner, object.type, object.content, nameHolds)
        )
          found = true
      },
      { timeoutMs: processMs },
    )
    return found
  }

  /**
   * Steps 2 and 3: the history rewritten into a new repository in
   * `folder`, and checked.
   */
  const rewrite = async (
    workspaceId: string,
    target: string,
    folder: string,
    scanner: PurgeScanner,
  ) => {
    rmSync(folder, { recursive: true, force: true })
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    writeFileSync(join(folder, "state.json"), JSON.stringify({ workspaceId }))
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
    const paths = new Map<string, Buffer | null>()
    const change = async (item: HistoryItem): Promise<HistoryItem> => {
      await scanner.pause()
      if (item.kind === "blob") {
        const data = scanner.replace(item.data, purgeMarker)
        if (data !== item.data) holding.add(item.mark)
        return { ...item, data }
      }
      const ref = branches.get(item.ref) ?? item.ref
      if (item.kind === "reset") return { ...item, ref }
      const changed = rewriteCommit(scanner, item, holding, counts.files, paths)
      if (changed.messages) counts.messages++
      if (changed.held) counts.commits++
      return { ...changed.commit, ref }
    }
    const written = await rewriteHistory(git, target, fresh, change, {
      temporaryDir: folder,
      timeoutMs: processMs,
    })
    // Step 3. Trees are made by fast-import from the paths written, so
    // their names are checked as those paths' names, each once.
    const objects = await listObjects(git, fresh, { timeoutMs: processMs })
    const commits = new Set<string>()
    const readable: string[] = []
    for (const [oid, type] of objects) {
      if (type === "commit") commits.add(oid)
      if (type !== "tree") readable.push(oid)
    }
    const leftOver = () =>
      new Error("A purge's new repository still holds the text")
    await readObjects(
      git,
      fresh,
      readable,
      async (object) => {
        await scanner.pause()
        if (
          objectHolds(scanner, object.type, object.content, (n) =>
            scanner.holds(n),
          )
        )
          throw leftOver()
      },
      { timeoutMs: processMs },
    )
    const checked = new Set<string>()
    for (const [original, renamed] of paths)
      for (const name of (renamed?.toString("latin1") ?? original).split("/")) {
        if (checked.has(name)) continue
        checked.add(name)
        if (scanner.holds(Buffer.from(name, "latin1"))) throw leftOver()
      }
    for (const { ref } of written.refs)
      if (scanner.holds(Buffer.from(ref))) throw leftOver()
    return {
      fresh,
      written,
      branches,
      commits,
      counts,
      rewritten: [...written.commits].filter(([old, now]) => old !== now),
      renamedBranches: [...branches].filter(([a, b]) => a !== b).length,
    }
  }

  /** Step 6, from the record alone: everything after the swap. */
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
    // whole from the journal at start. Journaled again on a retry, and
    // stored once by `web` (idempotent by purge and commit).
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
      counts: countsOf(record),
    })
    records.writePurge(workspaceId, { ...record, phase: "done" })
  }

  /** `finish`, tried again a few times: a failure leaves pushes refused. */
  const finishWithRetries = async (
    workspaceId: string,
    record: PurgeRecord,
  ) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await finish(workspaceId, record)
      } catch (error) {
        if (attempt >= 3) throw error
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
      }
    }
  }

  /**
   * Finishes the workspace's purges stopped after their swap. `swapped`
   * means swapped. `swapping`: swapped when its folder holds the old
   * repository and no new one (or none at all, and the branches are the
   * record's: pushes are refused meanwhile, so nothing else moved them);
   * otherwise the swap never happened, and the record is abandoned, which
   * is safe: the repository is the old one, with every commit it had.
   */
  const finishPending = async (workspaceId: string) => {
    for (const record of records.purges(workspaceId)) {
      if (record.phase !== "swapping" && record.phase !== "swapped") continue
      let swapped = record.phase === "swapped"
      if (!swapped) {
        const folder = folderOf(record.purgeId)
        const fresh = existsSync(join(folder, "new.git"))
        const old = existsSync(join(folder, "old.git"))
        if (old && !fresh) swapped = true
        else if (!old && !fresh) {
          const now = store.exists(workspaceId)
            ? await refsWithCommits(git, store.pathOf(workspaceId))
            : []
          swapped = now.length > 0 && refsKey(now) === refsKey(record.refs)
        }
      }
      if (!swapped) {
        records.writePurge(workspaceId, { ...record, phase: "abandoned" })
        rmSync(folderOf(record.purgeId), { recursive: true, force: true })
        continue
      }
      push.rewritten(workspaceId)
      if (record.phase === "swapping")
        records.writePurge(workspaceId, { ...record, phase: "swapped" })
      rmSync(folderOf(record.purgeId), { recursive: true, force: true })
      await finish(workspaceId, { ...record, phase: "swapped" })
    }
  }

  const run = async (
    workspaceId: string,
    input: { purgeId: string; text: string },
  ): Promise<RepositoryPurgeResult> => {
    const target = repositoryOf(store, workspaceId)
    const scanner = new PurgeScanner(input.text, { limitMs: matchingMs })
    const earlier = records.purge(workspaceId, input.purgeId)
    if (earlier && earlier.phase !== "abandoned")
      throw new StoreError(
        409,
        "purge-id-used",
        "That purge has run already; start a new one",
      )
    const folder = folderOf(input.purgeId)
    const result: RepositoryPurgeResult = {
      purgeId: input.purgeId,
      rewritten: false,
      commits: 0,
      rewrittenCommits: 0,
      removedCommits: 0,
      files: 0,
      messages: 0,
      renamedBranches: 0,
      journalEntries: 0,
    }
    // How long each part took, and how long pushes were held back: one
    // line of the log, without the text.
    const started = performance.now()
    const times = { scan: 0, rewrite: 0, locked: 0 }
    const seconds = (ms: number) => (ms / 1000).toFixed(1)
    const withLock = async <T>(work: () => Promise<T>): Promise<T> => {
      const release = await push.exclusive(workspaceId, lockWaitMs, "purge")
      if (!release)
        throw new StoreError(
          409,
          "busy",
          "A push to this catalog is being checked: try again in a minute",
        )
      const locked = performance.now()
      try {
        await finishPending(workspaceId)
        return await work()
      } finally {
        release()
        times.locked = performance.now() - locked
        log(
          `Purge ${input.purgeId}: ${seconds(performance.now() - started)} s in all (scan ${seconds(times.scan)} s, rewrite ${seconds(times.rewrite)} s); pushes held back ${seconds(times.locked)} s`,
        )
      }
    }
    /** Step 4, with the lock held. */
    const cleanRecords = (branches?: Map<string, string>) => {
      const rename = (ref: string) => branches?.get(ref) ?? scanner.rename(ref)
      result.journalEntries = journal.renameRefs(workspaceId, rename)
      records.renameRefs(workspaceId, rename)
      records.purgeMainGroups(
        workspaceId,
        (text) =>
          scanner.replace(Buffer.from(text), purgeMarker).toString("utf8"),
        (text) => scanner.holds(Buffer.from(text)),
      )
    }

    const before = await refsWithCommits(git, target)
    const scanned = await holdsAnywhere(target, scanner)
    times.scan = performance.now() - started
    if (!scanned) {
      // Nothing holds it: no rewrite; the journal and the records only.
      return withLock(() => {
        cleanRecords()
        return Promise.resolve(result)
      })
    }
    let prepared: Awaited<ReturnType<typeof rewrite>> | undefined
    try {
      const rewriting = performance.now()
      prepared = await rewrite(workspaceId, target, folder, scanner)
      times.rewrite = performance.now() - rewriting
      return await withLock(async () => {
        // A push moved a branch meanwhile: done again, now that none can.
        if (refsKey(await refsWithCommits(git, target)) !== refsKey(before))
          prepared = await rewrite(workspaceId, target, folder, scanner)
        const p = prepared!
        cleanRecords(p.branches)
        const removed: string[] = []
        for (const [oid, type] of await listObjects(git, target, {
          timeoutMs: processMs,
        }))
          if (type === "commit" && !p.commits.has(oid)) removed.push(oid)
        const record: PurgeRecord = {
          purgeId: input.purgeId,
          phase: "swapping",
          at: new Date().toISOString(),
          textHash: records.textHash(scanner.purgeText),
          rewritten: p.rewritten,
          removed,
          refs: p.written.refs.map(({ ref, commit }) => ({ ref, commit })),
          renamedBranches: p.renamedBranches,
          counts: {
            commits: p.counts.commits,
            files: p.counts.files.size,
            messages: p.counts.messages,
            journalEntries: result.journalEntries,
          },
        }
        records.writePurge(workspaceId, record)
        // Step 5: nobody reads the old history once the owner is told.
        const reopen =
          (await options.gate?.drain(workspaceId, drainMs)) ?? (() => {})
        try {
          renameSync(target, join(folder, "old.git"))
          renameSync(p.fresh, target)
          push.rewritten(workspaceId)
          records.writePurge(workspaceId, { ...record, phase: "swapped" })
        } finally {
          reopen()
        }
        rmSync(folder, { recursive: true, force: true })
        await finishWithRetries(workspaceId, { ...record, phase: "swapped" })
        return {
          ...result,
          rewritten: true,
          commits: record.counts.commits,
          rewrittenCommits: record.rewritten.length,
          removedCommits: removed.length,
          files: record.counts.files,
          messages: record.counts.messages,
          renamedBranches: record.renamedBranches,
        }
      })
    } finally {
      // Kept only while its record needs it (`finishPending`).
      const record = records.purge(workspaceId, input.purgeId)
      if (record?.phase !== "swapping")
        rmSync(folder, { recursive: true, force: true })
    }
  }

  const sweep = () => {
    for (const [id, job] of jobs)
      if (job.status.state !== "running" && Date.now() - job.at > statusMs)
        jobs.delete(id)
  }

  const start: Purges["start"] = (workspaceId, input) => {
    repositoryOf(store, workspaceId)
    sweep()
    if (
      [...jobs.values()].some(
        (j) => j.workspaceId === workspaceId && j.status.state === "running",
      )
    )
      throw new StoreError(
        409,
        "purge-running",
        "Text is already being removed from this catalog's history: try again in a few minutes",
      )
    // The text is checked before the job starts, so a bad one is refused.
    new PurgeScanner(input.text)
    const status: RepositoryPurgeStatus = {
      purgeId: input.purgeId,
      state: "running",
    }
    const job = { workspaceId, status, at: Date.now() }
    jobs.set(input.purgeId, job)
    void run(workspaceId, input).then(
      (result) => {
        job.status = { purgeId: input.purgeId, state: "done", result }
        job.at = Date.now()
      },
      (error: unknown) => {
        log(`Purge ${input.purgeId} failed: ${errorSummary(error)}`)
        job.status = {
          purgeId: input.purgeId,
          state: "failed",
          message:
            error instanceof StoreError
              ? error.message
              : records.unfinishedPurge(workspaceId)
                ? "The history was rewritten, but Shinan could not finish recording it; it tries again every minute, and pushes wait until then"
                : "Shinan could not remove the text: nothing was changed; try again",
        }
        job.at = Date.now()
      },
    )
    return status
  }

  const status: Purges["status"] = (workspaceId, purgeId) => {
    const job = jobs.get(purgeId)
    if (job && job.workspaceId === workspaceId) return job.status
    const record = records.purge(workspaceId, purgeId)
    if (record?.phase === "done")
      return {
        purgeId,
        state: "done",
        result: {
          purgeId,
          rewritten: true,
          ...countsOf(record),
        },
      }
    if (record?.phase === "swapping" || record?.phase === "swapped")
      return { purgeId, state: "running" }
    return { purgeId, state: "unknown" }
  }

  const recover = async () => {
    let names: string[] = []
    try {
      names = readdirSync(temporary)
    } catch {
      // No `.tmp/` yet.
    }
    for (const name of names) {
      const id = /^purge-([0-9a-f-]{36})$/.exec(name)?.[1]
      if (!id) continue
      const folder = join(temporary, name)
      let state: { workspaceId: string }
      try {
        state = JSON.parse(
          readFileSync(join(folder, "state.json"), "utf8"),
        ) as {
          workspaceId: string
        }
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
      await finishPending(workspaceId).catch((error: unknown) =>
        log(
          `Finishing a purge of workspace ${workspaceId} failed: ${errorSummary(error)}`,
        ),
      )
  }

  const keepFinishing: Purges["keepFinishing"] = (intervalMs = 60_000) => {
    const timer = setInterval(() => {
      void (async () => {
        for (const workspaceId of records.purgedWorkspaces()) {
          if (!records.unfinishedPurge(workspaceId)) continue
          const release = await push.exclusive(workspaceId, 0, "purge")
          if (!release) continue
          try {
            await finishPending(workspaceId)
          } catch (error) {
            log(
              `Finishing a purge of workspace ${workspaceId} failed: ${errorSummary(error)}`,
            )
          } finally {
            release()
          }
        }
      })()
    }, intervalMs)
    timer.unref()
    return () => clearInterval(timer)
  }

  return {
    preview,
    start,
    status,
    isText: (workspaceId, purgeId, text) => {
      const record = records.purge(workspaceId, purgeId)
      return (
        record !== undefined &&
        record.textHash === records.textHash(new PurgeScanner(text).purgeText)
      )
    },
    run,
    recover,
    keepFinishing,
  }
}

function countsOf(record: PurgeRecord) {
  return {
    commits: record.counts.commits,
    rewrittenCommits: record.rewritten.length,
    removedCommits: record.removed.length,
    files: record.counts.files,
    messages: record.counts.messages,
    renamedBranches: record.renamedBranches,
    journalEntries: record.counts.journalEntries,
  }
}

function refsKey(refs: { ref: string; commit: string }[]): string {
  return refs
    .map((r) => `${r.ref} ${r.commit}`)
    .sort()
    .join("\n")
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

/**
 * A commit with the text replaced; whether it held it, and in its message
 * or identities. `paths` keeps each path's new form, matched once however
 * many commits name it (null: unchanged); its keys and new forms are every
 * path the new repository holds.
 */
function rewriteCommit(
  scanner: PurgeScanner,
  commit: HistoryCommit,
  holding: ReadonlySet<number>,
  files: Set<string>,
  paths: Map<string, Buffer | null>,
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
    const key = change.path.toString("latin1")
    let known = paths.get(key)
    if (!known) {
      const renamed = Buffer.from(renamePath(scanner, change.path), "utf8")
      known = renamed.equals(change.path) ? null : renamed
      paths.set(key, known)
    }
    const inName = known !== null
    const path = known ?? change.path
    const inContent =
      change.op === "M" && holding.has(markNumber(change.dataref))
    if (inName || inContent) {
      held = true
      files.add(path.toString("utf8"))
    }
    return inName ? { ...change, path } : change
  })
  return {
    commit: { ...commit, message, author, committer, changes },
    held,
    messages,
  }
}

/**
 * Whether an object holds the text where people or agents wrote it; a
 * tree's names through `nameHolds`, so each is matched once.
 */
function objectHolds(
  scanner: PurgeScanner,
  type: string,
  content: Buffer,
  nameHolds: (name: Buffer) => boolean,
): boolean {
  if (type === "blob") return scanner.holds(content)
  if (type === "tree") return treeEntryNames(content).some(nameHolds)
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
