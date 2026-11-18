import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The skill's ID. OpenCode names a skill from an HTTP catalog after the
 * directory its files are fetched from (`<base>/shinan/<file>`), so this is
 * the ID agents load.
 */
export const skillName = "shinan"

/**
 * Where the skill's Markdown lives in this package: `skill/shinan/`, one
 * level above both `src/` and the built `dist/`.
 */
export const skillDirectory = fileURLToPath(
  new URL(`../skill/${skillName}/`, import.meta.url),
)

/**
 * Limits on what the catalog may hold (**proposed**, M2-9). The skill is a
 * few short Markdown files; the limits only make a mistake, such as a large
 * file copied into the folder, fail when the server starts rather than be
 * served to everyone.
 */
export const skillLimits = {
  files: 20,
  fileBytes: 64 * 1024,
  totalBytes: 256 * 1024,
} as const

/**
 * A relative path of Markdown files and folders made only of letters,
 * digits and hyphens: nothing hidden, no `..`, no encoding to get wrong.
 */
const safePath = /^(?:[a-z0-9][a-z0-9-]*\/){0,2}[A-Za-z0-9][A-Za-z0-9-]*\.md$/

export interface SkillSourceFile {
  /** Relative to the skill's folder, with `/`, such as `references/reading.md`. */
  path: string
  body: Uint8Array
}

export interface ServedFile {
  body: Uint8Array<ArrayBuffer>
  contentType: string
  /** A strong validator: a hash of the body, quoted. */
  etag: string
}

export interface SkillCatalog {
  /** Changes whenever any file's name or content changes. */
  version: string
  /**
   * Every file served, by its path below the catalog's base: `index.json`
   * and `shinan/<file>`. Nothing else is served.
   */
  files: ReadonlyMap<string, ServedFile>
}

export class SkillCatalogError extends Error {
  override name = "SkillCatalogError"
}

/**
 * Builds the HTTP skill catalog OpenCode reads
 * ([OpenCode skills](https://opencode.ai/docs/skills), "Catalogs"):
 * `index.json` lists the one skill, its version and its files, and each
 * file is served below the skill's name. The version is a hash of every
 * file's path and content, so it changes exactly when the files do, and
 * OpenCode refreshes its copy; nobody has to remember to raise it.
 */
export function buildSkillCatalog(
  sources: readonly SkillSourceFile[],
): SkillCatalog {
  if (sources.length > skillLimits.files)
    throw new SkillCatalogError(
      `The skill has more than ${skillLimits.files} files`,
    )
  const sorted = [...sources].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )
  const decoder = new TextDecoder("utf-8", { fatal: true })
  const hash = createHash("sha256")
  let total = 0
  for (const { path, body } of sorted) {
    if (!safePath.test(path))
      throw new SkillCatalogError(
        `The skill file ${JSON.stringify(path)} is not a plain Markdown path`,
      )
    if (body.byteLength > skillLimits.fileBytes)
      throw new SkillCatalogError(
        `The skill file ${path} is larger than ${skillLimits.fileBytes / 1024} KiB`,
      )
    try {
      decoder.decode(body)
    } catch {
      throw new SkillCatalogError(`The skill file ${path} is not UTF-8`)
    }
    total += body.byteLength
    hash.update(`${path}\0${body.byteLength}\0`).update(body)
  }
  if (total > skillLimits.totalBytes)
    throw new SkillCatalogError(
      `The skill is larger than ${skillLimits.totalBytes / 1024} KiB`,
    )
  if (!sorted.some((s) => s.path === "SKILL.md"))
    throw new SkillCatalogError("The skill has no SKILL.md")

  const version = hash.digest("hex").slice(0, 16)
  // SKILL.md first, as the entry file; then the others in order.
  const paths = [
    "SKILL.md",
    ...sorted.map((s) => s.path).filter((p) => p !== "SKILL.md"),
  ]
  const index = {
    skills: [{ name: skillName, version, files: paths }],
  }
  const files = new Map<string, ServedFile>()
  files.set(
    "index.json",
    served(
      new TextEncoder().encode(JSON.stringify(index, null, 2) + "\n"),
      "application/json; charset=utf-8",
    ),
  )
  for (const { path, body } of sorted)
    files.set(
      `${skillName}/${path}`,
      served(body, "text/markdown; charset=utf-8"),
    )
  return { version, files }
}

function served(source: Uint8Array, contentType: string): ServedFile {
  // A copy: the catalog never shares memory with its sources.
  const body = new Uint8Array(source)
  const digest = createHash("sha256").update(body).digest("base64url")
  return { body, contentType, etag: `"${digest.slice(0, 27)}"` }
}

/**
 * Reads the skill's files from `directory` (by default this package's
 * `skill/shinan/`) and builds the catalog. Anything but plain Markdown
 * files and folders, such as a link or a stray file, is an error, so the
 * server does not start with a catalog it did not mean to serve.
 */
export async function loadSkillCatalog(
  directory: string = skillDirectory,
): Promise<SkillCatalog> {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  })
  const sources: SkillSourceFile[] = []
  for (const entry of entries) {
    const full = join(entry.parentPath, entry.name)
    const path = relative(directory, full).split(sep).join("/")
    if (entry.isDirectory()) continue
    if (!entry.isFile())
      throw new SkillCatalogError(
        `The skill file ${JSON.stringify(path)} is not a plain file`,
      )
    sources.push({ path, body: await readFile(full) })
  }
  return buildSkillCatalog(sources)
}
