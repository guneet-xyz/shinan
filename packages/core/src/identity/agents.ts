import { and, asc, eq, inArray, isNull, schema, sql } from "@shinan/db"
import type { SQL, TokenRevocationReason, Transaction } from "@shinan/db"

import { scopes as allScopes, writtenActor } from "../actor.js"
import type { AgentActor, ResolvedActor, Scope } from "../actor.js"
import { atInstallation, inWorkspace } from "../authorize.js"
import type { Context, RequestInfo, WorkspaceScope } from "../context.js"
import {
  InvalidInputError,
  NotFoundError,
  RuleViolationError,
} from "../errors.js"
import { appendEvent } from "../events.js"
import type { WriteScope } from "../events.js"
import { takeRateLimit } from "../rate-limits.js"
import { networkAddress, recordSecurityEntry } from "../security-log.js"
import { agentTokenPattern, hashToken, newAgentToken } from "../tokens.js"
import { checkName, isId } from "../validation.js"
import { sendSecurityAlert } from "./sign-in.js"

/**
 * The two choices of scopes a token is issued with (identity §7.2): all
 * five, or only the two `read` scopes. A read-only token is a choice of
 * scopes, not a role (§5.1).
 */
export type TokenAccess = "full" | "read-only"

export const tokenScopes: Record<TokenAccess, readonly Scope[]> = {
  full: allScopes,
  "read-only": ["catalog:read", "tasks:read"],
}

/**
 * A token not used for this many days (or never used since it was issued
 * this long ago) is marked as unused (identity §7.3). Nothing expires; the
 * mark only helps the person decide what to revoke.
 */
export const unusedTokenDays = 30

/** The longest coding tool or machine name, as part of a handle. */
export const agentHandlePartLimit = 32

export interface AgentToken {
  id: string
  access: TokenAccess
  scopes: Scope[]
  createdAt: Date
  firstUsedAt: Date | null
  lastUsedAt: Date | null
  /** The network address of the last request that used it. */
  lastNetworkAddress: string | null
  requestCount: number
  /** Not used for `unusedTokenDays` (identity §7.3). */
  unused: boolean
}

export interface Agent {
  id: string
  workspaceId: string
  workspaceName: string
  /** The membership the agent acts through. */
  memberId: string
  personId: string
  personHandle: string
  personName: string
  codingTool: string
  machine: string
  /** `<coding tool>-<machine>` (identity §8.7). */
  handle: string
  name: string
  /** The `machine` catalog entity it runs on, if one was named. */
  machineEntityId: string | null
  enabled: boolean
  createdAt: Date
  disabledAt: Date | null
  /** The token that works now, if any. */
  token: AgentToken | null
}

/** An agent as the Members list shows it beside its member. */
export interface AgentLabel {
  id: string
  handle: string
  name: string
  enabled: boolean
}

/** A new token, shown once (identity §7.4), and the agent it is for. */
export interface IssuedToken {
  agent: Agent
  /** The token itself. Shinan keeps only its hash; it is never shown again. */
  token: string
  /** Whether the agent was created for this token. */
  agentCreated: boolean
  /** Whether an earlier token of the agent was revoked by this one. */
  replacedToken: boolean
}

// Reading agents

/**
 * The signed-in person's own agents in every workspace they are a member
 * of (human experience, Your agents).
 */
export async function listYourAgents(ctx: Context): Promise<Agent[]> {
  return atInstallation(ctx, "account.read", (scope) =>
    selectAgents(
      scope.tx,
      and(
        eq(schema.agents.personId, scope.actor.personId!),
        isNull(schema.members.removedAt),
      ),
    ),
  )
}

/**
 * The workspace's agents: every agent for a workspace owner, only their own
 * for a contributor (identity §5.1).
 */
export async function listAgents(
  ctx: Context,
  workspaceId: string,
): Promise<Agent[]> {
  return inWorkspace(ctx, workspaceId, "agent.read", (scope) =>
    selectAgents(
      scope.tx,
      and(
        eq(schema.agents.workspaceId, scope.workspaceId),
        scope.actor.member!.role === "owner"
          ? undefined
          : eq(schema.agents.memberId, scope.actor.member!.id),
      ),
    ),
  )
}

