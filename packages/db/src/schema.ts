import { sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow()

/** Workspace roles (D-045): there is no viewer role. */
export const roles = ["owner", "contributor"] as const
export type Role = (typeof roles)[number]
export const roleEnum = pgEnum("role", roles)

/** Kinds of actor (domain model, Actor; identity §8.7 for `unknown`). */
export const actorKinds = [
  "person",
  "agent",
  "shinan",
  "outside",
  "unknown",
] as const
export type ActorKind = (typeof actorKinds)[number]
export const actorKindEnum = pgEnum("actor_kind", actorKinds)

/** Attribution confidence (identity §8.2). */
export const confidences = [
  "recorded",
  "marked",
  "inferred",
  "unknown",
] as const
export type Confidence = (typeof confidences)[number]
export const confidenceEnum = pgEnum("attribution_confidence", confidences)

/** Where an event came from (architecture §4.3). */
export const eventOrigins = [
  "shinan_action",
  "webhook",
  "reconciliation",
  "plugin_report",
  "mcp_call",
] as const
export type EventOrigin = (typeof eventOrigins)[number]
export const eventOriginEnum = pgEnum("event_origin", eventOrigins)

export const securityOutcomes = ["succeeded", "refused", "failed"] as const
export type SecurityOutcome = (typeof securityOutcomes)[number]
export const securityOutcomeEnum = pgEnum("security_outcome", securityOutcomes)

/** One running copy of Shinan. The table holds exactly one row. */
export const installation = pgTable(
  "installation",
  {
    id: smallint("id").primaryKey().default(1),
    name: text("name").notNull(),
    createdAt: createdAt(),
    /**
     * When the first operator account was created through the one-time setup
     * link (identity §3.2, architecture §12). Until then no account can be
     * created any other way.
     */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
  },
  (t) => [check("installation_single_row", sql`${t.id} = 1`)],
)

const lowerCaseEmail = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} = lower(${column})`)

/**
 * A human who can sign in to the installation. This is also the sign-in
 * layer's user record (Better Auth's `user` model), but only core creates
 * people (identity §3.2).
 */
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Never changes (identity §8.7). */
    handle: text("handle").notNull().unique(),
    name: text("name").notNull(),
    /** Stored in lower case, so uniqueness ignores case. */
    email: text("email").notNull().unique(),
    /**
     * Always true: an account is created only when a magic link sent to the
     * address is opened (identity §3.2). Kept for the sign-in layer.
     */
    emailVerified: boolean("email_verified").notNull().default(true),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("people_handle_format", sql`${t.handle} ~ '^[a-z0-9-]+$'`),
    lowerCaseEmail("people_email_lower_case", t.email),
  ],
)

/**
 * The installation operators' email addresses, as the installation's
 * configuration names them (identity §3.2, §12). The `web` role writes them
 * on start; a person whose address is here is an operator.
 */
export const installationOperators = pgTable(
  "installation_operators",
  {
    email: text("email").primaryKey(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [lowerCaseEmail("installation_operators_email_lower_case", t.email)],
)

/** Who can have an account on the installation (identity §3.2, O-48). */
export const emailAllowlist = pgTable(
  "email_allowlist",
  {
    email: text("email").primaryKey(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [lowerCaseEmail("email_allowlist_email_lower_case", t.email)],
)

/**
 * The one-time setup link that claims a fresh installation (architecture
 * §12). At most one exists; a restart replaces it, and claiming deletes it.
 */
export const setupLinks = pgTable(
  "setup_links",
  {
    id: smallint("id").primaryKey().default(1),
    /** SHA-256 of the token; the token itself is only in the printed link. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** The operator address a sign-in link was sent to from this link. */
    email: text("email"),
    createdAt: createdAt(),
  },
  (t) => [
    check("setup_links_single_row", sql`${t.id} = 1`),
    lowerCaseEmail("setup_links_email_lower_case", t.email),
  ],
)

/**
 * A person's signed-in state in one browser (identity §3.3); Better Auth's
 * `session` model. Only a hash of the session token is stored.
 */
export const signInSessions = pgTable(
  "sign_in_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 of the session token; the token is only in the cookie. */
    tokenHash: text("token_hash").notNull().unique(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    /** Ends after an hour without activity, moved on as the person works. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    /** Last activity, updated every few minutes while the person works. */
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sign_in_sessions_person_id").on(t.personId)],
)

/**
 * A sign-in method other than email: only GitHub (D-044). Better Auth's
 * `account` model. The GitHub account is identified by its stable number;
 * no GitHub token is ever kept (identity §3.1, §7.1), which the database
 * enforces.
 */
export const signInAccounts = pgTable(
  "sign_in_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    /** GitHub's stable account number. */
    accountId: text("account_id").notNull(),
    /** The GitHub username when it was linked, for display only. */
    login: text("login"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("sign_in_accounts_github_only", sql`${t.providerId} = 'github'`),
    check(
      "sign_in_accounts_no_credentials",
      sql`${t.accessToken} is null and ${t.refreshToken} is null and ${t.idToken} is null and ${t.password} is null`,
    ),
    uniqueIndex("sign_in_accounts_provider_account").on(
      t.providerId,
      t.accountId,
    ),
    uniqueIndex("sign_in_accounts_person_provider").on(
      t.personId,
      t.providerId,
    ),
  ],
)

/**
 * Short-lived values of the sign-in layer (Better Auth's `verification`
 * model): magic-link tokens and OAuth state. Identifiers are stored hashed.
 */
export const signInVerifications = pgTable(
  "sign_in_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sign_in_verifications_identifier").on(t.identifier)],
)

/**
 * A GitHub sign-in by a GitHub account no person has linked yet. The person
 * is asked for their email address next; when the magic link sent there is
 * opened in the same browser, the account is linked (identity §3.2).
 */
export const pendingGitHubSignIns = pgTable(
  "pending_github_sign_ins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 of the token in the browser's cookie. */
    tokenHash: text("token_hash").notNull().unique(),
    githubAccountId: text("github_account_id").notNull(),
    githubLogin: text("github_login"),
    /** The address a sign-in link was requested for, from this browser. */
    email: text("email"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [lowerCaseEmail("pending_github_sign_ins_email_lower_case", t.email)],
)

/**
 * Browsers a person has signed in from, by a hash of a long-lived browser
 * cookie, so a sign-in from a new one can be emailed (identity §3.3).
 */
export const knownBrowsers = pgTable(
  "known_browsers",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    browserHash: text("browser_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.browserHash] })],
)

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [check("workspaces_name_not_blank", sql`btrim(${t.name}) <> ''`)],
)

/**
 * A person's membership in one workspace. Rows are kept after removal, so
 * past records stay credited to the former member; a person who rejoins gets
 * a new row.
 */
export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    role: roleEnum("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    invitedByMemberId: uuid("invited_by_member_id"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    // Lets other tables reference a member together with its workspace, so
    // the database refuses references that cross workspaces.
    unique("members_workspace_id_id").on(t.workspaceId, t.id),
    foreignKey({
      name: "members_invited_by_same_workspace",
      columns: [t.workspaceId, t.invitedByMemberId],
      foreignColumns: [t.workspaceId, t.id],
    }),
    uniqueIndex("members_one_current_membership")
      .on(t.workspaceId, t.personId)
      .where(sql`${t.removedAt} is null`),
    index("members_person_id").on(t.personId),
  ],
)

/**
 * Where an invitation stands (identity §5.2, glossary). A pending
 * invitation past its expiry counts as expired; it is stored as `expired`
 * only when it is replaced.
 */
export const invitationStates = [
  "pending",
  "accepted",
  "declined",
  "expired",
  "withdrawn",
] as const
export type InvitationState = (typeof invitationStates)[number]
export const invitationStateEnum = pgEnum("invitation_state", invitationStates)

/**
 * An invitation to join a workspace, sent to one email address with a role
 * (identity §5.2). The link's token is stored only as a hash.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** Stored in lower case. */
    email: text("email").notNull(),
    role: roleEnum("role").notNull(),
    state: invitationStateEnum("state").notNull().default("pending"),
    /** SHA-256 of the token in the emailed link. */
    tokenHash: text("token_hash").notNull().unique(),
    invitedByMemberId: uuid("invited_by_member_id").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** When it was accepted, declined, withdrawn or replaced. */
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** The membership an accepted invitation created. */
    memberId: uuid("member_id"),
  },
  (t) => [
    lowerCaseEmail("invitations_email_lower_case", t.email),
    foreignKey({
      name: "invitations_invited_by_same_workspace",
      columns: [t.workspaceId, t.invitedByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    foreignKey({
      name: "invitations_member_same_workspace",
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    check(
      "invitations_decided_unless_pending",
      sql`(${t.state} = 'pending') = (${t.decidedAt} is null)`,
    ),
    check(
      "invitations_member_when_accepted",
      sql`(${t.state} = 'accepted') = (${t.memberId} is not null)`,
    ),
    uniqueIndex("invitations_one_pending")
      .on(t.workspaceId, t.email)
      .where(sql`${t.state} = 'pending'`),
    index("invitations_email").on(t.email),
  ],
)

/** Something an event is about (domain model, Event). */
export interface EventSubject {
  type: string
  id: string
}

/** The columns that say who acted, shared by events and the security log. */
const actorColumns = () => ({
  actorKind: actorKindEnum("actor_kind").notNull(),
  actorPersonId: uuid("actor_person_id"),
  actorAgentId: uuid("actor_agent_id"),
  actorAgentSessionId: uuid("actor_agent_session_id"),
  /** The actor's written form (identity §8.7), as it was at the time. */
  actorLabel: text("actor_label").notNull(),
  confidence: confidenceEnum("confidence").notNull(),
})

/** People and agents are always credited with the person they act for. */
const actorCheck = (
  name: string,
  t: {
    actorKind: AnyPgColumn
    actorPersonId: AnyPgColumn
    actorAgentId: AnyPgColumn
  },
) =>
  check(
    name,
    sql`(${t.actorKind} not in ('person', 'agent') or ${t.actorPersonId} is not null) and (${t.actorKind} <> 'agent' or ${t.actorAgentId} is not null)`,
  )

/**
 * Append-only record of what happened in a workspace (architecture §4.3). A
 * database trigger refuses updates, deletes and truncation; purge
 * (architecture §4.4) will narrow that when it is built.
 */
export const events = pgTable(
  "events",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    kind: text("kind").notNull(),
    origin: eventOriginEnum("origin").notNull(),
    ...actorColumns(),
    subjects: jsonb("subjects").$type<EventSubject[]>().notNull().default([]),
    summary: text("summary").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    /** Link to the original, such as a pull request, where one exists. */
    link: text("link"),
    /** Stops the same change arriving twice (webhook and reconciliation). */
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    foreignKey({
      name: "events_actor_person_id_fk",
      columns: [t.actorPersonId],
      foreignColumns: [people.id],
    }),
    actorCheck("events_actor_known", t),
    index("events_workspace_id_id").on(t.workspaceId, t.id),
    index("events_subjects").using("gin", t.subjects),
    uniqueIndex("events_idempotency_key").on(t.workspaceId, t.idempotencyKey),
  ],
)

/**
 * Security-relevant actions (identity §11). Entries with no workspace are
 * installation-level. Kept forever and never purged (D-049): a trigger
 * refuses updates, deletes and truncation. There are deliberately no foreign
 * keys, so nothing an entry mentions can block it or be deleted with it.
 */
export const securityLog = pgTable(
  "security_log",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    workspaceId: uuid("workspace_id"),
    action: text("action").notNull(),
    outcome: securityOutcomeEnum("outcome").notNull(),
    ...actorColumns(),
    /** The person the entry is about, if not the actor. */
    subjectPersonId: uuid("subject_person_id"),
    networkAddress: inet("network_address"),
    /** The client described by the request, such as a user agent. */
    client: text("client"),
    /** What changed, as structured values; never free text or secrets. */
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    actorCheck("security_log_actor_known", t),
    index("security_log_workspace_id_id").on(t.workspaceId, t.id),
    index("security_log_actor_person_id").on(t.actorPersonId),
    index("security_log_subject_person_id").on(t.subjectPersonId),
  ],
)

/** The messages Shinan sends in the first version (architecture §9.1). */
export const emailKinds = [
  "magic_link",
  "invitation",
  "security_alert",
] as const
export type EmailKind = (typeof emailKinds)[number]
export const emailKindEnum = pgEnum("email_kind", emailKinds)

/**
 * Where an email stands (architecture §9.2): waiting to be sent, accepted by
 * the provider, rejected for good, given up after temporary errors, or never
 * queued because of throttling.
 */
export const emailStatuses = [
  "queued",
  "sent",
  "rejected",
  "given_up",
  "throttled",
] as const
export type EmailStatus = (typeof emailStatuses)[number]
export const emailStatusEnum = pgEnum("email_status", emailStatuses)

/** The rendered message, kept only until the email is finished. */
export interface EmailContent {
  subject: string
  text: string
  html: string
}

/**
 * One email Shinan sends, and its outcome. The message itself is removed
 * when the email is finished, so the record keeps only who it was for, what
 * kind it was and how it ended (architecture §9.2). The ID is also the job
 * queue's job ID.
 */
export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: emailKindEnum("kind").notNull(),
    /** Stored in lower case. */
    recipient: text("recipient").notNull(),
    /**
     * For magic links, the network address of the request that caused it
     * (an IPv6 address as its /64), for throttling.
     */
    networkAddress: inet("network_address"),
    status: emailStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    /** The last error's code, such as `TooManyRequestsException`; never text. */
    lastError: text("last_error"),
    /** The provider's ID for the accepted message. */
    providerMessageId: text("provider_message_id"),
    /** Not sent after this time (at most an hour, or a magic link's expiry). */
    notAfter: timestamp("not_after", { withTimezone: true }).notNull(),
    message: jsonb("message").$type<EmailContent>(),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "email_deliveries_recipient_lower_case",
      sql`${t.recipient} = lower(${t.recipient})`,
    ),
    check(
      "email_deliveries_message_only_while_queued",
      sql`(${t.status} = 'queued') = (${t.message} is not null)`,
    ),
    check(
      "email_deliveries_finished_unless_queued",
      sql`(${t.status} = 'queued') = (${t.finishedAt} is null)`,
    ),
    index("email_deliveries_recipient_created_at").on(t.recipient, t.createdAt),
    index("email_deliveries_network_address_created_at")
      .on(t.networkAddress, t.createdAt)
      .where(sql`${t.networkAddress} is not null`),
    index("email_deliveries_status_created_at").on(t.status, t.createdAt),
  ],
)

/**
 * Request counts for rate limits (architecture §10.1), shared by every `web`
 * process: one row per limit and network address (or other key), counting
 * requests in a fixed window that starts with the first one. Rows are
 * disposable: old windows are deleted, and the table is unlogged, so a
 * database crash simply resets the counts.
 */
export const rateLimits = pgTable("rate_limits", {
  /** The limit's name and what it counts by, such as `sign-in-link:192.0.2.1`. */
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
})
