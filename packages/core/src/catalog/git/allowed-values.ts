import { and, asc, eq, schema, sql } from "@shinan/db"

import { inWorkspace, snapshotRead } from "../../authorize.js"
import type { Context } from "../../context.js"
import {
  InvalidInputError,
  NotFoundError,
  RuleViolationError,
} from "../../errors.js"
import { recordSecurityEntry } from "../../security-log.js"
import { secretFingerprint } from "../document/secrets.js"
import { maxAllowedValues } from "./api.js"

/** A value a workspace's owners allowed as "not a secret": its fingerprint only. */
export interface CatalogAllowedValue {
  /** SHA-256 of the value, lowercase hex. */
  fingerprint: string
  allowedByPersonId: string
  createdAt: Date
}

/**
 * A fingerprint as a refusal shows it: `sha256:` and 64 hexadecimal
 * characters. The prefix is required: 64 bare hexadecimal characters are
 * what a key looks like, so they are a value (review of #196).
 */
const fingerprintPattern = /^sha256:([0-9a-fA-F]{64})$/
/** A fingerprint as stored, for removing one: with or without the prefix. */
const storedPattern = /^(?:sha256:)?([0-9a-fA-F]{64})$/

/**
 * The values a workspace's owners allowed as "not a secret" (Git-based
 * catalog plan §2.5, GQ-2), oldest first: fingerprints, never values.
 * Workspace owners only.
 */
export async function listCatalogAllowedValues(
  ctx: Context,
  workspaceId: string,
): Promise<CatalogAllowedValue[]> {
  return inWorkspace(
    ctx,
    workspaceId,
    "catalog-allowed-value.read",
    (scope) =>
      scope.tx
        .select({
          fingerprint: schema.catalogAllowedValues.fingerprint,
          allowedByPersonId: schema.catalogAllowedValues.allowedByPersonId,
          createdAt: schema.catalogAllowedValues.createdAt,
        })
        .from(schema.catalogAllowedValues)
        .where(eq(schema.catalogAllowedValues.workspaceId, scope.workspaceId))
        .orderBy(
          asc(schema.catalogAllowedValues.createdAt),
          asc(schema.catalogAllowedValues.fingerprint),
        ),
    snapshotRead,
  )
}

/**
 * Lets one exact value through the secret check of the workspace's pushes
 * (GQ-2): given as the value itself, or as the fingerprint a refusal showed
 * (`sha256:…`). Only the fingerprint is stored and recorded in the security
 * log. A workspace owner who signed in again recently; at most 100 values.
 * Allowing a value already allowed changes nothing.
 */
export async function allowCatalogValue(
  ctx: Context,
  input: { workspaceId: string; value?: string; fingerprint?: string },
): Promise<CatalogAllowedValue> {
  return inWorkspace(
    ctx,
    input.workspaceId,
    "catalog-allowed-value.change",
    async (scope) => {
      const fingerprint = fingerprintOf(input)
      const personId = scope.actor.personId!
      const [existing] = await scope.tx
        .select()
        .from(schema.catalogAllowedValues)
        .where(
          and(
            eq(schema.catalogAllowedValues.workspaceId, scope.workspaceId),
            eq(schema.catalogAllowedValues.fingerprint, fingerprint),
          ),
        )
      if (existing) return existing
      // One allowance at a time per workspace, so the count holds.
      await scope.tx
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, scope.workspaceId))
        .for("update")
      const [{ n } = { n: 0 }] = await scope.tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.catalogAllowedValues)
        .where(eq(schema.catalogAllowedValues.workspaceId, scope.workspaceId))
      if (n >= maxAllowedValues) {
        throw new RuleViolationError(
          "allowed-values-full",
          `A workspace can allow at most ${maxAllowedValues} values; remove one first`,
        )
      }
      const [row] = await scope.tx
        .insert(schema.catalogAllowedValues)
        .values({
          workspaceId: scope.workspaceId,
          fingerprint,
          allowedByPersonId: personId,
        })
        .returning()
      await recordSecurityEntry(scope.tx, {
        workspaceId: scope.workspaceId,
        action: "catalog.secret-allowed",
        outcome: "succeeded",
        actor: scope.actor,
        request: scope.request,
        details: { fingerprint },
      })
      return row!
    },
  )
}

/** Stops allowing a value (GQ-2), by its fingerprint; recorded in the security log. */
export async function removeCatalogAllowedValue(
  ctx: Context,
  input: { workspaceId: string; fingerprint: string },
): Promise<void> {
  await inWorkspace(
    ctx,
    input.workspaceId,
    "catalog-allowed-value.change",
    async (scope) => {
      const match = storedPattern.exec(input.fingerprint.trim())
      if (!match) throw new NotFoundError()
      const fingerprint = match[1]!.toLowerCase()
      const removed = await scope.tx
        .delete(schema.catalogAllowedValues)
        .where(
          and(
            eq(schema.catalogAllowedValues.workspaceId, scope.workspaceId),
            eq(schema.catalogAllowedValues.fingerprint, fingerprint),
          ),
        )
        .returning()
      if (removed.length === 0) throw new NotFoundError()
      await recordSecurityEntry(scope.tx, {
        workspaceId: scope.workspaceId,
        action: "catalog.secret-allow-removed",
        outcome: "succeeded",
        actor: scope.actor,
        request: scope.request,
        details: { fingerprint },
      })
    },
  )
}

function fingerprintOf(input: {
  value?: string
  fingerprint?: string
}): string {
  if ((input.value === undefined) === (input.fingerprint === undefined)) {
    throw new InvalidInputError(
      "value",
      "Give the value, or the fingerprint a refusal showed, not both",
    )
  }
  if (input.value !== undefined) {
    if (input.value === "" || input.value.length > 64 * 1024) {
      throw new InvalidInputError("value", "The value is empty or too long")
    }
    // A mistyped fingerprint would be allowed as a value nobody pushes.
    if (/^\s*sha256:/i.test(input.value)) {
      throw new InvalidInputError(
        "fingerprint",
        "A fingerprint is sha256: and 64 hexadecimal characters, as a refusal shows it",
      )
    }
    return secretFingerprint(input.value)
  }
  const match = fingerprintPattern.exec(input.fingerprint!.trim())
  if (!match) {
    throw new InvalidInputError(
      "fingerprint",
      "A fingerprint is sha256: and 64 hexadecimal characters, as a refusal shows it",
    )
  }
  return match[1]!.toLowerCase()
}
