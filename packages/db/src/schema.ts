import { sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import {
  bigint,
  boolean,
  check,
  customType,
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
    // Lets agents reference a member together with its person too.
    unique("members_workspace_id_id_person_id").on(
      t.workspaceId,
      t.id,
      t.personId,
    ),
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

/** Agent token scopes (identity §7.2). */
export const agentScopes = [
  "catalog:read",
  "catalog:propose",
  "tasks:read",
  "tasks:write",
  "presence",
] as const

const slug = (column: AnyPgColumn) =>
  sql`${column} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`

/**
 * One member's coding tool on one machine (identity §6.1, O-40): it belongs
 * to one workspace and acts for the member through the membership it was
 * created with, so it can never outlive that membership (identity §5.3).
 * Rows are kept when disabled, so past records stay credited.
 */
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    memberId: uuid("member_id").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    /** Such as `opencode`. */
    codingTool: text("coding_tool").notNull(),
    /** Such as `daedalus`. */
    machine: text("machine").notNull(),
    /** `<coding tool>-<machine>`; never changes (identity §8.7). */
    handle: text("handle").notNull(),
    /** What people call it, such as "OpenCode on Daedalus"; can be renamed. */
    name: text("name").notNull(),
    /** The `machine` catalog entity it runs on, such as `machine/daedalus`. */
    machineEntityId: text("machine_entity_id"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (t) => [
    // The membership is in the agent's workspace and is its person's.
    foreignKey({
      name: "agents_member_same_workspace_and_person",
      columns: [t.workspaceId, t.memberId, t.personId],
      foreignColumns: [members.workspaceId, members.id, members.personId],
    }),
    // Lets tokens reference an agent together with its workspace.
    unique("agents_workspace_id_id").on(t.workspaceId, t.id),
    check("agents_coding_tool_format", slug(t.codingTool)),
    check("agents_machine_format", slug(t.machine)),
    check(
      "agents_handle_from_tool_and_machine",
      sql`${t.handle} = ${t.codingTool} || '-' || ${t.machine}`,
    ),
    check("agents_name_not_blank", sql`btrim(${t.name}) <> ''`),
    check(
      "agents_disabled_at_when_disabled",
      sql`${t.enabled} = (${t.disabledAt} is null)`,
    ),
    uniqueIndex("agents_member_handle").on(t.memberId, t.handle),
    index("agents_workspace_id").on(t.workspaceId),
    index("agents_person_id").on(t.personId),
  ],
)

/**
 * Why an agent token stopped working (identity §7.3, §7.5), recorded on the
 * token and in the security log.
 */
export const tokenRevocationReasons = [
  /** Its member or a workspace owner revoked it. */
  "revoked",
  /** A new token was issued for the agent (one token per agent, NO-1). */
  "replaced",
  "agent-disabled",
  "member-removed",
  "member-left",
  "allowlist-removed",
  "signed-out-everywhere",
] as const
export type TokenRevocationReason = (typeof tokenRevocationReasons)[number]

/**
 * An agent's long-lived token (identity §7). Only a SHA-256 hash is stored,
 * never the token (§7.4); the database refuses anything that is not a hash.
 * Revoked tokens are kept for their use summary. At most one per agent is
 * not revoked (NO-1).
 */
export const agentTokens = pgTable(
  "agent_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    /** SHA-256 of the token, URL-safe base64. */
    tokenHash: text("token_hash").notNull().unique(),
    scopes: text("scopes").array().notNull(),
    /** The origin of the installation that issued it (identity §7.4). */
    installationUrl: text("installation_url").notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason").$type<TokenRevocationReason>(),
    firstUsedAt: timestamp("first_used_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastNetworkAddress: inet("last_network_address"),
    requestCount: bigint("request_count", { mode: "number" })
      .notNull()
      .default(0),
    /** `request_count` at the last use summary in the security log. */
    summarizedCount: bigint("summarized_count", { mode: "number" })
      .notNull()
      .default(0),
  },
  (t) => [
    foreignKey({
      name: "agent_tokens_agent_same_workspace",
      columns: [t.workspaceId, t.agentId],
      foreignColumns: [agents.workspaceId, agents.id],
    }),
    check(
      "agent_tokens_hash_only",
      sql`${t.tokenHash} ~ '^[A-Za-z0-9_-]{43}$'`,
    ),
    check(
      "agent_tokens_known_scopes",
      sql`cardinality(${t.scopes}) > 0 and ${t.scopes} <@ array[${sql.raw(
        agentScopes.map((s) => `'${s}'`).join(", "),
      )}]::text[]`,
    ),
    check(
      "agent_tokens_reason_when_revoked",
      sql`(${t.revokedAt} is null) = (${t.revokedReason} is null)`,
    ),
    check(
      "agent_tokens_known_reason",
      sql`${t.revokedReason} in (${sql.raw(
        tokenRevocationReasons.map((r) => `'${r}'`).join(", "),
      )})`,
    ),
    uniqueIndex("agent_tokens_one_active")
      .on(t.agentId)
      .where(sql`${t.revokedAt} is null`),
    index("agent_tokens_workspace_id").on(t.workspaceId),
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
    foreignKey({
      name: "events_actor_agent_id_fk",
      columns: [t.actorAgentId],
      foreignColumns: [agents.id],
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

/**
 * Catalog storage (catalog §2.1, §9; architecture §5.2, §5.3). The stored
 * Markdown text of each revision is the catalog's source of truth; nothing
 * else is authoritative. M2-3 adds the text and the revision numbers the
 * agent index is built from; catalog proposals and approval (M2-4) add
 * their own records about each revision.
 */

/** Where a catalog proposal stands (catalog §8.1, domain model). */
export const catalogProposalStates = [
  "pending",
  "applied",
  "rejected",
  "withdrawn",
] as const
export type CatalogProposalState = (typeof catalogProposalStates)[number]
export const catalogProposalStateEnum = pgEnum(
  "catalog_proposal_state",
  catalogProposalStates,
)

/**
 * A catalog proposal (catalog §8.1): a change to the catalog, made and
 * reviewed inside Shinan, as a list of operations with their inline fact
 * checks. It applies at once or waits for catalog approval (§8.2). The
 * record is about the change, not catalog content (catalog §2.1): it is
 * not rebuilt from the Markdown. Proposals that conflict or that validation
 * blocks are not stored; their author is told why.
 */
export const catalogProposals = pgTable(
  "catalog_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** Numbered from 1 in each workspace, for people to name it. */
    number: integer("number").notNull(),
    createdAt: createdAt(),
    /** The author. */
    ...actorColumns(),
    /** Why, in a few sentences (catalog §8.1). */
    explanation: text("explanation").notNull(),
    /** The related task's ID, as text until tasks exist (M3). */
    relatedTask: text("related_task"),
    /** The operations as sent, with their inline fact checks. */
    operations: jsonb("operations").$type<unknown[]>().notNull(),
    /** The catalog revision it was made against. */
    basedOnRevision: integer("based_on_revision").notNull(),
    state: catalogProposalStateEnum("state").notNull().default("pending"),
    /** Its approval classes (catalog §8.2). */
    approvalClasses: text("approval_classes").array().notNull(),
    /** Why it waits for catalog approval; empty when it applies on its own. */
    approvalReasons: jsonb("approval_reasons").$type<string[]>().notNull(),
    /** The catalog IDs of the documents it changes, before and after, to show it on them (catalog §8.6). */
    touches: text("touches").array().notNull(),
    /** Validation's findings on the text it would produce (catalog §8.3); never a secret's value. */
    validation: jsonb("validation")
      .$type<Record<string, unknown>[]>()
      .notNull(),
    /** A key the author chose, so a retried request is stored once; unique per author. */
    idempotencyKey: text("idempotency_key"),
    /** A hash of the request, to tell a retry from a different request with the same key. */
    requestHash: text("request_hash").notNull(),
    /**
     * The revision it applied as. That revision names this proposal, which
     * the database checks; a key in both directions would make the two
     * tables' types depend on each other.
     */
    appliedRevision: integer("applied_revision"),
    /** When it was applied, rejected or withdrawn, and by whom. */
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByPersonId: uuid("decided_by_person_id"),
    decidedByAgentId: uuid("decided_by_agent_id"),
    decidedByLabel: text("decided_by_label"),
    /** Why it was rejected (catalog §8.6). */
    rejectionReason: text("rejection_reason"),
  },
  (t) => [
    unique("catalog_proposals_workspace_id_id").on(t.workspaceId, t.id),
    unique("catalog_proposals_workspace_id_number").on(t.workspaceId, t.number),
    // Per author: an agent by itself, a person by themselves.
    uniqueIndex("catalog_proposals_idempotency_key")
      .on(
        t.workspaceId,
        sql`coalesce(${t.actorAgentId}, ${t.actorPersonId})`,
        t.idempotencyKey,
      )
      .where(sql`${t.idempotencyKey} is not null`),
    index("catalog_proposals_workspace_id_state").on(t.workspaceId, t.state),
    foreignKey({
      name: "catalog_proposals_actor_person_id_fk",
      columns: [t.actorPersonId],
      foreignColumns: [people.id],
    }),
    foreignKey({
      name: "catalog_proposals_actor_agent_id_fk",
      columns: [t.actorAgentId],
      foreignColumns: [agents.id],
    }),
    foreignKey({
      name: "catalog_proposals_decided_by_person_id_fk",
      columns: [t.decidedByPersonId],
      foreignColumns: [people.id],
    }),
    foreignKey({
      name: "catalog_proposals_decided_by_agent_id_fk",
      columns: [t.decidedByAgentId],
      foreignColumns: [agents.id],
    }),
    actorCheck("catalog_proposals_actor_known", t),
    check("catalog_proposals_number_positive", sql`${t.number} > 0`),
    check(
      "catalog_proposals_decided",
      sql`(${t.state} = 'pending') = (${t.decidedAt} is null) and (${t.decidedAt} is null) = (${t.decidedByLabel} is null)`,
    ),
    check(
      "catalog_proposals_applied_revision",
      sql`(${t.state} = 'applied') = (${t.appliedRevision} is not null)`,
    ),
    check(
      "catalog_proposals_rejection_reason",
      sql`(${t.state} = 'rejected') = (${t.rejectionReason} is not null)`,
    ),
  ],
)

/**
 * A catalog revision: one applied change to a workspace's catalog, numbered
 * from 1 within the workspace. Every answer from the agent index names the
 * revision it was built from (catalog §12.2). Its author is credited the
 * way events are. Never edited (catalog §9); a database trigger refuses
 * updates and deletes, which purge (M2-10) will narrow.
 */
export const catalogRevisions = pgTable(
  "catalog_revisions",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    number: integer("number").notNull(),
    createdAt: createdAt(),
    ...actorColumns(),
    /**
     * The catalog proposal it applied (M2-4). Null only for revisions stored
     * before proposals existed: revisions are never edited, so these
     * columns could not be filled in later.
     */
    proposalId: uuid("proposal_id"),
    /** The revision the proposal was based on (architecture §5.3), for history and display. */
    basedOnRevision: integer("based_on_revision"),
    /** The person whose catalog approval applied it, if it needed one (catalog §8.2). */
    approvedByPersonId: uuid("approved_by_person_id"),
    /** That person's written form (identity §8.7), as it was at the time. */
    approvedByLabel: text("approved_by_label"),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.number] }),
    foreignKey({
      name: "catalog_revisions_proposal_fk",
      columns: [t.workspaceId, t.proposalId],
      foreignColumns: [catalogProposals.workspaceId, catalogProposals.id],
    }),
    foreignKey({
      name: "catalog_revisions_approved_by_person_id_fk",
      columns: [t.approvedByPersonId],
      foreignColumns: [people.id],
    }),
    check(
      "catalog_revisions_approver_labelled",
      sql`(${t.approvedByPersonId} is null) = (${t.approvedByLabel} is null)`,
    ),
    foreignKey({
      name: "catalog_revisions_actor_person_id_fk",
      columns: [t.actorPersonId],
      foreignColumns: [people.id],
    }),
    foreignKey({
      name: "catalog_revisions_actor_agent_id_fk",
      columns: [t.actorAgentId],
      foreignColumns: [agents.id],
    }),
    actorCheck("catalog_revisions_actor_known", t),
    check("catalog_revisions_number_positive", sql`${t.number} > 0`),
  ],
)

/**
 * One catalog document: an entity, a type schema document or the start-here
 * document. Its catalog ID (such as `machine/musashi`) lives in its text and
 * can change (catalog §2.4), so the document has its own stable ID, which
 * every revision of its text and its index rows refer to.
 */
export const catalogDocuments = pgTable(
  "catalog_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** The catalog revision that holds its latest text. */
    currentRevision: integer("current_revision").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "catalog_documents_current_revision_fk",
      columns: [t.workspaceId, t.currentRevision],
      foreignColumns: [catalogRevisions.workspaceId, catalogRevisions.number],
    }),
    // Lets revisions and index rows reference a document with its workspace.
    unique("catalog_documents_workspace_id_id").on(t.workspaceId, t.id),
  ],
)

