import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serve } from "@hono/node-server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  createGitClient,
  moveCatalogsIntoGit,
  shinan,
  storeCatalogJournal,
} from "@shinan/core"
import {
  createDatabase,
  eq,
  m2DropMigration,
  migrateDatabase,
  migrationsFolder,
  schema,
} from "@shinan/db"
import { createTestDatabase, loadDump, v030Dataset } from "@shinan/db/testing"
import type { TestDatabase } from "@shinan/db/testing"
import { createGit } from "@shinan/git"

import { createGitApp } from "./app.js"
import { openJournal } from "./journal.js"
import { checkMain } from "./push/main/checks.js"
import { openRecords } from "./push/records.js"
import { createPushService } from "./push/service.js"
import { createRepositoryStore } from "./store.js"
import type { RepositoryStore } from "./store.js"

// The move of M2's catalog into Git (Git-based catalog plan §4.1, GC-6)
// through the real Git container, on the database v0.3.0 leaves
// (deploy/test/v0.3.0-dataset.sql): the first commit as Git stores it,
// first pushed by `shinan`, and the moved fact checks valid for later
// pushes to `main` that leave them unchanged (D-066).

const serviceToken = "s".repeat(43)
let work: string
let database: TestDatabase
let pool: ReturnType<typeof createDatabase>["pool"]
let db: ReturnType<typeof createDatabase>["db"]
let store: RepositoryStore
let server: Server
let client: ReturnType<typeof createGitClient>
const git = createGit()

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "shinan-move-"))
  for (const folder of ["catalog", "hooks", "home"])
    mkdirSync(join(work, folder))
  const root = join(work, "catalog")
  store = createRepositoryStore({
    root,
    git: createGit({ home: join(work, "home") }),
    hooksDirectory: join(work, "hooks"),
  })
  const journal = openJournal(root)
  const push = createPushService({
    store,
    journal,
    records: openRecords(root),
    log: () => {},
  })
  server = serve({
    fetch: createGitApp({ serviceToken, store, journal, push, log: () => {} })
      .fetch,
    hostname: "127.0.0.1",
    port: 0,
  }) as Server
  await new Promise<void>((resolve) => server.once("listening", resolve))
  client = createGitClient({
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    serviceToken,
  })

  database = await createTestDatabase({ migrate: false })
  await loadDump(database.url, v030Dataset)
  await migrateDatabase(database.url, migrationsFolder, {
    before: m2DropMigration,
  })
  ;({ db, pool } = createDatabase(database.url))
}, 60_000)

afterAll(async () => {
  await pool.end()
  await database.drop()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(work, { recursive: true, force: true })
})

const sha256 = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex")

