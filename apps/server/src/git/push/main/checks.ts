import {
  isEntityId,
  maxDocumentBytes as maxReadDocumentBytes,
  parseCatalogDocument,
  readCatalog,
  slugPattern,
  typeNamePattern,
  validateChange,
} from "@shinan/core"
import type {
  CatalogDocument,
  EntityDocument,
  FactGroup,
  WrittenFact,
} from "@shinan/core"
import { createGit, objectName, openCatFile } from "@shinan/git"
import type { CatFile, Git } from "@shinan/git"

import { shown } from "../checks.js"
import type { Problem } from "../checks.js"

/**
 * The checks of a push that changes `main` (Git-based catalog plan §2.5,
 * checks 4 to 7), on the tree of its new commit against the old one. They
 * run in a worker thread of the `git` role (`pool.ts`), with a time limit
 * and a heap limit, reading objects through the push's quarantine.
 */
export interface MainCheckInput {
  /** The `git` program and the empty folder it sees as `HOME`. */
  gitBinary: string
  gitHome: string
  gitDir: string
  /** The push's quarantine variables. */
  env: Record<string, string>
  /** `main` before the push and after it (a fast-forward). */
  from: string
  to: string
  /** The time "not in the future" is judged against, in milliseconds. */
  now: number
  /** The workspace's member handles, for owners' warnings. */
  memberHandles: string[]
  /**
   * The first pusher of each commit the push adds to `main`, in the written
   * form the `by` rule expects; null if none is on record.
   */
  firstPushers: Record<string, string | null>
  /** The fact check groups ever on `main` (the revert rule). */
  groupsEver: MainGroup[]
  limits: { documents: number; textBytes: number }
}

/**
 * A fact check group as it was on `main`: the document (its ID), the
 * check's five fields and the facts it covered, each as a key that holds
 * its value.
 */
export interface MainGroup {
  document: string
  check: string
  facts: string[]
}

export interface MainCheckOutput {
  problems: Problem[]
  warnings: Problem[]
  /** The groups of the new `main` not on record yet, to record once it is applied. */
  groups: MainGroup[]
}

/** One file of a tree. */
interface TreeFile {
  path: string
  mode: string
  type: string
  oid: string
  size: number
}

/**
 * Parsed documents by blob ID, kept between pushes: a blob's text never
 * changes, so a push parses only the documents it changes. At most
 * `cacheBytes` of text.
 */
const cache = new Map<string, CatalogDocument>()
let cachedBytes = 0
const cacheBytes = 64 * 1024 * 1024

const maxDocumentBytes = 2 * 1024 * 1024

/**
 * Reads, checks and validates `main`'s new tree against its old one:
 *
 * 4. **Layout:** only `README.md`, `start-here.md`, `schema/<type>.md` and
 *    `<type>/<slug>.md` (lower-case letters, digits and dashes, so no
 *    upper case and no hidden or right-to-left characters), as regular
 *    files that are not executable; each document's ID is its path; no ID
 *    or alias that resolved before has gone; at most 20,000 documents and
 *    50 MiB of text.
 * 5. **Validation** of the new catalog, charged to the push: every
 *    blocking problem in the documents it adds or changes, and any problem
 *    it newly causes elsewhere. Secret-looking values are check 3's.
 * 6. **The `by` rule (D-066):** a new or changed fact check must name the
 *    first pusher of every commit that introduced it among those the push
 *    adds to `main`. A group as it was on `main` before (unchanged, or
 *    restored by a revert) introduces nothing.
 * 7. **Warnings** of validation are printed and do not block.
 */