/**
 * The full Markdown text of each document a revision changed (architecture
 * §5.3). The latest text of a document is the one at its
 * `current_revision`. Never edited, like revisions.
 */
export const catalogRevisionDocuments = pgTable(
  "catalog_revision_documents",
  {
    workspaceId: uuid("workspace_id").notNull(),
    revision: integer("revision").notNull(),
    documentId: uuid("document_id").notNull(),
    text: text("text").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.revision] }),
    foreignKey({
      name: "catalog_revision_documents_revision_fk",
      columns: [t.workspaceId, t.revision],
      foreignColumns: [catalogRevisions.workspaceId, catalogRevisions.number],
    }),
    foreignKey({
      name: "catalog_revision_documents_document_fk",
      columns: [t.workspaceId, t.documentId],
      foreignColumns: [catalogDocuments.workspaceId, catalogDocuments.id],
    }),
    index("catalog_revision_documents_workspace_id_revision").on(
      t.workspaceId,
      t.revision,
    ),
  ],
)

/**
 * The agent index (catalog §12; architecture §5.2, §5.3): rows derived from
 * the stored text by the indexer alone, and rebuilt from the text when lost
 * or when the parser changes. Every row records the parser version that
 * produced it.
 */

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
})

const bytea = customType<{ data: Buffer }>({
  dataType: () => "bytea",
})

