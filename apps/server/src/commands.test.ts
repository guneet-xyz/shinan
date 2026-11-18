import { randomBytes } from "node:crypto"
import type { AddressInfo } from "node:net"
import { serve } from "@hono/node-server"
import { afterEach, describe, expect, inject, it, vi } from "vitest"

import { schema } from "@shinan/db"
import { connectTestDatabase } from "@shinan/db/testing"

import { createInternalApp } from "./app.js"
import { closeWeb, createEmailSender, runCommand, usage } from "./commands.js"
import { checkHealth } from "./health.js"

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

  it("checks the agent index commands' arguments", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    for (const args of [
      ["catalog-index"],
      ["catalog-index", "rebuild"],
      ["catalog-index", "unknown"],
    ]) {
      await expect(runCommand(args, {}), args.join(" ")).resolves.toBe(1)
    }
  })

  it("rebuilds and checks an agent index on an operator's command", async () => {
    const { db, pool } = connectTestDatabase()
    try {
      const [workspace] = await db
        .insert(schema.workspaces)
        .values({ name: "Indexed" })
        .returning()
      const info = vi.spyOn(console, "info").mockImplementation(() => {})
      const env = { DATABASE_URL: inject("databaseUrl") }
      await expect(
        runCommand(["catalog-index", "rebuild", workspace!.id], env),
      ).resolves.toBe(0)
      expect(info).toHaveBeenCalledWith(
        `Rebuilt the agent index of workspace ${workspace!.id} at revision 0 (0 documents)`,
      )
      vi.spyOn(console, "error").mockImplementation(() => {})
      await expect(
        runCommand(["catalog-index", "rebuild", crypto.randomUUID()], env),
      ).resolves.toBe(1)
    } finally {
      await pool.end()
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

describe("account change-email", () => {
  it("refuses a configured operator address with what to do instead", async () => {
    const { db, pool } = connectTestDatabase()
    try {
      const handle = `op-${randomBytes(4).toString("hex")}`
      const email = `${handle}@example.com`
      await db.insert(schema.people).values({ handle, name: handle, email })
      await db.insert(schema.installationOperators).values({ email })
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      const code = await runCommand(
        ["account", "change-email", handle, "new@example.com"],
        { DATABASE_URL: inject("databaseUrl") },
      )
      expect(code).toBe(1)
      expect(error).toHaveBeenCalledWith(
        `${email} is an operator address in SHINAN_OPERATORS. Replace it there with new@example.com and restart Shinan, then run this command again.`,
      )
    } finally {
      await pool.end()
    }
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

describe("health", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Serves the internal listener on a free loopback port. */
  async function internalListener(ready: boolean) {
    const app = createInternalApp({
      checkDatabase: () =>
        Promise.resolve({ reachable: true, migrationsCurrent: ready }),
    })
    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const s = serve(
        { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
        () => resolve(s),
      )
    })
    const { port } = server.address() as AddressInfo
    return {
      port: String(port),
      close: () => new Promise((resolve) => server.close(resolve)),
    }
  }

  it("exits 0 when the web role is ready", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const listener = await internalListener(true)
    try {
      await expect(
        runCommand(["health"], { INTERNAL_PORT: listener.port }),
      ).resolves.toBe(0)
    } finally {
      await listener.close()
    }
  })

  it("exits 1 when the web role is not ready", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const listener = await internalListener(false)
    try {
      await expect(
        runCommand(["health"], { INTERNAL_PORT: listener.port }),
      ).resolves.toBe(1)
      expect(error).toHaveBeenCalledWith(expect.stringContaining("503"))
    } finally {
      await listener.close()
    }
  })

  it("exits 1 when nothing answers", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const listener = await internalListener(true)
    await listener.close()
    await expect(
      runCommand(["health"], { INTERNAL_PORT: listener.port }),
    ).resolves.toBe(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"))
  })

  it("asks on loopback when the listener is on every address", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const asked: string[] = []
    const fetchReadiness = (url: string | URL | Request) => {
      asked.push(url instanceof Request ? url.url : url.toString())
      return Promise.resolve(new Response("{}"))
    }
    await checkHealth({ INTERNAL_HOST: "0.0.0.0" }, fetchReadiness)
    await checkHealth(
      { INTERNAL_HOST: "::", INTERNAL_PORT: "4001" },
      fetchReadiness,
    )
    await checkHealth({ INTERNAL_HOST: "10.0.0.5" }, fetchReadiness)
    expect(asked).toEqual([
      "http://127.0.0.1:3001/readyz",
      "http://[::1]:4001/readyz",
      "http://10.0.0.5:3001/readyz",
    ])
  })
})
