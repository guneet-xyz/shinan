import { and, desc, eq, gt, lt, schema, sql } from "@shinan/db"
import type { Transaction } from "@shinan/db"

import type { ResolvedActor } from "../actor.js"
import { atInstallation } from "../authorize.js"
import type { Context, InstallationScope, RequestInfo } from "../context.js"
import { violatedUniqueConstraint } from "../database-errors.js"
import { queueEmail } from "../email/queue.js"
import { magicLinkEmail, securityAlertEmail } from "../email/templates.js"
import type { SecurityAlert } from "../email/templates.js"
import {
  InvalidInputError,
  NotFoundError,
  RuleViolationError,
} from "../errors.js"
import { recordSecurityEntry } from "../security-log.js"
import { hashToken, newToken } from "../tokens.js"
import { isId, normalizeEmail } from "../validation.js"
import { revokeTokensOfPerson } from "./agents.js"
import { isAllowlisted, personWith } from "./allowlist.js"
import { getInstallation } from "./installation.js"
import { createAccount } from "./people.js"

/** A magic link works once and expires after 15 minutes (identity §3.1). */
export const signInLinkMinutes = 15

/**
 * How recent a sign-in must be for sensitive actions (identity §3.3, open
 * question 1). Proposed: 10 minutes, long enough for a few sensitive
 * actions in a row after signing in again, short enough that a sign-in
 * session left open or stolen rarely falls inside it.
 */
export const reauthenticationMinutes = 10

/** The first-start setup link lasts a day (architecture §12). */
export const setupLinkHours = 24

/** How long a GitHub sign-in waits for its email address (identity §3.2). */
export const pendingGitHubMinutes = 15

export type SignInMethod = "email" | "github"

type SignInScope = InstallationScope<"sign-in">

// First start (identity §3.2, architecture §12)

/**
 * Creates the one-time setup link's token if the installation has not been
 * claimed yet, replacing any earlier one, so a restart gives a fresh link.
 * Returns null once the first operator account exists. Only the token's hash
 * is stored; the caller prints the link once.
 */
export async function prepareSetupLink(ctx: Context): Promise<string | null> {
  return atInstallation(ctx, "sign-in", async (scope) => {
    if (await isClaimed(scope.tx)) return null
    const token = newToken()
    const values = {
      tokenHash: hashToken(token),
      expiresAt: sql`now() + make_interval(hours => ${setupLinkHours})`,
      email: null,
    }
    await scope.tx
      .insert(schema.setupLinks)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({
        target: schema.setupLinks.id,
        set: { ...values, createdAt: sql`now()` },
      })
    await record(scope, "installation.setup-link-created", null, {
      expiresInHours: setupLinkHours,
    })
    return token
  })
}

/**
 * Someone opened the setup link and chose a configured operator address. The
 * link is bound to that address and cannot be used again; the sign-in link
 * sent there then creates the first operator account (`openSignInLink`). An
 * unknown, used or expired setup link answers not found.
 */
export async function startSetup(
  ctx: Context,
  input: { token: string; email: string },
): Promise<void> {
  await atInstallation(ctx, "sign-in", async (scope) => {
    const setup = await currentSetup(scope.tx)
    // The link works once (architecture §12): once an address was chosen,
    // a new link needs a restart.
    if (!setup || setup.tokenHash !== hashToken(input.token) || setup.email) {
      throw new NotFoundError()
    }
    const email = normalizeEmail(input.email)
    if (!(await isOperator(scope.tx, email))) {
      throw new InvalidInputError(
        "not-operator",
        "That is not one of the operator email addresses in the installation's configuration",
      )
    }
    await scope.tx
      .update(schema.setupLinks)
      .set({ email })
      .where(eq(schema.setupLinks.id, 1))
    await record(scope, "installation.setup-started", null, { email })
  })
}

// Email magic links (identity §3.1)

/**
 * Emails a sign-in link, if the address may have one: an allowlisted address,
 * or before the first start, only the operator address the setup link was
 * used with. Otherwise nothing happens, and the caller answers the same
 * either way, so the sign-in form reveals nothing (identity §10). A pending
 * GitHub sign-in from the same browser is bound to the address.
 */
