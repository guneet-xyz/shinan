/**
 * What a purge renames, planned before the rewrite (review of #197): each
 * path, folder and catalog ID that holds the text gets its new name once,
 * the same in every commit, and never one that another page or folder of
 * the history has. A file or folder whose new name is taken gets a number,
 * as a branch does: `machine/purged-box.md` beside an existing one becomes
 * `machine/purged-box-2.md`, and its ID `machine/purged-box-2`, wherever it
 * is written.
 *
 * The plan is made from every path the history holds (`add`). Names are
 * given folder by folder: in each, the names that keep their form first,
 * then the new ones, in order. A path added later (a push during the
 * rewrite) can only take a name nothing has: if a name it keeps is one the
 * plan gave away, `add` says so (`PlanConflict`), and the rewrite starts
 * again from a new plan.
 */
export class PathPlan {
  /** Each folder's names, by the folder's path as the history holds it ("" for the top). */
  private readonly folders = new Map<
    string,
    { names: Map<string, string>; taken: Set<string> }
  >()
  /** Every page's ID after the purge. */
  private readonly ids = new Set<string>()
  /** Plain ID (the text as `purged`) to the ID it gets, where they differ. */
  private readonly idNames = new Map<string, string>()
  /** Plain IDs of pages the plan renamed: they keep the name their page got. */
  private readonly pageIds = new Set<string>()
  /** Plain IDs already answered as themselves, which a later path must not take. */
  private readonly answered = new Set<string>()
  /** Renamed paths whose name had to be made unique: their plain path and new path. */
  private readonly apart = new Map<string, string>()

  constructor(private readonly rename: (name: string) => string) {}

  /** Adds the paths the history holds; throws `PlanConflict` when one can't keep its name. */
  add(paths: Iterable<string>): void {
    const fresh: string[][] = []
    for (const path of paths) {
      if (this.known(path)) continue
      fresh.push(path.split("/"))
    }
    if (fresh.length === 0) return
    // Folder by folder, from the top: a folder's new name is known before
    // its contents get theirs.
    const depth = Math.max(...fresh.map((p) => p.length))
    for (let level = 0; level < depth; level++) {
      const wanted = new Map<string, Set<string>>()
      for (const parts of fresh) {
        if (parts.length <= level) continue
        const parent = parts.slice(0, level).join("/")
        let names = wanted.get(parent)
        if (!names) wanted.set(parent, (names = new Set()))
        names.add(parts[level]!)
      }
      for (const [parent, names] of wanted) {
        const folder = this.folder(parent)
        const ordered = [...names].filter((n) => !folder.names.has(n)).sort()
        // Names that keep their form first, so a renamed one never takes one.
        for (const name of ordered) {
          if (this.rename(name) !== name) continue
          if (folder.taken.has(name)) throw new PlanConflict()
          folder.names.set(name, name)
          folder.taken.add(name)
        }
        for (const name of ordered) {
          const plain = this.rename(name)
          if (plain === name) continue
          let next = plain
          for (let n = 2; folder.taken.has(next); n++) next = numbered(plain, n)
          folder.names.set(name, next)
          folder.taken.add(next)
        }
      }
    }
    for (const parts of fresh) {
      const original = parts.join("/")
      const now = this.path(original)
      if (!now.endsWith(".md")) continue
      const id = now.slice(0, -3)
      const plain = parts.map((p) => this.rename(p)).join("/")
      const plainId = plain.slice(0, -3)
      // An ID already written for another page or an alias, before this
      // page was known, would now name two things.
      if (
        (plain === original && this.answered.has(id)) ||
        (plainId !== id && this.answered.has(plainId))
      )
        throw new PlanConflict()
      this.ids.add(id)
      if (plain === original) continue
      this.pageIds.add(plainId)
      if (plain !== now) {
        this.idNames.set(plainId, id)
        this.apart.set(plain, now)
      }
    }
  }

  /** Whether the plan holds a name for every part of `path`. */
  private known(path: string): boolean {
    const parts = path.split("/")
    let parent = ""
    for (const part of parts) {
      const folder = this.folders.get(parent)
      if (!folder?.names.has(part)) return false
      parent = parent === "" ? part : `${parent}/${part}`
    }
    return true
  }

  private folder(parent: string) {
    let folder = this.folders.get(parent)
    if (!folder)
      this.folders.set(
        parent,
        (folder = { names: new Map(), taken: new Set() }),
      )
    return folder
  }

  /** `path`'s name after the purge; a path the plan doesn't hold is added. */
  path(original: string): string {
    if (!this.known(original)) this.add([original])
    const parts = original.split("/")
    const out: string[] = []
    let parent = ""
    for (const part of parts) {
      out.push(this.folders.get(parent)!.names.get(part)!)
      parent = parent === "" ? part : `${parent}/${part}`
    }
    return out.join("/")
  }

  /**
   * The ID a catalog ID holding the text gets, from its plain form: a
   * renamed page's new ID; for another ID (an alias, a link to no page)
   * that would now name another page, a numbered one; otherwise the plain
   * form itself.
   */
  idName(plain: string): string {
    const named = this.idNames.get(plain)
    if (named !== undefined) return named
    if (this.pageIds.has(plain) || !this.ids.has(plain)) {
      this.answered.add(plain)
      return plain
    }
    let next = plain
    for (let n = 2; this.ids.has(next) || this.answered.has(next); n++)
      next = `${plain}-${n}`
    this.idNames.set(plain, next)
    this.answered.add(next)
    return next
  }

  /** Paths renamed apart from another one: the name the text alone would give, and the one given. */
  renamedApart(): { plain: string; path: string }[] {
    return [...this.apart]
      .map(([plain, path]) => ({ plain, path }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  /** Each catalog ID named apart: its plain form and its new ID. Neither holds the text. */
  renamedIds(): [string, string][] {
    return [...this.idNames].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  }
}

/** A path added during a rewrite can't keep its name: the rewrite starts again. */
export class PlanConflict extends Error {
  constructor() {
    super("A path pushed during a purge needs a name the purge gave away")
  }
}

/** `name` with `-n` before its extension: `purged-box.md` → `purged-box-2.md`. */
function numbered(name: string, n: number): string {
  const dot = name.lastIndexOf(".")
  return dot > 0
    ? `${name.slice(0, dot)}-${n}${name.slice(dot)}`
    : `${name}-${n}`
}
