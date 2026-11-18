import { factStates } from "./model.js"
import type { FactState } from "./model.js"
import type { RelationSchema } from "./schemas.js"
import type { ScalarValue } from "./yaml.js"

/**
 * The fact identity key: one line of text naming which written facts are
 * "the same fact" (catalog §4.2). It is derived from the document and the
 * type schema, never stored in the text. Operations (M2-2), the agent index
 * (M2-3), proposals (M2-4), MCP tools (M2-6) and the web editor (M2-8) name a
 * fact by it instead of rebuilding the identity rules.
 *
 * Form: the key, the fact state, then `name=value` parts, joined by `|`:
 *
 * - single-valued key or relation: `disk.data.size|observed`, or with `via`,
 *   `disk.data.size|observed|via=filesystem`;
 * - multi-valued key: `endpoint|intended|value=https://shinan.guneet.dev`;
 * - multi-valued relation, with the attributes the schema names as
 *   identifying: `checkout-on|observed|to=machine/musashi|path=/root/dockyard`;
 * - an `unknown` fact of a multi-valued key: `endpoint|unknown` (with `to=`
 *   when a relation names its target).
 *
 * The state is part of every identity, so an `intended` and an `observed`
 * fact, or a planned removal and the fact it plans to remove, sit side by
 * side. Relation attributes appear in the order the schema's `identified_by`
 * lists them, and only when written. Values are written as text (`128`,
 * `true`). In every part, `%`, `|` and line breaks are written `%25`, `%7C`,
 * `%0A` and `%0D`, so a key is always one line and splits unambiguously.
 */
export type FactIdentityKey = string

export interface IdentityInput {
  key: string
  state: FactState
  many: boolean
  relation: RelationSchema | null
  value: ScalarValue | undefined
  to: string | undefined
  via: string | undefined
  attributes: Readonly<Record<string, ScalarValue>>
}

export function factIdentityKey(fact: IdentityInput): FactIdentityKey {
  const parts = [escape(fact.key), fact.state]
  const add = (name: string, value: ScalarValue | undefined) => {
    if (value !== undefined && value !== null)
      parts.push(`${name}=${escape(canonicalValue(value))}`)
  }
  if (!fact.many) {
    add("via", fact.via)
  } else if (fact.relation) {
    add("to", fact.to)
    for (const attribute of fact.relation.identifiedBy)
      add(
        attribute,
        Object.hasOwn(fact.attributes, attribute)
          ? fact.attributes[attribute]
          : undefined,
      )
  } else if (fact.state !== "unknown") {
    add("value", fact.value)
  }
  return parts.join("|")
}

export interface ParsedFactIdentityKey {
  key: string
  state: FactState
  /** The `name=value` parts, in order. */
  parts: { name: string; value: string }[]
}

/** Reads an identity key back into its parts, or null if it is not one. */
export function parseFactIdentityKey(
  identity: string,
): ParsedFactIdentityKey | null {
  const [key, state, ...rest] = identity.split("|")
  const factState = factStates.find((s) => s === state)
  if (!key || !factState) return null
  const parts: ParsedFactIdentityKey["parts"] = []
  for (const part of rest) {
    const equals = part.indexOf("=")
    if (equals <= 0) return null
    parts.push({
      name: part.slice(0, equals),
      value: unescape(part.slice(equals + 1)),
    })
  }
  return { key: unescape(key), state: factState, parts }
}

/**
 * The identity key without its fact state, for linking facts that differ only
 * in state: a planned removal and the fact it removes, or an intended and an
 * observed value of the same key.
 */
export function identityWithoutState(identity: FactIdentityKey): string {
  const parts = identity.split("|")
  parts.splice(1, 1)
  return parts.join("|")
}

/** A fact value as text, for identity keys and comparing values. */
export function canonicalValue(value: ScalarValue): string {
  return value === null ? "null" : String(value)
}

function escape(text: string): string {
  return text.replace(/[%|\n\r]/g, (c) => {
    switch (c) {
      case "%":
        return "%25"
      case "|":
        return "%7C"
      case "\n":
        return "%0A"
      default:
        return "%0D"
    }
  })
}

function unescape(text: string): string {
  return text.replace(/%(25|7C|0A|0D)/g, (_, code: string) =>
    String.fromCharCode(parseInt(code, 16)),
  )
}
