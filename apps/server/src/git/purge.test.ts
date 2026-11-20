import { execFile } from "node:child_process"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serve } from "@hono/node-server"
import type { ServerType } from "@hono/node-server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  checkCatalogRefs,
  createAgentToken,
  createCatalogRepository,
  createGitClient,
  createWorkspace,
  previewCatalogPurge,
  purgeCatalogText,
  purgeMarker,
  PurgeScanner,
  shinan,
  storeCatalogJournal,
  updateCatalogIndex,
} from "@shinan/core"
import type { Context, GitClient, JobQueue } from "@shinan/core"
import { and, eq, schema, sql } from "@shinan/db"
import { connectTestDatabase } from "@shinan/db/testing"
import {
  createGit,
  findProgram,
  hooksDirectory,
  readAllObjects,
} from "@shinan/git"

import { insertPerson } from "../../test/people.js"
import { noSignIn } from "../api/sign-in.js"
import { createApp } from "../app.js"
import { listenerOptions } from "../in-flight.js"
import { createGitApp } from "./app.js"
import { openJournal } from "./journal.js"
import type { Journal } from "./journal.js"
import { createPurges } from "./purge.js"
import type { Purges } from "./purge.js"
import { createPushLocks } from "./push/lock.js"
import { openRecords } from "./push/records.js"
import type { Records } from "./push/records.js"
import { createPushService } from "./push/service.js"
import { createRepositoryStore } from "./store.js"
import type { RepositoryStore } from "./store.js"

// A purge as a history rewrite (GC-8, Git-based catalog plan §2.9), end to
// end: agents push a secret everywhere Git can hold it, through `web`, to a
// Git container running the image's own hooks; a workspace owner removes it;
// then no object on the Git volume, no file beside the repositories and no
// row of the database holds it.

const { db, pool } = connectTestDatabase()
const installationUrl = "http://shinan.test"
const jobs: JobQueue = { send: () => Promise.resolve(null) }
const serviceToken = "service-token-for-tests-0123456789abcdef"

let work: string
let root: string
let store: RepositoryStore
let journal: Journal
let records: Records
let client: GitClient
let purges: Purges
let push: ReturnType<typeof createPushService>
const servers: ServerType[] = []
let web: string
let workspaceId: string
let asOwner: Context
const tokens: Record<"alpha" | "beta", string> = { alpha: "", beta: "" }
const labels: Record<"alpha" | "beta", string> = { alpha: "", beta: "" }
const locks = createPushLocks()

async function listen(fetch: Parameters<typeof serve>[0]["fetch"]) {
  const server = serve({
    fetch,
    hostname: "127.0.0.1",
    port: 0,
    serverOptions: { maxHeaderSize: 80 * 1024, ...listenerOptions(120) },
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.once("listening", resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function gitRole() {
  store = createRepositoryStore({
    root,
    git: createGit({ home: join(work, "home") }),
    hooksDirectory: join(work, "hooks"),
  })
  journal = openJournal(root)
  records = openRecords(root)
  push = createPushService({
    store,
    journal,
    records,
    locks,
    log: () => {},
  })
  purges = createPurges({ store, journal, records, push })
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "shinan-purge-"))
  for (const folder of ["catalog", "hooks", "home"])
    mkdirSync(join(work, folder))
  for (const name of ["pre-receive", "post-receive"]) {
    const text = readFileSync(join(hooksDirectory, name), "utf8").replace(
      /^#!.*\n/,
      `#!${process.execPath}\n`,
    )
    writeFileSync(join(work, "hooks", name), text)
    chmodSync(join(work, "hooks", name), 0o755)
  }
  root = join(work, "catalog")
  gitRole()
  push.hookUrl = await listen(push.hookApp.fetch)
  const gitUrl = await listen(
    createGitApp({
      serviceToken,
      store,
      journal,
      push,
      purges,
      log: () => {},
    }).fetch,
  )
  client = createGitClient({ url: gitUrl, serviceToken })

  const owner = await insertPerson(db, "owner")
  await db.insert(schema.emailAllowlist).values({ email: owner.email })
  asOwner = {
    db,
    jobs,
    actor: { kind: "person", personId: owner.id, reauthenticated: true },
  }
  workspaceId = (await createWorkspace(asOwner, { name: "Team" })).workspace.id
  await createCatalogRepository(
    { db, actor: shinan, jobs },
    { workspaceId },
    client,
  )
  for (const machine of ["alpha", "beta"] as const) {
    const issued = await createAgentToken(
      { db, jobs, installationUrl, actor: asOwner.actor },
      { workspaceId, codingTool: "opencode", machine, access: "full" },
    )
    tokens[machine] = issued.token
    labels[machine] = `${owner.handle} via ${issued.agent.handle}`
  }
  web = await listen(
    createApp({
      db,
      signIn: noSignIn,
      jobs,
      installationUrl,
      rateLimit: false,
      gitClient: client,
    }).fetch,
  )
})

afterAll(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          ;(server as Server).closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
  await pool.end()
  rmSync(work, { recursive: true, force: true })
})

