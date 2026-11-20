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
  "git_push",
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

/**
 * A change of a person's email address they asked for, waiting for the link
 * sent to the new address (identity §3.4). One per person: asking again
 * replaces it. Only the link token's hash is kept.
 */
export const emailChanges = pgTable(
  "email_changes",
  {
    personId: uuid("person_id")
      .primaryKey()
      .references(() => people.id, { onDelete: "cascade" }),
    /** The new address, in lower case. */
    email: text("email").notNull(),
    /** SHA-256 of the token in the link sent to the new address. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [lowerCaseEmail("email_changes_email_lower_case", t.email)],
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
 * invitation past its expiry counts as expired; the hourly expiry job (or
 * inviting the address again) stores it as `expired`.
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
    /**
     * When it was accepted, declined, withdrawn or expired (as of its
     * expiry); null while pending, and again once an expired one is sent
     * again.
     */
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
  "catalog:write",
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
    /** Fetches and clones of the catalog with this token (plan §2.14). */
    fetchCount: bigint("fetch_count", { mode: "number" }).notNull().default(0),
    /** `fetch_count` at the last `catalog.fetched` summary. */
    fetchSummarizedCount: bigint("fetch_summarized_count", { mode: "number" })
      .notNull()
      .default(0),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
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
 * database trigger refuses updates, deletes and truncation, except that a
 * purge may replace the summary and data (architecture §4.4).
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
  /** The link that confirms a new email address (identity §3.4). */
  "email_change",
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
 * How many records a catalog purge changed, by kind: counts only, never the
 * text. Since the catalog moved into Git (GC-8), a purge rewrites the
 * repository's history (`history`) and the push log (`pushLog`). M2's
 * counts are kept for purges made before, and are zero since GC-6 dropped
 * its tables.
 */
export interface CatalogPurgeCounts {
  /** The repository's history, as the Git container rewrote it. */
  history?: CatalogPurgeHistoryCounts
  /** Branch names in the push log and the first-pusher record. */
  pushLog?: number
  /** Documents of the agent index, dropped until the rebuild from the new `main`. */
  indexDocuments?: number
  /** Stored texts of document revisions. */
  revisionTexts: number
  /** Documents with any purged revision text. */
  documents: number
  /** Documents whose latest text changed, stored again in the purge's revision. */
  latestDocuments: number
  /** Catalog proposals. */
  proposals: number
  /** Waiting catalog proposals it rejected. */
  rejectedProposals: number
  /** Events (timeline entries). */
  events: number
  /** Comments on catalog proposals. */
  comments: number
}

/** What a purge rewrote in a repository's history (GC-8). */
export interface CatalogPurgeHistoryCounts {
  /** Commits that held the text, in a file, a path, the message or an identity. */
  commits: number
  /** Commits that got a new ID: those, and every commit after them. */
  rewrittenCommits: number
  /** Commits the repository no longer holds, unreachable ones included. */
  removedCommits: number
  /** Files (by path) that held the text. */
  files: number
  /** Commit messages and identities that held it. */
  messages: number
  /** Branches renamed because their names held it. */
  renamedBranches: number
  /** Journal entries not yet stored that held it. */
  journalEntries: number
}

const xid8 = customType<{ data: string }>({ dataType: () => "xid8" })

/**
 * A purge of catalog content (catalog §9; architecture §4.4): who replaced
 * a text with a marker wherever the catalog stored it, when and why, never
 * the text itself. Numbered from 1 within the workspace. Append-only: a
 * trigger refuses deletes, and updates other than its counts in the
 * transaction that made it.
 */
export const catalogPurges = pgTable(
  "catalog_purges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    number: integer("number").notNull(),
    createdAt: createdAt(),
    ...actorColumns(),
    /** Why, in the workspace owner's words; checked not to hold the purged text. */
    reason: text("reason").notNull(),
    counts: jsonb("counts").$type<CatalogPurgeCounts>().notNull(),
    /**
     * The transaction that made it. The triggers on events and revision
     * text allow a purge's updates only in that transaction (migration
     * `0010_catalog_purge`).
     */
    transactionId: xid8("transaction_id")
      .notNull()
      .default(sql`pg_current_xact_id()`),
  },
  (t) => [
    unique("catalog_purges_workspace_id_id").on(t.workspaceId, t.id),
    unique("catalog_purges_workspace_id_number").on(t.workspaceId, t.number),
    foreignKey({
      name: "catalog_purges_actor_person_id_fk",
      columns: [t.actorPersonId],
      foreignColumns: [people.id],
    }),
    actorCheck("catalog_purges_actor_known", t),
    check("catalog_purges_number_positive", sql`${t.number} > 0`),
  ],
)

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
})

