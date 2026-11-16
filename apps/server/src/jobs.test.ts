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

import { getInstallation } from "@shinan/core"
import { connectTestDatabase } from "@shinan/db/testing"

import { runCommand } from "./commands.js"
import { migrateJobQueue, queues, startWorker } from "./jobs.js"
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
})

describe("worker", () => {
  let worker: Worker | undefined

  afterEach(async () => {
    await worker?.stop()
    worker = undefined
  })

  it("runs the heartbeat job", async () => {
    worker = await startWorker({ databaseUrl, db, pollingIntervalSeconds: 0.5 })
    const id = await worker.boss.send(queues.heartbeat)

    await vi.waitFor(
      async () => {
        const [job] = await worker!.boss.findJobs(queues.heartbeat, { id: id! })
        expect(job?.state).toBe("completed")
      },
      { timeout: 10_000, interval: 200 },
    )
  })

  it("schedules the heartbeat", async () => {
    worker = await startWorker({ databaseUrl, db })
    const schedule = await worker.boss.getSchedule(queues.heartbeat)
    expect(schedule?.cron).toBe("0 * * * *")
  })

  it("stops cleanly", async () => {
    const started = await startWorker({ databaseUrl, db })
    await started.stop()
    await expect(started.boss.send(queues.heartbeat)).rejects.toThrow()
  })
})
