// A small browser for GC-11's load scripts: keeps cookies, sends what
// browsers send to the site, and signs in through the setup link or a
// magic link read from Mailpit. The owner's session is kept in
// $OP/owner.cookies (test only).
import { readFileSync, writeFileSync } from "node:fs"

// The test stack's Caddy has a self-signed certificate.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

export const base = process.env.SHINAN_URL ?? "https://localhost:18444"
const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:18526"
const cookieFile = `${process.env.OP ?? "/work/op"}/owner.cookies`

export function browser() {
  const jar = new Map()
  async function request(path, init = {}) {
    const headers = {
      origin: base,
      "sec-fetch-site": "same-origin",
      "user-agent": "Mozilla/5.0 Firefox/140.0",
      ...init.headers,
    }
    if (jar.size > 0)
      headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
    if (init.body !== undefined) headers["content-type"] = "application/json"
    const response = await fetch(new URL(path, base), {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "manual",
    })
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";")
      const at = pair.indexOf("=")
      jar.set(pair.slice(0, at), pair.slice(at + 1))
    }
    return response
  }
  async function signIn(email, setupToken) {
    const since = Date.now()
    if (setupToken) {
      const r = await request("/api/setup", {
        body: { token: setupToken, email },
      })
      if (r.status !== 204) throw new Error(`setup answered ${r.status}`)
    } else {
      await request("/api/auth/sign-in/magic-link", {
        body: { email, callbackURL: "/" },
      })
    }
    for (let i = 0; i < 60; i++) {
      const search = await fetch(
        `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
      ).then((r) => r.json())
      const message = search.messages?.find(
        (m) => Date.parse(m.Created) >= since - 2000,
      )
      if (message) {
        const { Text } = await fetch(
          `${mailpit}/api/v1/message/${message.ID}`,
        ).then((r) => r.json())
        const link = new URL(Text.match(/https:\/\/\S+/)[0])
        const fragment = new URLSearchParams(link.hash.slice(1))
        const r = await request("/api/sign-in/link", {
          body: { token: fragment.get("token"), next: fragment.get("next") },
        })
        return r.status
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    throw new Error("no sign-in email")
  }
  const save = () =>
    writeFileSync(cookieFile, JSON.stringify([...jar]), { mode: 0o600 })
  const load = () => {
    for (const [k, v] of JSON.parse(readFileSync(cookieFile, "utf8")))
      jar.set(k, v)
  }
  return { request, signIn, save, load }
}