/**
 * Each workspace's catalog repository in the Git container (Git-based
 * catalog plan §2.4): asked for when the workspace is created, in the same
 * transaction, and marked created once the Git container has made it with
 * its first commit. The repository itself lives on the Git container's
 * volume; this records only that it exists and its first commit.
 */
export const catalogRepositories = pgTable(
  "catalog_repositories",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** When the Git container confirmed the repository; null until then. */
    createdAt: timestamp("created_at", { withTimezone: true }),
    /** The repository's first commit, once created. */
    firstCommit: text("first_commit"),
  },
  (t) => [
    check(
      "catalog_repositories_created_with_commit",
      sql`(${t.createdAt} is null) = (${t.firstCommit} is null)`,
    ),
    check(
      "catalog_repositories_commit_format",
      sql`${t.firstCommit} is null or ${t.firstCommit} ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'`,
    ),
  ],
)

const gitObjectId = (column: string) =>
  sql`${sql.identifier(column)} ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'`

/** A catalog proposal M2 left waiting, as the move reports it: never its text. */
export interface CatalogMoveWaitingProposal {
  number: number
  /** The catalog IDs it touched. */
  touches: string[]
}

/** A problem the moved catalog reads with, as the move reports it. */
export interface CatalogMoveProblem {
  code: string
  severity: "blocking" | "warning"
  /** The document's catalog ID, or null for one without a readable ID. */
  document: string | null
}

/**
 * The move of a workspace's M2 catalog into its repository (Git-based
 * catalog plan §4.1), made by `migrate` and verified by reading the first
 * commit back: one row per workspace that existed before v0.4.0. The drop
 * of M2's tables (§4.2) refuses to run unless every workspace with M2
 * documents has one, so a failed move is never followed by a drop. Kept
 * afterwards as the record of what was moved; never changed.
 */
export const catalogMoves = pgTable(
  "catalog_moves",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id),
    /** M2's latest catalog revision when the catalog was moved; 0 for none. */
    revision: integer("revision").notNull(),
    /** Documents moved, retired ones included; `README.md` aside. */
    documents: integer("documents").notNull(),
    /** The repository's first commit, which holds them. */
    firstCommit: text("first_commit").notNull(),
    /** When every file was read back and found equal to its stored text. */
    verifiedAt: timestamp("verified_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** The proposals left waiting for approval, which were not applied (GD-12). */
    waitingProposals: jsonb("waiting_proposals")
      .$type<CatalogMoveWaitingProposal[]>()
      .notNull(),
    /** What the moved catalog reads with: reported, not refused. */
    problems: jsonb("problems").$type<CatalogMoveProblem[]>().notNull(),
  },
  (t) => [
    check("catalog_moves_commit_format", gitObjectId("first_commit")),
    check(
      "catalog_moves_counts",
      sql`${t.revision} >= 0 and ${t.documents} >= 0`,
    ),
  ],
)

/** How a push ended at the push checks (Git-based catalog plan §2.6). */
export const catalogPushOutcomes = [
  "accepted",
  "refused",
  "check-only",
] as const
export type CatalogPushOutcome = (typeof catalogPushOutcomes)[number]

/** What a push did to one ref. */
export const catalogPushRefKinds = [
  "create",
  "update",
  "forced-update",
  "delete",
] as const
export type CatalogPushRefKind = (typeof catalogPushRefKinds)[number]

/**
 * The push log (Git-based catalog plan §2.6): one row per push that
 * reached the push checks, copied from the Git container's journal (its
 * `push.checked` entry, `journalEntry`). Append-only (migration triggers);
 * codes only, never the text of a refusal.
 */