/** Each member's agents in the workspace, for the Members list. */
export async function agentLabelsByMember(
  tx: Transaction,
  workspaceId: string,
): Promise<Map<string, AgentLabel[]>> {
  const rows = await tx
    .select({
      id: schema.agents.id,
      memberId: schema.agents.memberId,
      handle: schema.agents.handle,
      name: schema.agents.name,
      enabled: schema.agents.enabled,
    })
    .from(schema.agents)
    .where(eq(schema.agents.workspaceId, workspaceId))
    .orderBy(asc(schema.agents.name), asc(schema.agents.id))
  const byMember = new Map<string, AgentLabel[]>()
  for (const { memberId, ...label } of rows) {
    byMember.set(memberId, [...(byMember.get(memberId) ?? []), label])
  }
  return byMember
}

/** What an agent's own request learns about itself (`GET /api/agent`). */
export interface ConnectedAgent {
  agent: Pick<Agent, "id" | "handle" | "name" | "codingTool" | "machine">
  person: { handle: string; name: string }
  workspace: { id: string; name: string }
  /** The role of the member the agent acts for. */
  role: "owner" | "contributor"
  access: TokenAccess
  scopes: Scope[]
}

/**
 * The agent making the request, its member and workspace, and what its
 * token allows: for a person setting up an agent to check the connection.
 */
export async function getConnectedAgent(ctx: Context): Promise<ConnectedAgent> {
  const actor = ctx.actor
  if (actor.kind !== "agent") throw new NotFoundError()
  return inWorkspace(
    ctx,
    actor.workspaceId,
    "workspace.read",
    async (scope) => {
      const [agent] = await selectAgents(
        scope.tx,
        eq(schema.agents.id, actor.agentId),
      )
      if (!agent) throw new NotFoundError()
      return {
        agent: {
          id: agent.id,
          handle: agent.handle,
          name: agent.name,
          codingTool: agent.codingTool,
          machine: agent.machine,
        },
        person: { handle: agent.personHandle, name: agent.personName },
        workspace: { id: agent.workspaceId, name: agent.workspaceName },
        role: scope.actor.member!.role,
        access: accessOf(actor.scopes),
        scopes: [...actor.scopes],
      }
    },
  )
}

// Registering agents and issuing tokens

/**
 * Creates a token by hand (identity §6.2, fallback): for the member's agent
 * with this coding tool and machine, created if it does not exist yet. A
 * new token revokes the agent's previous one (§7.3). The person signs in
 * again first, sees the token once, and is emailed (§3.3).
 */
export async function createAgentToken(
  ctx: Context,
  input: {
    workspaceId: string
    codingTool: string
    machine: string
    /** What to call the agent if it is created; its handle by default. */
    name?: string
    access: TokenAccess
    machineEntityId?: string | null
  },
): Promise<IssuedToken> {
  return inWorkspace(ctx, input.workspaceId, "agent.create", async (scope) => {
    const codingTool = checkHandlePart(input.codingTool, "coding tool")
    const machine = checkHandlePart(input.machine, "machine")
    const handle = `${codingTool}-${machine}`
    const access = checkAccess(input.access)
    const name =
      input.name === undefined || input.name.trim() === ""
        ? handle
        : checkName(input.name, "The agent's name")
    const machineEntityId = checkMachineEntity(input.machineEntityId)
    const memberId = scope.actor.member!.id

    const inserted = await scope.tx
      .insert(schema.agents)
      .values({
        workspaceId: scope.workspaceId,
        memberId,
        personId: scope.actor.personId!,
        codingTool,
        machine,
        handle,
        name,
        machineEntityId,
      })
      .onConflictDoNothing({
        target: [schema.agents.memberId, schema.agents.handle],
      })
      .returning({ id: schema.agents.id })
    const agentCreated = inserted.length > 0
    const [row] = await scope.tx
      .select()
      .from(schema.agents)
      .where(
        and(
          eq(schema.agents.memberId, memberId),
          eq(schema.agents.handle, handle),
        ),
      )
      .for("update")
    if (!row) throw new NotFoundError()
    // Both parts may hold hyphens, so another pair can make the same
    // handle, such as `gemini-cli` on `daedalus` and `gemini` on
    // `cli-daedalus`. Only the same tool and machine is the same agent.
    if (row.codingTool !== codingTool || row.machine !== machine) {
      throw new RuleViolationError(
        "handle-taken",
        `You already have an agent with the handle ${handle} (${row.codingTool} on ${row.machine}). Name the machine differently.`,
      )
    }
    if (agentCreated) {
      await recordAgentChange(scope, row, {
        kind: "agent.created",
        summary: `${scope.actor.label} registered the agent ${handle}`,
        data: { codingTool, machine, name, machineEntityId },
      })
    }
    return issueToken(scope, row, access, agentCreated)
  })
}