export async function sendSignInLink(
  ctx: Context,
  input: {
    email: string
    link: string
    expiresAt: Date
    pendingGitHubToken?: string
  },
): Promise<void> {
  await atInstallation(ctx, "sign-in", async (scope) => {
    let email: string
    try {
      email = normalizeEmail(input.email)
    } catch {
      return
    }
    if (!(await mayReceiveSignInLink(scope.tx, email))) return

    if (input.pendingGitHubToken) {
      await scope.tx
        .update(schema.pendingGitHubSignIns)
        .set({ email })
        .where(
          and(
            eq(
              schema.pendingGitHubSignIns.tokenHash,
              hashToken(input.pendingGitHubToken),
            ),
            gt(schema.pendingGitHubSignIns.expiresAt, sql`now()`),
          ),
        )
    }

    const installation = await getInstallation(scope.tx)
    const queued = await queueEmail(scope, {
      kind: "magic_link",
      to: email,
      content: magicLinkEmail({
        installationName: installation?.name ?? "Shinan",
        link: input.link,
        expiresInMinutes: signInLinkMinutes,
      }),
      notAfter: input.expiresAt,
    })
    if (queued.queued) {
      await record(
        scope,
        "sign-in.link-sent",
        await personWith(scope.tx, email),
        {
          method: "email",
        },
      )
    }
  })
}

export type OpenedSignInLink =
  | { allowed: true; personId: string; accountCreated: boolean }
  | { allowed: false }

/**
 * A valid magic link for `email` is being opened. Creates the account if the
 * address has none yet: this is the only way accounts are created
 * (identity §3.2). Before the first start, only the operator address chosen
 * on the setup link can, and doing so claims the installation for good. An
 * address no longer allowed is refused and the refusal recorded.
 */
export async function openSignInLink(
  ctx: Context,
  input: { email: string },
): Promise<OpenedSignInLink> {
  return atInstallation(ctx, "sign-in", async (scope) => {
    const email = normalizeEmail(input.email)

    if (!(await isClaimed(scope.tx))) {
      const personId = await personWith(scope.tx, email)
      const setup = await currentSetup(scope.tx)
      if (
        !setup ||
        setup.email !== email ||
        !(await isOperator(scope.tx, email))
      ) {
        await recordFailure(scope, "email", "not-allowed", personId)
        return { allowed: false }
      }
      // Locks the installation row, so two links cannot both claim it.
      const [claimed] = await scope.tx
        .update(schema.installation)
        .set({ claimedAt: sql`now()` })
        .where(
          and(
            eq(schema.installation.id, 1),
            sql`${schema.installation.claimedAt} is null`,
          ),
        )
        .returning()
      if (claimed) {
        await scope.tx.delete(schema.setupLinks)
        await scope.tx
          .insert(schema.emailAllowlist)
          .values({ email })
          .onConflictDoNothing()
        const person = personId
          ? { id: personId }
          : await createAccount(scope, { email })
        await record(scope, "installation.claimed", person.id, { email })
        return { allowed: true, personId: person.id, accountCreated: !personId }
      }
      // A concurrent opening (a double click) claimed it first and has
      // committed: carry on as after the first start.
    }

    const personId = await personWith(scope.tx, email)
    if (!(await isAllowlisted(scope.tx, email))) {
      await recordFailure(scope, "email", "not-allowed", personId)
      return { allowed: false }
    }
    if (personId) return { allowed: true, personId, accountCreated: false }
    const person = await createAccount(scope, { email })
    return { allowed: true, personId: person.id, accountCreated: true }
  })
}

/**
 * Whether a person may start a sign-in session now, by either method: their
 * address must still be on the allowlist (identity §3.2).
 */
export async function maySignIn(
  ctx: Context,
  input: { personId: string },
): Promise<boolean> {
  return atInstallation(ctx, "sign-in", async (scope) => {
    if (!isId(input.personId)) return false
    const [person] = await scope.tx
      .select({ email: schema.people.email })
      .from(schema.people)
      .where(eq(schema.people.id, input.personId))
    if (!person || !(await isAllowlisted(scope.tx, person.email))) {
      await recordFailure(
        scope,
        null,
        "not-allowed",
        person ? input.personId : null,
      )
      return false
    }
    return true
  })
}

/** Records a sign-in that did not happen, such as a used or expired link. */
export async function recordSignInFailure(
  ctx: Context,
  input: { method: SignInMethod; reason: string },
): Promise<void> {
  await atInstallation(ctx, "sign-in", async (scope) => {
    await recordFailure(scope, input.method, safeCode(input.reason), null)
  })
}

