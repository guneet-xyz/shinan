import { sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import {
  bigint,
  check,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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
  },
  (t) => [check("installation_single_row", sql`${t.id} = 1`)],
)

/** A human who can sign in to the installation. Sign-in methods come in M1-4. */
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Never changes (identity §8.7). */
    handle: text("handle").notNull().unique(),
    name: text("name").notNull(),
    /** Stored in lower case, so uniqueness ignores case. */
    email: text("email").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    check("people_handle_format", sql`${t.handle} ~ '^[a-z0-9-]+$'`),
    check("people_email_lower_case", sql`${t.email} = lower(${t.email})`),
  ],
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
    /** The network address of the request that caused it, for throttling. */
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
