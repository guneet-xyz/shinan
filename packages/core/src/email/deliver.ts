import { and, eq, schema, sql } from "@shinan/db"
import type { EmailStatus } from "@shinan/db"
import type { EmailSender, SendResult } from "@shinan/email"

import { atInstallation } from "../authorize.js"
import type { Context } from "../context.js"
import { isId } from "../validation.js"

/** One run of an email job, as the job queue hands it to the worker. */
export interface EmailAttempt {
  deliveryId: string
  /** How many times the job has been retried before this run. */
  retryCount: number
  /** How many retries the job may have in all. */
  retryLimit: number
}

export type DeliveryOutcome =
  | { status: "sent"; providerMessageId: string | null }
  | { status: "rejected" | "given_up"; code: string }
  /** The email was already finished, or does not exist. */
  | { status: "skipped" }

/**
 * Thrown when a temporary error should be retried later; the job queue
 * retries the job with backoff.
 */
export class EmailRetryError extends Error {
  override name = "EmailRetryError"
  constructor(readonly code: string) {
    super(`Temporary email error, retrying later: ${code}`)
  }
}

/**
 * Sends one queued email and records how it ended (architecture §9.2):
 * accepted by the provider, rejected for good, or given up after temporary
 * errors past its deadline or the last retry. A temporary error before then
 * throws `EmailRetryError` so the job queue retries. The message is removed
 * when the email is finished, and nothing is sent after `notAfter`.
 *
 * Safe to run twice: a finished email is skipped. If the worker stops after
 * the provider accepted a message but before this records it, the next run
 * sends it again; that is the job queue's at-least-once delivery.
 */
export async function deliverEmail(
  ctx: Context,
  sender: EmailSender,
  attempt: EmailAttempt,
  now: () => Date = () => new Date(),
): Promise<DeliveryOutcome> {
  if (!isId(attempt.deliveryId)) return { status: "skipped" }
  const id = attempt.deliveryId.toLowerCase()
  const lastAttempt = attempt.retryCount >= attempt.retryLimit

  try {
    const delivery = await atInstallation(ctx, "email.deliver", (scope) =>
      scope.tx
        .select({
          recipient: schema.emailDeliveries.recipient,
          status: schema.emailDeliveries.status,
          message: schema.emailDeliveries.message,
          notAfter: schema.emailDeliveries.notAfter,
        })
        .from(schema.emailDeliveries)
        .where(eq(schema.emailDeliveries.id, id))
        .then(([row]) => row),
    )
    if (delivery?.status !== "queued" || !delivery.message) {
      return { status: "skipped" }
    }
    if (now() >= delivery.notAfter) {
      return await finish(ctx, id, "given_up", { code: "Expired" }, false)
    }

    let result: SendResult
    try {
      result = await sender.send({
        to: delivery.recipient,
        ...delivery.message,
      })
    } catch {
      result = { ok: false, temporary: true, code: "SenderError" }
    }

    if (result.ok) {
      return await finish(ctx, id, "sent", {
        providerMessageId: result.messageId,
      })
    }
    if (!result.temporary) {
      return await finish(ctx, id, "rejected", { code: result.code })
    }
    if (lastAttempt || now() >= delivery.notAfter) {
      return await finish(ctx, id, "given_up", { code: result.code })
    }
    await atInstallation(ctx, "email.deliver", (scope) =>
      scope.tx
        .update(schema.emailDeliveries)
        .set({
          attempts: sql`${schema.emailDeliveries.attempts} + 1`,
          lastError: result.code,
        })
        .where(queued(id)),
    )
    throw new EmailRetryError(result.code)
  } catch (error) {
    // On the last run, an unexpected error (such as a lost database
    // connection) still finishes the email, so its message is not kept.
    if (lastAttempt && !(error instanceof EmailRetryError)) {
      await finish(ctx, id, "given_up", { code: "InternalError" }).catch(
        () => {},
      )
    }
    throw error
  }
}

async function finish(
  ctx: Context,
  id: string,
  status: Exclude<EmailStatus, "queued" | "throttled">,
  result: { code?: string; providerMessageId?: string | null },
  attempted = true,
): Promise<DeliveryOutcome> {
  await atInstallation(ctx, "email.deliver", (scope) =>
    scope.tx
      .update(schema.emailDeliveries)
      .set({
        status,
        message: null,
        finishedAt: sql`now()`,
        ...(result.code === undefined ? {} : { lastError: result.code }),
        ...(status === "sent"
          ? { providerMessageId: result.providerMessageId ?? null }
          : {}),
        ...(attempted
          ? { attempts: sql`${schema.emailDeliveries.attempts} + 1` }
          : {}),
      })
      .where(queued(id)),
  )
  return status === "sent"
    ? { status, providerMessageId: result.providerMessageId ?? null }
    : { status, code: result.code ?? "UnknownError" }
}

function queued(id: string) {
  return and(
    eq(schema.emailDeliveries.id, id),
    eq(schema.emailDeliveries.status, "queued"),
  )
}
