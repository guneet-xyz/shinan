import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { and, eq, schema } from "@shinan/db"

import {
  asAgent,
  asPerson,
  newPerson,
  testDatabase,
} from "../../../test/helpers.js"
import {
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  ReauthenticationRequiredError,
  RuleViolationError,
} from "../../errors.js"
import { addMember } from "../../identity/members.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import { secretFingerprint } from "../document/secrets.js"
import { authorizeGitRequest } from "./access.js"
import {
  allowCatalogValue,
  listCatalogAllowedValues,
  removeCatalogAllowedValue,
} from "./allowed-values.js"
import { maxAllowedValues } from "./api.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

let owner: Person
let contributor: Person
let workspaceId: string

beforeEach(async () => {
  owner = await newPerson(db, "owner")
  contributor = await newPerson(db, "contributor")
  workspaceId = (await createWorkspace(asPerson(db, owner), { name: "Team" }))
    .workspace.id
  await addMember(asPerson(db, owner), {
    workspaceId,
    personId: contributor.id,
    role: "contributor",
  })
})

const value = "ghp_0123456789abcdefghijABCDEFGHIJ012345"

const logged = (action: string) =>
  db
    .select()
    .from(schema.securityLog)
    .where(
      and(
        eq(schema.securityLog.workspaceId, workspaceId),
        eq(schema.securityLog.action, action),
      ),
    )

describe("values allowed as not a secret (GQ-2)", () => {
  it("are allowed by value or by fingerprint, stored and logged as fingerprints only", async () => {
    const byValue = await allowCatalogValue(asPerson(db, owner), {
      workspaceId,
      value,
    })
    expect(byValue.fingerprint).toBe(secretFingerprint(value))
    const other = secretFingerprint("another value")
    await allowCatalogValue(asPerson(db, owner), {
      workspaceId,
      fingerprint: `sha256:${other.toUpperCase()}`,
    })
    // The same value again changes nothing.
    await allowCatalogValue(asPerson(db, owner), { workspaceId, value })
    expect(
      (await listCatalogAllowedValues(asPerson(db, owner), workspaceId))
        .map((v) => v.fingerprint)
        .sort(),
    ).toEqual([secretFingerprint(value), other].sort())
    const entries = await logged("catalog.secret-allowed")
    expect(entries.map((e) => e.details)).toEqual([
      { fingerprint: secretFingerprint(value) },
      { fingerprint: other },
    ])
    expect(JSON.stringify(entries)).not.toContain(value)

    await removeCatalogAllowedValue(asPerson(db, owner), {
      workspaceId,
      fingerprint: other,
    })
    expect(await logged("catalog.secret-allow-removed")).toMatchObject([
      { details: { fingerprint: other } },
    ])
    await expect(
      removeCatalogAllowedValue(asPerson(db, owner), {
        workspaceId,
        fingerprint: other,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("reach the push's context as fingerprints", async () => {
    await allowCatalogValue(asPerson(db, owner), { workspaceId, value })
    const agent = await asAgent(db, contributor, workspaceId)
    const push = await authorizeGitRequest(
      { ...agent, request: { networkAddress: "203.0.113.9" } },
      {
        workspaceId,
        service: "git-receive-pack",
        advertisement: true,
        requestId: "r",
      },
    )
    expect(push).toMatchObject({
      allowed: true,
      context: {
        allowedValues: [secretFingerprint(value)],
        networkAddress: "203.0.113.9",
      },
    })
    const fetch = await authorizeGitRequest(agent, {
      workspaceId,
      service: "git-upload-pack",
      advertisement: true,
      requestId: "r",
    })
    expect(fetch).toMatchObject({ context: { allowedValues: [] } })
  })

  it("are for workspace owners who signed in again; never contributors or agents", async () => {
    await expect(
      allowCatalogValue(asPerson(db, contributor), { workspaceId, value }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      listCatalogAllowedValues(asPerson(db, contributor), workspaceId),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      allowCatalogValue(asPerson(db, owner, { reauthenticated: false }), {
        workspaceId,
        value,
      }),
    ).rejects.toBeInstanceOf(ReauthenticationRequiredError)
    await expect(
      allowCatalogValue(await asAgent(db, owner, workspaceId), {
        workspaceId,
        value,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("take 64 hexadecimal characters without sha256: as a key, never storing or logging it", async () => {
    // What a pasted key looks like: the API takes it as no fingerprint.
    const key = "0f344e".padEnd(64, "9")
    await expect(
      allowCatalogValue(asPerson(db, owner), { workspaceId, fingerprint: key }),
    ).rejects.toBeInstanceOf(InvalidInputError)
    const stored = await db
      .select()
      .from(schema.catalogAllowedValues)
      .where(eq(schema.catalogAllowedValues.workspaceId, workspaceId))
    expect(JSON.stringify(stored)).not.toContain(key)
    expect(
      JSON.stringify(await logged("catalog.secret-allowed")),
    ).not.toContain(key)
  })

  it("refuse a malformed fingerprint, both or neither, and more than 100", async () => {
    for (const input of [
      { fingerprint: "sha256:abc" },
      // A mistyped fingerprint, given as a value.
      { value: "sha256:abc" },
      { value: "", fingerprint: undefined },
      { value, fingerprint: secretFingerprint(value) },
      {},
    ]) {
      await expect(
        allowCatalogValue(asPerson(db, owner), { workspaceId, ...input }),
      ).rejects.toBeInstanceOf(InvalidInputError)
    }
    for (let i = 0; i < maxAllowedValues; i++) {
      await allowCatalogValue(asPerson(db, owner), {
        workspaceId,
        value: `value ${i}`,
      })
    }
    await expect(
      allowCatalogValue(asPerson(db, owner), { workspaceId, value }),
    ).rejects.toBeInstanceOf(RuleViolationError)
  })
})