/**
 * Issues a new token by hand for one of the member's own agents, revoking
 * its current one (identity §7.3). A disabled agent gets no new token until
 * it is enabled again (§7.5).
 */
export async function issueAgentToken(
  ctx: Context,
  input: { workspaceId: string; agentId: string; access: TokenAccess },
): Promise<IssuedToken> {
  return inWorkspace(ctx, input.workspaceId, "agent.create", async (scope) => {
    const access = checkAccess(input.access)
    const row = await findAgent(scope, input.agentId, "own")
    return issueToken(scope, row, access, false)
  })
}

// Changing agents

/**
 * Renames one of the member's own agents. Only its name changes; its handle,
 * the written form in records, never does (identity §8.7).
 */
export async function renameAgent(
  ctx: Context,
  input: { workspaceId: string; agentId: string; name: string },
): Promise<Agent> {
  return inWorkspace(ctx, input.workspaceId, "agent.change", async (scope) => {
    const name = checkName(input.name, "The agent's name")
    const row = await findAgent(scope, input.agentId, "own")
    if (row.name !== name) {
      await scope.tx
        .update(schema.agents)
        .set({ name })
        .where(eq(schema.agents.id, row.id))
      await recordAgentChange(scope, row, {
        kind: "agent.renamed",
        summary: `${scope.actor.label} renamed the agent ${row.handle} to ${name}`,
        data: { from: row.name, to: name },
      })
    }
    return getAgent(scope, row.id)
  })
}

/**
 * Disables an agent: its token stops working, and no new one can be issued
 * until it is enabled again (identity §7.5). Its member, or any workspace
 * owner.
 */
export async function disableAgent(
  ctx: Context,
  input: { workspaceId: string; agentId: string },
): Promise<Agent> {
  return inWorkspace(ctx, input.workspaceId, "agent.change", async (scope) => {
    const row = await findAgent(scope, input.agentId, "own-or-owner")
    await disable(scope, [row], "agent-disabled")
    return getAgent(scope, row.id)
  })
}

/**
 * Enables one of the member's own agents again. It still needs a new token
 * before it can connect.
 */
export async function enableAgent(
  ctx: Context,
  input: { workspaceId: string; agentId: string },
): Promise<Agent> {
  return inWorkspace(ctx, input.workspaceId, "agent.change", async (scope) => {
    const row = await findAgent(scope, input.agentId, "own")
    if (!row.enabled) {
      await scope.tx
        .update(schema.agents)
        .set({ enabled: true, disabledAt: null })
        .where(eq(schema.agents.id, row.id))
      await recordAgentChange(scope, row, {
        kind: "agent.enabled",
        summary: `${scope.actor.label} enabled the agent ${row.handle}`,
        data: {},
      })
    }
    return getAgent(scope, row.id)
  })
}

/**
 * Revokes an agent's token; it stops working on its next request (identity
 * §7.5). Its member, or any workspace owner.
 */
export async function revokeAgentToken(
  ctx: Context,
  input: { workspaceId: string; agentId: string },
): Promise<Agent> {
  return inWorkspace(ctx, input.workspaceId, "agent.change", async (scope) => {
    const row = await findAgent(scope, input.agentId, "own-or-owner")
    const revoked = await revokeTokens(
      scope,
      eq(schema.agentTokens.agentId, row.id),
      "revoked",
    )
    if (revoked.length === 0) {
      throw new RuleViolationError("no-token", "This agent has no token")
    }
    await appendEvent(scope, {
      kind: "agent.token-revoked",
      subjects: [{ type: "agent", id: row.id }],
      summary: `${scope.actor.label} revoked the token of ${row.handle}`,
      data: { tokenId: revoked[0]!.id, reason: "revoked" },
    })
    return getAgent(scope, row.id)
  })
}

