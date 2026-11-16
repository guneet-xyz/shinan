import { vi } from "vitest"

/**
 * The local mail catcher (Mailpit) that tests send to. `pnpm services:up`
 * starts it; CI runs it as a service container. `SMTP_HOST`, `SMTP_PORT` and
 * `MAILPIT_URL` point tests at another one.
 */
export function mailCatcher() {
  return {
    host: process.env.SMTP_HOST ?? "127.0.0.1",
    port: Number(process.env.SMTP_PORT ?? 1025),
    apiUrl: process.env.MAILPIT_URL ?? "http://127.0.0.1:8025",
  }
}

export interface CaughtMessage {
  ID: string
  MessageID: string
  Subject: string
  From: { Name: string; Address: string }
  To: { Name: string; Address: string }[]
  Text: string
  HTML: string
}

/** Every message the mail catcher holds for one recipient. */
export async function caughtMessages(to: string): Promise<CaughtMessage[]> {
  const { apiUrl } = mailCatcher()
  const search = await getJson<{ messages: { ID: string }[] }>(
    `${apiUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
  )
  return Promise.all(
    search.messages.map((m) =>
      getJson<CaughtMessage>(`${apiUrl}/api/v1/message/${m.ID}`),
    ),
  )
}

/** Waits until the mail catcher holds `count` messages for a recipient. */
export async function waitForMessages(
  to: string,
  count = 1,
): Promise<CaughtMessage[]> {
  return vi.waitFor(
    async () => {
      const messages = await caughtMessages(to)
      if (messages.length < count) {
        throw new Error(`${messages.length} of ${count} messages to ${to}`)
      }
      return messages
    },
    { timeout: 15_000, interval: 200 },
  )
}

async function getJson<T>(url: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    throw new Error(
      `Email tests could not reach the mail catcher at ${url}. ` +
        "Start it with `pnpm services:up` or set MAILPIT_URL.",
      { cause: error },
    )
  }
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return (await response.json()) as T
}
