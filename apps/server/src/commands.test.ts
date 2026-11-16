import { afterEach, describe, expect, it, vi } from "vitest"

import { closeWeb, createEmailSender, runCommand, usage } from "./commands.js"

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

  it("requires DATABASE_URL to serve the web role", async () => {
    await expect(
      runCommand(["web"], { NODE_ENV: "development" }),
    ).rejects.toThrow(/DATABASE_URL/)
  })

  it("requires the sign-in settings to serve the web role in production", async () => {
    const env = { DATABASE_URL: "postgres://unused", NODE_ENV: "production" }
    await expect(runCommand(["web"], env)).rejects.toThrow(/SHINAN_URL/)
  })

  it("checks the recovery commands' arguments", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    for (const args of [
      ["account"],
      ["account", "end-sessions"],
      ["account", "end-sessions", "ada", "extra"],
      ["account", "change-email", "ada"],
      ["account", "unknown", "ada"],
    ]) {
      await expect(runCommand(args, {}), args.join(" ")).resolves.toBe(1)
    }
  })

  it("requires DATABASE_URL to run the worker", async () => {
    await expect(runCommand(["worker"], {})).rejects.toThrow(/DATABASE_URL/)
  })

  it("requires SES settings to run the worker in production", async () => {
    const env = { DATABASE_URL: "postgres://unused", NODE_ENV: "production" }
    await expect(runCommand(["worker"], env)).rejects.toThrow(/EMAIL_TRANSPORT/)
  })
})

describe("closeWeb", () => {
  it("waits for background sign-in work before closing the database", async () => {
    const order: string[] = []
    let finish!: () => void
    const background = new Promise<void>((resolve) => (finish = resolve))
    const closing = closeWeb({
      signIn: {
        idle: async () => {
          await background
          order.push("sign-in idle")
        },
      },
      jobs: {
        stop: () => {
          order.push("jobs stopped")
          return Promise.resolve()
        },
      },
      pool: {
        end: () => {
          order.push("database closed")
          return Promise.resolve()
        },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(order).toEqual([])
    finish()
    await closing
    expect(order).toEqual(["sign-in idle", "jobs stopped", "database closed"])
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