// Automatic revocation (identity §3.2, §5.3, §7.5)

/**
 * Disables every agent of a membership that has just ended, revoking their
 * tokens (identity §5.3). Called inside the removal or leaving.
 */
export async function endAgentsOfMember(
  scope: WriteScope,
  memberId: string,
  reason: "member-removed" | "member-left",
): Promise<void> {
  const rows = await scope.tx
    .select()
    .from(schema.agents)
    .where(
      and(
        eq(schema.agents.workspaceId, scope.workspaceId),
        eq(schema.agents.memberId, memberId),
      ),
    )
    .for("update")
  await disable(scope, rows, reason)
}

/**
 * Revokes all of a person's agent tokens in every workspace, as removal
 * from the allowlist does and "sign out everywhere" may (identity §3.2,
 * §7.5). The agents stay enabled. Returns how many were revoked.
 */
export async function revokeTokensOfPerson(
  scope: RecordScope,
  personId: string,
  reason: "allowlist-removed" | "signed-out-everywhere",
): Promise<number> {
  const revoked = await revokeTokens(
    scope,
    inArray(
      schema.agentTokens.agentId,
      scope.tx
        .select({ id: schema.agents.id })
        .from(schema.agents)
        .where(eq(schema.agents.personId, personId)),
    ),
    reason,
  )
  return revoked.length
}

// Authenticating agent requests

export type AgentAuthentication =
  | { authenticated: true; actor: AgentActor }
  /**
   * The token does not work. Callers answer every such request the same
   * way, whatever the reason (identity §10). With `retryAfterSeconds`, the
   * request was refused by a rate limit instead: a failing token from an
   * address with too many failed attempts, or a working token that made
   * too many requests.
   */
  | { authenticated: false; retryAfterSeconds?: number }

/** Why a token was refused, for the security log only. */
type TokenFailure =
  | "malformed"
  | "unknown"
  | "revoked"
  | "agent-disabled"
  | "membership-ended"
  | "not-allowlisted"
  | "other-installation"

/**
 * Checks an agent token from a request's `Authorization` header (identity
 * §7.4, §7.5), on every request: it must be one this installation issued
 * (so the installation's address must be known), not revoked, of an enabled
 * agent whose membership is current and whose person is still on the email
 * allowlist. A working token is then counted against its own rate limit,
 * and only a request that limit lets through counts as a use.
 *
 * A working token is never refused because of other requests from its
 * network address (§10). Failed attempts are counted per address: while
 * under the limit each is recorded in the security log; over it, failures
 * get a 429 and only the first is recorded. The token itself is never
 * stored or logged, only its hash looked up.
 */
