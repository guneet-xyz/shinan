import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest"

import { emailQueue, getInstallation } from "@shinan/core"
import { createDatabase, eq, schema } from "@shinan/db"
import { connectTestDatabase, createTestDatabase } from "@shinan/db/testing"
import type { EmailSender, SendResult } from "@shinan/email"

import { runCommand } from "./commands.js"
import {
  connectJobQueue,
  migrateJobQueue,
  queues,
  startWorker,
} from "./jobs.js"
import type { Worker } from "./jobs.js"

const databaseUrl = inject("databaseUrl")
const { db, pool } = connectTestDatabase()

beforeAll(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  await migrateJobQueue(databaseUrl)
})

afterAll(async () => {
  vi.restoreAllMocks()
  await pool.end()
})

describe("migrate", () => {
  it("prepares the database and can run again", async () => {
    const env = { DATABASE_URL: databaseUrl }
    await expect(runCommand(["migrate"], env)).resolves.toBe(0)
    await expect(runCommand(["migrate"], env)).resolves.toBe(0)

    expect(await getInstallation(db)).toMatchObject({ name: "Shinan" })
  })

  it("creates core's queues with their retry policies", async () => {
    const boss = await connectJobQueue(databaseUrl)
    try {
      expect(await boss.getQueue(emailQueue.name)).toMatchObject({
        retryLimit: emailQueue.options.retryLimit,
        retryDelay: emailQueue.options.retryDelay,
        retryBackoff: true,
        retryDelayMax: emailQueue.options.retryDelayMax,
        notify: true,
      })
    } finally {
      await boss.stop({ graceful: false })
    }
  })

  it("lets overlapping runs on a fresh database take turns", async () => {
    const fresh = await createTestDatabase({ migrate: false })
    try {
      const env = { DATABASE_URL: fresh.url }
      const runs = await Promise.all(
        Array.from({ length: 3 }, () => runCommand(["migrate"], env)),
      )
      expect(runs).toEqual([0, 0, 0])

      const freshDb = createDatabase(fresh.url)
      try {
        expect(await getInstallation(freshDb.db)).toMatchObject({
          name: "Shinan",
        })
      } finally {
        await freshDb.pool.end()
      }
    } finally {
      await fresh.drop()
    }
  })
})

function fakeSender(result: SendResult) {
  return {
    send: vi.fn(() => Promise.resolve(result)),
    close: vi.fn(() => Promise.resolve()),
  } satisfies EmailSender
}

const emailSender = fakeSender({ ok: true, messageId: null })

describe("worker", () => {
  let worker: Worker | undefined

  afterEach(async () => {
    await worker?.stop()
    worker = undefined
  })

  it("runs the heartbeat job", async () => {
    worker = await startWorker({
      databaseUrl,
      db,
      emailSender,
      pollingIntervalSeconds: 0.5,
    })
    const id = await worker.boss.send(queues.heartbeat)

    await vi.waitFor(
      async () => {
        const [job] = await worker!.boss.findJobs(queues.heartbeat, { id: id! })
        expect(job?.state).toBe("completed")
      },
      { timeout: 10_000, interval: 200 },
    )
  })

  it("schedules the heartbeat and pruning email records", async () => {
    worker = await startWorker({ databaseUrl, db, emailSender })
    const heartbeat = await worker.boss.getSchedule(queues.heartbeat)
    expect(heartbeat?.cron).toBe("0 * * * *")
    const prune = await worker.boss.getSchedule(queues.emailPrune)
    expect(prune?.cron).toBe("30 * * * *")
    const signIn = await worker.boss.getSchedule(queues.signInPrune)
    expect(signIn?.cron).toBe("15 * * * *")
    const rateLimits = await worker.boss.getSchedule(queues.rateLimitPrune)
    expect(rateLimits?.cron).toBe("20 * * * *")
  })

  it("prunes rate-limit counts", async () => {
    worker = await startWorker({
      databaseUrl,
      db,
      emailSender,
      pollingIntervalSeconds: 0.5,
    })
    const id = await worker.boss.send(queues.rateLimitPrune)

    await vi.waitFor(
      async () => {
        const [job] = await worker!.boss.findJobs(queues.rateLimitPrune, {
          id: id!,
        })
        expect(job?.state).toBe("completed")
        expect(job?.output).toEqual({ deleted: expect.any(Number) as number })
      },
      { timeout: 10_000, interval: 200 },
    )
  })

  it("prunes expired sign-in records", async () => {
    worker = await startWorker({
      databaseUrl,
      db,
      emailSender,
      pollingIntervalSeconds: 0.5,
    })
    const id = await worker.boss.send(queues.signInPrune)

    await vi.waitFor(
      async () => {
        const [job] = await worker!.boss.findJobs(queues.signInPrune, {
          id: id!,
        })
        expect(job?.state).toBe("completed")
        expect(job?.output).toEqual({
          pendingGitHubSignIns: expect.any(Number) as number,
          signInSessions: expect.any(Number) as number,
        })
      },
      { timeout: 10_000, interval: 200 },
    )
  })

  it("prunes email records", async () => {
    worker = await startWorker({
      databaseUrl,
      db,
      emailSender,
      pollingIntervalSeconds: 0.5,
    })
    const id = await worker.boss.send(queues.emailPrune)

    await vi.waitFor(
      async () => {
        const [job] = await worker!.boss.findJobs(queues.emailPrune, {
          id: id!,
        })
        expect(job?.state).toBe("completed")
        expect(job?.output).toEqual({
          lost: expect.any(Number) as number,
          deleted: expect.any(Number) as number,
        })
      },
      { timeout: 10_000, interval: 200 },
    )
  })

  it("stops cleanly", async () => {
    const started = await startWorker({ databaseUrl, db, emailSender })
    await started.stop()
    await expect(started.boss.send(queues.heartbeat)).rejects.toThrow()
  })
})

