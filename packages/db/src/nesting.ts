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
  constructor(method: string, message?: string) {
    super(
      message ??
        `db.${method}() was called while this work holds a transaction: use the transaction's tx, or call it before the transaction opens`,
    )
    this.name = "NestedConnectionError"
  }
}

/**
 * Whether the work running now started inside a transaction that is still
 * open. The store is the transaction's own state, cleared when its work
 * settles, so work it started that runs later (a timer, an emitter's
 * handler) may use `db` again once the transaction is over.
 */
const holding = new AsyncLocalStorage<{ open: boolean }>()

function inTransaction(): boolean {
  return holding.getStore()?.open ?? false
}

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

function refuse(name: string, message?: string): never {
  const error = new NestedConnectionError(name, message)
  const where = (error.stack ?? "")
    .split("\n")
    .slice(2, 6)
    .map((line) => line.trim())
    .join(" < ")
  refusals.push(`${error.message} (${where})`)
  throw error
}

/**
 * For tests: `target`, such as a client of another service, whose methods
 * refuse to run while this work holds a transaction of a database that
 * refuses nested connections. Code that calls a slow service with a
 * transaction open holds a connection meanwhile; the Git container is never
 * called inside one (architecture §5.3). A refusal is recorded like a
 * nested connection's, so a test fails even if the code caught it.
 */
export function refuseDuringTransactions<T extends object>(
  target: T,
  name: string,
): T {
  return new Proxy(target, {
    get(object, property, receiver) {
      const value: unknown = Reflect.get(object, property, receiver)
      if (typeof value !== "function") return value
      return (...args: unknown[]): unknown => {
        if (inTransaction())
          refuse(
            String(property),
            `${name}.${String(property)}() was called while this work holds a database transaction: call it before the transaction opens or after it ends`,
          )
        return (value as (...a: unknown[]) => unknown).apply(object, args)
      }
    },
  })
}

/** The pool's methods that take a connection. */
const poolConnecting = new Set<PropertyKey>(["connect", "query"])

/** The raw pool, refusing like `db` while this work holds a transaction. */
function guardPool<P extends object>(pool: P): P {
  return new Proxy(pool, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver)
      if (poolConnecting.has(property) && inTransaction())
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
      if (inTransaction()) refuse(String(property))
      if (property !== "transaction" || typeof value !== "function")
        return value
      return (
        work: (tx: unknown) => Promise<unknown>,
        ...rest: unknown[]
      ): unknown =>
        (value as (...args: unknown[]) => unknown).call(
          target,
          (tx: unknown) => {
            const state = { open: true }
            return holding.run(state, async () => {
              try {
                return await work(tx)
              } finally {
                state.open = false
              }
            })
          },
          ...rest,
        )
    },
  })
}