export async function checkMain(
  input: MainCheckInput,
): Promise<MainCheckOutput> {
  const git = createGit({
    binary: input.gitBinary,
    home: input.gitHome,
    timeoutMs: 120_000,
    maxOutputBytes: 64 * 1024 * 1024,
  })
  const reader = openCatFile(git, input.gitDir, {
    env: input.env,
    maxObjectBytes: maxDocumentBytes,
  })
  const problems: Problem[] = []
  const warnings: Problem[] = []
  try {
    const before = await treeFiles(git, input, input.from)
    const after = await treeFiles(git, input, input.to)

    // 4. Layout.
    for (const file of after) {
      const why = layoutProblem(file)
      if (why)
        problems.push({
          code: "path-not-allowed",
          where: shownPath(file.path),
          message: why,
        })
    }
    const documentsAfter = after.filter(isDocumentFile)
    const documentsBefore = before.filter(isDocumentFile)
    const textBytes = documentsAfter.reduce((n, f) => n + f.size, 0)
    if (
      documentsAfter.length > input.limits.documents ||
      textBytes > input.limits.textBytes
    ) {
      problems.push({
        code: "catalog-too-large",
        where: "",
        message: `over the catalog's limits: ${documentsAfter.length.toLocaleString("en")} documents, ${(textBytes / 1024 / 1024).toFixed(1)} MiB (at most ${input.limits.documents.toLocaleString("en")}, ${input.limits.textBytes / 1024 / 1024} MiB)`,
      })
      return { problems, warnings, groups: [] }
    }

    const read = (file: TreeFile) => documentOf(reader, file)
    const oldDocs = new Map<string, CatalogDocument>()
    for (const file of documentsBefore) oldDocs.set(file.path, await read(file))
    const newDocs = new Map<string, CatalogDocument>()
    for (const file of documentsAfter) newDocs.set(file.path, await read(file))

    // Each document's ID is its path.
    for (const [path, document] of newDocs) {
      const expected = path.slice(0, -".md".length)
      if (document.id !== null && document.id !== expected) {
        problems.push({
          code: "path-id-mismatch",
          where: shownPath(path),
          message: `its id is ${quoted(document.id)}: a document's path is its id plus .md`,
        })
      }
    }

    // No ID or alias that resolved before has gone.
    const resolving = (documents: Iterable<CatalogDocument>) => {
      const ids = new Set<string>()
      for (const document of documents) {
        if (document.id !== null) ids.add(document.id)
        if (document.kind === "entity")
          for (const alias of document.aliases) ids.add(alias)
      }
      return ids
    }
    const now = resolving(newDocs.values())
    for (const id of resolving(oldDocs.values())) {
      if (!now.has(id)) {
        problems.push({
          code: "id-disappeared",
          where: shownPath(`${id}.md`),
          message: `${quoted(id)} no longer resolves: retire the document, or keep the old id in aliases`,
        })
      }
    }

    // 5 and 7. Validation, charged to the push.
    const blobBefore = new Map(documentsBefore.map((f) => [f.path, f.oid]))
    const changed = documentsAfter
      .filter((f) => blobBefore.get(f.path) !== f.oid)
      .map((f) => newDocs.get(f.path)!)
    const pathById = new Map<string, string>()
    for (const [path, document] of newDocs)
      if (document.id !== null && !pathById.has(document.id))
        pathById.set(document.id, path)
    const result = validateChange(
      {
        before: readCatalog(oldDocs.values()),
        after: readCatalog(newDocs.values()),
        changed,
      },
      { now: input.now, memberHandles: new Set(input.memberHandles) },
    )
    for (const problem of result.problems) {
      // Secret-looking values are check 3's, which knows the owners'
      // allowed values and shows fingerprints.
      if (problem.code === "secret" || problem.code === "secret-suspected")
        continue
      const path =
        problem.documentId === null
          ? null
          : (pathById.get(problem.documentId) ?? null)
      const document = path === null ? undefined : newDocs.get(path)
      const where =
        path === null
          ? ""
          : `${shownPath(path)}${problem.range && document ? `:${lineAt(document.text, problem.range.start)}` : ""}`
      ;(problem.severity === "blocking" ? problems : warnings).push({
        code: problem.code,
        where,
        message: problem.message,
      })
    }

    // 6. The `by` rule.
    const groupsBefore = new Map<string, MainGroup[]>()
    for (const document of oldDocs.values())
      if (document.kind === "entity" && document.id !== null)
        groupsBefore.set(document.id, groupsOf(document))
    const ever = new Map<string, MainGroup[]>()
    for (const group of input.groupsEver) {
      const list = ever.get(group.document) ?? []
      list.push(group)
      ever.set(group.document, list)
    }
    const covers = (held: MainGroup, group: MainGroup) =>
      held.check === group.check &&
      group.facts.every((fact) => held.facts.includes(fact))
    for (const [path, document] of newDocs) {
      if (document.kind !== "entity" || document.id === null) continue
      const names = [document.id, ...document.aliases]
      const pending: { group: MainGroup; written: FactGroup; by: string }[] = []
      for (const [i, group] of groupsOf(document).entries()) {
        const written = document.groups.filter((g) => g.check !== null)[i]!
        const by = written.check?.by
        if (by === undefined) continue
        const before = names.flatMap((name) => groupsBefore.get(name) ?? [])
        if (before.some((held) => covers(held, group))) continue
        const restored = names.flatMap((name) => ever.get(name) ?? [])
        if (restored.some((held) => covers(held, group))) continue
        pending.push({ group, written, by })
      }
      if (pending.length === 0) continue
      for (const finding of await introducing(
        git,
        reader,
        input,
        names,
        pending.map((p) => p.group),
      )) {
        const { by, written } = pending[finding.index]!
        const pusher = input.firstPushers[finding.commit] ?? null
        if (pusher === by) continue
        const shownBy = /^[a-z0-9-]{1,100}( via [a-z0-9-]{1,100})?$/.test(by)
          ? `"by: ${by}"`
          : "its by"
        problems.push({
          code: "by-not-first-pusher",
          where: `${shownPath(path)}:${lineAt(document.text, written.range.start)}`,
          message:
            pusher === null
              ? `${shownBy} but commit ${finding.commit.slice(0, 7)} has no first pusher on record`
              : `${shownBy} but commit ${finding.commit.slice(0, 7)} was first pushed by "${pusher}"`,
        })
      }
    }

    // The groups now on `main`, for the revert rule's record. The first
    // time, those of the old `main` too: they were on `main` before.
    const groups: MainGroup[] = []
    const known = new Set(input.groupsEver.map(groupKey))
    const add = (documents: Iterable<CatalogDocument>) => {
      for (const document of documents) {
        if (document.kind !== "entity" || document.id === null) continue
        for (const group of groupsOf(document)) {
          const key = groupKey(group)
          if (known.has(key)) continue
          known.add(key)
          groups.push(group)
        }
      }
    }
    if (input.groupsEver.length === 0) add(oldDocs.values())
    add(newDocs.values())
    return { problems, warnings, groups }
  } finally {
    await reader.close()
  }
}

