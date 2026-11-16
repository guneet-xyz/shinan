import { randomBytes, randomUUID } from "node:crypto"
import type { PgBoss } from "pg-boss"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { eq, schema, sql } from "@shinan/db"
import type { EmailContent, EmailKind } from "@shinan/db"
import { createSmtpSender } from "@shinan/email"
import type { EmailSender, SendResult } from "@shinan/email"
import { mailCatcher, waitForMessages } from "@shinan/email/testing"

import {
  asPerson,
  asShinan,
  newPerson,
  startTestJobQueue,
  testDatabase,
} from "../../test/helpers.js"
import { ForbiddenError, RuleViolationError } from "../errors.js"
import type { JobQueue } from "../jobs.js"
import { deliverEmail, EmailRetryError } from "./deliver.js"
import type { EmailAttempt } from "./deliver.js"
import { lostEmailGraceMinutes, pruneEmailDeliveries } from "./prune.js"
import {
  emailLimits,
  emailQueue,
  EmailQueueError,
  emailRetryWindowMs,
  queueEmail,
  throttleAddress,
} from "./queue.js"
import type { EmailJob, OutgoingEmail } from "./queue.js"
import { magicLinkEmail } from "./templates.js"

const { db, pool } = testDatabase()
let boss: PgBoss

beforeAll(async () => {
  boss = await startTestJobQueue()
})

afterAll(async () => {
  await boss.stop({ graceful: false })
  await pool.end()
})

const content: EmailContent = {
  subject: "Subject",
  text: "Text\n",
  html: "<p>Text</p>",
}

const address = () => `email-${randomBytes(4).toString("hex")}@example.com`

function email(overrides: Partial<OutgoingEmail> = {}): OutgoingEmail {
  return { kind: "magic_link", to: address(), content, ...overrides }
}

/** Queues an email in a transaction of its own. */
function queue(
  outgoing: OutgoingEmail,
  options: { networkAddress?: string; jobs?: JobQueue | undefined } = {},
) {
  const jobs = "jobs" in options ? options.jobs : boss
  return db.transaction((tx) =>
    queueEmail(
      { tx, jobs, request: { networkAddress: options.networkAddress } },
      outgoing,
    ),
  )
}

async function delivery(id: string) {
  const [row] = await db
    .select()
    .from(schema.emailDeliveries)
    .where(eq(schema.emailDeliveries.id, id))
  return row!
}