export const catalogPushes = pgTable(
  "catalog_pushes",
  {
    /** The request's ID, which `web` gave the push. */
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** The journal and entry it was copied from. */
    journalId: uuid("journal_id").notNull(),
    journalEntry: bigint("journal_entry", { mode: "number" }).notNull(),
    pushedAt: timestamp("pushed_at", { withTimezone: true }).notNull(),
    agentId: uuid("agent_id").notNull(),
    tokenId: uuid("token_id"),
    memberId: uuid("member_id").notNull(),
    personId: uuid("person_id").notNull(),
    /** The pusher's written form (identity §8.7), as the `by` rule reads it. */
    byLabel: text("by_label").notNull(),
    networkAddress: inet("network_address"),
    outcome: text("outcome").$type<CatalogPushOutcome>().notNull(),
    /** The refusal codes, one of each; empty when accepted. */
    codes: text("codes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    warnings: integer("warnings").notNull().default(0),
    receivedBytes: bigint("received_bytes", { mode: "number" }).notNull(),
    receivedObjects: integer("received_objects").notNull(),
    newCommits: integer("new_commits").notNull(),
  },
  (t) => [
    check(
      "catalog_pushes_outcome",
      sql`${t.outcome} in ('accepted', 'refused', 'check-only')`,
    ),
    index("catalog_pushes_workspace_pushed_at").on(t.workspaceId, t.pushedAt),
  ],
)

/**
 * The refs of each push: the commit before and after, the kind, and
 * whether Git applied the update (`confirmed`, from the journal's
 * `push.confirmed` entry; the only change the triggers allow, false to
 * true).
 */
export const catalogPushRefs = pgTable(
  "catalog_push_refs",
  {
    pushId: uuid("push_id")
      .notNull()
      .references(() => catalogPushes.id),
    /** The order Git listed the refs in, from 0. */
    position: integer("position").notNull(),
    ref: text("ref").notNull(),
    oldCommit: text("old_commit"),
    newCommit: text("new_commit"),
    kind: text("kind").$type<CatalogPushRefKind>().notNull(),
    confirmed: boolean("confirmed").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.pushId, t.position] }),
    check(
      "catalog_push_refs_kind",
      sql`${t.kind} in ('create', 'update', 'forced-update', 'delete')`,
    ),
    check(
      "catalog_push_refs_commits",
      sql`(${t.oldCommit} is null or ${gitObjectId("old_commit")}) and (${t.newCommit} is null or ${gitObjectId("new_commit")})`,
    ),
  ],
)

/**
 * The first pusher of every commit Shinan has received (Git-based catalog
 * plan §2.6, D-066), copied from the journal: the push whose applied ref
 * update first brought it and the first of its refs that carried it, or
 * `shinan` for commits Shinan made. Inserted once and never changed; the
 * Git container keeps the authoritative copy on its volume.
 */
export const catalogCommitFirstPushes = pgTable(
  "catalog_commit_first_pushes",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    commit: text("commit").notNull(),
    /** Null for a commit Shinan made. */
    pushId: uuid("push_id").references(() => catalogPushes.id),
    ref: text("ref"),
    firstPushedAt: timestamp("first_pushed_at", {
      withTimezone: true,
    }).notNull(),
    pusherKind: text("pusher_kind").$type<"agent" | "shinan">().notNull(),
    agentId: uuid("agent_id"),
    personId: uuid("person_id"),
    /** The written form the `by` rule expects of this commit's fact checks. */
    byLabel: text("by_label").notNull(),
    /** For a commit a purge rewrote, the commit it replaces. */
    replacesCommit: text("replaces_commit"),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.commit] }),
    check("catalog_commit_first_pushes_commit", gitObjectId("commit")),
    check(
      "catalog_commit_first_pushes_pusher",
      sql`(${t.pusherKind} = 'shinan' and ${t.pushId} is null and ${t.agentId} is null) or (${t.pusherKind} = 'agent' and ${t.pushId} is not null and ${t.agentId} is not null)`,
    ),
    index("catalog_commit_first_pushes_push").on(t.pushId),
  ],
)

/**
 * When each commit reached `main` (Git-based catalog plan §2.6; review of
 * #196), copied from the journal: for each applied update of `main`, the
 * commits it made reachable (`push.confirmed`'s `main.added`), with the
 * time Shinan recorded; for a repository's first commit, when Shinan made
 * it. Recorded once, on the first arrival, and never changed (an agent
 * writes a commit's own date, so it is not this). A purge's rewritten
 * commits keep their arrival through the first-pusher record's
 * `replaces_commit`, which a read follows.
 */
export const catalogMainArrivals = pgTable(
  "catalog_main_arrivals",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    commit: text("commit").notNull(),
    /** The push that brought it; null for a commit Shinan made. */
    pushId: uuid("push_id").references(() => catalogPushes.id),
    reachedMainAt: timestamp("reached_main_at", {
      withTimezone: true,
    }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.commit] }),
    check("catalog_main_arrivals_commit", gitObjectId("commit")),
  ],
)

