import { afterAll, describe, expect, it } from "vitest"

import {
  asAgent,
  asPerson,
  asShinan,
  newPerson,
  testDatabase,
} from "../../test/helpers.js"
import { ForbiddenError, NotFoundError } from "../errors.js"
import { getAccount } from "./account.js"
import { addMember, leaveWorkspace } from "./members.js"
import { createWorkspace } from "./workspaces.js"

const { db, pool } = testDatabase()

afterAll(async () => {
  await pool.end()
})

describe("getAccount", () => {
  it("shows the person and their current workspaces with their role", async () => {
    const person = await newPerson(db)
    const other = await newPerson(db)
    const own = await createWorkspace(asPerson(db, person), { name: "B own" })
    const joined = await createWorkspace(asPerson(db, other), {
      name: "A joined",
    })
    await addMember(asPerson(db, other), {
      workspaceId: joined.workspace.id,
      personId: person.id,
      role: "contributor",
    })
    const left = await createWorkspace(asPerson(db, other), { name: "C left" })
    await addMember(asPerson(db, other), {
      workspaceId: left.workspace.id,
      personId: person.id,
      role: "contributor",
    })
    await leaveWorkspace(asPerson(db, person), {
      workspaceId: left.workspace.id,
    })
    // Someone else's workspace never appears.
    await createWorkspace(asPerson(db, other), { name: "D not mine" })

    const account = await getAccount(asPerson(db, person))

    expect(account.person).toEqual({
      id: person.id,
      handle: person.handle,
      name: person.name,
      email: person.email,
      createdAt: person.createdAt,
    })
    expect(
      account.workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role })),
    ).toEqual([
      { id: joined.workspace.id, name: "A joined", role: "contributor" },
      { id: own.workspace.id, name: "B own", role: "owner" },
    ])
    expect(account.workspaces[1]!.memberId).toBe(own.member.id)
  })

  it("is for people only", async () => {
    const person = await newPerson(db)
    const { workspace } = await createWorkspace(asPerson(db, person), {
      name: "Mine",
    })
    await expect(getAccount(asShinan(db))).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(
      getAccount(await asAgent(db, person, workspace.id)),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("answers not found for a person who does not exist", async () => {
    await expect(
      getAccount({
        db,
        actor: { kind: "person", personId: crypto.randomUUID() },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
