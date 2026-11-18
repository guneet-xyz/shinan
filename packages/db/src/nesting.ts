import { AsyncLocalStorage } from "node:async_hooks"

/**
 * A database that refuses to be queried while the same piece of work holds
 * one of its transactions (#124's review). Such a query needs a second
 * connection from the pool while the transaction keeps its first; when as
 * many requests do it at once as the pool has connections, each waits for a
 * connection that only another can free, and the process hangs for good.
 * Work inside a transaction uses its `tx`; anything that needs its own
 * connection, such as a rate limit, runs before the transaction opens.
 *
 * Tests run against this database, so the whole suite checks the rule. A
 * refusal is also recorded, so that code which catches and swallows the
 * error still fails its test (`takeNestedConnectionRefusals`, checked after
 * every test by `test/nesting-check.ts`), and the raw pool (`db.$client`)
 * is guarded like `db`.
 */
export class NestedConnectionError extends Error {
  constructor(method: string) {
    super(
      `db.${method}() was called while this work holds a transaction: use the transaction's tx, or call it before the transaction opens`,
    )
    this.name = "NestedConnectionError"
  }
}

const holding = new AsyncLocalStorage<boolean>()

/** Refusals since the last `takeNestedConnectionRefusals`, as their messages and where they came from. */
const refusals: string[] = []

/**
 * The refusals recorded since the last call, emptying the record. The test
 * setup fails any test that leaves one behind, even if the code under test
 * caught the error; a test that provokes refusals on purpose takes them.
 */
export function takeNestedConnectionRefusals(): string[] {
  return refusals.splice(0)
}

function refuse(name: string): never {
  const error = new NestedConnectionError(name)
  const where = (error.stack ?? "")
    .split("\n")
    .slice(2, 6)
    .map((line) => line.trim())
    .join(" < ")
  refusals.push(`${error.message} (${where})`)
  throw error
}

/** The pool's methods that take a connection. */
const poolConnecting = new Set<PropertyKey>(["connect", "query"])

/** The raw pool, refusing like `db` while this work holds a transaction. */
function guardPool<P extends object>(pool: P): P {
  return new Proxy(pool, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver)
      if (poolConnecting.has(property) && holding.getStore())
        refuse(`$client.${String(property)}`)
      return value
    },
  })
}

/** Drizzle's methods that take a connection from the pool. */
const connecting = new Set<PropertyKey>([
  "select",
  "selectDistinct",
  "selectDistinctOn",
  "insert",
  "update",
  "delete",
  "execute",
  "with",
  "$with",
  "$count",
  "refreshMaterializedView",
  "transaction",
  "query",
])

export function refuseNestedConnections<D extends object>(db: D): D {
  let client: object | undefined
  return new Proxy(db, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver)
      if (property === "$client" && typeof value === "object" && value)
        return (client ??= guardPool(value))
      if (!connecting.has(property)) return value
      if (holding.getStore()) refuse(String(property))
      if (property !== "transaction" || typeof value !== "function")
        return value
      return (
        work: (tx: unknown) => Promise<unknown>,
        ...rest: unknown[]
      ): unknown =>
        (value as (...args: unknown[]) => unknown).call(
          target,
          (tx: unknown) => holding.run(true, () => work(tx)),
          ...rest,
        )
    },
  })
}
