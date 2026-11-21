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
import { PathPlan, PlanConflict } from "./purge-plan.js"
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
  /**
   * Whether `text` is the text of purge `purgeId`, a rewrite `web` has not
   * recorded yet, by its keyed hash.
   */
  isText(workspaceId: string, purgeId: string, text: string): boolean
  /** Drops a finished purge's keyed hash, once `web` has recorded it. */
  forgetText(workspaceId: string, purgeId: string): void
  /** Whether a purge is reading or rewriting the repository (no pruning meanwhile). */
  running(workspaceId: string): boolean
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
  /** Repositories a purge is reading or rewriting: not pruned meanwhile. */
  const running = new Set<string>()
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
      renamedApart: [],
      renamedApartMore: 0,
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
    const paths = new Set<string>()
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
        for (const c of item.changes)
          if (c.op !== "deleteall") paths.add(c.path.toString("utf8"))
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
          files[side].add(change.path.toString("utf8"))
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
    // The names the purge would give, each apart from every other.
    const plan = new PathPlan((name) => scanner.rename(name))
    plan.add(paths)
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
          const shown = plan.path(path)
          current.push({
            path: shown,
            title: path.endsWith(".md")
              ? scanner.title(content, (plain) => plan.idName(plain))
              : null,
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
    // A page on `main` is named by its title, as in the list above.
    const titles = new Map(current.map((c) => [c.path, c.title]))
    const apart = plan.renamedApart().map((r) => ({
      ...r,
      title: r.folder ? null : (titles.get(r.path) ?? null),
    }))
    result.renamedApart = apart.slice(0, maxPurgePaths)
    result.renamedApartMore = apart.length - result.renamedApart.length
    return result
  }

  /**
   * Step 1: whether anything the repository holds has the text, reachable
   * or not, and every path its history holds (for the plan of new names).
   * The history is read once as fast-export gives it (each blob and commit
   * once, each path once); objects no branch reaches are read whole. With
   * `revisions`, only what they add is read (a push during the scan).
   */
  const holdsAnywhere = async (
    gitDir: string,
    scanner: PurgeScanner,
    revisions?: string[],
  ) => {
    let found = false
    const paths = new Set<string>()
    if (revisions && !revisions.some((r) => !r.startsWith("^")))
      return { found, paths }
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
        if (item.kind === "commit")
          for (const c of item.changes)
            if (c.op !== "deleteall") paths.add(c.path.toString("utf8"))
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
      { timeoutMs: processMs, revisions },
    )
    if (revisions) {
      // New branch names, even of commits the history had.
      for (const r of revisions)
        if (r.startsWith("refs/heads/") && r !== "refs/heads/main")
          found ||= nameHolds(Buffer.from(r))
      return { found, paths }
    }
    if (found) return { found, paths }
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
    return { found, paths }
  }

  /** A new, empty repository in `folder` for a purge's rewrite, with its plan. */
  const startRewrite = async (
    workspaceId: string,
    folder: string,
    scanner: PurgeScanner,
    paths: Iterable<string>,
  ): Promise<Rewrite> => {
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
    const plan = new PathPlan((name) => scanner.rename(name))
    plan.add(paths)
    return {
      folder,
      fresh,
      scanner,
      plan,
      branches: new Map(),
      holding: new Set(),
      counts: { commits: 0, files: new Set(), messages: 0 },
      commits: new Map(),
      checked: new Set(),
      names: new Set(),
      written: new Set(),
      pathCache: new Map(),
      source: [],
      refs: [],
    }
  }

  /**
   * Steps 2 and 3: the history rewritten into the rewrite's repository, and
   * checked. `again`: only what the repository gained since the last call,
   * with the same marks, names and plan (review of #197), so a push during
   * the rewrite costs seconds under the lock, not a whole rewrite. Throws
   * `PlanConflict` when a pushed path needs a name the plan gave away.
   */
  const rewriteMore = async (
    state: Rewrite,
    target: string,
    again: boolean,
  ) => {
    const { scanner, plan } = state
    const source = await refsWithCommits(git, target)
    extendBranchNames(
      state.branches,
      source.map((r) => r.ref),
      (ref) => scanner.rename(ref),
    )
    const idName = (plain: string) => plan.idName(plain)
    const change = async (item: HistoryItem): Promise<HistoryItem> => {
      await scanner.pause()
      if (item.kind === "blob") {
        const data = scanner.replace(item.data, purgeMarker, idName)
        if (data !== item.data) state.holding.add(item.mark)
        return { ...item, data }
      }
      const ref = state.branches.get(item.ref) ?? item.ref
      if (item.kind === "reset") return { ...item, ref }
      const changed = rewriteCommit(scanner, item, state, idName)
      if (changed.messages) state.counts.messages++
      if (changed.held) state.counts.commits++
      return { ...changed.commit, ref }
    }
    const written = await rewriteHistory(git, target, state.fresh, change, {
      temporaryDir: state.folder,
      timeoutMs: processMs,
      again,
    })
    for (const [old, now] of written.commits) state.commits.set(old, now)
    if (again) {
      // Each branch where the repository has it now, under its new name;
      // branches deleted meanwhile go.
      const lines: string[] = []
      const kept = new Set<string>()
      for (const { ref, commit } of source) {
        const now = state.commits.get(commit)
        const name = state.branches.get(ref)
        if (!now || !name)
          throw new Error("A purge's rewrite lost track of a branch")
        kept.add(name)
        lines.push(`update ${name} ${now}`)
      }
      for (const { ref } of await refsWithCommits(git, state.fresh))
        if (!kept.has(ref)) lines.push(`delete ${ref}`)
      await git.run(["update-ref", "--stdin"], {
        gitDir: state.fresh,
        input: `${lines.join("\n")}\n`,
      })
    }
    // Step 3, for what is new: every blob and commit, each path's names
    // (trees are made by fast-import from them), and every branch name.
    const leftOver = () =>
      new Error("A purge's new repository still holds the text")
    const objects = await listObjects(git, state.fresh, {
      timeoutMs: processMs,
    })
    const readable: string[] = []
    for (const [oid, type] of objects) {
      if (state.checked.has(oid)) continue
      state.checked.add(oid)
      if (type !== "tree") readable.push(oid)
    }
    await readObjects(
      git,
      state.fresh,
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
    for (const path of state.written)
      for (const name of path.split("/")) {
        if (state.names.has(name)) continue
        state.names.add(name)
        if (scanner.holds(Buffer.from(name, "utf8"))) throw leftOver()
      }
    state.source = source
    state.refs = await refsWithCommits(git, state.fresh)
    for (const { ref } of state.refs)
      if (scanner.holds(Buffer.from(ref))) throw leftOver()
    state.objects = objects
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
      // Catalog IDs named apart from another page's: their plain form (the
      // text as `purged`) and new ID, so `web` names them the same way.
      ids: record.ids ?? [],
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
    const times = { scan: 0, rewrite: 0, again: 0, locked: 0 }
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
        times.locked += performance.now() - locked
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

    running.add(workspaceId)
    try {
      let before = await refsWithCommits(git, target)
      const scan = await holdsAnywhere(target, scanner)
      times.scan = performance.now() - started
      const paths = scan.paths
      if (!scan.found) {
        // Nothing held it when read. Under the lock, what was pushed
        // meanwhile is read too (review of #197): only if that holds none
        // either is the answer "nothing".
        const outcome = await withLock(async () => {
          const now = await refsWithCommits(git, target)
          if (refsKey(now) !== refsKey(before)) {
            const more = await holdsAnywhere(
              target,
              scanner,
              since(before, now),
            )
            for (const path of more.paths) paths.add(path)
            if (more.found) return "rewrite"
          }
          cleanRecords()
          return "none"
        })
        if (outcome === "none") return result
        before = []
      }
      const rewriting = performance.now()
      let state: Rewrite | undefined
      for (let attempt = 1; !state; attempt++) {
        const made = await startRewrite(workspaceId, folder, scanner, paths)
        try {
          await rewriteMore(made, target, false)
          state = made
        } catch (error) {
          if (!(error instanceof PlanConflict) || attempt >= 3) throw error
          for (const path of (await holdsAnywhere(target, scanner)).paths)
            paths.add(path)
        }
      }
      times.rewrite = performance.now() - rewriting
      return await withLock(async () => {
        let p: Rewrite = state
        // A push moved a branch meanwhile: only what it added is rewritten.
        const again = performance.now()
        if (refsKey(await refsWithCommits(git, target)) !== refsKey(p.source))
          try {
            await rewriteMore(p, target, true)
            times.again = performance.now() - again
          } catch (error) {
            if (!(error instanceof PlanConflict)) throw error
            // Rare: a pushed path keeps a name the plan gave away. Planned
            // and rewritten again, whole, with the lock held.
            for (const path of (await holdsAnywhere(target, scanner)).paths)
              paths.add(path)
            p = await startRewrite(workspaceId, folder, scanner, paths)
            await rewriteMore(p, target, false)
          }
        cleanRecords(p.branches)
        const commits = new Set<string>()
        for (const [oid, type] of p.objects ?? [])
          if (type === "commit") commits.add(oid)
        const removed: string[] = []
        for (const [oid, type] of await listObjects(git, target, {
          timeoutMs: processMs,
        }))
          if (type === "commit" && !commits.has(oid)) removed.push(oid)
        const record: PurgeRecord = {
          purgeId: input.purgeId,
          phase: "swapping",
          at: new Date().toISOString(),
          textHash: records.textHash(scanner.purgeText),
          rewritten: [...p.commits].filter(([old, now]) => old !== now),
          removed,
          refs: p.refs,
          renamedBranches: [...p.branches].filter(([a, b]) => a !== b).length,
          ids: p.plan.renamedIds(),
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
      running.delete(workspaceId)
      log(
        `Purge ${input.purgeId}: ${seconds(performance.now() - started)} s in all (scan ${seconds(times.scan)} s, rewrite ${seconds(times.rewrite)} s${times.again ? `, what was pushed meanwhile ${seconds(times.again)} s` : ""}); pushes held back ${seconds(times.locked)} s`,
      )
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
                ? "The text is already gone from the catalog's history. Shinan is still finishing its own records and tries again every minute; agents' pushes wait until then. You can leave this page."
                : "Shinan could not remove the text: nothing was changed; try again",
        }
        job.at = Date.now()
      },
    )
    return status
  }

  /**
   * Where a purge stands. Its record goes first once it has one, so a
   * purge that failed after its swap and was finished later (`keepFinishing`)
   * says `done`, not the failure (review of #197); while it is unfinished it
   * is `running`, with why it takes so long.
   */
  const status: Purges["status"] = (workspaceId, purgeId) => {
    const job = jobs.get(purgeId)
    const followed = job?.workspaceId === workspaceId ? job.status : undefined
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
      return followed?.state === "failed"
        ? { purgeId, state: "running", message: followed.message }
        : { purgeId, state: "running" }
    return followed ?? { purgeId, state: "unknown" }
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
      // Only a rewrite `web` has not recorded keeps its text's hash.
      const record = records.purge(workspaceId, purgeId)
      return (
        record?.phase === "done" &&
        record.textHash !== undefined &&
        record.textHash === records.textHash(new PurgeScanner(text).purgeText)
      )
    },
    forgetText: (workspaceId, purgeId) => {
      const record = records.purge(workspaceId, purgeId)
      if (record?.phase !== "done" || record.textHash === undefined) return
      const rest: PurgeRecord = { ...record }
      delete rest.textHash
      records.writePurge(workspaceId, rest)
    },
    running: (workspaceId) => running.has(workspaceId),
    run,
    recover,
    keepFinishing,
  }
}

