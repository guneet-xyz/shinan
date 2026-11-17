import { afterAll, describe, expect, it } from "vitest"

import { and, eq, schema, sql } from "@shinan/db"

import { testDatabase } from "../test/helpers.js"
import { shinan } from "./actor.js"
import type { Context } from "./context.js"
import {
  pruneRateLimits,
  rateLimitReached,
  rateLimits,
  takeRateLimit,
} from "./rate-limits.js"
import type { RateLimitName } from "./rate-limits.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

let counter = 0

/** A network address no other test in this run uses. */
function freshAddress(): string {
  counter++
  return `198.51.100.${counter}`
}

/** Takes one request and says "allowed" or "refused". */
async function take(ctx: Context, name: RateLimitName): Promise<string> {
  return (await takeRateLimit(ctx, name)).allowed ? "allowed" : "refused"
}

function from(networkAddress: string): Context {
  return { db, actor: shinan, request: { networkAddress, client: "test" } }
}

async function throttledEntries(networkAddress: string, action: string) {
  return db
    .select()
    .from(schema.securityLog)
    .where(
      and(
        eq(schema.securityLog.action, action),
        sql`${schema.securityLog.networkAddress} = ${networkAddress}::inet`,
      ),
    )
}

describe("takeRateLimit", () => {
  it("counts by a key instead of the address when given one", async () => {
    const key = crypto.randomUUID()
    const { max } = rateLimits["agent-token"]
    // Two addresses taking turns: the key is what is counted.
    const addresses = [freshAddress(), freshAddress()]
    for (let n = 0; n < max; n++) {
      const outcome = await takeRateLimit(
        from(addresses[n % 2]!),
        "agent-token",
        { key },
      )
      expect(outcome.allowed).toBe(true)
    }
    const refused = await takeRateLimit(from(addresses[0]!), "agent-token", {
      key,
    })
    expect(refused.allowed).toBe(false)
    const [entry] = await db
      .select()
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.action, "request.throttled"),
          sql`${schema.securityLog.details}->>'key' = ${key}`,
        ),
      )
    expect(entry?.details).toEqual({ limit: "agent-token", key })
  })

  it("allows up to the limit in a window, then refuses", async () => {
    const address = freshAddress()
    const { max } = rateLimits["sign-in-link"]
    const outcomes = []
    for (let n = 0; n < max + 3; n++) {
      outcomes.push(await take(from(address), "sign-in-link"))
    }
    expect(outcomes).toEqual([
      ...Array<string>(max).fill("allowed"),
      "refused",
      "refused",
      "refused",
    ])
    // Another address and another limit are counted separately.
    expect(await take(from(freshAddress()), "sign-in-link")).toBe("allowed")
    expect(await take(from(address), "github-sign-in")).toBe("allowed")
  })

  it("records only the first refusal in a window", async () => {
    const address = freshAddress()
    for (let n = 0; n < rateLimits["sign-in-link-open"].max + 5; n++) {
      await take(from(address), "sign-in-link-open")
    }
    const entries = await throttledEntries(address, "sign-in.failed")
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      actorKind: "shinan",
      outcome: "failed",
      client: "test",
      details: { method: "email", reason: "throttled" },
    })

    for (let n = 0; n < rateLimits["invitation-token"].max + 2; n++) {
      await take(from(address), "invitation-token")
    }
    const refused = await throttledEntries(address, "request.throttled")
    expect(refused).toHaveLength(1)
    expect(refused[0]).toMatchObject({
      outcome: "refused",
      details: { limit: "invitation-token" },
    })
  })

  it("does not record refusals of the general limit", async () => {
    const address = freshAddress()
    for (let n = 0; n < rateLimits.api.max + 2; n++) {
      await take(from(address), "api")
    }
    expect(await take(from(address), "api")).toBe("refused")
    const entries = await db
      .select()
      .from(schema.securityLog)
      .where(
        sql`${schema.securityLog.networkAddress} = ${address}::inet and ${schema.securityLog.details}->>'limit' = 'api'`,
      )
    expect(entries).toHaveLength(0)
  })

  it("says how long until the window ends", async () => {
    const address = freshAddress()
    const { max, windowSeconds } = rateLimits["sign-in-link"]
    for (let n = 0; n < max; n++) {
      await takeRateLimit(from(address), "sign-in-link")
    }
    await db
      .update(schema.rateLimits)
      .set({ windowStart: sql`now() - make_interval(secs => 45)` })
      .where(eq(schema.rateLimits.key, `sign-in-link:${address}`))
    const refused = await takeRateLimit(from(address), "sign-in-link")
    expect(refused).toEqual({
      allowed: false,
      retryAfterSeconds: windowSeconds - 45,
    })
  })

  it("starts counting again when the window has passed", async () => {
    const address = freshAddress()
    const { max, windowSeconds } = rateLimits["sign-in-link"]
    for (let n = 0; n <= max; n++) {
      await take(from(address), "sign-in-link")
    }
    expect(await take(from(address), "sign-in-link")).toBe("refused")
    await db
      .update(schema.rateLimits)
      .set({
        windowStart: sql`now() - make_interval(secs => ${windowSeconds})`,
      })
      .where(eq(schema.rateLimits.key, `sign-in-link:${address}`))
    expect(await take(from(address), "sign-in-link")).toBe("allowed")
    const [row] = await db
      .select()
      .from(schema.rateLimits)
      .where(eq(schema.rateLimits.key, `sign-in-link:${address}`))
    expect(row!.count).toBe(1)
  })

  it("counts exactly under concurrent requests", async () => {
    const address = freshAddress()
    const { max } = rateLimits["github-sign-in"]
    const outcomes = await Promise.all(
      Array.from({ length: max * 3 }, () =>
        take(from(address), "github-sign-in"),
      ),
    )
    expect(outcomes.filter((o) => o === "allowed")).toHaveLength(max)
    expect(await throttledEntries(address, "sign-in.failed")).toHaveLength(1)
  })

  it("counts an IPv6 address by its /64", async () => {
    const prefix = `2001:db8:0:${++counter}`
    const { max } = rateLimits["sign-in-link"]
    for (let n = 0; n < max; n++) {
      expect(await take(from(`${prefix}::${n + 1}`), "sign-in-link")).toBe(
        "allowed",
      )
    }
    expect(await take(from(`${prefix}::ffff`), "sign-in-link")).toBe("refused")
  })

  it("is only for Shinan", async () => {
    await expect(
      take(
        {
          db,
          actor: { kind: "person", personId: crypto.randomUUID() },
        },
        "api",
      ),
    ).rejects.toThrow()
  })
})