describe("queueEmail", () => {
  it("records the email and adds its job in the caller's transaction", async () => {
    const outgoing = email({ to: "  Mixed.Case@Example.com " })
    const result = await queue(outgoing)

    expect(result).toEqual({
      queued: true,
      deliveryId: expect.any(String) as string,
    })
    const row = await delivery(result.deliveryId)
    expect(row).toMatchObject({
      kind: "magic_link",
      recipient: "mixed.case@example.com",
      status: "queued",
      attempts: 0,
      message: content,
      finishedAt: null,
    })

    const [job] = await boss.findJobs<EmailJob>(emailQueue.name, {
      id: result.deliveryId,
    })
    expect(job).toMatchObject({
      data: { deliveryId: result.deliveryId },
      retryLimit: emailQueue.options.retryLimit,
      retryBackoff: true,
    })
  })

  it("adds nothing when the transaction rolls back", async () => {
    const to = address()
    let deliveryId: string | undefined
    await expect(
      db.transaction(async (tx) => {
        const result = await queueEmail(
          { tx, jobs: boss, request: {} },
          email({ to }),
        )
        deliveryId = result.deliveryId
        throw new Error("the change failed")
      }),
    ).rejects.toThrow("the change failed")

    const rows = await db
      .select()
      .from(schema.emailDeliveries)
      .where(eq(schema.emailDeliveries.recipient, to))
    expect(rows).toEqual([])
    expect(await boss.findJobs(emailQueue.name, { id: deliveryId! })).toEqual(
      [],
    )
  })

  it("needs the job queue, and writes nothing without it", async () => {
    const to = address()
    await expect(queue(email({ to }), { jobs: undefined })).rejects.toThrow(
      /job queue/,
    )
    const rows = await db
      .select()
      .from(schema.emailDeliveries)
      .where(eq(schema.emailDeliveries.recipient, to))
    expect(rows).toEqual([])
  })

  it("refuses something that is not an email address", async () => {
    await expect(queue(email({ to: "not an address" }))).rejects.toThrow(
      RuleViolationError,
    )
  })

  /** Everything a thrown error would show if logged, as one string. */
  function everything(error: unknown): string {
    const fields = error as Record<string, unknown>
    return [
      String(error),
      fields.message,
      fields.stack,
      JSON.stringify(error, Object.getOwnPropertyNames(error)),
    ].join("\n")
  }

  it("never puts the message or recipient in a database error", async () => {
    const to = address()
    const token = randomUUID()
    const link = `https://shinan.example/sign-in?token=${token}`
    // PostgreSQL's jsonb refuses \u0000, so the insert fails with the
    // message as a query parameter.
    const failing = { ...content, text: `${link}\u0000` }

    const error = await queue(email({ to, content: failing })).catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(EmailQueueError)
    expect(error).toMatchObject({ code: "22P05" })
    expect((error as Error).cause).toBeUndefined()
    expect(everything(error)).not.toContain(token)
    expect(everything(error)).not.toContain(to)
  })

  it("never puts the recipient in an error from the throttle's queries", async () => {
    const to = address()
    const error = await db
      .transaction(async (tx) => {
        // An earlier failure aborts the transaction, so the lock query fails.
        await tx.execute(sql`select 1/0`).catch(() => {})
        return queueEmail({ tx, jobs: boss, request: {} }, email({ to }))
      })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(EmailQueueError)
    expect(error).toMatchObject({ code: "25P02" })
    expect(everything(error)).not.toContain(to)
  })

  it("never keeps trying for more than an hour", async () => {
    const before = Date.now()
    const late = await queue(
      email({ notAfter: new Date(before + 3 * emailRetryWindowMs) }),
    )
    const soon = new Date(before + 15 * 60 * 1000)
    const early = await queue(email({ notAfter: soon }))

    const lateRow = await delivery(late.deliveryId)
    expect(lateRow.notAfter.getTime()).toBeGreaterThanOrEqual(
      before + emailRetryWindowMs,
    )
    expect(lateRow.notAfter.getTime()).toBeLessThanOrEqual(
      Date.now() + emailRetryWindowMs,
    )
    expect((await delivery(early.deliveryId)).notAfter).toEqual(soon)
  })
})