const repository = () => `${web}/git/${workspaceId}.git`

function agentGit(
  agent: "alpha" | "beta",
  args: string[],
  cwd = work,
  identity: string = agent,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const home = join(work, `home-${agent}`)
  mkdirSync(join(home, ".config", "shinan"), { recursive: true })
  writeFileSync(join(home, ".config", "shinan", "token"), tokens[agent])
  return new Promise((resolve) => {
    execFile(
      findProgram("git")!,
      [
        "-c",
        `credential.${web}.helper=`,
        "-c",
        `credential.${web}.helper=!f(){ test "$1" = get && printf "username=agent\\npassword=%s\\n" "$(cat ~/.config/shinan/token)"; }; f`,
        "-c",
        `user.name=${identity}`,
        "-c",
        `user.email=${agent}@example.com`,
        ...args,
      ],
      {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          LC_ALL: "C",
        },
      },
      (error, stdout, stderr) =>
        resolve({
          code: error ? ((error as { code?: number }).code ?? 1) : 0,
          stdout,
          stderr,
        }),
    )
  })
}

let clones = 0
async function cloneAs(agent: "alpha" | "beta"): Promise<string> {
  const folder = join(work, `clone-${++clones}`)
  const cloned = await agentGit(agent, [
    "clone",
    "--quiet",
    repository(),
    folder,
  ])
  expect(cloned.stderr).toBe("")
  return folder
}