/** A purge's rewrite in progress: its repository, plan and what it has done. */
interface Rewrite {
  folder: string
  /** The new repository. */
  fresh: string
  scanner: PurgeScanner
  plan: PathPlan
  /** Each branch's new name. */
  branches: Map<string, string>
  /** Marks of blobs that held the text. */
  holding: Set<number>
  counts: { commits: number; files: Set<string>; messages: number }
  /** Every commit rewritten, by its old ID, with its new one. */
  commits: Map<string, string>
  /** Objects of the new repository already checked. */
  checked: Set<string>
  /** Path names already checked. */
  names: Set<string>
  /** Every path written. */
  written: Set<string>
  /** Each path's new name (null: unchanged), by its bytes. */
  pathCache: Map<string, Buffer | null>
  /** The branches of the repository it was made from, at its last call. */
  source: { ref: string; commit: string }[]
  /** The branches of the new repository. */
  refs: { ref: string; commit: string }[]
  /** The new repository's objects, by type. */
  objects?: Map<string, string>
}

/** What to read for what `now`'s branches add to `before`'s. */
function since(
  before: { ref: string; commit: string }[],
  now: { ref: string; commit: string }[],
): string[] {
  const old = new Set(before.map((r) => r.commit))
  const known = new Set(before.map((r) => `${r.ref} ${r.commit}`))
  return [
    ...now.filter((r) => !known.has(`${r.ref} ${r.commit}`)).map((r) => r.ref),
    ...[...old].map((c) => `^${c}`),
  ]
}

