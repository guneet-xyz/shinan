import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { createDatabase, migrateDatabase, migrationsFolder } from "./index.js"
import { createTestDatabase } from "./testing.js"

/** A migrations folder holding only those up to and including `last`. */
async function migrationsUpTo(last: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "shinan-migrations-"))
  await cp(migrationsFolder, folder, { recursive: true })
  const path = join(folder, "meta", "_journal.json")
  const journal = JSON.parse(await readFile(path, "utf8")) as {
    entries: { tag: string }[]
  }
  const end = journal.entries.findIndex((e) => e.tag === last)
  if (end < 0) throw new Error(`No migration ${last}`)
  journal.entries = journal.entries.slice(0, end + 1)
  await writeFile(path, JSON.stringify(journal))
  return folder
}

describe("renaming the scope catalog:propose to catalog:write", () => {
  it("keeps every stored token's access", async () => {
    const database = await createTestDatabase({ migrate: false })
    const folder = await migrationsUpTo("0012_catalog_purge")
    const { pool } = createDatabase(database.url)
    try {
      await migrateDatabase(database.url, folder)
      const { rows } = await pool.query<{ agent: string; workspace: string }>(`
        with person as (
          insert into people (handle, name, email)
          values ('ana', 'Ana', 'ana@example.com') returning id
        ), workspace as (
          insert into workspaces (name) values ('Team') returning id
        ), member as (
          insert into members (workspace_id, person_id, role)
          select workspace.id, person.id, 'owner' from workspace, person
          returning id, workspace_id, person_id
        )
        insert into agents (workspace_id, member_id, person_id, coding_tool, machine, handle, name)
        select workspace_id, id, person_id, 'opencode', 'daedalus', 'opencode-daedalus', 'OpenCode on Daedalus'
        from member
        returning id as agent, workspace_id as workspace
      `)
      const [{ agent, workspace }] = rows as [
        { agent: string; workspace: string },
      ]
      // One active token per agent: the others were replaced.
      const token = (n: number, scopes: string[], active = false) =>
        pool.query(
          "insert into agent_tokens (workspace_id, agent_id, token_hash, scopes, installation_url, revoked_at, revoked_reason) values ($1, $2, $3, $4, 'https://shinan.test', $5, $6)",
          [
            workspace,
            agent,
            String(n).padStart(43, "a"),
            scopes,
            active ? null : new Date(),
            active ? null : "replaced",
          ],
        )
      await token(
        1,
        [
          "catalog:read",
          "catalog:propose",
          "tasks:read",
          "tasks:write",
          "presence",
        ],
        true,
      )
      await token(2, ["catalog:read", "tasks:read"])

      await migrateDatabase(database.url)

      const after = await pool.query<{ scopes: string[] }>(
        "select scopes from agent_tokens order by token_hash desc",
      )
      expect(after.rows.map((r) => r.scopes)).toEqual([
        ["catalog:read", "tasks:read"],
        [
          "catalog:read",
          "catalog:write",
          "tasks:read",
          "tasks:write",
          "presence",
        ],
      ])
      // The old name is refused from now on.
      await expect(token(3, ["catalog:propose"])).rejects.toThrow(
        /agent_tokens_known_scopes/,
      )
    } finally {
      await pool.end()
      await database.drop()
      await rm(folder, { recursive: true, force: true })
    }
  })
})
