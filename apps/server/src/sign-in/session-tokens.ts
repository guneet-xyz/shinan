import type { DBAdapter, Where } from "better-auth/adapters"

import { hashToken } from "@shinan/core"

/**
 * Better Auth stores sign-in session tokens as they are. This wraps its
 * database adapter so that only a hash of each token is stored (identity
 * §7.4, architecture §10.3): a copy of the database holds no usable session.
 *
 * Tokens are hashed on the way in, wherever a session is written or looked
 * up by token. On the way out, a session found by its token gets the token
 * back, since Better Auth puts it in the cookie; sessions found any other way
 * carry only the hash, so no route that lists sessions by person may hand
 * their tokens to Better Auth (the sign-in layer serves none).
 */
export function hashSessionTokens<A extends DBAdapter>(adapter: A): A {
  return wrap(adapter)
}

type Row = Record<string, unknown> | null
type Query = { model: string; where?: Where[] } & Record<string, unknown>

/** The adapter's methods, typed loosely: the wrapper only rewrites values. */
interface Loose {
  create(data: Query & { data: Record<string, unknown> }): Promise<Row>
  findOne(data: Query & { where: Where[] }): Promise<Row>
  findMany(data: Query): Promise<Row[]>
  count(data: Query): Promise<number>
  update(
    data: Query & { where: Where[]; update: Record<string, unknown> },
  ): Promise<Row>
  updateMany(
    data: Query & { where: Where[]; update: Record<string, unknown> },
  ): Promise<number>
  delete(data: Query & { where: Where[] }): Promise<void>
  deleteMany(data: Query & { where: Where[] }): Promise<number>
  consumeOne(data: Query & { where: Where[] }): Promise<Row>
  incrementOne(data: Query & { where: Where[] }): Promise<Row>
  transaction?<R>(callback: (trx: unknown) => Promise<R>): Promise<R>
}

function wrap<A>(original: A): A {
  const adapter = original as unknown as Loose
  const wrapped: Omit<Loose, "transaction"> = {
    create: async (data) => {
      if (data.model !== "session") return adapter.create(data)
      const token = data.data.token
      if (typeof token !== "string") return adapter.create(data)
      const created = await adapter.create({
        ...data,
        data: { ...data.data, token: hashToken(token) },
      })
      return withToken(created, token)
    },
    findOne: async (data) => {
      if (data.model !== "session") return adapter.findOne(data)
      const { where, token } = hashWhere(data.where)
      return withToken(await adapter.findOne({ ...data, where }), token)
    },
    findMany: async (data) => {
      if (data.model !== "session" || !data.where) return adapter.findMany(data)
      const { where, token } = hashWhere(data.where)
      const rows = await adapter.findMany({ ...data, where })
      return rows.map((row) => withToken(row, token))
    },
    count: async (data) =>
      data.model === "session" && data.where
        ? adapter.count({ ...data, where: hashWhere(data.where).where })
        : adapter.count(data),
    update: async (data) => {
      if (data.model !== "session") return adapter.update(data)
      const { where, token } = hashWhere(data.where)
      const update = hashUpdate(data.update)
      return withToken(await adapter.update({ ...data, where, update }), token)
    },
    updateMany: async (data) =>
      data.model === "session"
        ? adapter.updateMany({
            ...data,
            where: hashWhere(data.where).where,
            update: hashUpdate(data.update),
          })
        : adapter.updateMany(data),
    delete: async (data) =>
      data.model === "session"
        ? adapter.delete({ ...data, where: hashWhere(data.where).where })
        : adapter.delete(data),
    deleteMany: async (data) =>
      data.model === "session"
        ? adapter.deleteMany({ ...data, where: hashWhere(data.where).where })
        : adapter.deleteMany(data),
    consumeOne: async (data) => {
      if (data.model !== "session") return adapter.consumeOne(data)
      const { where, token } = hashWhere(data.where)
      return withToken(await adapter.consumeOne({ ...data, where }), token)
    },
    incrementOne: async (data) => {
      if (data.model !== "session") return adapter.incrementOne(data)
      const { where, token } = hashWhere(data.where)
      return withToken(await adapter.incrementOne({ ...data, where }), token)
    },
  }
  const result = Object.create(adapter) as Loose
  Object.assign(result, wrapped)
  if (adapter.transaction) {
    const transaction = adapter.transaction.bind(adapter)
    result.transaction = (callback) => transaction((trx) => callback(wrap(trx)))
  }
  return result as unknown as A
}

function hashUpdate(update: Record<string, unknown>): Record<string, unknown> {
  return typeof update.token === "string"
    ? { ...update, token: hashToken(update.token) }
    : update
}

/**
 * Hashes token values in a where clause. Returns the token when the clause
 * selects exactly one token, so results can carry it again.
 */
function hashWhere(where: Where[]): { where: Where[]; token?: string } {
  let token: string | undefined
  const hashed = where.map((clause) => {
    if (clause.field !== "token") return clause
    const { value } = clause
    if (typeof value === "string") {
      if (!clause.operator || clause.operator === "eq") token = value
      return { ...clause, value: hashToken(value) }
    }
    if (Array.isArray(value)) {
      return {
        ...clause,
        value: value.map((v) => (typeof v === "string" ? hashToken(v) : v)),
      } as Where
    }
    return clause
  })
  return { where: hashed, token }
}

function withToken(row: Row, token: string | undefined): Row {
  if (!token || row === null) return row
  return { ...row, token }
}