export async function authenticateAgent(
  ctx: Context,
  input: { token: string },
): Promise<AgentAuthentication> {
  const checked = await atInstallation(
    ctx,
    "agent-token.authenticate",
    async (scope) => {
      if (!isWellFormed(input.token)) {
        return { failure: "malformed" as const, row: undefined }
      }
      const [row] = await scope.tx
        .select({
          tokenId: schema.agentTokens.id,
          scopes: schema.agentTokens.scopes,
          installationUrl: schema.agentTokens.installationUrl,
          revokedAt: schema.agentTokens.revokedAt,
          agentId: schema.agents.id,
          handle: schema.agents.handle,
          enabled: schema.agents.enabled,
          workspaceId: schema.agents.workspaceId,
          personId: schema.agents.personId,
          personHandle: schema.people.handle,
          memberId: schema.members.id,
          role: schema.members.role,
          memberRemovedAt: schema.members.removedAt,
          allowlisted: sql<boolean>`exists (select 1 from email_allowlist a where a.email = people.email) or exists (select 1 from installation_operators o where o.email = people.email)`,
        })
        .from(schema.agentTokens)
        .innerJoin(
          schema.agents,
          eq(schema.agents.id, schema.agentTokens.agentId),
        )
        .innerJoin(
          schema.members,
          eq(schema.members.id, schema.agents.memberId),
        )
        .innerJoin(schema.people, eq(schema.people.id, schema.agents.personId))
        .where(eq(schema.agentTokens.tokenHash, hashToken(input.token)))
      if (!row) return { failure: "unknown" as const, row }
      const failure: TokenFailure | null = row.revokedAt
        ? "revoked"
        : !row.enabled
          ? "agent-disabled"
          : row.memberRemovedAt
            ? "membership-ended"
            : !row.allowlisted
              ? "not-allowlisted"
              : // Fail closed: without the installation's address, no token
                // can be shown to be this installation's.
                !scope.installationUrl ||
                  originOf(scope.installationUrl) !== row.installationUrl
                ? "other-installation"
                : null
      return { failure, row }
    },
  )

  const { failure, row } = checked
  if (failure === null) {
    const limited = await takeRateLimit(ctx, "agent-token", {
      key: row.tokenId,
    })
    if (!limited.allowed) {
      return {
        authenticated: false,
        retryAfterSeconds: limited.retryAfterSeconds,
      }
    }
    const actor: AgentActor = {
      kind: "agent",
      agentId: row.agentId,
      tokenId: row.tokenId,
      agentHandle: row.handle,
      personId: row.personId,
      workspaceId: row.workspaceId,
      scopes: row.scopes as Scope[],
    }
    await atInstallation(ctx, "agent-token.authenticate", async (scope) => {
      const [used] = await scope.tx
        .update(schema.agentTokens)
        .set({
          requestCount: sql`${schema.agentTokens.requestCount} + 1`,
          lastUsedAt: sql`now()`,
          firstUsedAt: sql`coalesce(${schema.agentTokens.firstUsedAt}, now())`,
          lastNetworkAddress: networkAddress(scope.request.networkAddress),
        })
        .where(eq(schema.agentTokens.id, row.tokenId))
        .returning({ requestCount: schema.agentTokens.requestCount })
      if (used?.requestCount !== 1) return
      await recordSecurityEntry(scope.tx, {
        workspaceId: row.workspaceId,
        action: "agent-token.first-used",
        outcome: "succeeded",
        actor: {
          kind: "agent",
          personId: row.personId,
          agentId: row.agentId,
          agentSessionId: null,
          label: writtenActor(actor, row.personHandle),
          confidence: "recorded",
          member: { id: row.memberId, role: row.role },
          operator: false,
        },
        request: scope.request,
        details: {
          agentId: row.agentId,
          handle: row.handle,
          tokenId: row.tokenId,
        },
      })
    })
    return { authenticated: true, actor }
  }

  const counted = await takeRateLimit(ctx, "agent-token-failure")
  if (!counted.allowed) {
    return {
      authenticated: false,
      retryAfterSeconds: counted.retryAfterSeconds,
    }
  }
  await atInstallation(ctx, "agent-token.authenticate", (scope) =>
    recordSecurityEntry(scope.tx, {
      // A known token's failures belong to its workspace, where its owners
      // look; unknown ones are installation-level.
      workspaceId: row?.workspaceId ?? null,
      action: "agent-token.failed",
      outcome: "failed",
      actor: scope.actor,
      subjectPersonId: row?.personId ?? null,
      request: scope.request,
      details: {
        reason: failure,
        ...(row
          ? { agentId: row.agentId, handle: row.handle, tokenId: row.tokenId }
          : {}),
      },
    }),
  )
  return { authenticated: false }
}

/**
 * Records each token's use since the last summary in the security log: how
 * many requests, first and last use, and the last network address
 * (identity §11: summaries, not every request). The worker runs this hourly.
 * Returns how many tokens were summarised.
 */
export async function summarizeAgentTokenUse(ctx: Context): Promise<number> {
  return atInstallation(ctx, "agent-token.authenticate", async (scope) => {
    const t = schema.agentTokens
    const rows = await scope.tx
      .select({
        token: t,
        handle: schema.agents.handle,
        personId: schema.agents.personId,
      })
      .from(t)
      .innerJoin(schema.agents, eq(schema.agents.id, t.agentId))
      .where(sql`${t.requestCount} > ${t.summarizedCount}`)
      .orderBy(asc(t.id))
      .for("update", { of: t })
    for (const { token, handle, personId } of rows) {
      await scope.tx
        .update(t)
        .set({ summarizedCount: token.requestCount })
        .where(eq(t.id, token.id))
      await recordSecurityEntry(scope.tx, {
        workspaceId: token.workspaceId,
        action: "agent-token.used",
        outcome: "succeeded",
        actor: scope.actor,
        subjectPersonId: personId,
        request: {},
        details: {
          agentId: token.agentId,
          handle,
          tokenId: token.id,
          ...usageOf(token),
        },
      })
    }
    return rows.length
  })
}

