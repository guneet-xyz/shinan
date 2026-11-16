import { afterAll, beforeEach, describe, expect, it } from "vitest"

import {
  asAgent,
  asPerson,
  newPerson,
  testDatabase,
} from "../../test/helpers.js"
import {
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  ReauthenticationRequiredError,
} from "../errors.js"
import { listEvents } from "../events.js"
import { listSecurityLog } from "../security-log-read.js"
import { addMember } from "./members.js"
import type { Person } from "./people.js"
import { createWorkspace, getWorkspace, renameWorkspace } from "./workspaces.js"

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
  const created = await createWorkspace(asPerson(db, owner), { name: "Team" })
  workspaceId = created.workspace.id
  await addMember(asPerson(db, owner), {
    workspaceId,
    personId: contributor.id,
    role: "contributor",
  })
})

describe("getWorkspace", () => {
  it("shows the workspace with the reader's role", async () => {
    expect(await getWorkspace(asPerson(db, owner), workspaceId)).toMatchObject({
      id: workspaceId,
      name: "Team",
      role: "owner",
    })
    expect(
      await getWorkspace(asPerson(db, contributor), workspaceId),
    ).toMatchObject({ name: "Team", role: "contributor" })
  })

  it("answers not found for people outside the workspace", async () => {
    const outsider = await newPerson(db)
    await expect(
      getWorkspace(asPerson(db, outsider), workspaceId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe("renameWorkspace", () => {
  it("refuses a name longer than 100 characters", async () => {
    await expect(
      renameWorkspace(asPerson(db, owner), {
        workspaceId,
        name: "x".repeat(101),
      }),
    ).rejects.toMatchObject({ rule: "name-too-long" })
  })

  it("renames the workspace and records it", async () => {
    const renamed = await renameWorkspace(asPerson(db, owner), {
      workspaceId,
      name: "  Crew ",
    })

    expect(renamed).toMatchObject({ name: "Crew", role: "owner" })
    const [event] = await listEvents(asPerson(db, owner), workspaceId)
    expect(event).toMatchObject({
      kind: "workspace.renamed",
      summary: `${owner.handle} renamed the workspace to Crew`,
      data: { from: "Team", to: "Crew" },
    })
    const [entry] = await listSecurityLog(asPerson(db, owner), workspaceId)
    expect(entry).toMatchObject({
      action: "workspace.renamed",
      outcome: "succeeded",
      actorPersonId: owner.id,
      details: { from: "Team", to: "Crew" },
    })
  })

  it("records nothing when the name is unchanged", async () => {
    const [before] = await listEvents(asPerson(db, owner), workspaceId)
    await renameWorkspace(asPerson(db, owner), { workspaceId, name: "Team" })
    const [after] = await listEvents(asPerson(db, owner), workspaceId)
    expect(after!.id).toBe(before!.id)
  })

  it("refuses a blank name as invalid input", async () => {
    await expect(
      renameWorkspace(asPerson(db, owner), { workspaceId, name: " " }),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it("checks permission before input, so refusals are recorded", async () => {
    await expect(
      renameWorkspace(asPerson(db, contributor), { workspaceId, name: " " }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    const [entry] = await listSecurityLog(asPerson(db, owner), workspaceId)
    expect(entry).toMatchObject({
      action: "request.refused",
      actorPersonId: contributor.id,
      details: { action: "workspace.change-settings", reason: "role" },
    })
  })

  it("is for workspace owners who signed in again", async () => {
    await expect(
      renameWorkspace(asPerson(db, contributor), { workspaceId, name: "X" }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      renameWorkspace(asPerson(db, owner, { reauthenticated: false }), {
        workspaceId,
        name: "X",
      }),
    ).rejects.toBeInstanceOf(ReauthenticationRequiredError)
    await expect(
      renameWorkspace(asAgent(db, owner, workspaceId), {
        workspaceId,
        name: "X",
      }),
    ).rejects.toMatchObject({ reason: "people-only" })
    expect(await getWorkspace(asPerson(db, owner), workspaceId)).toMatchObject({
      name: "Team",
    })
  })
})
