// node mcp.mjs <token file> <tool> [JSON arguments]: one MCP tool call, as
// v0.3.0's agents made them (the rehearsal's proposal before the upgrade).
import { readFileSync } from "node:fs"

// The test stack's Caddy has a self-signed certificate.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

const [tokenFile, tool, args] = process.argv.slice(2)
const url = `${process.env.SHINAN_URL ?? "https://localhost:18444"}/mcp`
const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  authorization: `Bearer ${readFileSync(tokenFile, "utf8").trim()}`,
}
async function post(body, extra = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: { ...headers, ...extra },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  const data = text.match(/^data: (.*)$/m)
  return {
    status: r.status,
    body: data ? JSON.parse(data[1]) : text ? JSON.parse(text) : null,
  }
}
const init = await post({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "gc11", version: "1" },
  },
})
if (init.status !== 200) {
  console.log(`initialize answered ${init.status}`)
  process.exit(1)
}
const r = await post(
  {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: tool, arguments: JSON.parse(args ?? "{}") },
  },
  { "mcp-protocol-version": "2025-11-25" },
)
console.log(
  JSON.stringify(r.body?.result?.structuredContent ?? r.body).slice(0, 400),
)