export interface SignInRecord {
  personId: string
  sessionId: string
  method: SignInMethod
  /** Whether the account was created by this sign-in. */
  accountCreated: boolean
  /**
   * The sign-in session this browser had before, which the new one
   * replaces. Signing in again while signed in as the same person is a
   * re-authentication (identity §3.3, §11).
   */
  previousSessionId?: string
  /** The browser's long-lived cookie, if it has one. */
  browserToken?: string
  /** A GitHub sign-in from this browser that waits for this address. */
  pendingGitHubToken?: string
}

/**
 * Records a sign-in that started a sign-in session (identity §11), ends the
 * session it replaces, links GitHub if this completes a GitHub sign-in by
 * a new GitHub account, and emails the person if the browser is new to
 * their account (identity §3.3). Returns the browser cookie to set.
 */
export async function recordSignIn(
  ctx: Context,
  input: SignInRecord,
): Promise<{ browserToken: string }> {
  return atInstallation(ctx, "sign-in", async (scope) => {
    const [person] = await scope.tx
      .select({ id: schema.people.id, email: schema.people.email })
      .from(schema.people)
      .where(eq(schema.people.id, input.personId))
    if (!person) throw new NotFoundError()

    let reauthentication = false
    if (input.previousSessionId && isId(input.previousSessionId)) {
      const [previous] = await scope.tx
        .delete(schema.signInSessions)
        .where(
          and(
            eq(schema.signInSessions.id, input.previousSessionId),
            sql`${schema.signInSessions.id} <> ${input.sessionId}`,
          ),
        )
        .returning({ personId: schema.signInSessions.personId })
      reauthentication = previous?.personId === person.id
    }
    await record(scope, "sign-in.succeeded", person.id, {
      method: input.method,
      sessionId: input.sessionId,
      ...(reauthentication ? { reauthentication: true } : {}),
    })

    if (input.pendingGitHubToken) {
      await completeGitHubSignIn(scope, person, input)
    }

    const browserToken = input.browserToken ?? newToken()
    const [known] = await scope.tx
      .update(schema.knownBrowsers)
      .set({ lastSeenAt: sql`now()` })
      .where(
        and(
          eq(schema.knownBrowsers.personId, person.id),
          eq(schema.knownBrowsers.browserHash, hashToken(browserToken)),
        ),
      )
      .returning()
    if (!known) {
      await scope.tx
        .insert(schema.knownBrowsers)
        .values({ personId: person.id, browserHash: hashToken(browserToken) })
        .onConflictDoNothing()
      if (!input.accountCreated) {
        await sendSecurityAlert(scope, person, {
          kind: "new-browser-sign-in",
          client: describeClient(scope.request.client),
          at: new Date(),
        })
      }
    }
    return { browserToken }
  })
}

/**
 * Someone signed in with a GitHub account no person has linked. Nothing is
 * linked yet: the browser gets a token, and the person is asked for their
 * email address, which a magic link must confirm (identity §3.1, §3.2).
 * Only GitHub's stable account number counts; the login is for display.
 */
export async function startGitHubSignIn(
  ctx: Context,
  input: { githubAccountId: string; login?: string },
): Promise<string> {
  return atInstallation(ctx, "sign-in", async (scope) => {
    const token = newToken()
    await scope.tx.insert(schema.pendingGitHubSignIns).values({
      tokenHash: hashToken(token),
      githubAccountId: input.githubAccountId,
      githubLogin: input.login ?? null,
      expiresAt: sql`now() + make_interval(mins => ${pendingGitHubMinutes})`,
    })
    await recordFailure(scope, "github", "github-not-linked", null, {
      githubAccountId: input.githubAccountId,
    })
    return token
  })
}

/** The GitHub sign-in waiting in this browser, if any, for the email step. */
export async function findPendingGitHubSignIn(
  ctx: Context,
  input: { token: string },
): Promise<{ login: string | null } | null> {
  return atInstallation(ctx, "sign-in", async (scope) => {
    const [pending] = await scope.tx
      .select({ login: schema.pendingGitHubSignIns.githubLogin })
      .from(schema.pendingGitHubSignIns)
      .where(
        and(
          eq(schema.pendingGitHubSignIns.tokenHash, hashToken(input.token)),
          gt(schema.pendingGitHubSignIns.expiresAt, sql`now()`),
        ),
      )
    return pending ?? null
  })
}