describe("throttling", () => {
  it("limits each kind of email per recipient", async () => {
    const to = address()
    const limit = emailLimits.perRecipient.magic_link
    for (let i = 0; i < limit; i++) {
      expect(await queue(email({ to }))).toMatchObject({ queued: true })
    }

    const refused = await queue(email({ to }))
    expect(refused).toEqual({
      queued: false,
      reason: "throttled",
      deliveryId: expect.any(String) as string,
    })
    expect(await delivery(refused.deliveryId)).toMatchObject({
      status: "throttled",
      message: null,
      finishedAt: expect.any(Date) as Date,
    })
    expect(
      await boss.findJobs(emailQueue.name, { id: refused.deliveryId }),
    ).toEqual([])

    // Other kinds have their own limits.
    expect(await queue(email({ to, kind: "security_alert" }))).toMatchObject({
      queued: true,
    })
  })

  it("does not count throttled emails towards the limit", async () => {
    const to = address()
    const kind: EmailKind = "invitation"
    const limit = emailLimits.perRecipient[kind]
    for (let i = 0; i < limit + 3; i++) await queue(email({ to, kind }))

    const rows = await db
      .select({ status: schema.emailDeliveries.status })
      .from(schema.emailDeliveries)
      .where(eq(schema.emailDeliveries.recipient, to))
    expect(rows.filter((r) => r.status === "queued")).toHaveLength(limit)
    expect(rows.filter((r) => r.status === "throttled")).toHaveLength(3)
  })

  it("limits sign-in links per network address", async () => {
    const networkAddress = `198.51.100.${Math.floor(Math.random() * 250) + 1}`
    const limit = emailLimits.magicLinksPerNetworkAddress
    for (let i = 0; i < limit; i++) {
      expect(await queue(email(), { networkAddress })).toMatchObject({
        queued: true,
      })
    }

    expect(await queue(email(), { networkAddress })).toMatchObject({
      queued: false,
      reason: "throttled",
    })
    // Another address, and other kinds of email, are not affected.
    expect(
      await queue(email(), { networkAddress: "2001:db8::1" }),
    ).toMatchObject({ queued: true })
    expect(
      await queue(email({ kind: "security_alert" }), { networkAddress }),
    ).toMatchObject({ queued: true })
  })

  it("counts IPv6 addresses by their /64", async () => {
    const prefix = `2001:db8:${randomBytes(2).toString("hex")}:1`
    const limit = emailLimits.magicLinksPerNetworkAddress
    for (let i = 0; i < limit; i++) {
      expect(
        await queue(email(), { networkAddress: `${prefix}::${i + 1}` }),
      ).toMatchObject({ queued: true })
    }

    expect(
      await queue(email(), { networkAddress: `${prefix}:abcd::99` }),
    ).toMatchObject({ queued: false, reason: "throttled" })
    expect(
      await queue(email(), { networkAddress: `${prefix.slice(0, -1)}2::1` }),
    ).toMatchObject({ queued: true })
  })

  it("holds under concurrent requests", async () => {
    const to = address()
    const results = await Promise.all(
      Array.from({ length: 12 }, () => queue(email({ to }))),
    )
    expect(results.filter((r) => r.queued)).toHaveLength(
      emailLimits.perRecipient.magic_link,
    )
  })
})

