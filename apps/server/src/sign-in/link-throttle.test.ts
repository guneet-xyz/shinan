import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { eq, schema } from "@shinan/db"

import { Browser, startInstallation } from "../../test/installation.js"
import type { Installation } from "../../test/installation.js"
import { createAttemptLimiter } from "./attempt-limiter.js"

let installation: Installation

beforeAll(async () => {
  installation = await startInstallation({ rateLimit: true })
})

afterAll(async () => {
  await installation?.stop()
})

async function failures() {
  return installation.db
    .select()
    .from(schema.securityLog)
    .where(eq(schema.securityLog.action, "sign-in.failed"))
}

describe("opening sign-in links", () => {
  it("is limited per network address, recording one entry per flood", async () => {
    const b = new Browser(installation)
    const open = () =>
      b.request("/api/sign-in/link", {
        body: { token: "not-a-real-token", next: "/" },
      })

    for (let n = 0; n < 5; n++) {
      const response = await open()
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        location: expect.stringMatching(/^\/sign-in\?error=/) as string,
      })
    }
    expect(await failures()).toHaveLength(5)

    const refused = await open()
    expect(refused.status).toBe(429)
    expect(await refused.json()).toMatchObject({ error: "too-many-requests" })
    const afterFirstRefusal = await failures()
    expect(afterFirstRefusal).toHaveLength(6)
    expect(afterFirstRefusal.at(-1)!.details).toEqual({
      method: "email",
      reason: "throttled",
    })

    for (let n = 0; n < 10; n++) expect((await open()).status).toBe(429)
    expect(await failures()).toHaveLength(6)
  })
})

describe("createAttemptLimiter", () => {
  it("counts per key in fixed windows", () => {
    let time = 0
    const limiter = createAttemptLimiter({
      max: 2,
      windowMs: 1000,
      now: () => time,
    })
    expect(["a", "a", "a", "a", "b"].map((k) => limiter.take(k))).toEqual([
      "allowed",
      "allowed",
      "first-refusal",
      "refused",
      "allowed",
    ])
    time = 1000
    expect(limiter.take("a")).toBe("allowed")
  })
})