/**
 * For each of `groups` (of one document, known by any of `names`), the
 * commits among those the push adds to `main` that introduce it: whose
 * version of the document holds it while none of their parents' versions
 * does. Merges included, so a group written while resolving a conflict is
 * introduced by the merge.
 */
async function introducing(
  git: Git,
  reader: CatFile,
  input: MainCheckInput,
  names: string[],
  groups: MainGroup[],
): Promise<{ index: number; commit: string }[]> {
  const paths = names
    .map((name) => `${name}.md`)
    .filter((path) => !layoutProblem({ path, mode: "100644", type: "blob" }))
  if (paths.length === 0) return []
  const listed = (
    await git.run(
      [
        "rev-list",
        "--full-history",
        "--parents",
        `${input.from}..${input.to}`,
        "--",
        ...paths,
      ],
      { gitDir: input.gitDir, env: input.env },
    )
  ).stdout.toString("utf8")
  const versions = new Map<string, MainGroup[] | null>()
  const version = async (commit: string) => {
    if (versions.has(commit)) return versions.get(commit)!
    let found: MainGroup[] | null = null
    for (const path of paths) {
      const info = await reader.info(objectName(commit, path))
      if (!info || info.type !== "blob") continue
      const document = await documentOf(reader, {
        path,
        mode: "100644",
        type: "blob",
        oid: info.oid,
        size: info.size,
      })
      found = document.kind === "entity" ? groupsOf(document) : []
      break
    }
    versions.set(commit, found)
    return found
  }
  const holds = (held: MainGroup[] | null, group: MainGroup) =>
    held?.some(
      (h) =>
        h.check === group.check &&
        group.facts.every((fact) => h.facts.includes(fact)),
    ) ?? false
  const found: { index: number; commit: string }[] = []
  for (const line of listed.split("\n")) {
    if (line === "") continue
    const [commit, ...parents] = line.split(" ")
    const mine = await version(commit!)
    if (!mine) continue
    for (const [index, group] of groups.entries()) {
      if (!holds(mine, group)) continue
      let inParent = false
      for (const parent of parents) {
        if (holds(await version(parent), group)) {
          inParent = true
          break
        }
      }
      if (!inParent) found.push({ index, commit: commit! })
    }
  }
  return found
}

