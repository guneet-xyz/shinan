import { checkFields } from "./model.js"

/**
 * Names and IDs in catalog documents (catalog §2.4, §3.9, §4.1).
 */

/** A type name: lowercase kebab-case, such as `machine` or `dns-zone`. */
export const typeNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** A slug: lowercase kebab-case, unique within its type. */
export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A fact key: lowercase words joined by `.`, `-` or `_`, such as
 * `disk.data.size`, `docs.agent_instructions` or `checkout-on`.
 */
export const factKeyPattern = /^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/

const objectMembers: ReadonlySet<string> = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  "prototype",
])

/**
 * A fact key (and a type schema's key): `factKeyPattern`, but not the name of
 * a JavaScript object member such as `constructor` or `__proto__`, so code
 * that keeps keys in plain objects (the index, MCP answers) cannot be misled.
 */
export function isFactKey(name: string): boolean {
  return factKeyPattern.test(name) && !objectMembers.has(name)
}

/**
 * A relation attribute name (such as `path`): a fact key, so also never the
 * name of a JavaScript object member.
 */
export function isAttributeName(name: string): boolean {
  return isFactKey(name)
}

/**
 * Long-form fields with their own meaning, which a relation attribute (such
 * as `path`) cannot be named.
 */
export const factOptions: ReadonlySet<string> = new Set([
  "value",
  "to",
  "via",
  "note",
  "task",
  "remove",
  "accepted",
])

/**
 * Names a relation attribute cannot have: the long-form fields
 * (`factOptions`) and a fact check's fields (`checkFields`), so that
 * `{ to: …, by: guneet, checked: 2020-01-01 }` never reads as who checked
 * the fact, or when (catalog §4.3).
 */
export const reservedAttributeNames: ReadonlySet<string> = new Set([
  ...factOptions,
  ...checkFields,
])

/** Why `name` cannot name a relation attribute, or null when it can. */
export function attributeNameProblem(name: string): string | null {
  if (!isAttributeName(name))
    return `"${name}" cannot name an attribute: lowercase words joined by ".", "-" or "_"`
  if (factOptions.has(name))
    return `"${name}" cannot name an attribute: it is a field of a fact's long form`
  if (reservedAttributeNames.has(name))
    return `"${name}" cannot name an attribute: it is a field of a fact check, which says who checked the facts in its group, and when`
  return null
}

/**
 * A task ID (tasks §3): the workspace's prefix of 1 to 5 letters, a hyphen,
 * and a number counting from 1. Until tasks exist (M3), only this form is
 * checked.
 */
export const taskIdPattern = /^[A-Z]{1,5}-[1-9][0-9]*$/

/** The ID of the start-here document (catalog §11). */
export const startHereId = "start-here"

/** Type schema documents have the ID `schema/<type>` (catalog §3.9). */
export const schemaIdPrefix = "schema/"

/**
 * The target of `applies-to` meaning the whole workspace (catalog §5,
 * policies that apply everywhere).
 */
export const workspaceTarget = "workspace"

/**
 * Names that are not available as custom type names: `schema` is reserved by
 * catalog §3.9; `workspace` and `task` are relation targets with their own
 * meaning (`applies-to: workspace`, `from-task`).
 */
export const reservedTypeNames: ReadonlySet<string> = new Set([
  "schema",
  "workspace",
  "task",
])

export interface EntityId {
  type: string
  slug: string
}

/** Splits `<type>/<slug>`, or returns null if it is not an entity ID. */
export function parseEntityId(id: string): EntityId | null {
  const slash = id.indexOf("/")
  if (slash < 0) return null
  const type = id.slice(0, slash)
  const slug = id.slice(slash + 1)
  if (!typeNamePattern.test(type) || !slugPattern.test(slug)) return null
  return { type, slug }
}

export function isEntityId(id: string): boolean {
  const parsed = parseEntityId(id)
  return parsed !== null && parsed.type !== "schema"
}

/**
 * Whether `path` is where a catalog document lives on `main` (Git-based
 * catalog plan §2.1): `<type>/<slug>.md`, `schema/<type>.md` or
 * `start-here.md`, so its ID plus `.md`. The checks of `main` (GC-3b) and
 * the move of M2's catalog into Git (GC-6) both hold paths to it.
 */
export function isDocumentPath(path: string): boolean {
  if (path === "start-here.md") return true
  const match = /^([^/]+)\/([^/]+)\.md$/.exec(path)
  if (!match) return false
  const [, folder, name] = match
  return folder === "schema"
    ? typeNamePattern.test(name!)
    : typeNamePattern.test(folder!) &&
        slugPattern.test(name!) &&
        isEntityId(`${folder}/${name}`)
}

/** The type a `schema/<type>` ID describes, or null. */
export function schemaType(id: string): string | null {
  if (!id.startsWith(schemaIdPrefix)) return null
  const type = id.slice(schemaIdPrefix.length)
  return typeNamePattern.test(type) ? type : null
}

export function schemaId(type: string): string {
  return `${schemaIdPrefix}${type}`
}