async function run(
  agent: "alpha" | "beta",
  folder: string,
  ...args: string[]
): Promise<string> {
  const result = await agentGit(agent, args, folder)
  if (result.code !== 0)
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`)
  return result.stdout.trim()
}

async function commit(
  agent: "alpha" | "beta",
  folder: string,
  files: Record<string, string>,
  message = "A change",
  identity: string = agent,
): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(folder, path, ".."), { recursive: true })
    writeFileSync(join(folder, path), content)
    await run(agent, folder, "add", "--", path)
  }
  const made = await agentGit(
    agent,
    ["commit", "--quiet", "--allow-empty", "-m", message],
    folder,
    identity,
  )
  if (made.code !== 0) throw new Error(made.stderr)
  return run(agent, folder, "rev-parse", "HEAD")
}

async function pushAs(
  agent: "alpha" | "beta",
  folder: string,
  ...refspecs: string[]
) {
  const pushed = await agentGit(
    agent,
    ["push", "--porcelain", "origin", ...refspecs],
    folder,
  )
  await storeCatalogJournal({ db, actor: shinan, jobs }, client)
  return pushed
}

const remote = (stderr: string) =>
  stderr
    .split("\n")
    .filter((l) => l.startsWith("remote: "))
    .map((l) => l.slice("remote: ".length).trimEnd())

/** Every Git object of every repository on the volume, and every other file's bytes. */
async function volumeHolding(text: string): Promise<string[]> {
  const scanner = new PurgeScanner(text)
  const found: string[] = []
  const visit = async (folder: string) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name)
      if (statSync(path).isDirectory()) {
        if (name.endsWith(".git")) {
          await readAllObjects(store.git, path, (object) => {
            if (scanner.holds(object.content))
              found.push(`${path} ${object.type} ${object.oid}`)
          })
          // And the repository's own files: refs, configuration.
          const refs = await store.git.run(["for-each-ref"], { gitDir: path })
          if (scanner.holds(refs.stdout)) found.push(`${path} refs`)
        }
        await visit(path)
      } else if (!/\/objects\/(pack|[0-9a-f]{2})\//.test(path)) {
        if (scanner.holds(readFileSync(path))) found.push(path)
      }
    }
  }
  await visit(root)
  return found
}

/** Every table in the database with a row holding `text`: what a full dump would show. */
async function tablesHolding(text: string): Promise<string[]> {
  const words = text.split(/\s+/)
  const tables = await db.execute<{ schema: string; name: string }>(
    sql`select table_schema as schema, table_name as name from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema') order by 1, 2`,
  )
  const found: string[] = []
  for (const table of tables.rows) {
    const name = sql`${sql.identifier(table.schema)}.${sql.identifier(table.name)}`
    for (const word of words) {
      const { rows } = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${name} t where strpos(t::text, ${word}) > 0 or strpos(to_jsonb(t)::text, ${word}) > 0`,
      )
      if (rows[0]!.n > 0) found.push(`${table.schema}.${table.name}`)
    }
  }
  return [...new Set(found)]
}

/** A page `main` accepts, with a fact check group by `by` if given. */
const page = (id: string, summary: string, by?: string) => `---
id: ${id}
type: ${id.split("/")[0]}
title: ${id}
summary: ${summary}
status: active
owner: unknown
${
  by
    ? `facts:
  - checked: 2026-11-14T09:00:00Z
    by: ${by}
    scope: Looked
    source: Somewhere
    observed:
      hostname: x
`
    : ""
}---

# ${id}
`

describe(
  "purging a text from the catalog's history",
  { timeout: 120_000 },
  () => {
    it("removes every copy from every branch, message, name and unreachable object, the journal, the index and the database", async () => {
      // A leaked passphrase the secret check does not take for a credential,
      // and its long word split across lines by an editor.
      const word = `lanternorbitvelvet${Math.random().toString(36).slice(2, 10)}`
      const secret = `vault-${word}`
      const alpha = await cloneAs("alpha")

      // On `main`: a page, then a commit that keeps it.
      const onMain = await commit(
        "alpha",
        alpha,
        {
          "machine/musashi.md": page(
            "machine/musashi",
            `The console passphrase is ${secret} for now.`,
            labels.alpha,
          ),
        },
        "Add Musashi",
      )
      expect((await pushAs("alpha", alpha, "HEAD:refs/heads/main")).code).toBe(
        0,
      )
      const later = await commit(
        "alpha",
        alpha,
        { "machine/notes.md": page("machine/notes", "Nothing secret.") },
        "Add notes",
      )
      expect((await pushAs("alpha", alpha, "HEAD:refs/heads/main")).code).toBe(
        0,
      )

      // A page with alpha's fact check on a branch, for another agent to
      // merge after the purge.
      await run("alpha", alpha, "checkout", "--quiet", "-b", "facts")
      await commit(
        "alpha",
        alpha,
        {
          "machine/daedalus.md": page(
            "machine/daedalus",
            `Its old passphrase was ${secret}.`,
            labels.alpha,
          ),
        },
        "Add Daedalus",
      )
      expect((await pushAs("alpha", alpha, "HEAD:refs/heads/facts")).code).toBe(
        0,
      )
      await run("alpha", alpha, "checkout", "--quiet", "main")

      // On a branch, in a branch name, a commit message, a path, an identity,
      // and wrapped across lines.
      await run("alpha", alpha, "checkout", "--quiet", "-b", "work")
      await commit(
        "alpha",
        alpha,
        {
          [`scratch/${secret}.txt`]: "a file named after it\n",
          "scratch/wrapped.md": `vault-lanternorbit\n    velvet${word.slice(18)} was the old one\n`,
        },
        `Mention ${secret} in a message`,
        `Agent ${secret}`,
      )
      expect(
        (await pushAs("alpha", alpha, `HEAD:refs/heads/keep-${secret}`)).code,
      ).toBe(0)

      // An unreachable commit: pushed on a branch, then the branch deleted.
      await run("alpha", alpha, "checkout", "--quiet", "-b", "gone", later)
      const unreachable = await commit(
        "alpha",
        alpha,
        { "gone.md": `Only here: ${secret}\n` },
        "Soon unreachable",
      )
      expect((await pushAs("alpha", alpha, "HEAD:refs/heads/gone")).code).toBe(
        0,
      )
      expect((await pushAs("alpha", alpha, ":refs/heads/gone")).code).toBe(0)
      const gitDir = store.pathOf(workspaceId)
      expect(
        (
          await store.git.run(["cat-file", "-e", unreachable], {
            gitDir,
            okExitCodes: [0, 1, 128],
          })
        ).exitCode,
      ).toBe(0)

      expect(
        (await pushAs("alpha", alpha, `HEAD:refs/heads/also-${secret}`)).code,
      ).toBe(0)
      // A refused push `web` has not stored yet: its journal entry names a
      // branch too.
      const [agent] = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.workspaceId, workspaceId))
        .limit(1)
      const [member] = await db
        .select()
        .from(schema.members)
        .where(eq(schema.members.workspaceId, workspaceId))
      await journal.append("push.checked", {
        push: "00000000-0000-4000-8000-0000000000aa",
        workspaceId,
        agent: { id: agent!.id, handle: agent!.handle },
        person: { id: member!.personId, handle: "owner" },
        memberId: member!.id,
        by: labels.alpha,
        outcome: "refused",
        codes: ["busy"],
        warnings: 0,
        secrets: 0,
        refs: [
          {
            ref: `refs/heads/next-${secret}`,
            old: null,
            new: later,
            kind: "create",
          },
        ],
        receivedBytes: 0,
        receivedObjects: 0,
        newCommits: 0,
      })

      // The index holds the page.
      await updateCatalogIndex(
        { db, actor: shinan, jobs },
        { workspaceId },
        client,
      )

      expect(await volumeHolding(secret)).not.toEqual([])
      expect(await tablesHolding(secret)).toEqual(
        expect.arrayContaining([
          "public.catalog_push_refs",
          "public.catalog_commit_first_pushes",
          "public.catalog_index_documents",
        ]),
      )

      const preview = await previewCatalogPurge(asOwner, client, workspaceId, {
        text: secret,
      })
      expect(preview.history).toMatchObject({
        commits: { main: 1, branches: 3 },
        messages: { main: 0, branches: 1 },
        branchNames: 2,
        currentFiles: ["machine/musashi.md"],
        currentFilesMore: 0,
        journalEntries: 1,
      })
      expect(preview.history!.acrossLines).toBeGreaterThan(0)
      expect(preview.pushLog).toBeGreaterThan(0)
      expect(preview.indexDocuments).toBe(1)
      expect(JSON.stringify(preview)).not.toContain(word)

      const purge = await purgeCatalogText(asOwner, client, workspaceId, {
        text: secret,
        reason: "A passphrase was pushed to the catalog.",
      })
      expect(purge.counts.history).toMatchObject({
        commits: 4,
        messages: 1,
        renamedBranches: 2,
        journalEntries: 1,
      })
      expect(purge.counts.history!.removedCommits).toBeGreaterThanOrEqual(3)

      // The index is rebuilt from the new `main`.
      await updateCatalogIndex(
        { db, actor: shinan, jobs },
        { workspaceId },
        client,
      )
      await storeCatalogJournal({ db, actor: shinan, jobs }, client)

      // No object on the volume, no file beside the repositories, no row.
      expect(await volumeHolding(secret)).toEqual([])
      expect(await volumeHolding(word)).toEqual([])
      expect(await tablesHolding(secret)).toEqual([])
      expect(await tablesHolding(word)).toEqual([])
      expect(
        (
          await store.git.run(["cat-file", "-e", unreachable], {
            gitDir,
            okExitCodes: [0, 1, 128],
          })
        ).exitCode,
      ).not.toBe(0)

      // The page keeps its shape, with the marker.
      const fresh = await cloneAs("beta")
      expect(readFileSync(join(fresh, "machine/musashi.md"), "utf8")).toContain(
        `The console passphrase is ${purgeMarker} for now.`,
      )
      const branches = (
        await run("beta", fresh, "branch", "-r", "--format=%(refname:short)")
      ).split("\n")
      expect(branches).toEqual(
        expect.arrayContaining(["origin/keep-purged", "origin/also-purged"]),
      )

      // Rewritten commits inherit the first pusher of the commits they replace.
      const mainNow = await run("beta", fresh, "rev-parse", "origin/main")
      expect(mainNow).not.toBe(later)
      const [inherited] = await db
        .select()
        .from(schema.catalogCommitFirstPushes)
        .where(
          and(
            eq(schema.catalogCommitFirstPushes.workspaceId, workspaceId),
            eq(schema.catalogCommitFirstPushes.commit, mainNow),
          ),
        )
      expect(inherited).toMatchObject({
        replacesCommit: later,
        byLabel: labels.alpha,
        pusherKind: "agent",
      })
      expect(records.firstPush(workspaceId, mainNow)).toMatchObject({
        by: labels.alpha,
        replaces: later,
      })

      // The push log agrees with the rewritten branches.
      expect(
        await checkCatalogRefs({ db, actor: shinan, jobs }, client),
      ).toEqual({
        unlogged: 0,
        setAside: 0,
      })

      // A clone that still has the old history cannot push it back.
      const refused = await pushAs("alpha", alpha, `${onMain}:refs/heads/old`)
      expect(refused.code).not.toBe(0)
      expect(remote(refused.stderr).join("\n")).toContain(
        "this commit was removed by a purge: fetch, then reset your branch onto the new history",
      )

      // Work on the new history goes on: another agent merges alpha's
      // rewritten branch, whose fact check still names alpha, its first
      // pusher (D-066).
      await run("beta", fresh, "merge", "--quiet", "--no-edit", "origin/facts")
      const pushed = await pushAs("beta", fresh, "HEAD:refs/heads/main")
      expect(remote(pushed.stderr)).toEqual([])
      expect(pushed.code).toBe(0)
      const next = await commit(
        "beta",
        fresh,
        { "machine/notes.md": page("machine/notes", "More.") },
        "More notes",
      )
      expect((await pushAs("beta", fresh, "HEAD:refs/heads/main")).code).toBe(0)
      expect(await store.main(workspaceId)).toBe(next)

      // On the timeline and in the security log, with counts only.
      const [event] = await db
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.workspaceId, workspaceId),
            eq(schema.events.kind, "catalog.purged"),
          ),
        )
      expect(event).toMatchObject({
        data: {
          purgeId: purge.id,
          reason: "A passphrase was pushed to the catalog.",
        },
      })
      const [entry] = await db
        .select()
        .from(schema.securityLog)
        .where(
          and(
            eq(schema.securityLog.workspaceId, workspaceId),
            eq(schema.securityLog.action, "catalog.purged"),
          ),
        )
      expect(entry!.details).toMatchObject({
        purgeId: purge.id,
        counts: purge.counts,
      })
    })

    it("finishes a purge stopped by a restart, and one whose database part failed, without rewriting twice", async () => {
      const secret = `ember-${Math.random().toString(36).slice(2, 12)}-quartz`
      const folder = await cloneAs("alpha")
      await commit(
        "alpha",
        folder,
        { "machine/ember.md": page("machine/ember", `It is ${secret}.`) },
        "Ember",
      )
      expect((await pushAs("alpha", folder, "HEAD:refs/heads/main")).code).toBe(
        0,
      )
      const before = await store.main(workspaceId)

      // The Git container fails right after the swap, before it journals the
      // rewrite: its record still says `swapping`.
      const crash = new Error("stopped")
      const original = journal.append.bind(journal)
      let failing = true
      journal.append = (kind, data) => {
        if (failing && kind === "repository.rewritten")
          return Promise.reject(crash)
        return original(kind, data)
      }
      await expect(
        client.purge(workspaceId, {
          purgeId: "00000000-0000-4000-8000-000000000001",
          text: secret,
        }),
      ).rejects.toThrow()
      failing = false
      journal.append = original
      expect(await store.main(workspaceId)).not.toBe(before)

      // A restart (or the next purge) finishes it from its record: the
      // repository's branches are the record's, so the swap was done.
      expect(
        records.purge(workspaceId, "00000000-0000-4000-8000-000000000001")
          ?.phase,
      ).toBe("swapping")
      await purges.recover()
      expect(
        records.purge(workspaceId, "00000000-0000-4000-8000-000000000001")
          ?.phase,
      ).toBe("done")
      expect(records.purgedCommits(workspaceId).has(before!)).toBe(true)

      // `web` never recorded it: removing the text again finishes the
      // database part under the rewrite's ID, without rewriting.
      const main = await store.main(workspaceId)
      const purge = await purgeCatalogText(asOwner, client, workspaceId, {
        text: secret,
        reason: "Finishing.",
      })
      expect(purge.id).toBe("00000000-0000-4000-8000-000000000001")
      expect(purge.counts.history?.commits).toBe(1)
      expect(await store.main(workspaceId)).toBe(main)
      expect(await volumeHolding(secret)).toEqual([])
      expect(await tablesHolding(secret)).toEqual([])
    })
  },
)
