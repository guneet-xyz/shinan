import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

import { createPerson, getAccount, shinan } from "@shinan/core"
import { connectTestDatabase } from "@shinan/db/testing"

import { placeholderSignIn } from "./placeholder-sign-in.js"

const { db, pool } = connectTestDatabase()

afterAll(async () => {
  await pool.end()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const development = { NODE_ENV: "development" }

describe("placeholderSignIn", () => {
  it("signs every request in as one person with a workspace", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const handle = `placeholder-${process.pid}-${Date.now()}`

    const signIn = await placeholderSignIn(db, handle, development)
    const { person } = await signIn.currentPerson(new Request("http://x/"))

    expect(person).toMatchObject({ kind: "person", reauthenticated: true })
    const account = await getAccount({ db, actor: person! })
    expect(account.person.handle).toBe(handle)
    expect(account.workspaces).toMatchObject([
      { name: "Development", role: "owner" },
    ])

    // Starting again finds the same person and adds no workspace.
    const again = await placeholderSignIn(db, handle, development)
    const { person: same } = await again.currentPerson(new Request("http://x/"))
    expect(same?.personId).toBe(person!.personId)
    expect((await getAccount({ db, actor: same! })).workspaces).toHaveLength(1)
  })

  it("runs only with NODE_ENV=development", async () => {
    for (const NODE_ENV of [
      undefined,
      "",
      "production",
      "prod",
      "Development",
      "test",
    ]) {
      await expect(
        placeholderSignIn(db, "dev", { NODE_ENV }),
        String(NODE_ENV),
      ).rejects.toThrow(/NODE_ENV=development/)
    }
  })

  it("never signs in as a person it did not create", async () => {
    const handle = `real-${process.pid}-${Date.now()}`
    await createPerson(
      { db, actor: shinan },
      { handle, name: "Real", email: `${handle}@example.com` },
    )
    await expect(placeholderSignIn(db, handle, development)).rejects.toThrow(
      /did not create/,
    )
  })
})