const parserVersionColumn = () => integer("parser_version").notNull()

/** Where a workspace's index stands, and the last round-trip check. */
export const catalogIndexState = pgTable("catalog_index_state", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id),
  /** The latest catalog revision the index has been built up to. */
  revision: integer("revision").notNull().default(0),
  /** The parser version of the last full build. */
  parserVersion: parserVersionColumn(),
  /**
   * The version of the index's own rules (such as how `written_by` is
   * credited) of the last full build; 0 before the rules were versioned.
   */
  rulesVersion: integer("rules_version").notNull().default(0),
  /** Set while a rebuild is asked for or running: answers say the index is behind. */
  rebuildRequestedAt: timestamp("rebuild_requested_at", {
    withTimezone: true,
  }),
  rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }),
  /** The last round-trip check (architecture §5.2, rule 5). */
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  checkedRevision: integer("checked_revision"),
  /** How many documents' stored rows differed from their text; 0 when they all matched. */
  checkDifferences: integer("check_differences"),
  /** Which documents differed and in which tables: IDs only, never text. */
  checkDetails: jsonb("check_details").$type<IndexCheckDifference[]>(),
})

/** One document whose stored index rows differ from what its text gives. */
export interface IndexCheckDifference {
  documentId: string
  tables: string[]
}