// Internal helpers

type AgentRow = typeof schema.agents.$inferSelect
type TokenRow = typeof schema.agentTokens.$inferSelect

/** What recording a change needs: a transaction, an actor and a request. */
interface RecordScope {
  tx: Transaction
  actor: ResolvedActor
  request: RequestInfo
}

async function selectAgents(
  tx: Transaction,
  condition: SQL | undefined,
): Promise<Agent[]> {
  const t = schema.agentTokens
  const rows = await tx
    .select({
      agent: schema.agents,
      workspaceName: schema.workspaces.name,
      personHandle: schema.people.handle,
      personName: schema.people.name,
      token: {
        id: t.id,
        scopes: t.scopes,
        createdAt: t.createdAt,
        firstUsedAt: t.firstUsedAt,
        lastUsedAt: t.lastUsedAt,
        lastNetworkAddress: t.lastNetworkAddress,
        requestCount: t.requestCount,
        unused: sql<boolean>`coalesce(${t.lastUsedAt}, ${t.createdAt}) < now() - make_interval(days => ${unusedTokenDays})`,
      },
    })
    .from(schema.agents)
    .innerJoin(
      schema.workspaces,
      eq(schema.workspaces.id, schema.agents.workspaceId),
    )
    .innerJoin(schema.people, eq(schema.people.id, schema.agents.personId))
    .innerJoin(schema.members, eq(schema.members.id, schema.agents.memberId))
    .leftJoin(t, and(eq(t.agentId, schema.agents.id), isNull(t.revokedAt)))
    .where(condition)
    .orderBy(
      asc(schema.workspaces.name),
      asc(schema.people.handle),
      asc(schema.agents.name),
      asc(schema.agents.id),
    )
  return rows.map(({ agent, token, ...row }) => ({
    id: agent.id,
    workspaceId: agent.workspaceId,
    workspaceName: row.workspaceName,
    memberId: agent.memberId,
    personId: agent.personId,
    personHandle: row.personHandle,
    personName: row.personName,
    codingTool: agent.codingTool,
    machine: agent.machine,
    handle: agent.handle,
    name: agent.name,
    machineEntityId: agent.machineEntityId,
    enabled: agent.enabled,
    createdAt: agent.createdAt,
    disabledAt: agent.disabledAt,
    token: token
      ? {
          id: token.id,
          access: accessOf(token.scopes),
          scopes: token.scopes as Scope[],
          createdAt: token.createdAt,
          firstUsedAt: token.firstUsedAt,
          lastUsedAt: token.lastUsedAt,
          lastNetworkAddress: token.lastNetworkAddress,
          requestCount: token.requestCount,
          unused: token.unused,
        }
      : null,
  }))
}

async function getAgent(
  scope: WorkspaceScope,
  agentId: string,
): Promise<Agent> {
  const [agent] = await selectAgents(
    scope.tx,
    and(
      eq(schema.agents.workspaceId, scope.workspaceId),
      eq(schema.agents.id, agentId),
    ),
  )
  if (!agent) throw new NotFoundError()
  return agent
}

/**
 * Finds an agent in the scope's workspace and locks it. `own`: only the
 * actor's own agents (through their current membership); `own-or-owner`:
 * also any agent, for a workspace owner. Anything else is not found, so
 * nobody learns about agents they may not manage.
 */
async function findAgent(
  scope: WorkspaceScope,
  agentId: string,
  who: "own" | "own-or-owner",
): Promise<AgentRow> {
  if (!isId(agentId)) throw new NotFoundError()
  const member = scope.actor.member!
  const [row] = await scope.tx
    .select()
    .from(schema.agents)
    .where(
      and(
        eq(schema.agents.workspaceId, scope.workspaceId),
        eq(schema.agents.id, agentId),
        who === "own-or-owner" && member.role === "owner"
          ? undefined
          : eq(schema.agents.memberId, member.id),
      ),
    )
    .for("update")
  if (!row) throw new NotFoundError()
  return row
}

