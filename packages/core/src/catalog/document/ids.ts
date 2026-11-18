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
 * A relation attribute name (such as `path`): a fact key that is not the name
 * of a JavaScript object member such as `constructor` or `__proto__`.
 */
export function isAttributeName(name: string): boolean {
  return factKeyPattern.test(name) && !objectMembers.has(name)
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

/** The type a `schema/<type>` ID describes, or null. */
export function schemaType(id: string): string | null {
  if (!id.startsWith(schemaIdPrefix)) return null
  const type = id.slice(schemaIdPrefix.length)
  return typeNamePattern.test(type) ? type : null
}

export function schemaId(type: string): string {
  return `${schemaIdPrefix}${type}`
}
