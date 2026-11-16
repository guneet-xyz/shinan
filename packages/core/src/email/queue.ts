import { and, eq, gt, ne, schema, sql } from "@shinan/db"
import type { EmailContent, EmailKind, Transaction } from "@shinan/db"

import type { RequestInfo } from "../context.js"
import { addJob } from "../jobs.js"
import type { JobQueue, QueueDefinition } from "../jobs.js"
import { networkAddress } from "../security-log.js"
import { normalizeEmail } from "../validation.js"

/**
 * The queue the worker sends email from. Temporary errors are retried with
 * backoff (30 seconds, doubling, at most 10 minutes apart) for up to an hour
 * (architecture §9.2); the hour is enforced by `notAfter`, and the retry
 * limit only has to outlast it. Jobs carry only the delivery ID; the message
 * stays in `email_deliveries` until the email is finished. `notify` lets the
 * worker pick a job up as soon as it is committed.
 */
export const emailQueue = {
  name: "email",
  options: {
    retryLimit: 12,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 600,
    expireInSeconds: 60,
    notify: true,
  },
} as const satisfies QueueDefinition

/** What an email job carries. */
export interface EmailJob {
  deliveryId: string
}

/** The longest Shinan keeps trying to send an email (architecture §9.2). */
export const emailRetryWindowMs = 60 * 60 * 1000

/**
 * Emails allowed per hour (architecture §9.2, identity §3.1, §10): per
 * recipient for each kind, and per network address for sign-in links.
 * Proposed values; architecture leaves the numbers open.
 */
export const emailLimits = {
  windowMinutes: 60,
  perRecipient: {
    magic_link: 5,
    invitation: 5,
    security_alert: 20,
  } satisfies Record<EmailKind, number>,
  magicLinksPerNetworkAddress: 20,
} as const

export interface OutgoingEmail {
  kind: EmailKind
  /**
   * The recipient. Callers send only to an address Shinan verified, or, for
   * magic links and invitations, an address on the email allowlist
   * (architecture §9.2).
   */
  to: string
  content: EmailContent
  /**
   * Not sent after this time, such as a magic link's expiry. Never later
   * than an hour from now.
   */
  notAfter?: Date
}

export type QueuedEmail =
  | { queued: true; deliveryId: string }
  | { queued: false; reason: "throttled"; deliveryId: string }

/**
 * Queues an email in the caller's transaction, unless throttling refuses
 * it. Refusals are recorded but not raised, so a caller such as the sign-in
 * page can answer the same either way (architecture §9.2).
 *
 * Concurrent requests for the same recipient or network address take turns
 * on a transaction-level advisory lock, so the limits hold under load.
 */
export async function queueEmail(
  scope: { tx: Transaction; jobs: JobQueue | undefined; request: RequestInfo },
  email: OutgoingEmail,
): Promise<QueuedEmail> {
  const { tx } = scope
  const recipient = normalizeEmail(email.to)
  const address =
    email.kind === "magic_link"
      ? networkAddress(scope.request.networkAddress)
      : null
  const latest = new Date(Date.now() + emailRetryWindowMs)
  const notAfter =
    email.notAfter && email.notAfter < latest ? email.notAfter : latest

  await lock(tx, `recipient:${recipient}`)
  if (address) await lock(tx, `network-address:${address}`)

  const throttled =
    (await countRecent(tx, email.kind, { recipient })) >=
      emailLimits.perRecipient[email.kind] ||
    (address !== null &&
      (await countRecent(tx, email.kind, { networkAddress: address })) >=
        emailLimits.magicLinksPerNetworkAddress)

  const [delivery] = await tx
    .insert(schema.emailDeliveries)
    .values({
      kind: email.kind,
      recipient,
      networkAddress: address,
      notAfter,
      ...(throttled
        ? { status: "throttled", finishedAt: sql`now()` }
        : { message: email.content }),
    })
    .returning({ id: schema.emailDeliveries.id })
  const deliveryId = delivery!.id

  if (throttled) return { queued: false, reason: "throttled", deliveryId }
  await addJob(scope, emailQueue, { deliveryId } satisfies EmailJob, {
    id: deliveryId,
  })
  return { queued: true, deliveryId }
}

async function lock(tx: Transaction, key: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`shinan:email:${key}`}, 0))`,
  )
}

/** Emails of a kind queued (not throttled) in the last window. */
async function countRecent(
  tx: Transaction,
  kind: EmailKind,
  by: { recipient: string } | { networkAddress: string },
): Promise<number> {
  const t = schema.emailDeliveries
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(t)
    .where(
      and(
        eq(t.kind, kind),
        "recipient" in by
          ? eq(t.recipient, by.recipient)
          : eq(t.networkAddress, by.networkAddress),
        ne(t.status, "throttled"),
        gt(
          t.createdAt,
          sql`now() - make_interval(mins => ${emailLimits.windowMinutes})`,
        ),
      ),
    )
  return row!.count
}