/** One catalog document in the index, with its entity fields. */
export const catalogIndexDocuments = pgTable(
  "catalog_index_documents",
  {
    documentId: uuid("document_id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    /** The catalog revision whose text these rows were built from. */
    revision: integer("revision").notNull(),
    parserVersion: parserVersionColumn(),
    /** The index rules version these rows were built by (with all the document's rows); 0 before it was recorded. */
    rulesVersion: integer("rules_version").notNull().default(0),
    /** `entity`, `schema` or `start-here` (catalog §2, §3.9, §11). */
    kind: text("kind").notNull(),
    /** The catalog ID, such as `machine/musashi`; null if the text has none. */
    catalogId: text("catalog_id"),
    type: text("type"),
    title: text("title"),
    summary: text("summary"),
    status: text("status"),
    owner: text("owner"),
    replacedBy: text("replaced_by"),
    aliases: text("aliases").array().notNull(),
    importedFrom: text("imported_from"),
    decisionState: text("decision_state"),
    decidedOn: text("decided_on"),
    decidedBy: text("decided_by"),
    /** Required keys of the type schema the entity does not mention (catalog §4.8). */
    missingKeys: text("missing_keys").array().notNull(),
    /** What kept the text from being read as catalog §2 describes. */
    problems: jsonb("problems")
      .$type<{ code: string; message: string }[]>()
      .notNull(),
    /** A type schema document's resolved schema, or the start-here paths. */
    data: jsonb("data").$type<Record<string, unknown>>(),
    /** IDs split into words, aliases, and facts' keys, values and notes, for search. */
    searchText: text("search_text").notNull(),
    /** The whole body, so a search matches (and a `-word` excludes) the entity as a whole. */
    body: text("body").notNull(),
    /** Title, summary, search text and body, with English stemming. */
    search: tsvector("search")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(summary, '')), 'B') || setweight(to_tsvector('english', search_text), 'C') || setweight(to_tsvector('english', body), 'D')`,
      ),
    /** The same fields word for word, so IDs and values such as `instance-metadata` match as written. */
    searchSimple: tsvector("search_simple")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(summary, '')), 'B') || setweight(to_tsvector('simple', search_text), 'C') || setweight(to_tsvector('simple', body), 'D')`,
      ),
  },
  (t) => [
    foreignKey({
      name: "catalog_index_documents_document_fk",
      columns: [t.workspaceId, t.documentId],
      foreignColumns: [catalogDocuments.workspaceId, catalogDocuments.id],
    }),
    index("catalog_index_documents_catalog_id").on(t.workspaceId, t.catalogId),
    index("catalog_index_documents_type_status").on(
      t.workspaceId,
      t.kind,
      t.type,
      t.status,
    ),
    // For finding rows another parser or rules version built, on every answer.
    index("catalog_index_documents_versions").on(
      t.workspaceId,
      t.parserVersion,
      t.rulesVersion,
    ),
    index("catalog_index_documents_aliases").using("gin", t.aliases),
    index("catalog_index_documents_search").using("gin", t.search),
    index("catalog_index_documents_search_simple").using("gin", t.searchSimple),
  ],
)

