import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

import { getAccount } from "@shinan/core"
import { connectTestDatabase } from "@shinan/db/testing"

import { placeholderSignIn } from "./placeholder-sign-in.js"

const { db, pool } = connectTestDatabase()

afterAll(async () => {
  await pool.end()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("placeholderSignIn", () => {
  it("signs every request in as one person with a workspace", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const handle = `placeholder-${process.pid}-${Date.now()}`

    const signIn = await placeholderSignIn(db, handle, {})
    const person = await signIn.currentPerson(new Request("http://x/"))

    expect(person).toMatchObject({ kind: "person", reauthenticated: true })
    const account = await getAccount({ db, actor: person! })
    expect(account.person.handle).toBe(handle)
    expect(account.workspaces).toMatchObject([
      { name: "Development", role: "owner" },
    ])

    // Starting again finds the same person and adds no workspace.
    const again = await placeholderSignIn(db, handle, {})
    const same = await again.currentPerson(new Request("http://x/"))
    expect(same?.personId).toBe(person!.personId)
    expect((await getAccount({ db, actor: same! })).workspaces).toHaveLength(1)
  })

  it("refuses to run in production", async () => {
    await expect(
      placeholderSignIn(db, "dev", { NODE_ENV: "production" }),
    ).rejects.toThrow(/development only/)
  })
})