/**
 * The values a workspace's owners allowed as "not a secret" (plan §2.5,
 * GQ-2): only the SHA-256 of each value, at most 100 per workspace. The
 * push checks let exactly these values through.
 */
export const catalogAllowedValues = pgTable(
  "catalog_allowed_values",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    fingerprint: text("fingerprint").notNull(),
    allowedByPersonId: uuid("allowed_by_person_id")
      .notNull()
      .references(() => people.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.fingerprint] }),
    check(
      "catalog_allowed_values_fingerprint",
      sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)

/**
 * A rewrite of a workspace's repository by a purge (Git-based catalog plan
 * §2.9, GC-8), copied from the Git container's journal (its
 * `repository.purged` entry): the branches as the rewrite left them, which
 * the minute check of the push log starts from, and what it changed,
 * counted. Keyed by the purge's ID: the purge's record
 * (`catalog_purges`) is stored after it, by `web`, and a rewrite without
 * one is a purge whose database part has yet to finish. Append-only, except
 * that a later purge may replace text in `refs`.
 */
export const catalogRewrites = pgTable(
  "catalog_rewrites",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    journalId: uuid("journal_id").notNull(),
    journalEntry: bigint("journal_entry", { mode: "number" }).notNull(),
    rewrittenAt: timestamp("rewritten_at", { withTimezone: true }).notNull(),
    /** Every branch after the rewrite, and its commit. */
    refs: jsonb("refs").$type<{ ref: string; commit: string }[]>().notNull(),
    /** What the rewrite changed, counted. */
    counts: jsonb("counts").$type<CatalogPurgeHistoryCounts>().notNull(),
  },
  (t) => [
    index("catalog_rewrites_workspace_rewritten_at").on(
      t.workspaceId,
      t.rewrittenAt,
    ),
  ],
)

/**
 * How far `web` has stored each journal of the Git container (plan §2.6):
 * the last entry number stored, so an entry read twice is stored once.
 * Keyed by the journal's own ID, so a new journal (a replaced volume)
 * starts again from its first entry.
 */
export const catalogJournals = pgTable("catalog_journals", {
  journalId: uuid("journal_id").primaryKey(),
  lastStored: bigint("last_stored", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/**
 * The agent index (catalog §12; architecture §5.3): rows derived by the
 * indexer alone from the documents on `main` of the workspace's catalog
 * repository, and rebuilt from `main` when lost or when the parser changes
 * (D-006). Every row records the parser version that produced it. A
 * document is known by its path in the repository: its ID plus `.md`
 * (Git-based catalog plan §2.1).
 */

const parserVersionColumn = () => integer("parser_version").notNull()

/** A full Git object ID: SHA-1, or SHA-256 should repositories ever use it. */
const objectIdFormat = "^([0-9a-f]{40}|[0-9a-f]{64})$"

/** Where a workspace's index stands, and the last round-trip check. */
export const catalogIndexState = pgTable(
  "catalog_index_state",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id),
    /** The commit of `main` the index was built from; null before the first build. */
    commit: text("commit"),
    /**
     * The latest commit of `main` Shinan knows of: recorded with each
     * accepted update of `main`, and whenever the indexer reads it. The
     * index is behind while it differs from `commit`.
     */
    mainCommit: text("main_commit"),
    /** The parser version of the last full build. */
    parserVersion: parserVersionColumn(),
    /** The version of the index's own rules of the last full build. */
    rulesVersion: integer("rules_version").notNull(),
    /** Set while a rebuild is asked for or running: answers say the index is behind. */
    rebuildRequestedAt: timestamp("rebuild_requested_at", {
      withTimezone: true,
    }),
    rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }),
    /** The last round-trip check (architecture §5.3). */
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    /** The commit the last round-trip check compared the index with. */
    checkedCommit: text("checked_commit"),
    /** How many documents' stored rows differed from their text; 0 when they all matched. */
    checkDifferences: integer("check_differences"),
    /** Which documents differed and in which tables: paths only, never text. */
    checkDetails: jsonb("check_details").$type<IndexCheckDifference[]>(),
    /**
     * Why the last attempt to build or check the index failed, as a fixed
     * code (core's `IndexFailureReason`), never text from the catalog;
     * cleared once a build or check succeeds.
     */
    failure: text("failure"),
    failedAt: timestamp("failed_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "catalog_index_state_commit_format",
      sql`${t.commit} is null or ${t.commit} ~ '${sql.raw(objectIdFormat)}'`,
    ),
    check(
      "catalog_index_state_main_commit_format",
      sql`${t.mainCommit} is null or ${t.mainCommit} ~ '${sql.raw(objectIdFormat)}'`,
    ),
  ],
)

