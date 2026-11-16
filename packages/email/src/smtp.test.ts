import { randomBytes } from "node:crypto"
import { createServer } from "node:net"
import { describe, expect, it } from "vitest"

import { classifySmtpError, createSmtpSender } from "./smtp.js"
import { mailCatcher, waitForMessages } from "./testing.js"

const recipient = () => `smtp-${randomBytes(4).toString("hex")}@example.com`

describe("createSmtpSender", () => {
  it("delivers to the local mail catcher", async () => {
    const { host, port } = mailCatcher()
    const sender = createSmtpSender({
      from: { address: "shinan@localhost", name: "Shinan" },
      host,
      port,
    })
    const to = recipient()
    try {
      const result = await sender.send({
        to,
        subject: "Grüße from Shinan",
        text: "Plain text body",
        html: "<p>HTML body</p>",
      })
      expect(result).toMatchObject({ ok: true })
    } finally {
      await sender.close()
    }

    const [message] = await waitForMessages(to)
    expect(message).toMatchObject({
      Subject: "Grüße from Shinan",
      From: { Name: "Shinan", Address: "shinan@localhost" },
      To: [{ Address: to }],
    })
    expect(message!.Text.trim()).toBe("Plain text body")
    expect(message!.HTML).toContain("<p>HTML body</p>")
  })

  it("reports a refused connection as temporary", async () => {
    const port = await closedPort()
    const sender = createSmtpSender({
      from: { address: "shinan@localhost" },
      host: "127.0.0.1",
      port,
    })
    try {
      await expect(
        sender.send({ to: recipient(), subject: "S", text: "T" }),
      ).resolves.toMatchObject({ ok: false, temporary: true })
    } finally {
      await sender.close()
    }
  })
})

describe("classifySmtpError", () => {
  it("treats 4xx replies as temporary and 5xx as permanent", () => {
    expect(classifySmtpError({ code: "EENVELOPE", responseCode: 451 })).toEqual(
      { temporary: true, code: "SMTP451" },
    )
    expect(classifySmtpError({ code: "EENVELOPE", responseCode: 550 })).toEqual(
      { temporary: false, code: "SMTP550" },
    )
  })

  it("treats connection trouble as temporary and the rest as permanent", () => {
    expect(classifySmtpError({ code: "ETIMEDOUT" })).toEqual({
      temporary: true,
      code: "ETIMEDOUT",
    })
    expect(classifySmtpError({ code: "EENVELOPE" })).toEqual({
      temporary: false,
      code: "EENVELOPE",
    })
    expect(classifySmtpError(new Error("free text"))).toEqual({
      temporary: false,
      code: "UnknownError",
    })
  })
})

/** A local port with nothing listening on it. */
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (typeof address !== "object" || address === null) throw new Error()
  return address.port
}