/** A document's fact check groups, with what makes each the same group. */
function groupsOf(document: EntityDocument): MainGroup[] {
  return document.groups
    .filter((g) => g.check !== null)
    .map((g) => {
      const check = g.check!
      return {
        document: document.id!,
        check: JSON.stringify([
          check.checked === null ? null : (check.checked?.text ?? undefined),
          check.by,
          check.scope,
          check.source,
          check.limits,
        ]),
        facts: document.facts
          .filter((f) => f.group === g.index)
          .map(factKey)
          .sort(),
      }
    })
}

/** A fact as a group covers it: its key, state and value, whatever its place. */
function factKey(fact: WrittenFact): string {
  return JSON.stringify([
    fact.key,
    fact.state,
    fact.value ?? null,
    fact.to ?? null,
    fact.via ?? null,
    fact.note ?? null,
    fact.task ?? null,
    fact.remove,
    fact.accepted ?? null,
    Object.entries(fact.attributes).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
  ])
}

function groupKey(group: MainGroup): string {
  return JSON.stringify([group.document, group.check, group.facts])
}

/** Why a file may not be on `main` (plan §2.1), or null. */
export function layoutProblem(
  file: Pick<TreeFile, "path" | "mode" | "type">,
): string | null {
  if (file.type !== "blob" || file.mode === "120000" || file.mode === "160000")
    return "only files belong on main"
  if (file.mode !== "100644")
    return "an executable file: main holds only plain files"
  const { path } = file
  if (path === "README.md" || path === "start-here.md") return null
  const match = /^([^/]+)\/([^/]+)\.md$/.exec(path)
  if (match) {
    const [, folder, name] = match
    if (
      folder === "schema"
        ? typeNamePattern.test(name!)
        : typeNamePattern.test(folder!) &&
          slugPattern.test(name!) &&
          isEntityId(`${folder}/${name}`)
    )
      return null
  }
  return "not a page path: main holds <type>/<slug>.md in a-z, 0-9 and -"
}

function isDocumentFile(file: TreeFile): boolean {
  return (
    file.path.endsWith(".md") &&
    file.path !== "README.md" &&
    !layoutProblem(file)
  )
}

async function treeFiles(
  git: Git,
  input: MainCheckInput,
  commit: string,
): Promise<TreeFile[]> {
  const { stdout } = await git.run(
    ["ls-tree", "-r", "-z", "-l", "--full-tree", commit],
    { gitDir: input.gitDir, env: input.env },
  )
  const files: TreeFile[] = []
  for (const record of stdout.toString("utf8").split("\0")) {
    if (record === "") continue
    const tab = record.indexOf("\t")
    const [mode, type, oid, size] = record.slice(0, tab).split(/ +/)
    files.push({
      path: record.slice(tab + 1),
      mode: mode!,
      type: type!,
      oid: oid!,
      size: Number(size) || 0,
    })
  }
  return files
}

async function documentOf(
  reader: CatFile,
  file: TreeFile,
): Promise<CatalogDocument> {
  const cached = cache.get(file.oid)
  if (cached) {
    // Most recently used last.
    cache.delete(file.oid)
    cache.set(file.oid, cached)
    return cached
  }
  const object = await reader.read(file.oid)
  const text = typeof object === "string" ? "" : object.content.toString("utf8")
  const document = parseCatalogDocument(
    typeof object === "string" ? tooLarge() : text,
  )
  cache.set(file.oid, document)
  cachedBytes += text.length
  for (const [oid, kept] of cache) {
    if (cachedBytes <= cacheBytes) break
    cache.delete(oid)
    cachedBytes -= kept.text.length
  }
  return document
}

/** Text that reads as too large (`too-large`), for a file too large to read at all. */
function tooLarge(): string {
  return "x".repeat(maxReadDocumentBytes + 1)
}

function lineAt(text: string, offset: number): number {
  let line = 1
  for (
    let i = text.indexOf("\n");
    i >= 0 && i < offset;
    i = text.indexOf("\n", i + 1)
  )
    line++
  return line
}

/** An ID as text to show: quoted, cut short, and only if it is plain. */
function quoted(value: string): string {
  const short = value.length > 80 ? `${value.slice(0, 80)}…` : value
  return /^[\x20-\x7e]*$/.test(short)
    ? JSON.stringify(short)
    : "(not shown: it holds unusual characters)"
}

function shownPath(path: string): string {
  return shown(path)
}