/** One document whose stored index rows differ from what its text gives. */
export interface IndexCheckDifference {
  /** The document's path on `main`, or `*` for the workspace as a whole. */
  path: string
  tables: string[]
}

/** One catalog document in the index, with its entity fields. */
export const catalogIndexDocuments = pgTable(
  "catalog_index_documents",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** Its path on `main`, such as `machine/musashi.md`. */
    path: text("path").notNull(),
    /** The Git blob ID of the text these rows were built from. */
    blob: text("blob").notNull(),
    parserVersion: parserVersionColumn(),
    /** The index rules version these rows were built by (with all the document's rows). */
    rulesVersion: integer("rules_version").notNull(),
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
    primaryKey({ columns: [t.workspaceId, t.path] }),
    check(
      "catalog_index_documents_blob_format",
      sql`${t.blob} ~ '${sql.raw(objectIdFormat)}'`,
    ),
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
    workspaceId: uuid("workspace_id").notNull(),
    path: text("path").notNull(),
    /** Its place in the document, from 0. */
    position: integer("position").notNull(),
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
    primaryKey({ columns: [t.workspaceId, t.path, t.position] }),
    foreignKey({
      name: "catalog_index_facts_document_fk",
      columns: [t.workspaceId, t.path],
      foreignColumns: [
        catalogIndexDocuments.workspaceId,
        catalogIndexDocuments.path,
      ],
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
    workspaceId: uuid("workspace_id").notNull(),
    path: text("path").notNull(),
    position: integer("position").notNull(),
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
    primaryKey({ columns: [t.workspaceId, t.path, t.position] }),
    foreignKey({
      name: "catalog_index_relations_document_fk",
      columns: [t.workspaceId, t.path],
      foreignColumns: [
        catalogIndexDocuments.workspaceId,
        catalogIndexDocuments.path,
      ],
    }).onDelete("cascade"),
    index("catalog_index_relations_from").on(t.workspaceId, t.fromId),
    index("catalog_index_relations_to").on(t.workspaceId, t.toId),
  ],
)

/** Discrepancies (catalog §4.7), one row per single-valued key that has one. */
export const catalogIndexDiscrepancies = pgTable(
  "catalog_index_discrepancies",
  {
    workspaceId: uuid("workspace_id").notNull(),
    path: text("path").notNull(),
    key: text("key").notNull(),
    parserVersion: parserVersionColumn(),
    entityId: text("entity_id").notNull(),
    values: jsonb("values").$type<string[]>().notNull(),
    /** The identity keys of the facts in it. */
    identities: text("identities").array().notNull(),
    accepted: boolean("accepted").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.path, t.key] }),
    foreignKey({
      name: "catalog_index_discrepancies_document_fk",
      columns: [t.workspaceId, t.path],
      foreignColumns: [
        catalogIndexDocuments.workspaceId,
        catalogIndexDocuments.path,
      ],
    }).onDelete("cascade"),
  ],
)

/** Body sections (catalog §2.5, §12.1), split by heading, for search and the catalog pages. */
export const catalogIndexSections = pgTable(
  "catalog_index_sections",
  {
    workspaceId: uuid("workspace_id").notNull(),
    path: text("path").notNull(),
    position: integer("position").notNull(),
    parserVersion: parserVersionColumn(),
    catalogId: text("catalog_id"),
    heading: text("heading"),
    level: integer("level").notNull(),
    anchor: text("anchor"),
    text: text("text").notNull(),
    /** Its range in the document's text. */
    start: integer("start").notNull(),
    end: integer("end").notNull(),
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
    primaryKey({ columns: [t.workspaceId, t.path, t.position] }),
    foreignKey({
      name: "catalog_index_sections_document_fk",
      columns: [t.workspaceId, t.path],
      foreignColumns: [
        catalogIndexDocuments.workspaceId,
        catalogIndexDocuments.path,
      ],
    }).onDelete("cascade"),
    index("catalog_index_sections_search").using("gin", t.search),
    index("catalog_index_sections_search_simple").using("gin", t.searchSimple),
  ],
)