/**
 * Deletes sign-in records that can no longer be used: GitHub sign-ins that
 * waited too long for an email address, and sign-in sessions past their
 * expiry, which hold network addresses and user agents. Run hourly by the
 * worker.
 */
export async function pruneSignInRecords(
  ctx: Context,
): Promise<{ pendingGitHubSignIns: number; signInSessions: number }> {
  return atInstallation(ctx, "sign-in", async (scope) => {
    const pending = await scope.tx
      .delete(schema.pendingGitHubSignIns)
      .where(lt(schema.pendingGitHubSignIns.expiresAt, sql`now()`))
      .returning({ id: schema.pendingGitHubSignIns.id })
    const sessions = await scope.tx
      .delete(schema.signInSessions)
      .where(lt(schema.signInSessions.expiresAt, sql`now()`))
      .returning({ id: schema.signInSessions.id })
    return {
      pendingGitHubSignIns: pending.length,
      signInSessions: sessions.length,
    }
  })
}

// The signed-in person's own sign-in sessions and methods

export interface SignInSession {
  id: string
  createdAt: Date
  /** Last activity, to within a few minutes. */
  lastActiveAt: Date
  expiresAt: Date
  networkAddress: string | null
  /** The user agent the session was started with. */
  client: string | null
  /** A short description of that browser, such as "Firefox on Linux". */
  browser: string
  /** The session this request came with. */
  current: boolean
}

/** The person's active sign-in sessions, newest first (identity §3.3). */
export async function listSignInSessions(
  ctx: Context,
): Promise<SignInSession[]> {
  return atInstallation(ctx, "account.read", async (scope) => {
    const rows = await scope.tx
      .select()
      .from(schema.signInSessions)
      .where(
        and(
          eq(schema.signInSessions.personId, scope.actor.personId!),
          gt(schema.signInSessions.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(schema.signInSessions.createdAt))
    const current =
      ctx.actor.kind === "person" ? ctx.actor.signInSessionId : undefined
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      lastActiveAt: row.updatedAt,
      expiresAt: row.expiresAt,
      networkAddress: row.ipAddress,
      client: row.userAgent,
      browser: describeClient(row.userAgent ?? undefined),
      current: row.id === current,
    }))
  })
}

/** Ends one of the person's own sign-in sessions. */
export async function endSignInSession(
  ctx: Context,
  input: { sessionId: string },
): Promise<void> {
  await atInstallation(ctx, "sign-in-session.end", async (scope) => {
    if (!isId(input.sessionId)) throw new NotFoundError()
    const ended = await scope.tx
      .delete(schema.signInSessions)
      .where(
        and(
          eq(schema.signInSessions.id, input.sessionId),
          eq(schema.signInSessions.personId, scope.actor.personId!),
        ),
      )
      .returning({ id: schema.signInSessions.id })
    if (ended.length === 0) throw new NotFoundError()
    await record(scope, "sign-in.session-ended", scope.actor.personId, {
      sessionId: input.sessionId,
    })
  })
}

/**
 * "Sign out everywhere": ends all the person's sign-in sessions, this one
 * included, and if they choose, revokes all their agent tokens in every
 * workspace (identity §3.3, §7.5). Returns how many sessions ended.
 */
export async function endAllSignInSessions(
  ctx: Context,
  options: { revokeAgentTokens?: boolean } = {},
): Promise<number> {
  return atInstallation(ctx, "sign-in-session.end", async (scope) => {
    const personId = scope.actor.personId!
    const ended = await scope.tx
      .delete(schema.signInSessions)
      .where(eq(schema.signInSessions.personId, personId))
      .returning({ id: schema.signInSessions.id })
    const tokensRevoked = options.revokeAgentTokens
      ? await revokeTokensOfPerson(scope, personId, "signed-out-everywhere")
      : 0
    await record(scope, "sign-in.signed-out-everywhere", personId, {
      sessionsEnded: ended.length,
      agentTokensRevoked: tokensRevoked,
    })
    return ended.length
  })
}

/** Records that the person signed out of this browser's sign-in session. */
export async function recordSignOut(
  ctx: Context,
  input: { sessionId: string },
): Promise<void> {
  await atInstallation(ctx, "sign-in-session.end", async (scope) => {
    await record(scope, "sign-in.session-ended", scope.actor.personId, {
      sessionId: input.sessionId,
      signedOut: true,
    })
  })
}

