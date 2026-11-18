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
 * Tests run against this database, so the whole suite checks the rule.
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
  return new Proxy(db, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver)
      if (!connecting.has(property)) return value
      if (holding.getStore()) throw new NestedConnectionError(String(property))
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
