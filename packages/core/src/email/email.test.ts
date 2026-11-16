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
import { pruneEmailDeliveries } from "./prune.js"
import {
  emailLimits,
  emailQueue,
  emailRetryWindowMs,
  queueEmail,
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
  it("deletes records a week after they finished, and lost queued ones", async () => {
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
        { ...values, message: content, createdAt: days(8) },
        { ...values, message: content },
      ])
      .returning({ id: schema.emailDeliveries.id })

    expect(await pruneEmailDeliveries(asShinan(db))).toBeGreaterThanOrEqual(2)

    const left = await db
      .select({ id: schema.emailDeliveries.id })
      .from(schema.emailDeliveries)
      .where(eq(schema.emailDeliveries.recipient, values.recipient))
    expect(left.map((r) => r.id).sort()).toEqual(
      [rows[1]!.id, rows[3]!.id].sort(),
    )
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