describe("pruneRateLimits", () => {
  it("deletes counts whose windows have ended", async () => {
    const old = freshAddress()
    const current = freshAddress()
    await take(from(old), "api")
    await take(from(current), "api")
    await db
      .update(schema.rateLimits)
      .set({ windowStart: sql`now() - interval '1 day'` })
      .where(eq(schema.rateLimits.key, `api:${old}`))

    expect(await pruneRateLimits({ db, actor: shinan })).toBeGreaterThan(0)
    const keys = (await db.select().from(schema.rateLimits)).map((r) => r.key)
    expect(keys).not.toContain(`api:${old}`)
    expect(keys).toContain(`api:${current}`)
  })
})

describe("rateLimitReached", () => {
  it("says whether a limit is used up without counting", async () => {
    const address = freshAddress()
    const { max } = rateLimits["agent-token-failure"]
    for (let n = 0; n < 3 * max; n++) {
      expect(
        (await rateLimitReached(from(address), "agent-token-failure")).allowed,
      ).toBe(true)
    }
    for (let n = 0; n < max - 1; n++) {
      await takeRateLimit(from(address), "agent-token-failure")
    }
    expect(
      (await rateLimitReached(from(address), "agent-token-failure")).allowed,
    ).toBe(true)
    await takeRateLimit(from(address), "agent-token-failure")
    const reached = await rateLimitReached(from(address), "agent-token-failure")
    expect(reached).toMatchObject({ allowed: false })
    expect(
      (await rateLimitReached(from(freshAddress()), "agent-token-failure"))
        .allowed,
    ).toBe(true)
  })
})