describe("sending email", () => {
  let worker: Worker | undefined

  afterEach(async () => {
    await worker?.stop()
    worker = undefined
  })

  /** A queued email, as core's `queueEmail` leaves it, and its job. */
  async function queuedEmail(boss: Worker["boss"], to: string) {
    const [delivery] = await db
      .insert(schema.emailDeliveries)
      .values({
        kind: "security_alert",
        recipient: to,
        notAfter: new Date(Date.now() + 60_000),
        message: {
          subject: "New sign-in",
          text: "secret-text",
          html: "<p>x</p>",
        },
      })
      .returning({ id: schema.emailDeliveries.id })
    await boss.send(
      emailQueue.name,
      { deliveryId: delivery!.id },
      { id: delivery!.id },
    )
    return delivery!.id
  }

  async function waitForStatus(id: string, status: string) {
    await vi.waitFor(
      async () => {
        const [row] = await db
          .select({ status: schema.emailDeliveries.status })
          .from(schema.emailDeliveries)
          .where(eq(schema.emailDeliveries.id, id))
        expect(row?.status).toBe(status)
      },
      { timeout: 10_000, interval: 200 },
    )
  }

  it("works the email queue with the configured sender", async () => {
    const sender = fakeSender({ ok: true, messageId: "message-1" })
    worker = await startWorker({
      databaseUrl,
      db,
      emailSender: sender,
      pollingIntervalSeconds: 0.5,
    })
    const id = await queuedEmail(worker.boss, "worker@example.com")

    await waitForStatus(id, "sent")
    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "worker@example.com" }),
    )
  })

  it("logs failures by delivery ID and code, never the address", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const sender = fakeSender({
      ok: false,
      temporary: false,
      code: "MessageRejected",
    })
    worker = await startWorker({
      databaseUrl,
      db,
      emailSender: sender,
      pollingIntervalSeconds: 0.5,
    })
    const id = await queuedEmail(worker.boss, "rejected@example.com")

    await waitForStatus(id, "rejected")
    expect(error).toHaveBeenCalledWith(`Email ${id} rejected: MessageRejected`)
    for (const call of error.mock.calls) {
      expect(String(call[0])).not.toContain("rejected@example.com")
    }
  })

  it("stores only a code with a failed run, never the message", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const sender = fakeSender({
      ok: false,
      temporary: true,
      code: "TooManyRequestsException",
    })
    worker = await startWorker({
      databaseUrl,
      db,
      emailSender: sender,
      pollingIntervalSeconds: 0.5,
    })
    const id = await queuedEmail(worker.boss, "retry@example.com")

    await vi.waitFor(
      async () => {
        const [job] = await worker!.boss.findJobs(emailQueue.name, { id })
        expect(job?.state).toBe("retry")
        expect(JSON.stringify(job?.output)).toContain(
          "Email not sent: TooManyRequestsException",
        )
        expect(JSON.stringify(job)).not.toContain("secret-text")
      },
      { timeout: 10_000, interval: 200 },
    )
  })
})

describe("connectJobQueue", () => {
  it("adds jobs without working them", async () => {
    const boss = await connectJobQueue(databaseUrl)
    try {
      const deliveryId = crypto.randomUUID()
      const id = await boss.send(emailQueue.name, { deliveryId })
      const [job] = await boss.findJobs(emailQueue.name, { id: id! })
      expect(job?.state).toBe("created")
    } finally {
      await boss.stop({ graceful: false })
    }
  })
})
