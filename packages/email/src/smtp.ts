import { createTransport } from "nodemailer"

import { formatFrom, safeCode } from "./sender.js"
import type {
  EmailFrom,
  EmailMessage,
  EmailSender,
  SendResult,
} from "./sender.js"

export interface SmtpOptions {
  from: EmailFrom
  host: string
  port: number
}

/**
 * Sends email over plain SMTP without authentication, for the local mail
 * catcher (Mailpit) in development and tests only. Shinan sends real email
 * through SES, not SMTP (D-044); the server refuses this sender in
 * production.
 */
export function createSmtpSender(options: SmtpOptions): EmailSender {
  const from = formatFrom(options.from)
  const transport = createTransport({
    host: options.host,
    port: options.port,
    secure: false,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 15_000,
  })

  return {
    async send(message: EmailMessage): Promise<SendResult> {
      try {
        const info = await transport.sendMail({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html === undefined ? {} : { html: message.html }),
        })
        return { ok: true, messageId: info.messageId ?? null }
      } catch (error) {
        return { ok: false, ...classifySmtpError(error) }
      }
    },
    close() {
      transport.close()
      return Promise.resolve()
    },
  }
}

/** SMTP errors that come from the connection rather than the message. */
const temporarySmtpErrors = new Set([
  "ECONNECTION",
  "ETIMEDOUT",
  "ESOCKET",
  "EDNS",
  "ECONNREFUSED",
  "ECONNRESET",
])

/**
 * A 4xx reply is temporary and a 5xx reply permanent (RFC 5321); without a
 * reply, connection trouble is temporary and anything else permanent.
 */
export function classifySmtpError(error: unknown): {
  temporary: boolean
  code: string
} {
  const fields = (
    typeof error === "object" && error !== null ? error : {}
  ) as Record<string, unknown>
  const reply = fields.responseCode
  if (typeof reply === "number" && reply >= 400 && reply < 600) {
    return { temporary: reply < 500, code: `SMTP${reply}` }
  }
  const code = safeCode(fields.code, "UnknownError")
  return { temporary: temporarySmtpErrors.has(code), code }
}
