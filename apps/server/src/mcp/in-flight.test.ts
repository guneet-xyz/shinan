import type { AddressInfo, Socket } from "node:net"
import { connect } from "node:net"
import { serve } from "@hono/node-server"
import type { ServerType } from "@hono/node-server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createAgentToken, createWorkspace } from "@shinan/core"
import type { JobQueue } from "@shinan/core"
import { schema } from "@shinan/db"
import { connectTestDatabase } from "@shinan/db/testing"

import { insertPerson } from "../../test/people.js"
import { noSignIn } from "../api/sign-in.js"
import { createApp } from "../app.js"
import { parseTrustedProxies } from "../client-address.js"
import { listenerOptions } from "../in-flight.js"
import { mcpInFlight } from "./server.js"

// Slow senders through a real Node server (checklist 1.11): a client that
// sends large bodies slowly holds at most a few in memory, and Node cuts
// off what it does not finish sending.

const { db, pool } = connectTestDatabase()
const installationUrl = "http://shinan.test"
const jobs: JobQueue = { send: () => Promise.resolve(null) }
// Seconds a client has to send its request, short for the test.
const receiveSeconds = 2

let server: ServerType
let port: number
const tokens: string[] = []
const sockets: Socket[] = []

beforeAll(async () => {
  const owner = await insertPerson(db, "owner")
  await db.insert(schema.emailAllowlist).values({ email: owner.email })
  const workspaceId = (
    await createWorkspace(
      { db, actor: { kind: "person", personId: owner.id } },
      { name: "Team" },
    )
  ).workspace.id
  for (const machine of ["one", "two", "three", "four"])
    tokens.push(
      (
        await createAgentToken(
          {
            db,
            jobs,
            installationUrl,
            actor: {
              kind: "person",
              personId: owner.id,
              reauthenticated: true,
            },
          },
          { workspaceId, codingTool: "opencode", machine, access: "full" },
        )
      ).token,
    )
  const app = createApp({
    db,
    signIn: noSignIn,
    jobs,
    installationUrl,
    rateLimit: false,
    // The test stands in for the proxy, to send from several addresses.
    trustedProxies: parseTrustedProxies("127.0.0.1"),
  })
  server = serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: 0,
    serverOptions: listenerOptions(receiveSeconds),
  })
  await new Promise<void>((resolve) => server.once("listening", resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  for (const socket of sockets) socket.destroy()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await pool.end()
})

const initialize = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
})

/** A request to `/mcp`, as an open socket and what it was answered. */
interface Sent {
  socket: Socket
  answer: Promise<string>
}

/**
 * Sends the headers of a ~400 KB `/mcp` request and `sent` bytes of its
 * body; `stall` keeps the rest back.
 */
function send(
  token: string,
  address: string,
  options: { stall: boolean },
): Sent {
  const body = Buffer.from(
    initialize.replace(
      '"capabilities":{}',
      `"capabilities":{},"_meta":{"padding":"${"x".repeat(400 * 1024)}"}`,
    ),
  )
  const socket = connect(port, "127.0.0.1")
  sockets.push(socket)
  const chunks: Buffer[] = []
  socket.on("data", (chunk: Buffer) => chunks.push(chunk))
  const answer = new Promise<string>((resolve) => {
    socket.on("close", () => resolve(Buffer.concat(chunks).toString()))
    socket.on("data", () => {
      const text = Buffer.concat(chunks).toString()
      if (/^HTTP\/1\.1 4\d\d/.test(text)) resolve(text)
    })
    socket.on("error", () => resolve(Buffer.concat(chunks).toString()))
  })
  socket.write(
    [
      "POST /mcp HTTP/1.1",
      "Host: shinan.test",
      `Authorization: Bearer ${token}`,
      `X-Forwarded-For: ${address}`,
      "Content-Type: application/json",
      "Accept: application/json, text/event-stream",
      `Content-Length: ${body.length}`,
      "",
      "",
    ].join("\r\n"),
  )
  socket.write(options.stall ? body.subarray(0, 100 * 1024) : body)
  return { socket, answer }
}

/** The status of an answer, or null while there is none. */
async function statusWithin(sent: Sent, ms: number): Promise<number | null> {
  const status = await Promise.race([
    sent.answer.then((text) => Number(/^HTTP\/1\.1 (\d{3})/.exec(text)?.[1])),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
  return Number.isNaN(status) ? 0 : status
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 500))

describe("slow senders at /mcp", () => {
  it("hold at most a few bodies per token and per address, and are cut off", async () => {
    // One token from many addresses: only perToken requests are held.
    const held = Array.from({ length: mcpInFlight.perToken }, (_, i) =>
      send(tokens[0]!, `192.0.2.${i + 1}`, { stall: true }),
    )
    await settle()
    for (const sent of held) expect(await statusWithin(sent, 50)).toBeNull()
    const over = send(tokens[0]!, "192.0.2.100", { stall: true })
    expect(await statusWithin(over, 5000)).toBe(429)

    // Several tokens from one address, each below its own cap (6, 6 and 4),
    // and an IPv6 address counted by its /64: only perAddress are held.
    const inSameNetwork = (i: number) => `2001:db8:0:1::${(i + 1).toString(16)}`
    const split = [6, 6, mcpInFlight.perAddress - 12]
    const fromAddress = split.flatMap((count, t) =>
      Array.from({ length: count }, (_, i) =>
        send(tokens[t + 1]!, inSameNetwork(t * 8 + i), { stall: true }),
      ),
    )
    await settle()
    for (const sent of fromAddress)
      expect(await statusWithin(sent, 50)).toBeNull()
    // The 17th, on a token with room left, is refused by the address's cap.
    expect(
      await statusWithin(
        send(tokens[3]!, inSameNetwork(100), { stall: true }),
        5000,
      ),
    ).toBe(429)
    // The same token from another /64 still has room.
    const elsewhere = send(tokens[3]!, "2001:db8:0:2::1", { stall: true })
    await settle()
    expect(await statusWithin(elsewhere, 50)).toBeNull()
    fromAddress.push(elsewhere)

    // Node cuts off every stalled request once its time to send is up
    // (408, or the connection closed), which frees its body and its slot.
    for (const sent of [...held, ...fromAddress]) {
      const status = await statusWithin(sent, (receiveSeconds + 10) * 1000)
      expect(status === 408 || status === 0, String(status)).toBe(true)
    }
    const whole = send(tokens[0]!, "192.0.2.1", { stall: false })
    expect(await statusWithin(whole, 10_000)).toBe(200)
  }, 60_000)
})