/** One fact of an entity, with its fact check and type schema (catalog §4). */
export const catalogIndexFacts = pgTable(
  "catalog_index_facts",
  {
    documentId: uuid("document_id").notNull(),
    /** Its place in the document, from 0. */
    position: integer("position").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    parserVersion: parserVersionColumn(),
    entityId: text("entity_id").notNull(),
    identity: text("identity").notNull(),
    key: text("key").notNull(),
    state: text("state").notNull(),
    form: text("form").notNull(),
    /**
     * The value as a one-item list, so a written `null` (`[null]`) differs
     * from no value (SQL null, as on relations and `unknown` facts).
     */
    value: jsonb("value").$type<[string | number | boolean | null]>(),
    to: text("to"),
    via: text("via"),
    note: text("note"),
    task: text("task"),
    remove: boolean("remove").notNull(),
    accepted: text("accepted"),
    attributes: jsonb("attributes")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull(),
    /** The `index` of its group in the `facts` list. */
    groupIndex: integer("group_index").notNull(),
    many: boolean("many").notNull(),
    relation: boolean("relation").notNull(),
    inSchema: boolean("in_schema").notNull(),
    recheckDays: integer("recheck_days"),
    /** Whether its group is a fact check. */
    hasCheck: boolean("has_check").notNull(),
    /** As written: a date, or a date and time; null for `checked: null`. */
    checked: text("checked"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    by: text("by"),
    scope: text("scope"),
    source: text("source"),
    limits: text("limits"),
    /** When it becomes due for recheck; freshness itself is computed when read (catalog §12.2). */
    dueAt: timestamp("due_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.position] }),
    foreignKey({
      name: "catalog_index_facts_document_fk",
      columns: [t.documentId],
      foreignColumns: [catalogIndexDocuments.documentId],
    }).onDelete("cascade"),
    index("catalog_index_facts_entity").on(t.workspaceId, t.entityId),
    index("catalog_index_facts_due_at")
      .on(t.workspaceId, t.dueAt)
      .where(sql`${t.dueAt} is not null`),
    index("catalog_index_facts_unknown")
      .on(t.workspaceId)
      .where(sql`${t.state} = 'unknown'`),
  ],
)

/**
 * Relations (catalog §5), one row per written relation, read in both
 * directions: written on the source, generated (the inverse) on the target.
 * The `owner` and `replaced_by` entity fields are here too, as `field`
 * rows, so the target shows "owns" and "replaces".
 */
export const catalogIndexRelations = pgTable(
  "catalog_index_relations",
  {
    documentId: uuid("document_id").notNull(),
    position: integer("position").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    parserVersion: parserVersionColumn(),
    fromId: text("from_id").notNull(),
    fromType: text("from_type"),
    key: text("key").notNull(),
    /** The target as written: an entity ID or alias, `schema/<type>`, `workspace` or a task ID. */
    toId: text("to_id").notNull(),
    /** Null on `field` rows. */
    state: text("state"),
    identity: text("identity"),
    attributes: jsonb("attributes")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull(),
    /** The name shown on the target, such as `checkouts`. */
    inverse: text("inverse"),
    field: boolean("field").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.position] }),
    foreignKey({
      name: "catalog_index_relations_document_fk",
      columns: [t.documentId],
      foreignColumns: [catalogIndexDocuments.documentId],
    }).onDelete("cascade"),
    index("catalog_index_relations_from").on(t.workspaceId, t.fromId),
    index("catalog_index_relations_to").on(t.workspaceId, t.toId),
  ],
)

