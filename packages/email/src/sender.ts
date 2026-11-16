/**
 * One email message, as a channel sends it. Shinan sends each message to one
 * recipient (architecture §9.2).
 */
export interface EmailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

/**
 * How a send ended. Delivery errors are returned, not thrown, so callers
 * decide about retries from `temporary` alone (architecture §9.2):
 * temporary errors (throttling, service errors, network trouble) may succeed
 * later; permanent ones (a rejected message, bad configuration) will not.
 */
export type SendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; temporary: boolean; code: string }

/**
 * The small interface every email channel implements, so callers do not
 * depend on SES or any other provider (architecture §9.2).
 */
export interface EmailSender {
  /** Sends one message. Resolves with the outcome; never throws for it. */
  send(message: EmailMessage): Promise<SendResult>
  /** Releases connections. */
  close(): Promise<void>
}

/** The From address and display name. */
export interface EmailFrom {
  address: string
  name?: string
}

/**
 * Formats the From header value. Display names outside printable ASCII are
 * MIME encoded words (RFC 2047), as SES requires.
 */
export function formatFrom(from: EmailFrom): string {
  const address = from.address.trim()
  if (!/^[^\s@<>",]+@[^\s@<>",]+$/.test(address)) {
    throw new Error(`Not a valid From address: "${from.address}"`)
  }
  const name = from.name?.replace(/[\r\n]+/g, " ").trim()
  if (!name) return address
  if (/^[\x20-\x7e]*$/.test(name)) {
    return `"${name.replace(/["\\]/g, "\\$&")}" <${address}>`
  }
  return `=?UTF-8?B?${Buffer.from(name, "utf8").toString("base64")}?= <${address}>`
}

/**
 * An error code safe to store and log: a short identifier, never a message
 * text that could carry addresses or content.
 */
export function safeCode(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value)
    ? value
    : fallback
}
