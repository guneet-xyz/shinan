import { Hono } from "hono"
import { describe, expect, it } from "vitest"

import { BusyError } from "@shinan/core"

import { errorHandler } from "./errors.js"

describe("the API's error handler", () => {
  it("answers a busy refusal with 429 and when to send again", async () => {
    const app = new Hono()
    app.onError(errorHandler(() => {}))
    app.get("/", () => {
      throw new BusyError("catalog-busy", "Busy; send it again", 5)
    })
    const response = await app.request("/")
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("5")
    expect(await response.json()).toEqual({
      error: "too-many-requests",
      message: "Busy; send it again",
      rule: "catalog-busy",
    })
  })
})