export interface GitHubSignInMethod {
  /** GitHub's stable account number. */
  accountId: string
  login: string | null
  addedAt: Date
}

/** The person's linked GitHub account, if any. */
export async function githubMethodOf(
  tx: Pick<Transaction, "select">,
  personId: string,
): Promise<GitHubSignInMethod | null> {
  const [row] = await tx
    .select({
      accountId: schema.signInAccounts.accountId,
      login: schema.signInAccounts.login,
      addedAt: schema.signInAccounts.createdAt,
    })
    .from(schema.signInAccounts)
    .where(
      and(
        eq(schema.signInAccounts.personId, personId),
        eq(schema.signInAccounts.providerId, "github"),
      ),
    )
  return row ?? null
}

/**
 * Checks that the person may add GitHub as a sign-in method now: only while
 * signed in, recently (identity §3.1, §3.3), and only one GitHub account.
 * The sign-in layer then runs GitHub's authorization.
 */
export async function checkAddGitHub(ctx: Context): Promise<void> {
  await atInstallation(ctx, "sign-in-method.change", async (scope) => {
    if (await githubMethodOf(scope.tx, scope.actor.personId!)) {
      throw new RuleViolationError(
        "github-linked",
        "A GitHub account is already a sign-in method; remove it first",
      )
    }
  })
}

/**
 * Records that the sign-in layer linked a GitHub account to the person, and
 * emails them (identity §3.3, §11). Runs as Shinan: the person's check was
 * made when they started (`checkAddGitHub`).
 */
export async function recordGitHubAdded(
  ctx: Context,
  input: { personId: string; githubAccountId: string; login?: string },
): Promise<void> {
  await atInstallation(ctx, "sign-in", async (scope) => {
    const [person] = await scope.tx
      .select({ id: schema.people.id, email: schema.people.email })
      .from(schema.people)
      .where(eq(schema.people.id, input.personId))
    if (!person) throw new NotFoundError()
    await scope.tx
      .update(schema.signInAccounts)
      .set({ login: input.login ?? null, updatedAt: sql`now()` })
      .where(
        and(
          eq(schema.signInAccounts.personId, person.id),
          eq(schema.signInAccounts.providerId, "github"),
          eq(schema.signInAccounts.accountId, input.githubAccountId),
        ),
      )
    await addedGitHub(
      scope,
      person,
      input.githubAccountId,
      input.login ?? null,
      true,
    )
  })
}

/**
 * Removes GitHub as the person's sign-in method, with re-authentication;
 * they can still sign in by email (identity §3.1, §3.3).
 */
export async function removeGitHub(ctx: Context): Promise<void> {
  await atInstallation(ctx, "sign-in-method.change", async (scope) => {
    const personId = scope.actor.personId!
    const [removed] = await scope.tx
      .delete(schema.signInAccounts)
      .where(
        and(
          eq(schema.signInAccounts.personId, personId),
          eq(schema.signInAccounts.providerId, "github"),
        ),
      )
      .returning()
    if (!removed) throw new NotFoundError()
    await record(scope, "sign-in-method.removed", personId, {
      method: "github",
      githubAccountId: removed.accountId,
      githubLogin: removed.login,
    })
    const [person] = await scope.tx
      .select({ id: schema.people.id, email: schema.people.email })
      .from(schema.people)
      .where(eq(schema.people.id, personId))
    await sendSecurityAlert(scope, person!, {
      kind: "github-removed",
      githubLogin: removed.login ?? removed.accountId,
      at: new Date(),
    })
  })
}

// Internal helpers

async function completeGitHubSignIn(
  scope: SignInScope,
  person: { id: string; email: string },
  input: SignInRecord,
): Promise<void> {
  const [pending] = await scope.tx
    .delete(schema.pendingGitHubSignIns)
    .where(
      eq(
        schema.pendingGitHubSignIns.tokenHash,
        hashToken(input.pendingGitHubToken!),
      ),
    )
    .returning()
  // Linked only if the magic link was asked for from this same browser, for
  // this person's address, in time; otherwise someone could get a GitHub
  // account linked to another person's account (identity §3.1).
  if (
    !pending ||
    pending.email !== person.email ||
    pending.expiresAt.getTime() < Date.now()
  ) {
    return
  }
  if (await githubMethodOf(scope.tx, person.id)) return
  const inserted = await scope.tx
    .insert(schema.signInAccounts)
    .values({
      personId: person.id,
      providerId: "github",
      accountId: pending.githubAccountId,
      login: pending.githubLogin,
    })
    .onConflictDoNothing()
    .returning()
    .catch((error: unknown) => {
      if (violatedUniqueConstraint(error)) return []
      throw error
    })
  if (inserted.length === 0) return
  await addedGitHub(
    scope,
    person,
    pending.githubAccountId,
    pending.githubLogin,
    !input.accountCreated,
  )
}