/** New branches' names, added to `names` (`branchNames`), never one already given. */
function extendBranchNames(
  names: Map<string, string>,
  refs: readonly string[],
  rename: (ref: string) => string,
): void {
  const fresh = refs.filter((r) => !names.has(r))
  if (fresh.length === 0) return
  const taken = new Set([...names.values(), ...names.keys(), ...refs])
  for (const [ref, name] of branchNames(fresh, rename, taken))
    names.set(ref, name)
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

/**
 * Each ref's name after the purge: the text replaced in branch names
 * (`main` keeps its name whatever it holds), and a name that would be
 * invalid or taken made unique (`purged-2`, …).
 */
export function branchNames(
  refs: readonly string[],
  rename: (ref: string) => string,
  taken: Set<string> = new Set(refs),
): Map<string, string> {
  const names = new Map<string, string>()
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
 * or identities. Each path gets its name from the plan (`PathPlan`),
 * looked up once however many commits name it; the names written are kept
 * (`written`) for the check.
 */
function rewriteCommit(
  scanner: PurgeScanner,
  commit: HistoryCommit,
  state: Rewrite,
  idName: (plain: string) => string,
): { commit: HistoryCommit; held: boolean; messages: boolean } {
  const identity = (value: Buffer | null) => {
    if (!value) return value
    const parts = splitIdentity(value)
    const name = scanner.replace(parts.name, purgeMarker)
    const email = scanner.replace(parts.email, purgeMarker)
    if (name === parts.name && email === parts.email) return value
    return joinIdentity({ name, email, when: parts.when })
  }
  const message = scanner.replace(commit.message, purgeMarker, idName)
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
    let known = state.pathCache.get(key)
    if (known === undefined) {
      const original = change.path.toString("utf8")
      const now = state.plan.path(original)
      known = now === original ? null : Buffer.from(now, "utf8")
      state.pathCache.set(key, known)
      state.written.add(now)
    }
    const inName = known !== null
    const path = known ?? change.path
    const inContent =
      change.op === "M" && state.holding.has(markNumber(change.dataref))
    if (inName || inContent) {
      held = true
      state.counts.files.add(path.toString("utf8"))
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