describe("throttleAddress", () => {
  it.each([
    [undefined, null],
    ["not an address", null],
    ["192.0.2.10", "192.0.2.10"],
    ["::ffff:192.0.2.10", "192.0.2.10"],
    ["::ffff:c000:20a", "192.0.2.10"],
    ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"],
    ["2001:0DB8:0001:0002::1", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["64:ff9b::192.0.2.10", "64:ff9b:0:0::/64"],
  ])("keys %s as %s", (input, key) => {
    expect(throttleAddress(input)).toBe(key)
  })
})

describe("deliverEmail", () => {
  const ctx = asShinan(db)

  function fakeSender(result: SendResult | (() => Promise<SendResult>)) {
    const send = vi.fn(
      typeof result === "function" ? result : () => Promise.resolve(result),
    )
    return {
      send,
      close: () => Promise.resolve(),
    } satisfies EmailSender
  }

  /** Queues an email without a job queue, for calling `deliverEmail` directly. */
  async function queued(overrides: Partial<OutgoingEmail> = {}) {
    const jobs = { send: () => Promise.resolve(null) } as unknown as JobQueue
    const { deliveryId } = await queue(email(overrides), { jobs })
    return deliveryId
  }

  const firstRun = (deliveryId: string): EmailAttempt => ({
    deliveryId,
    retryCount: 0,
    retryLimit: emailQueue.options.retryLimit,
  })

  it("sends the message and keeps only the outcome", async () => {
    const id = await queued({ to: "Person@Example.com" })
    const sender = fakeSender({ ok: true, messageId: "provider-1" })

    await expect(deliverEmail(ctx, sender, firstRun(id))).resolves.toEqual({
      status: "sent",
      providerMessageId: "provider-1",
    })
    expect(sender.send).toHaveBeenCalledWith({
      to: "person@example.com",
      ...content,
    })
    expect(await delivery(id)).toMatchObject({
      status: "sent",
      attempts: 1,
      providerMessageId: "provider-1",
      message: null,
      finishedAt: expect.any(Date) as Date,
    })
  })

  it("does not retry a permanent rejection", async () => {
    const id = await queued()
    const sender = fakeSender({
      ok: false,
      temporary: false,
      code: "MessageRejected",
    })

    await expect(deliverEmail(ctx, sender, firstRun(id))).resolves.toEqual({
      status: "rejected",
      code: "MessageRejected",
    })
    expect(await delivery(id)).toMatchObject({
      status: "rejected",
      attempts: 1,
      lastError: "MessageRejected",
      message: null,
    })
  })

  it("asks for a retry after a temporary error", async () => {
    const id = await queued()
    const sender = fakeSender({
      ok: false,
      temporary: true,
      code: "TooManyRequestsException",
    })

    const error = await deliverEmail(ctx, sender, firstRun(id)).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(EmailRetryError)
    expect(await delivery(id)).toMatchObject({
      status: "queued",
      attempts: 1,
      lastError: "TooManyRequestsException",
      message: content,
    })

    // The next run succeeds and keeps the earlier error for the record.
    const retry = fakeSender({ ok: true, messageId: null })
    await expect(
      deliverEmail(ctx, retry, { ...firstRun(id), retryCount: 1 }),
    ).resolves.toMatchObject({ status: "sent" })
    expect(await delivery(id)).toMatchObject({
      status: "sent",
      attempts: 2,
      lastError: "TooManyRequestsException",
    })
  })

  it("treats a sender that throws as a temporary error", async () => {
    const id = await queued()
    const sender = fakeSender(() => Promise.reject(new Error("bug")))
    await expect(deliverEmail(ctx, sender, firstRun(id))).rejects.toThrow(
      EmailRetryError,
    )
    expect(await delivery(id)).toMatchObject({ lastError: "SenderError" })
  })

  it("gives up after the last retry", async () => {
    const id = await queued()
    const sender = fakeSender({
      ok: false,
      temporary: true,
      code: "Throttling",
    })
    const last = { ...firstRun(id), retryCount: emailQueue.options.retryLimit }

    await expect(deliverEmail(ctx, sender, last)).resolves.toEqual({
      status: "given_up",
      code: "Throttling",
    })
    expect(await delivery(id)).toMatchObject({
      status: "given_up",
      message: null,
    })
  })

  it("gives up on a temporary error after the deadline", async () => {
    const id = await queued()
    const { notAfter } = await delivery(id)
    let calls = 0
    // The deadline passes while the provider is being called.
    const now = () =>
      calls++ === 0 ? new Date() : new Date(notAfter.getTime())
    const sender = fakeSender({
      ok: false,
      temporary: true,
      code: "Throttling",
    })

    await expect(deliverEmail(ctx, sender, firstRun(id), now)).resolves.toEqual(
      { status: "given_up", code: "Throttling" },
    )
  })

  it("never sends after the deadline, such as an expired magic link", async () => {
    const id = await queued({ notAfter: new Date(Date.now() - 1000) })
    const sender = fakeSender({ ok: true, messageId: null })

    await expect(deliverEmail(ctx, sender, firstRun(id))).resolves.toEqual({
      status: "given_up",
      code: "Expired",
    })
    expect(sender.send).not.toHaveBeenCalled()
    expect(await delivery(id)).toMatchObject({
      status: "given_up",
      attempts: 0,
      message: null,
    })
  })

  it("skips finished and unknown emails", async () => {
    const id = await queued()
    const sender = fakeSender({ ok: true, messageId: null })
    await deliverEmail(ctx, sender, firstRun(id))

    await expect(deliverEmail(ctx, sender, firstRun(id))).resolves.toEqual({
      status: "skipped",
    })
    await expect(
      deliverEmail(ctx, sender, firstRun(randomUUID())),
    ).resolves.toEqual({ status: "skipped" })
    await expect(
      deliverEmail(ctx, sender, firstRun("not-an-id")),
    ).resolves.toEqual({ status: "skipped" })
    expect(sender.send).toHaveBeenCalledOnce()
  })

  it("is Shinan's to do", async () => {
    const id = await queued()
    const sender = fakeSender({ ok: true, messageId: null })
    const person = asPerson(db, await newPerson(db))
    await expect(deliverEmail(person, sender, firstRun(id))).rejects.toThrow(
      ForbiddenError,
    )
    expect(sender.send).not.toHaveBeenCalled()
  })
})

describe("pruneEmailDeliveries", () => {
  it("deletes records a week after they finished", async () => {
    const days = (n: number) => sql`now() - make_interval(days => ${n})`
    const values = {
      kind: "invitation" as const,
      recipient: address(),
      notAfter: new Date(),
    }
    const rows = await db
      .insert(schema.emailDeliveries)
      .values([
        { ...values, status: "sent", createdAt: days(9), finishedAt: days(8) },
        { ...values, status: "sent", createdAt: days(9), finishedAt: days(6) },
        { ...values, message: content },
      ])
      .returning({ id: schema.emailDeliveries.id })

    const result = await pruneEmailDeliveries(asShinan(db))
    expect(result.deleted).toBeGreaterThanOrEqual(1)

    const left = await db
      .select({ id: schema.emailDeliveries.id })
      .from(schema.emailDeliveries)
      .where(eq(schema.emailDeliveries.recipient, values.recipient))
    expect(left.map((r) => r.id).sort()).toEqual(
      [rows[1]!.id, rows[2]!.id].sort(),
    )
  })

  it("gives up lost emails well past their deadline and removes their message", async () => {
    const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000)
    const values = {
      kind: "invitation" as const,
      recipient: address(),
      message: content,
    }
    const [lost, recent] = await db
      .insert(schema.emailDeliveries)
      .values([
        { ...values, notAfter: minutesAgo(lostEmailGraceMinutes + 5) },
        { ...values, notAfter: minutesAgo(lostEmailGraceMinutes - 5) },
      ])
      .returning({ id: schema.emailDeliveries.id })

    const result = await pruneEmailDeliveries(asShinan(db))
    expect(result.lost).toBeGreaterThanOrEqual(1)

    expect(await delivery(lost!.id)).toMatchObject({
      status: "given_up",
      lastError: "Lost",
      message: null,
      finishedAt: expect.any(Date) as Date,
    })
    // Still within the grace period: a run may still be sending it.
    expect(await delivery(recent!.id)).toMatchObject({
      status: "queued",
      message: content,
    })
  })

  it("is Shinan's to do", async () => {
    await expect(
      pruneEmailDeliveries(asPerson(db, await newPerson(db))),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe("sending through the job queue", () => {
  it("delivers a magic link to the local mail catcher", async () => {
    // Jobs left by the tests above would go first.
    await boss.deleteQueuedJobs(emailQueue.name)
    const { host, port } = mailCatcher()
    const sender = createSmtpSender({
      from: { address: "shinan@localhost", name: "Shinan" },
      host,
      port,
    })
    const workerId = await boss.work(
      emailQueue.name,
      { includeMetadata: true, pollingIntervalSeconds: 0.5 },
      async ([job]) =>
        deliverEmail(asShinan(db), sender, {
          deliveryId: (job!.data as EmailJob).deliveryId,
          retryCount: job!.retryCount,
          retryLimit: job!.retryLimit,
        }),
    )

    try {
      const to = address()
      const link = `https://shinan.example/sign-in?token=${randomUUID()}`
      const { deliveryId } = await queue(
        email({
          to,
          content: magicLinkEmail({
            installationName: "Shinan",
            link,
            expiresInMinutes: 15,
          }),
        }),
      )

      const [message] = await waitForMessages(to)
      expect(message).toMatchObject({
        Subject: "Sign in to Shinan",
        From: { Name: "Shinan", Address: "shinan@localhost" },
      })
      expect(message!.Text).toContain(link)

      await vi.waitFor(
        async () =>
          expect(await delivery(deliveryId)).toMatchObject({
            status: "sent",
            message: null,
          }),
        { timeout: 10_000, interval: 200 },
      )
    } finally {
      await boss.offWork(emailQueue.name, { id: workerId })
      await sender.close()
    }
  }, 20_000)
})