async function issueToken(
  scope: WriteScope,
  agent: AgentRow,
  access: TokenAccess,
  agentCreated: boolean,
): Promise<IssuedToken> {
  if (!agent.enabled) {
    throw new RuleViolationError(
      "agent-disabled",
      "This agent is disabled. Enable it before issuing a token.",
    )
  }
  if (!scope.installationUrl) {
    throw new Error("The installation's address is needed to issue a token")
  }
  const replaced = await revokeTokens(
    scope,
    eq(schema.agentTokens.agentId, agent.id),
    "replaced",
  )
  const token = newAgentToken()
  const scopes = [...tokenScopes[access]]
  const [issued] = await scope.tx
    .insert(schema.agentTokens)
    .values({
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      tokenHash: hashToken(token),
      scopes,
      installationUrl: originOf(scope.installationUrl),
    })
    .returning({ id: schema.agentTokens.id })
  const tokenId = issued!.id
  const replacedTokenId = replaced[0]?.id ?? null
  await appendEvent(scope, {
    kind: "agent.token-issued",
    subjects: [{ type: "agent", id: agent.id }],
    summary: `${scope.actor.label} issued a ${access === "full" ? "full" : "read-only"} token for ${agent.handle}`,
    data: { tokenId, access, replacedTokenId },
  })
  await recordSecurityEntry(scope.tx, {
    workspaceId: scope.workspaceId,
    action: "agent-token.issued",
    outcome: "succeeded",
    actor: scope.actor,
    subjectPersonId: agent.personId,
    request: scope.request,
    details: {
      agentId: agent.id,
      handle: agent.handle,
      tokenId,
      access,
      scopes,
      method: "by-hand",
      replacedTokenId,
    },
  })

  const [details] = await scope.tx
    .select({ email: schema.people.email, workspace: schema.workspaces.name })
    .from(schema.people)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, agent.workspaceId))
    .where(eq(schema.people.id, agent.personId))
  await sendSecurityAlert(
    scope,
    { email: details!.email },
    {
      kind: "agent-token-approved",
      agentHandle: agent.handle,
      workspaceName: details!.workspace,
      at: new Date(),
    },
    "/account/agents",
  )

  return {
    agent: await getAgent(scope, agent.id),
    token,
    agentCreated,
    replacedToken: replacedTokenId !== null,
  }
}

/** Disables agents and revokes their tokens, recording each. */
async function disable(
  scope: WriteScope,
  rows: AgentRow[],
  reason: "agent-disabled" | "member-removed" | "member-left",
): Promise<void> {
  for (const row of rows) {
    const revoked = await revokeTokens(
      scope,
      eq(schema.agentTokens.agentId, row.id),
      reason,
    )
    if (!row.enabled) continue
    await scope.tx
      .update(schema.agents)
      .set({ enabled: false, disabledAt: sql`now()` })
      .where(eq(schema.agents.id, row.id))
    await recordAgentChange(scope, row, {
      kind: "agent.disabled",
      summary: `${scope.actor.label} disabled the agent ${row.handle}`,
      data: { reason, revokedTokenId: revoked[0]?.id ?? null },
    })
  }
}

/**
 * Revokes the tokens that match and are not revoked yet, recording each
 * with why and its use summary (identity §11).
 */
