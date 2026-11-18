import { and, eq, gt, schema, sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import { shinan } from "../actor.js"
import { atInstallation } from "../authorize.js"
import type { Context, InstallationScope } from "../context.js"
import { queueEmail } from "../email/queue.js"
import { emailChangeEmail } from "../email/templates.js"
import {
  BusyError,
  InvalidInputError,
  NotFoundError,
  RuleViolationError,
} from "../errors.js"
import { takeRateLimit } from "../rate-limits.js"
import { recordSecurityEntry } from "../security-log.js"
import { hashToken, newToken } from "../tokens.js"
import { normalizeEmail } from "../validation.js"
import { isAllowlisted, personWith } from "./allowlist.js"
import { moveEmailAddress } from "./email-address.js"
import { getInstallation } from "./installation.js"
import { installationLink, sendSecurityAlert } from "./sign-in.js"

/**
 * How long the link sent to a new address works (**proposed**, #66): an
 * hour, longer than a sign-in link's 15 minutes, since the person may first
 * have to reach a mailbox they do not use every day; it works only for them,
 * signed in, so the longer window gives a stranger nothing.
 */
export const emailChangeMinutes = 60

/** The change waiting for its link, as the person sees it. */
export interface PendingEmailChange {
  email: string
  expiresAt: Date
}

/** The person's own change waiting for confirmation, if any. */
export async function getEmailChange(
  ctx: Context,
): Promise<PendingEmailChange | null> {
  return atInstallation(ctx, "account.read", async (scope) => {
    const [row] = await scope.tx
      .select({
        email: schema.emailChanges.email,
        expiresAt: schema.emailChanges.expiresAt,
      })
      .from(schema.emailChanges)
      .where(
        and(
          eq(schema.emailChanges.personId, scope.actor.personId!),
          gt(schema.emailChanges.expiresAt, sql`now()`),
        ),
      )
    return row ?? null
  })
}

/**
 * A person asks to change their own email address (identity §3.4), with
 * re-authentication. The new address must be on the email allowlist (an
 * operator adds it first) and belong to no other account; an operator's
 * address, either one, is changed in the configuration and with the
 * operator's command instead. Shinan emails a link to the new address and
 * alerts the old one; nothing changes until the person opens the link,
 * signed in (`confirmEmailChange`). Asking again replaces the earlier
 * request and its link. Limited per person (`email-change`).
 */
export async function requestEmailChange(
  ctx: Context,
  input: { email: string },
): Promise<PendingEmailChange> {
  // The permission check first, then the rate limit, which takes its own
  // connection, so it runs between transactions, never inside one. Counted
  // as Shinan, by the person, whether or not the request then succeeds.
  const personId = await atInstallation(ctx, "email-change.request", (scope) =>
    Promise.resolve(scope.actor.personId!),
  )
  const limit = await takeRateLimit(
    { db: ctx.db, actor: shinan, request: ctx.request ?? {} },
    "email-change",
    { key: personId },
  )
  if (!limit.allowed)
    throw new BusyError(
      "email-change",
      "Too many email address changes asked for; try again later",
      limit.retryAfterSeconds,
    )
  return atInstallation(ctx, "email-change.request", async (scope) => {
    const person = await personOf(scope.tx, personId)
    let email: string
    try {
      email = normalizeEmail(input.email)
    } catch {
      throw new InvalidInputError("email", "Enter an email address")
    }
    if (email === person.email)
      throw new InvalidInputError(
        "same-email",
        "That is already your email address",
      )
    await checkNewAddress(scope.tx, person, email)

    const token = newToken()
    const [pending] = await scope.tx
      .insert(schema.emailChanges)
      .values({
        personId,
        email,
        tokenHash: hashToken(token),
        expiresAt: sql`now() + make_interval(mins => ${emailChangeMinutes})`,
      })
      .onConflictDoUpdate({
        target: schema.emailChanges.personId,
        set: {
          email,
          tokenHash: hashToken(token),
          expiresAt: sql`now() + make_interval(mins => ${emailChangeMinutes})`,
          createdAt: sql`now()`,
        },
      })
      .returning()

    const installation = await getInstallation(scope.tx)
    await queueEmail(scope, {
      kind: "email_change",
      to: email,
      content: emailChangeEmail({
        installationName: installation?.name ?? "Shinan",
        link: installationLink(scope, `/email-change#${token}`),
        expiresInMinutes: emailChangeMinutes,
      }),
    })
    await sendSecurityAlert(scope, person, {
      kind: "email-change-requested",
      newEmail: email,
      at: new Date(),
    })
    await record(scope, "account.email-change-requested", personId, {
      from: person.email,
      to: email,
    })
    return { email: pending!.email, expiresAt: pending!.expiresAt }
  })
}

/**
 * Confirms a change from the link sent to the new address (identity §3.4):
 * only the person who asked, signed in, can, so a stranger who is sent the
 * link (or tricked into opening it) changes nothing. The address is checked
 * again, then moved as the operator's command moves it
 * (`moveEmailAddress`): the old address leaves the allowlist and its
 * pending invitations are withdrawn, and every other sign-in session of the
 * person ends, keeping the one they confirmed from. Agent tokens stay: the
 * person is the same, and the alerts say how to revoke them. Both addresses
 * are alerted. An unknown, used, expired or someone else's link answers not
 * found.
 */
export async function confirmEmailChange(
  ctx: Context,
  input: { token: string },
): Promise<{ email: string }> {
  return atInstallation(ctx, "email-change.complete", async (scope) => {
    const personId = scope.actor.personId!
    const [pending] = await scope.tx
      .delete(schema.emailChanges)
      .where(
        and(
          eq(schema.emailChanges.tokenHash, hashToken(String(input.token))),
          eq(schema.emailChanges.personId, personId),
          gt(schema.emailChanges.expiresAt, sql`now()`),
        ),
      )
      .returning()
    if (!pending) throw new NotFoundError()
    const person = await personOf(scope.tx, personId)
    await checkNewAddress(scope.tx, person, pending.email)
    await moveEmailAddress(scope, person, pending.email, {
      by: "self",
      addToAllowlist: false,
      ...(ctx.actor.kind === "person" && ctx.actor.signInSessionId
        ? { keepSession: ctx.actor.signInSessionId }
        : {}),
    })
    const alert = {
      kind: "email-changed" as const,
      from: person.email,
      to: pending.email,
      at: new Date(),
    }
    await sendSecurityAlert(scope, { email: person.email }, alert)
    await sendSecurityAlert(scope, { email: pending.email }, alert)
    return { email: pending.email }
  })
}

/** Cancels the person's waiting change; its link stops working. */
export async function cancelEmailChange(ctx: Context): Promise<void> {
  await atInstallation(ctx, "email-change.complete", async (scope) => {
    const personId = scope.actor.personId!
    const [cancelled] = await scope.tx
      .delete(schema.emailChanges)
      .where(eq(schema.emailChanges.personId, personId))
      .returning()
    if (!cancelled) throw new NotFoundError()
    await record(scope, "account.email-change-cancelled", personId, {
      to: cancelled.email,
    })
  })
}

// Internal helpers

type ChangeScope = InstallationScope<
  "email-change.request" | "email-change.complete"
>

async function personOf(
  tx: Transaction,
  personId: string,
): Promise<{ id: string; email: string }> {
  const [person] = await tx
    .select({ id: schema.people.id, email: schema.people.email })
    .from(schema.people)
    .where(eq(schema.people.id, personId))
  if (!person) throw new NotFoundError()
  return person
}

/**
 * The rules for the new address, checked when the change is asked for and
 * again when it is confirmed, since either may have changed meanwhile.
 */
async function checkNewAddress(
  tx: Transaction,
  person: { id: string; email: string },
  email: string,
): Promise<void> {
  // Operator rights come from the configured addresses (identity §12): the
  // operator changes theirs in the configuration and with the recovery
  // command, which keeps the two in step.
  if ((await isOperator(tx, person.email)) || (await isOperator(tx, email)))
    throw new RuleViolationError(
      "operator-address",
      "An operator's email address is changed in the installation's configuration, by an operator",
    )
  if (!(await isAllowlisted(tx, email)))
    throw new RuleViolationError(
      "not-allowlisted",
      "That address is not on the email allowlist. Ask an installation operator to add it first",
    )
  const holder = await personWith(tx, email)
  if (holder !== null && holder !== person.id)
    throw new RuleViolationError(
      "email-taken",
      "That email address has another account",
    )
}

async function isOperator(tx: Transaction, email: string): Promise<boolean> {
  const [row] = await tx
    .select({ email: schema.installationOperators.email })
    .from(schema.installationOperators)
    .where(eq(schema.installationOperators.email, email))
  return row !== undefined
}

async function record(
  scope: ChangeScope,
  action: string,
  personId: string,
  details: Record<string, unknown>,
): Promise<void> {
  await recordSecurityEntry(scope.tx, {
    workspaceId: null,
    action,
    outcome: "succeeded",
    actor: scope.actor,
    subjectPersonId: personId,
    request: scope.request,
    details,
  })
}