async function addedGitHub(
  scope: SignInScope,
  person: { id: string; email: string },
  githubAccountId: string,
  login: string | null,
  alert: boolean,
): Promise<void> {
  await record(scope, "sign-in-method.added", person.id, {
    method: "github",
    githubAccountId,
    githubLogin: login,
  })
  if (alert) {
    await sendSecurityAlert(scope, person, {
      kind: "github-added",
      githubLogin: login ?? githubAccountId,
      at: new Date(),
    })
  }
}

/**
 * Emails a security alert to the person's own, verified address (identity
 * §3.3, architecture §9.2). Throttled like other email.
 */
export async function sendSecurityAlert(
  scope: {
    tx: Transaction
    jobs: InstallationScope["jobs"]
    request: RequestInfo
    installationUrl: string | undefined
  },
  person: { email: string },
  alert: SecurityAlert,
  /** The page the email links to, where the person can review it. */
  reviewPath = "/account",
): Promise<void> {
  const installation = await getInstallation(scope.tx)
  await queueEmail(scope, {
    kind: "security_alert",
    to: person.email,
    content: securityAlertEmail({
      installationName: installation?.name ?? "Shinan",
      accountLink: installationLink(scope, reviewPath),
      alert,
    }),
  })
}

/** A link to a page of this installation, for emails. */
export function installationLink(
  scope: { installationUrl: string | undefined },
  path: string,
): string {
  if (!scope.installationUrl) {
    throw new Error("The installation's address is needed to send this email")
  }
  return new URL(path, scope.installationUrl).href
}

async function mayReceiveSignInLink(
  tx: Transaction,
  email: string,
): Promise<boolean> {
  if (await isClaimed(tx)) return isAllowlisted(tx, email)
  const setup = await currentSetup(tx)
  return setup?.email === email && (await isOperator(tx, email))
}

async function isClaimed(tx: Pick<Transaction, "select">): Promise<boolean> {
  const installation = await getInstallation(tx)
  return installation?.claimedAt != null
}

async function currentSetup(tx: Pick<Transaction, "select">) {
  const [setup] = await tx
    .select()
    .from(schema.setupLinks)
    .where(
      and(
        eq(schema.setupLinks.id, 1),
        gt(schema.setupLinks.expiresAt, sql`now()`),
      ),
    )
  return setup ?? null
}

async function isOperator(
  tx: Pick<Transaction, "select">,
  email: string,
): Promise<boolean> {
  const [row] = await tx
    .select()
    .from(schema.installationOperators)
    .where(eq(schema.installationOperators.email, email))
  return row !== undefined
}

async function record(
  scope: { tx: Transaction; actor: ResolvedActor; request: RequestInfo },
  action: string,
  subjectPersonId: string | null | undefined,
  details: Record<string, unknown>,
): Promise<void> {
  await recordSecurityEntry(scope.tx, {
    workspaceId: null,
    action,
    outcome: "succeeded",
    actor: scope.actor,
    subjectPersonId: subjectPersonId ?? null,
    request: scope.request,
    details,
  })
}

async function recordFailure(
  scope: { tx: Transaction; actor: ResolvedActor; request: RequestInfo },
  method: SignInMethod | null,
  reason: string,
  subjectPersonId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await recordSecurityEntry(scope.tx, {
    workspaceId: null,
    action: "sign-in.failed",
    outcome: "failed",
    actor: scope.actor,
    subjectPersonId,
    request: scope.request,
    details: { ...(method ? { method } : {}), reason, ...details },
  })
}

/** Error codes from outside go in the log only as short identifiers. */
function safeCode(value: string): string {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : "unknown"
}

/**
 * A short description of a browser from its user agent, such as "Firefox
 * on Linux", for security alerts.
 */
export function describeClient(userAgent: string | undefined): string {
  if (!userAgent) return "an unknown browser"
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "a browser"
  const system = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X|Macintosh/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : undefined
  return system ? `${browser} on ${system}` : browser
}