describe(
  "moving M2's catalog through the Git container",
  { timeout: 60_000 },
  () => {
    it("stores each document's text as Git's blob, by Shinan, first pushed by shinan", async () => {
      const { rows: texts } = await pool.query<{
        workspace: string
        text: string
      }>(`
      select d.workspace_id as workspace, rd.text
      from catalog_documents d
      join catalog_revision_documents rd
        on rd.document_id = d.id and rd.revision = d.current_revision`)
      const reports = await moveCatalogsIntoGit({ db, actor: shinan }, client)
      expect(reports).toHaveLength(3)
      for (const report of reports) {
        const gitDir = store.pathOf(report.workspaceId)
        const show = async (args: string[]) =>
          (await git.run(args, { gitDir })).stdout
        const mine = texts.filter((t) => t.workspace === report.workspaceId)
        for (const { text } of mine) {
          const path = `${/^id: (.+)$/m.exec(text)![1]}.md`
          expect(
            sha256(
              await show(["cat-file", "blob", `${report.firstCommit}:${path}`]),
            ),
            path,
          ).toBe(sha256(text))
        }
        expect(
          (await show(["log", "--format=%an <%ae>|%cn|%P|%s", "main"]))
            .toString()
            .trim(),
        ).toBe(
          `Shinan <shinan@shinan.invalid>|Shinan||${mine.length === 0 ? "Start the catalog" : `Import the catalog from PostgreSQL (revision ${report.revision})`}`,
        )
      }

      // The Git container's journal says Shinan made each first commit; the
      // push log records it as first pushed by shinan.
      await migrateDatabase(database.url)
      await storeCatalogJournal({ db, actor: shinan, jobs: undefined }, client)
      const firsts = await db.select().from(schema.catalogCommitFirstPushes)
      expect(
        firsts.map((f) => [f.commit, f.byLabel, f.pusherKind]).sort(),
      ).toEqual(reports.map((r) => [r.firstCommit, "shinan", "shinan"]).sort())
    })

    it("keeps the moved fact checks valid for a push that leaves them unchanged, and holds new ones to the by rule", async () => {
      // After the first test's move: running it again changes nothing.
      expect(await moveCatalogsIntoGit({ db, actor: shinan }, client)).toEqual(
        [],
      )
      const [trial] = await db
        .select()
        .from(schema.catalogMoves)
        .where(eq(schema.catalogMoves.documents, 17))
      const workspaceId = trial!.workspaceId
      const gitDir = store.pathOf(workspaceId)
      const from = (await git.run(["rev-parse", "main"], { gitDir })).stdout
        .toString()
        .trim()
      const run = async (args: string[], input?: string) =>
        (
          await git.run(args, {
            gitDir,
            input,
            env: {
              GIT_AUTHOR_NAME: "Agent",
              GIT_AUTHOR_EMAIL: "agent@example.com",
              GIT_COMMITTER_NAME: "Agent",
              GIT_COMMITTER_EMAIL: "agent@example.com",
            },
          })
        ).stdout
          .toString()
          .trim()
      /** A commit on `from` with one page's text replaced. */
      const changed = async (path: string, edit: (text: string) => string) => {
        const text = (
          await git.run(["cat-file", "blob", `${from}:${path}`], { gitDir })
        ).stdout.toString()
        const blob = await run(["hash-object", "-w", "--stdin"], edit(text))
        const index = join(work, `index-${Math.random()}`)
        const env = { GIT_INDEX_FILE: index }
        await git.run(["read-tree", from], { gitDir, env })
        await git.run(
          ["update-index", "--cacheinfo", `100644,${blob},${path}`],
          { gitDir, env },
        )
        const tree = (await git.run(["write-tree"], { gitDir, env })).stdout
          .toString()
          .trim()
        return run(["commit-tree", "-p", from, "-m", "A change", tree])
      }
      const check = (to: string) =>
        checkMain({
          gitBinary: git.binary,
          gitHome: join(work, "home"),
          gitDir,
          env: {},
          from,
          to,
          now: Date.parse("2026-11-21T12:00:00Z"),
          memberHandles: ["guneet"],
          // Another agent than the one the moved checks name.
          firstPushers: { [to]: "guneet via opencode-other" },
          groupsEver: [],
          limits: { documents: 20_000, textBytes: 50 * 1024 * 1024 },
        })

      // The body of a moved page changed, its fact checks left as they are.
      const body = await changed(
        "machine/musashi.md",
        (t) => `${t}\nOne more line.\n`,
      )
      expect((await check(body)).problems).toEqual([])

      // A new fact check that names the moved checks' agent, pushed by
      // another one, is held to the by rule.
      const claimed = await changed("machine/musashi.md", (t) =>
        t.replace(
          "facts:\n",
          "facts:\n  - checked: 2026-11-21T09:00:00Z\n    by: guneet via opencode-daedalus\n    scope: Looked again\n    source: The host\n    observed:\n      hostname: musashi\n",
        ),
      )
      expect((await check(claimed)).problems).toEqual([
        expect.objectContaining({ code: "by-not-first-pusher" }),
      ])
    })
  },
)