async function revokeTokens(
  scope: RecordScope,
  condition: SQL,
  reason: TokenRevocationReason,
): Promise<TokenRow[]> {
  const t = schema.agentTokens
  // Read first, locked, so the entry can say how many requests came since
  // the last hourly summary; the update then marks them summarised, so the
  // next summary does not count them again.
  const revoked = await scope.tx
    .select()
    .from(t)
    .where(and(isNull(t.revokedAt), condition))
    .orderBy(asc(t.id))
    .for("update")
  if (revoked.length === 0) return revoked
  await scope.tx
    .update(t)
    .set({
      revokedAt: sql`now()`,
      revokedReason: reason,
      summarizedCount: sql`${t.requestCount}`,
    })
    .where(
      inArray(
        t.id,
        revoked.map((token) => token.id),
      ),
    )
  const agents = await scope.tx
    .select({
      id: schema.agents.id,
      handle: schema.agents.handle,
      personId: schema.agents.personId,
    })
    .from(schema.agents)
    .where(
      inArray(
        schema.agents.id,
        revoked.map((token) => token.agentId),
      ),
    )
  for (const token of revoked) {
    const agent = agents.find((a) => a.id === token.agentId)!
    await recordSecurityEntry(scope.tx, {
      workspaceId: token.workspaceId,
      action: "agent-token.revoked",
      outcome: "succeeded",
      actor: scope.actor,
      subjectPersonId: agent.personId,
      request: scope.request,
      details: {
        agentId: agent.id,
        handle: agent.handle,
        tokenId: token.id,
        reason,
        ...usageOf(token),
      },
    })
  }
  return revoked
}

/** Records a change to an agent as an event and in the security log. */
async function recordAgentChange(
  scope: WriteScope,
  agent: AgentRow,
  change: { kind: string; summary: string; data: Record<string, unknown> },
): Promise<void> {
  await appendEvent(scope, {
    kind: change.kind,
    subjects: [{ type: "agent", id: agent.id }],
    summary: change.summary,
    data: change.data,
  })
  await recordSecurityEntry(scope.tx, {
    workspaceId: scope.workspaceId,
    action: change.kind,
    outcome: "succeeded",
    actor: scope.actor,
    subjectPersonId: agent.personId,
    request: scope.request,
    details: { agentId: agent.id, handle: agent.handle, ...change.data },
  })
}

/**
 * A token's use for the security log: `requests` since the last summary
 * (hourly, or the revocation), so no request is counted in two entries, and
 * `totalRequests` since it was made.
 */
function usageOf(token: TokenRow) {
  return {
    requests: token.requestCount - token.summarizedCount,
    totalRequests: token.requestCount,
    firstUsedAt: token.firstUsedAt?.toISOString() ?? null,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    lastNetworkAddress: token.lastNetworkAddress,
  }
}

function accessOf(scopes: readonly string[]): TokenAccess {
  return scopes.every((scope) =>
    tokenScopes["read-only"].includes(scope as Scope),
  )
    ? "read-only"
    : "full"
}

function checkAccess(value: unknown): TokenAccess {
  if (value !== "full" && value !== "read-only") {
    throw new InvalidInputError(
      "token-access",
      "A token is either full or read-only",
    )
  }
  return value
}

/**
 * A coding tool or machine as part of a handle: lowercase letters, digits
 * and single hyphens (identity §8.7). Spaces, dots and underscores become
 * hyphens and letters are lowered, so "MacBook Air" becomes `macbook-air`.
 */
function checkHandlePart(value: string, what: string): string {
  const part = value
    .trim()
    .toLowerCase()
    .replace(/[\s._]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  if (part === "") {
    throw new InvalidInputError(
      `${what.replace(" ", "-")}-blank`,
      `The ${what} must not be blank`,
    )
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(part)) {
    throw new InvalidInputError(
      "handle-format",
      `The ${what} may use only letters, digits, spaces and hyphens`,
    )
  }
  if (part.length > agentHandlePartLimit) {
    throw new InvalidInputError(
      "handle-too-long",
      `The ${what} must be at most ${agentHandlePartLimit} characters`,
    )
  }
  return part
}

/** A `machine` catalog entity ID, such as `machine/daedalus`. */
function checkMachineEntity(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim() === "") return null
  const id = value.trim()
  if (!/^machine\/[a-z0-9]+(-[a-z0-9]+)*$/.test(id) || id.length > 100) {
    throw new InvalidInputError(
      "machine-entity",
      "The machine entity must be a catalog ID such as machine/daedalus",
    )
  }
  return id
}

/** A token Shinan could have issued (identity §7.4), and nothing more. */
function isWellFormed(token: string): boolean {
  return new RegExp(`^${agentTokenPattern.source}$`).test(token)
}

function originOf(url: string): string {
  return new URL(url).origin
}