/** Discrepancies (catalog §4.7), one row per single-valued key that has one. */
export const catalogIndexDiscrepancies = pgTable(
  "catalog_index_discrepancies",
  {
    documentId: uuid("document_id").notNull(),
    key: text("key").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    parserVersion: parserVersionColumn(),
    entityId: text("entity_id").notNull(),
    values: jsonb("values").$type<string[]>().notNull(),
    /** The identity keys of the facts in it. */
    identities: text("identities").array().notNull(),
    accepted: boolean("accepted").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.key] }),
    foreignKey({
      name: "catalog_index_discrepancies_document_fk",
      columns: [t.documentId],
      foreignColumns: [catalogIndexDocuments.documentId],
    }).onDelete("cascade"),
    index("catalog_index_discrepancies_workspace_id").on(t.workspaceId),
  ],
)

/**
 * Body sections (catalog §2.5, §12.1), split by heading, each with the
 * catalog revision that last changed it and that revision's author, from
 * which trust labels are set (agent integrations, trust labels).
 */
export const catalogIndexSections = pgTable(
  "catalog_index_sections",
  {
    documentId: uuid("document_id").notNull(),
    position: integer("position").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    parserVersion: parserVersionColumn(),
    catalogId: text("catalog_id"),
    heading: text("heading"),
    level: integer("level").notNull(),
    anchor: text("anchor"),
    text: text("text").notNull(),
    /** Its range in the document's text. */
    start: integer("start").notNull(),
    end: integer("end").notNull(),
    changedRevision: integer("changed_revision").notNull(),
    authorKind: actorKindEnum("author_kind").notNull(),
    /** The author's written form (identity §8.7). */
    author: text("author").notNull(),
    /**
     * The least-trusted author whose words may be in the section, from the
     * document's word provenance (catalog §12.4), for trust labels.
     */
    leastTrustedKind: actorKindEnum("least_trusted_kind").notNull(),
    leastTrusted: text("least_trusted").notNull(),
    search: tsvector("search")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', coalesce(heading, '')), 'A') || setweight(to_tsvector('english', text), 'B')`,
      ),
    searchSimple: tsvector("search_simple")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('simple', coalesce(heading, '')), 'A') || setweight(to_tsvector('simple', text), 'B')`,
      ),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.position] }),
    foreignKey({
      name: "catalog_index_sections_document_fk",
      columns: [t.documentId],
      foreignColumns: [catalogIndexDocuments.documentId],
    }).onDelete("cascade"),
    index("catalog_index_sections_workspace_id").on(t.workspaceId),
    index("catalog_index_sections_search").using("gin", t.search),
    index("catalog_index_sections_search_simple").using("gin", t.searchSimple),
  ],
)

/**
 * Where a document's words came from (catalog §12.4, `written_by`): for each
 * unit of its words (a hashed, normalised word 3-gram) that anyone less
 * trusted than a person ever introduced into the document, the
 * least-trusted author who did. Derived from the document's history like
 * every index row, and compared by the round-trip check.
 */
export const catalogIndexProvenance = pgTable(
  "catalog_index_provenance",
  {
    documentId: uuid("document_id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    parserVersion: parserVersionColumn(),
    /** The authors the units name, sorted: their kind and written form. */
    authors: jsonb("authors")
      .$type<{ kind: ActorKind; author: string }[]>()
      .notNull(),
    /** The units, sorted, 10 bytes each: a 53-bit hash and the author's place in `authors`. */
    units: bytea("units").notNull(),
  },
  (t) => [
    foreignKey({
      name: "catalog_index_provenance_document_fk",
      columns: [t.documentId],
      foreignColumns: [catalogIndexDocuments.documentId],
    }).onDelete("cascade"),
    index("catalog_index_provenance_workspace_id").on(t.workspaceId),
  ],
)

/**
 * When each person last opened each catalog page in the wiki, and the
 * catalog revision the page stood at then (human experience, start here for
 * people: "opened" and "changed since you opened it"). Not catalog content
 * and not an event: a small personal record, overwritten on each opening.
 */
export const catalogPageVisits = pgTable(
  "catalog_page_visits",
  {
    workspaceId: uuid("workspace_id").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    documentId: uuid("document_id").notNull(),
    /** The catalog revision that had last changed the page when it was opened. */
    revision: integer("revision").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.personId, t.documentId] }),
    foreignKey({
      name: "catalog_page_visits_document_fk",
      columns: [t.workspaceId, t.documentId],
      foreignColumns: [catalogDocuments.workspaceId, catalogDocuments.id],
    }),
  ],
)
