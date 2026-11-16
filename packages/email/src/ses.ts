import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2"
import type { SendEmailCommandOutput } from "@aws-sdk/client-sesv2"

import { formatFrom, safeCode } from "./sender.js"
import type {
  EmailFrom,
  EmailMessage,
  EmailSender,
  SendResult,
} from "./sender.js"

export interface SesOptions {
  from: EmailFrom
  /** The AWS region of the SES identity, such as `us-east-1`. */
  region: string
  /**
   * An access key for a user that may only send email (architecture §9.4).
   * When absent, the AWS SDK's default credential chain is used.
   */
  credentials?: { accessKeyId: string; secretAccessKey: string }
  /** The SES configuration set to send with, such as `guneet-dev`. */
  configurationSet?: string
  /** A client to use instead of creating one; tests pass a mock. */
  client?: SesClient
}

/** The part of the SES v2 client this sender uses. */
export interface SesClient {
  send(command: SendEmailCommand): Promise<SendEmailCommandOutput>
  destroy(): void
}

/** Requests that hang are cut off, so a job never outlives its claim. */
const requestTimeoutMs = 15_000
const connectionTimeoutMs = 5_000

/**
 * Sends email through the SES API with the AWS SDK for JavaScript v3
 * (D-044, architecture §9.2). Retries across time are the job queue's
 * business; the SDK only retries once, quickly, for blips.
 */
export function createSesSender(options: SesOptions): EmailSender {
  const from = formatFrom(options.from)
  const client =
    options.client ??
    new SESv2Client({
      region: options.region,
      ...(options.credentials ? { credentials: options.credentials } : {}),
      maxAttempts: 2,
      requestHandler: {
        requestTimeout: requestTimeoutMs,
        connectionTimeout: connectionTimeoutMs,
      },
    })

  return {
    async send(message: EmailMessage): Promise<SendResult> {
      const command = new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [message.to] },
        ...(options.configurationSet
          ? { ConfigurationSetName: options.configurationSet }
          : {}),
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: message.text, Charset: "UTF-8" },
              ...(message.html === undefined
                ? {}
                : { Html: { Data: message.html, Charset: "UTF-8" } }),
            },
          },
        },
      })
      try {
        const output = await client.send(command)
        return { ok: true, messageId: output.MessageId ?? null }
      } catch (error) {
        return { ok: false, ...classifySesError(error) }
      }
    },
    close() {
      client.destroy()
      return Promise.resolve()
    },
  }
}

/** SES errors worth trying again later (architecture §9.2). */
const temporarySesErrors = new Set([
  "TooManyRequestsException",
  "LimitExceededException",
  "ThrottlingException",
  "Throttling",
  "InternalServiceErrorException",
  "ServiceUnavailable",
  "RequestTimeout",
  "RequestTimeoutException",
])

/**
 * Throttling and service errors are temporary; other answers from SES (a
 * rejected message, an unverified sender, bad credentials, paused sending)
 * are permanent. No answer at all (a network error or timeout) is temporary,
 * except missing credentials, which only configuration can fix.
 */
export function classifySesError(error: unknown): {
  temporary: boolean
  code: string
} {
  const fields = (
    typeof error === "object" && error !== null ? error : {}
  ) as Record<string, unknown>
  const code = safeCode(fields.name ?? fields.code, "UnknownError")
  const metadata = fields.$metadata as { httpStatusCode?: number } | undefined
  const status = metadata?.httpStatusCode

  if (status === undefined) {
    return { temporary: !/credential/i.test(code), code }
  }
  const temporary =
    temporarySesErrors.has(code) ||
    fields.$fault === "server" ||
    status === 429 ||
    status >= 500
  return { temporary, code }
}
