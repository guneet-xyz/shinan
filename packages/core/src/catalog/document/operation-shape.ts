/**
 * Checks that an operation has the shape of `CatalogOperation` before it is
 * applied: operations arrive as JSON from MCP and the web editor, and a
 * malformed one must be refused, not make the applier throw. Unknown fields
 * are refused too, so a field the caller may not send (such as `by`) cannot
 * be slipped in and silently ignored.
 */

export class ShapeError extends Error {}

type Check = (value: unknown, path: string) => void

const fail = (path: string, expected: string): never => {
  throw new ShapeError(`\`${path}\` ${expected}`)
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const str: Check = (v, path) => {
  if (typeof v !== "string") fail(path, "is text")
}
const bool: Check = (v, path) => {
  if (typeof v !== "boolean") fail(path, "is true or false")
}
const scalar: Check = (v, path) => {
  if (
    typeof v !== "string" &&
    typeof v !== "boolean" &&
    !(typeof v === "number" && Number.isFinite(v))
  )
    fail(path, "is text, a finite number, or true or false")
}
const literal =
  (expected: unknown): Check =>
  (v, path) => {
    if (v !== expected) fail(path, `is ${JSON.stringify(expected)}`)
  }
const nullable =
  (check: Check): Check =>
  (v, path) => {
    if (v !== null) check(v, path)
  }
const list =
  (check: Check, max = 1000): Check =>
  (v, path) => {
    if (!Array.isArray(v)) return fail(path, "is a list")
    if (v.length > max) fail(path, `holds at most ${max} items`)
    v.forEach((item, i) => check(item, `${path}[${i}]`))
  }
const record =
  (check: Check, max = 100): Check =>
  (v, path) => {
    if (!isObject(v)) return fail(path, "is a map")
    const entries = Object.entries(v)
    if (entries.length > max) fail(path, `holds at most ${max} entries`)
    for (const [k, item] of entries) check(item, `${path}.${k}`)
  }

/** A map with these fields; those marked optional (`?` in the name) may be left out. */
const object =
  (fields: Record<string, Check>): Check =>
  (v, path) => {
    if (!isObject(v)) return fail(path, "is a map")
    const known = new Map(
      Object.entries(fields).map(([name, check]) => [
        name.replace(/\?$/, ""),
        { check, optional: name.endsWith("?") },
      ]),
    )
    for (const key of Object.keys(v))
      if (!known.has(key)) fail(`${path}.${key}`, "is not a field here")
    for (const [name, { check, optional }] of known) {
      if (!Object.hasOwn(v, name) || v[name] === undefined) {
        if (!optional) fail(`${path}.${name}`, "is missing")
        continue
      }
      check(v[name], `${path}.${name}`)
    }
  }

/** One of several shapes, told apart by `pick`. */
const either =
  (pick: (v: Record<string, unknown>) => Check): Check =>
  (v, path) => {
    if (!isObject(v)) return fail(path, "is a map")
    pick(v)(v, path)
  }

const factInput = object({
  key: str,
  state: str,
  "value?": scalar,
  "to?": str,
  "attributes?": record(scalar),
  "via?": str,
  "note?": str,
  "task?": str,
  "remove?": bool,
  // Refused with its own message by the applier: Shinan writes it.
  "accepted?": () => {},
})

const checkInput = object({
  checked: str,
  scope: str,
  source: str,
  "limits?": str,
})

const expectedCheck = object({
  checked: nullable(str),
  "by?": str,
  "scope?": str,
  "source?": str,
  "limits?": nullable(str),
})

const presentFields = {
  identity: str,
  value: str,
  check: nullable(expectedCheck),
  "via?": str,
  "note?": str,
  "task?": str,
  "remove?": bool,
  "accepted?": str,
  "attributes?": record(scalar),
}
const presentFact = object(presentFields)
const factExpectation = either((v) =>
  "absent" in v
    ? object({ identity: str, absent: literal(true) })
    : presentFact,
)

const keyOptions = object({
  "many?": bool,
  "relation?": list(str, 100),
  "identifiedBy?": list(str, 100),
  "inverse?": str,
  "recheck?": str,
})

const step = either((v) =>
  "to" in v
    ? object({ to: str, note: str })
    : "list" in v
      ? object({ list: str, note: str })
      : object({ url: str, note: str }),
)

const fieldValue: Check = (v, path) => {
  if (v === null || typeof v === "string") return
  list(str, 100)(v, path)
}

const shapes: Record<string, Check> = {
  "create-entity": object({
    op: str,
    id: str,
    title: str,
    summary: str,
    "status?": str,
    owner: str,
    "decision?": object({
      state: str,
      "decidedOn?": str,
      "decidedBy?": str,
    }),
    "facts?": list(object({ fact: factInput, "check?": checkInput })),
    "body?": str,
  }),
  "set-fact": object({
    op: str,
    document: str,
    fact: factInput,
    "check?": checkInput,
    expect: factExpectation,
    "supersedes?": presentFact,
  }),
  "remove-fact": object({ op: str, document: str, expect: presentFact }),
  "recheck-facts": object({
    op: str,
    document: str,
    facts: list(presentFact),
    check: checkInput,
  }),
  "accept-discrepancy": object({
    op: str,
    document: str,
    key: str,
    note: str,
    expect: list(presentFact),
  }),
  "edit-body": object({
    op: str,
    document: str,
    "section?": nullable(str),
    text: str,
    expect: either((v) =>
      "absent" in v ? object({ absent: literal(true) }) : object({ text: str }),
    ),
  }),
  "set-field": object({
    op: str,
    document: str,
    field: str,
    value: fieldValue,
    expect: object({ value: fieldValue }),
  }),
  retire: object({
    op: str,
    document: str,
    "replacedBy?": str,
    expect: object({ status: str }),
  }),
  "change-id": object({ op: str, document: str, id: str }),
  "create-schema": object({
    op: str,
    type: str,
    title: str,
    summary: str,
    owner: str,
    "status?": str,
    "keys?": record(keyOptions, 200),
    "required?": list(str, 200),
    "sections?": list(str, 100),
    "body?": str,
  }),
  "set-schema-key": object({
    op: str,
    document: str,
    key: str,
    options: nullable(keyOptions),
    expect: either((v) =>
      "absent" in v
        ? object({ absent: literal(true) })
        : object({ options: keyOptions }),
    ),
  }),
  "create-start-here": object({
    op: str,
    title: str,
    "summary?": str,
    "owner?": str,
    people: list(step, 200),
    agents: list(step, 200),
    "body?": str,
  }),
  "restore-document": object({
    op: str,
    document: str,
    text: str,
    expect: object({ sha256: str }),
  }),
  "set-start-here-path": object({
    op: str,
    path: str,
    steps: list(step, 200),
    expect: object({ steps: list(step, 200) }),
  }),
}

/** Throws `ShapeError` unless `operation` has the shape of a catalog operation. */
export function checkOperationShape(operation: unknown): void {
  if (!isObject(operation)) fail("operation", "is a map")
  const op = (operation as Record<string, unknown>).op
  const shape = typeof op === "string" ? shapes[op] : undefined
  if (!shape || !Object.hasOwn(shapes, op as string))
    throw new ShapeError(`"${String(op)}" is not a catalog operation`)
  shape(operation, "operation")
}
