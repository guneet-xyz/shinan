import { afterEach, describe, expect, it, vi } from "vitest"

import { createEmailSender, runCommand, usage } from "./commands.js"

describe("runCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("prints usage for help", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})

    await expect(runCommand(["help"], {})).resolves.toBe(0)
    expect(info).toHaveBeenCalledWith(usage)
  })

  it("rejects unknown commands", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(runCommand(["serve"], {})).resolves.toBe(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining("serve"))
  })

  it("requires a command", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(runCommand([], {})).resolves.toBe(1)
  })

  it("requires DATABASE_URL to migrate", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})

    await expect(runCommand(["migrate"], {})).rejects.toThrow(/DATABASE_URL/)
  })

  it("requires DATABASE_URL to run the worker", async () => {
    await expect(runCommand(["worker"], {})).rejects.toThrow(/DATABASE_URL/)
  })

  it("requires SES settings to run the worker in production", async () => {
    const env = { DATABASE_URL: "postgres://unused", NODE_ENV: "production" }
    await expect(runCommand(["worker"], env)).rejects.toThrow(/EMAIL_TRANSPORT/)
  })
})

describe("createEmailSender", () => {
  it("builds the configured sender without sending anything", async () => {
    const ses = createEmailSender({
      transport: "ses",
      from: { address: "shinan@guneet.dev", name: "Shinan" },
      region: "us-east-1",
    })
    const smtp = createEmailSender({
      transport: "smtp",
      from: { address: "shinan@localhost" },
      host: "127.0.0.1",
      port: 1025,
    })
    await ses.close()
    await smtp.close()
  })
})
