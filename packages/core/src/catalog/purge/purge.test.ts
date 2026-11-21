import { randomBytes } from "node:crypto"
import { afterAll, beforeEach, describe, expect, it } from "vitest"

import {
  and,
  asc,
  eq,
  inArray,
  refuseDuringTransactions,
  schema,
  sql,
} from "@shinan/db"

import {
  asAgent,
  asPerson,
  newPerson,
  testDatabase,
} from "../../../test/helpers.js"
import { shinan } from "../../actor.js"
import type { Context } from "../../context.js"
import {
  BusyError,
  ForbiddenError,
  InvalidInputError,
  ReauthenticationRequiredError,
  RuleViolationError,
  UnavailableError,
} from "../../errors.js"
import { addMember } from "../../identity/members.js"
import type { Person } from "../../identity/people.js"
import { createWorkspace } from "../../identity/workspaces.js"
import type {
  JournalEntry,
  RepositoryPurgePreview,
  RepositoryPurgeResult,
} from "../git/api.js"
import { GitServiceError } from "../git/client.js"
import type { GitClient } from "../git/client.js"
import { storeCatalogJournal } from "../git/push-log.js"
import { PurgeMatcher } from "./matcher.js"
import type { CatalogPurge } from "./purge.js"
import {
  getCatalogPurgeStatus,
  listCatalogPurges,
  previewCatalogPurge as previewWith,
  purgeFollowing,
  purgeMarker,
  purgeCatalogText as purgeWith,
} from "./purge.js"

// Since the move into Git (GC-6), what a purge rewrites in PostgreSQL is
// the timeline's events, the push log's branch names, the record of the
// move and the index; the repository's history is the Git container's
// (GC-8). The tests plant the text in the database.

const { db, pool } = testDatabase()

// The repository's part of a purge is the Git container's, tested against
// real Git in `apps/server/src/git/purge.test.ts`. Here a stand-in answers
// for it: by default, the history holds no copy. Like the real client in
// tests, it refuses to be called inside a database transaction.
const noHistory: RepositoryPurgePreview = {
  commits: { main: 0, branches: 0 },
  files: { main: 0, branches: 0 },
  messages: { main: 0, branches: 0 },
  branchNames: 0,
  currentFiles: [],
  currentFilesMore: 0,
  acrossLines: 0,
  structure: [],
  alsoWrittenAs: [],
  mayAppearEncoded: [],
  renamedApart: [],
  renamedApartMore: 0,
  journalEntries: 0,
}
const jobs = { send: () => Promise.resolve(null) }
const gitJournal = {
  id: "0b6a3a52-6e3f-4cf1-9a11-6a1c6a7d2f00",
  entries: [] as JournalEntry[],
  last: 0,
}
let gitPurge: (input: { purgeId: string }) => RepositoryPurgeResult
/** The purges whose text's hash `web` told the Git container to drop. */
const forgotten: string[] = []
/** The stand-in's purges, by ID: their results and texts. */
const gitPurges = new Map<
  string,
  { result: RepositoryPurgeResult; text: string }
>()
const git = refuseDuringTransactions(
  {
    previewPurge: () => Promise.resolve(noHistory),
    startPurge: (
      _workspaceId: string,
      input: { purgeId: string; text: string },
    ) => {
      gitPurges.set(input.purgeId, {
        result: gitPurge(input),
        text: input.text,
      })
      return Promise.resolve({ purgeId: input.purgeId, state: "running" })
    },
    purgeStatus: (_workspaceId: string, purgeId: string) => {
      const found = gitPurges.get(purgeId)
      return Promise.resolve(
        found
          ? { purgeId, state: "done", result: found.result }
          : { purgeId, state: "unknown" },
      )
    },
    isPurgeText: (
      _workspaceId: string,
      input: { purgeId: string; text: string },
    ) => Promise.resolve(gitPurges.get(input.purgeId)?.text === input.text),
    forgetPurgeText: (_workspaceId: string, purgeId: string) => {
      forgotten.push(purgeId)
      return Promise.resolve()
    },
    readJournal: ({ after }: { after: number }) =>
      Promise.resolve({
        journalId: gitJournal.id,
        entries: gitJournal.entries.filter((e) => e.number > after),
        last: gitJournal.last,
      }),
    acknowledgeJournal: ({ through }: { through: number }) => {
      gitJournal.entries = gitJournal.entries.filter((e) => e.number > through)
      return Promise.resolve({ deleted: 0 })
    },
  } as unknown as GitClient,
  "git",
)

const previewCatalogPurge = (
  ctx: Context,
  workspaceId: string,
  input: { text: unknown },
) => previewWith(ctx, git, workspaceId, input)
purgeFollowing.intervalMs = 5

/**
 * Removes a text and waits for the removal's end, as the screen does:
 * the purge, or the rule it failed on as core's error.
 */
async function purgeCatalogText(
  ctx: Context,
  workspaceId: string,
  input: { text: unknown; reason: unknown },
  client: GitClient = git,
): Promise<CatalogPurge> {
  const started = await purgeWith(ctx, client, workspaceId, input)
  for (let status = started; ;) {
    if (status.state === "done") return status.purge!
    if (status.state === "failed" && status.rule)
      throw new RuleViolationError(status.rule, status.message!)
    if (status.state !== "running")
      throw new Error(`The removal ended ${status.state}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
    status = await getCatalogPurgeStatus(ctx, client, workspaceId, started.id)
  }
}

/** Appends an entry to the stand-in's journal, as the Git container would. */
function journalEntry(kind: string, data: Record<string, unknown>) {
  gitJournal.last++
  gitJournal.entries.push({
    number: gitJournal.last,
    recordedAt: new Date().toISOString(),
    kind,
    data,
  })
}

afterAll(async () => {
  await pool.end()
})

let owner: Person
let contributor: Person
let workspaceId: string
let asOwner: Context
let asContributor: Context
let asOwnersAgent: Context
/** A leaked passphrase, unique to each test, that the secret check does not catch. */
let secret: string

beforeEach(async () => {
  gitPurge = ({ purgeId }) => ({
    purgeId,
    rewritten: false,
    commits: 0,
    rewrittenCommits: 0,
    removedCommits: 0,
    files: 0,
    messages: 0,
    renamedBranches: 0,
    journalEntries: 0,
  })
  owner = await newPerson(db, "owner")
  contributor = await newPerson(db, "contributor")
  asOwner = asPerson(db, owner)
  asContributor = asPerson(db, contributor)
  const created = await createWorkspace(asOwner, { name: "Team" })
  workspaceId = created.workspace.id
  await addMember(asOwner, {
    workspaceId,
    personId: contributor.id,
    role: "contributor",
  })
  asOwnersAgent = await asAgent(db, owner, workspaceId)
  secret = `plum-otter-${randomBytes(4).toString("hex")}-lantern`
})

/** An event of the workspace's timeline with this summary and data. */
async function event(
  summary: string,
  data: Record<string, unknown> = {},
): Promise<number> {
  const [row] = await db
    .insert(schema.events)
    .values({
      workspaceId,
      kind: "catalog.pushed",
      origin: "git_push",
      actorKind: "person",
      actorPersonId: owner.id,
      actorLabel: owner.handle,
      confidence: "recorded",
      summary,
      data,
    })
    .returning({ id: schema.events.id })
  return row!.id
}

/** The secret, in two events' summaries and one's data (keys and values). */
async function plant(): Promise<number[]> {
  return [
    await event(`${owner.handle} pushed: the passphrase is ${secret}`),
    await event("A change", { note: `Was ${secret}`, [secret]: true }),
    await event("Another change", { list: ["fine", `old ${secret}`] }),
  ]
}

/**
 * Every table in the database, in every schema (the job queue's too), that
 * has a row holding `text`: what a full dump would show.
 */
async function tablesHolding(text: string): Promise<string[]> {
  const tables = await db.execute<{ schema: string; name: string }>(
    sql`select table_schema as schema, table_name as name from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema') order by 1, 2`,
  )
  const found: string[] = []
  for (const table of tables.rows) {
    const name = sql`${sql.identifier(table.schema)}.${sql.identifier(table.name)}`
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${name} t where strpos(t::text, ${text}) > 0 or strpos(to_jsonb(t)::text, ${text}) > 0`,
    )
    if (rows[0]!.n > 0) found.push(`${table.schema}.${table.name}`)
  }
  return found
}

async function securityLog() {
  return db
    .select()
    .from(schema.securityLog)
    .where(eq(schema.securityLog.workspaceId, workspaceId))
    .orderBy(asc(schema.securityLog.id))
}

const none = {
  history: noHistory,
  pushLog: 0,
  indexDocuments: 0,
  moves: 0,
  acrossLines: 0,
  mayAppearEncoded: [],
  unfinished: 0,
  finishesUnfinished: false,
}

describe("purging catalog text", { timeout: 60_000 }, () => {
  it("removes a leaked secret from every event the database stores, keeping the security log", async () => {
    const [first, second, third] = await plant()
    expect(await tablesHolding(secret)).toEqual(["public.events"])
    const logBefore = await securityLog()
    expect(
      await previewCatalogPurge(asOwner, workspaceId, { text: secret }),
    ).toEqual({ ...none, events: 3, alsoWrittenAs: [] })
    const purge = await purgeCatalogText(asOwner, workspaceId, {
      text: ` ${secret}\n`,
      reason: "A passphrase was written into the catalog.",
    })
    expect(purge).toMatchObject({
      number: 1,
      purgedBy: owner.handle,
      reason: "A passphrase was written into the catalog.",
      counts: {
        pushLog: 0,
        indexDocuments: 0,
        revisionTexts: 0,
        documents: 0,
        latestDocuments: 0,
        proposals: 0,
        rejectedProposals: 0,
        events: 3,
        comments: 0,
      },
    })
    expect(purge.counts.history).toBeUndefined()
    // Nothing in the database holds it any more, not even the earlier
    // versions of rows or the job queue.
    expect(await tablesHolding(secret)).toEqual([])
    const rows = await db
      .select({
        id: schema.events.id,
        summary: schema.events.summary,
        data: schema.events.data,
      })
      .from(schema.events)
      .where(inArray(schema.events.id, [first!, second!, third!]))
      .orderBy(asc(schema.events.id))
    expect(rows).toEqual([
      {
        id: first,
        summary: `${owner.handle} pushed: the passphrase is ${purgeMarker}`,
        data: {},
      },
      {
        id: second,
        summary: "A change",
        data: { note: `Was ${purgeMarker}`, [purgeMarker]: true },
      },
      {
        id: third,
        summary: "Another change",
        data: { list: ["fine", `old ${purgeMarker}`] },
      },
    ])
    // The security log keeps every entry as it was, and records the purge
    // without the text.
    const logAfter = await securityLog()
    expect(logAfter.slice(0, logBefore.length)).toEqual(logBefore)
    const added = logAfter.slice(logBefore.length)
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({
      action: "catalog.purged",
      outcome: "succeeded",
      actorPersonId: owner.id,
      details: {
        purgeId: purge.id,
        number: 1,
        counts: purge.counts,
      },
    })
    // The purge is on the timeline, with who, what and why.
    const [purged] = await db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.workspaceId, workspaceId),
          eq(schema.events.kind, "catalog.purged"),
        ),
      )
    expect(purged).toMatchObject({
      actorPersonId: owner.id,
      summary: `${owner.handle} removed text from the catalog's history (purge 1)`,
      data: {
        purgeId: purge.id,
        reason: "A passphrase was written into the catalog.",
        counts: purge.counts,
      },
    })
    expect(purged!.subjects).toEqual([{ type: "catalog-purge", id: purge.id }])
    expect(await listCatalogPurges(asContributor, workspaceId)).toEqual([purge])
  })

  it("is only for workspace owners who signed in again recently, never agents", async () => {
    await plant()
    const input = { text: secret, reason: "Leaked." }
    await expect(
      purgeCatalogText(asContributor, workspaceId, input),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      previewCatalogPurge(asContributor, workspaceId, input),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      purgeCatalogText(asOwnersAgent, workspaceId, input),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      purgeCatalogText(
        asPerson(db, owner, { reauthenticated: false }),
        workspaceId,
        input,
      ),
    ).rejects.toBeInstanceOf(ReauthenticationRequiredError)
    const refusals = await db
      .select()
      .from(schema.securityLog)
      .where(
        and(
          eq(schema.securityLog.workspaceId, workspaceId),
          eq(schema.securityLog.action, "request.refused"),
        ),
      )
      .orderBy(asc(schema.securityLog.id))
    expect(refusals.map((r) => r.details)).toEqual([
      { action: "catalog.purge", reason: "role" },
      { action: "catalog.purge", reason: "role" },
      { action: "catalog.purge", reason: "people-only" },
      { action: "catalog.purge", reason: "reauthentication" },
    ])
    // Nothing was purged.
    expect(await listCatalogPurges(asOwner, workspaceId)).toEqual([])
    expect(await tablesHolding(secret)).toEqual(["public.events"])
  })

  it("checks the text and the reason", async () => {
    await plant()
    const purge = (text: unknown, reason: unknown = "Leaked.") =>
      purgeCatalogText(asOwner, workspaceId, { text, reason })
    const refused = async (promise: Promise<unknown>, rule: string) => {
      const error: unknown = await promise.then(
        () => null,
        (e: unknown) => e,
      )
      expect(error).toBeInstanceOf(RuleViolationError)
      expect((error as RuleViolationError).rule).toBe(rule)
      // An error never repeats the text.
      expect((error as Error).message).not.toContain(secret)
    }
    await refused(purge(42), "text")
    await refused(purge(" abc "), "text-too-short")
    await refused(purge("x".repeat(10_001)), "text-too-long")
    await refused(purge("urged"), "text-in-marker")
    await refused(purge(secret, "  "), "reason-blank")
    await refused(purge(secret, `Leaked ${secret}`), "reason-holds-text")
    await refused(purge("not anywhere at all"), "nothing-to-purge")
    await expect(purge(42)).rejects.toBeInstanceOf(InvalidInputError)
    expect(await listCatalogPurges(asOwner, workspaceId)).toEqual([])
  })

  it("matches any run of whitespace, so wrapped text and split secrets go too", async () => {
    const address = "Jane Q Example, 12 Baker Street, Springfield"
    const split = secret.replace("-lantern", "-\nlantern")
    await event(
      "Ask Jane Q Example, 12 Baker\nStreet, Springfield for the key.",
    )
    await event("Indented", {
      text: "Jane Q\r\n  Example, 12   Baker Street,\tSpringfield",
    })
    await event(`The key is ${split}`)
    expect(
      await previewCatalogPurge(asOwner, workspaceId, {
        text: "Jane Q Example,\n12 Baker Street, Springfield",
      }),
    ).toMatchObject({ events: 2 })
    await purgeCatalogText(asOwner, workspaceId, {
      text: address,
      reason: "Personal data.",
    })
    await purgeCatalogText(asOwner, workspaceId, {
      text: secret,
      reason: "A passphrase, split by a line break.",
    })
    for (const word of [
      "Baker",
      "Springfield",
      "Jane Q",
      "-\nlantern",
      secret.split("-")[2]!,
    ])
      expect([word, await tablesHolding(word)]).toEqual([word, []])
  })

  it("purges a whole key block, as long as the text may be, in little time", async () => {
    let body = ""
    for (let i = 0; body.length < 6000; i++)
      body += randomBytes(48).toString("base64")
    const lines = ["-----BEGIN PRIVATE KEY-----"]
    for (let i = 0; i < 6000; i += 64) lines.push(body.slice(i, i + 64))
    lines.push("-----END PRIVATE KEY-----")
    const pem = lines.join("\n").slice(0, 6147)
    // Indented as a Markdown code block, with Windows line endings.
    await event("A pasted key", {
      text: `    ${pem.replaceAll("\n", "\r\n    ")}`,
    })
    const started = performance.now()
    expect(
      await previewCatalogPurge(asOwner, workspaceId, { text: pem }),
    ).toMatchObject({ events: 1 })
    await purgeCatalogText(asOwner, workspaceId, {
      text: pem,
      reason: "A private key in an event.",
    })
    expect(performance.now() - started).toBeLessThan(10_000)
    expect(await tablesHolding(lines[3]!)).toEqual([])
  })

  it("gives the event loop back between the values it matches (#149)", async () => {
    // A contrived worst case: many words of the text, then a word that
    // breaks them, over and over, so every place found fails late.
    const text = "a ".repeat(4999) + "a"
    const value = ("a ".repeat(4997) + "aa ").repeat(2)
    // Once to warm up, as the preview's matching will be.
    new PurgeMatcher(text).test(value)
    const started = performance.now()
    expect(new PurgeMatcher(text).test(value)).toBe(false)
    const single = performance.now() - started

    const events = 12
    for (let i = 0; i < events; i++) await event(value)

    // How long the event loop is held at most while the preview matches.
    let longest = 0
    let last = performance.now()
    const probe = setInterval(() => {
      const now = performance.now()
      longest = Math.max(longest, now - last)
      last = now
    }, 5)
    const previewStarted = performance.now()
    try {
      expect(
        await previewCatalogPurge(asOwner, workspaceId, { text }),
      ).toMatchObject({ events: 0 })
    } finally {
      clearInterval(probe)
    }
    const total = performance.now() - previewStarted
    // Every value was matched (an event costs about `single`; half of
    // them leaves room for timing noise). Without the pauses, the values
    // are matched in one stretch: twelve values, at least. With them,
    // about one value and the pause's budget. Half the events leaves room
    // either way, also on a busy machine.
    expect(total).toBeGreaterThan((events / 2) * single)
    expect(longest).toBeLessThan((events / 2) * single)
  })

  it("shows copies in encoded forms the purge does not reach", async () => {
    const percent = secret.replaceAll("-", "%2D")
    await event(`A link: https://example.com/?q=${percent}`)
    expect(
      (await previewCatalogPurge(asOwner, workspaceId, { text: secret }))
        .alsoWrittenAs,
    ).toEqual([{ form: "percent", text: percent, places: 1 }])
  })

  it("purges branch names in the push log, and finishes a rewrite whose database part never ran", async () => {
    // A push of a branch named after the secret, as `web` stored it.
    const [agent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, workspaceId))
    const [member] = await db
      .select()
      .from(schema.members)
      .where(
        and(
          eq(schema.members.workspaceId, workspaceId),
          eq(schema.members.personId, owner.id),
        ),
      )
    const push = "6a1f0000-0000-4000-8000-000000000001"
    const branch = `refs/heads/notes-${secret}`
    const old = "a".repeat(40)
    const now = "b".repeat(40)
    journalEntry("push.checked", {
      push,
      workspaceId,
      agent: { id: agent!.id, handle: agent!.handle },
      person: { id: owner.id, handle: owner.handle },
      memberId: member!.id,
      by: owner.handle,
      outcome: "accepted",
      codes: [],
      warnings: 0,
      secrets: 0,
      refs: [{ ref: branch, old: null, new: old, kind: "create" }],
      receivedBytes: 10,
      receivedObjects: 3,
      newCommits: 1,
    })
    journalEntry("push.confirmed", {
      push,
      workspaceId,
      confirmed: [0],
      firstPushes: [{ commit: old, ref: branch }],
      main: null,
    })

    // The Git container rewrote the history, then `web` failed before its
    // database part.
    const rewrite = "6a1f0000-0000-4000-8000-0000000000ff"
    const counts = {
      commits: 1,
      rewrittenCommits: 1,
      removedCommits: 1,
      files: 1,
      messages: 0,
      renamedBranches: 1,
      journalEntries: 0,
    }
    journalEntry("repository.rewritten", {
      workspaceId,
      purge: rewrite,
      commits: [{ commit: now, replaces: old, ref: "refs/heads/notes-purged" }],
    })
    journalEntry("repository.purged", {
      workspaceId,
      purge: rewrite,
      refs: [{ ref: "refs/heads/notes-purged", commit: now }],
      counts,
      // The rewrite named a page apart from one that had its name.
      ids: [["machine/purged-box", "machine/purged-box-2"]],
    })
    const moved = await event(`Moved machine/${secret}-box`)
    await storeCatalogJournal({ db, actor: shinan, jobs }, git)
    expect(await tablesHolding(secret)).toEqual(
      expect.arrayContaining([
        "public.catalog_push_refs",
        "public.catalog_commit_first_pushes",
      ]),
    )
    const preview = await previewCatalogPurge(asOwner, workspaceId, {
      text: secret,
    })
    // The Git container knows the rewrite's text by its keyed hash.
    gitPurges.set(rewrite, {
      text: secret,
      result: {
        purgeId: rewrite,
        rewritten: true,
        ...counts,
      },
    })
    expect(preview).toMatchObject({ pushLog: 2, unfinished: 1 })
    expect(
      await previewCatalogPurge(asOwner, workspaceId, { text: secret }),
    ).toMatchObject({ finishesUnfinished: true })

    // Another text never finishes it, and it stays listed.
    await expect(
      purgeCatalogText({ ...asOwner, jobs }, workspaceId, {
        text: "a different text altogether",
        reason: "Something else.",
      }),
    ).rejects.toMatchObject({ rule: "nothing-to-purge" })
    expect(
      await previewCatalogPurge(asOwner, workspaceId, {
        text: "a different text altogether",
      }),
    ).toMatchObject({ unfinished: 1, finishesUnfinished: false })

    const purge = await purgeCatalogText({ ...asOwner, jobs }, workspaceId, {
      text: secret,
      reason: "A branch named after a passphrase.",
    })
    // The rewrite's ID and counts: its database part is now done.
    expect(purge).toMatchObject({
      id: rewrite,
      counts: { history: counts, pushLog: 2 },
    })
    // Recorded, so the Git container drops its text's hash.
    expect(forgotten).toContain(rewrite)
    // The timeline names the page as the rewrite did.
    const [named] = await db
      .select({ summary: schema.events.summary })
      .from(schema.events)
      .where(eq(schema.events.id, moved))
    expect(named!.summary).toBe("Moved machine/purged-box-2")
    expect(await tablesHolding(secret)).toEqual([])
    const [ref] = await db
      .select()
      .from(schema.catalogPushRefs)
      .where(eq(schema.catalogPushRefs.pushId, push))
    expect(ref!.ref).toBe("refs/heads/notes-purged")
    // The rewritten commit inherited its first pusher.
    const [inherited] = await db
      .select()
      .from(schema.catalogCommitFirstPushes)
      .where(eq(schema.catalogCommitFirstPushes.commit, now))
    expect(inherited).toMatchObject({
      pushId: push,
      replacesCommit: old,
      ref: "refs/heads/notes-purged",
      pusherKind: "agent",
    })
    // The index is rebuilt from the new `main`.
    const [state] = await db
      .select()
      .from(schema.catalogIndexState)
      .where(eq(schema.catalogIndexState.workspaceId, workspaceId))
    expect(state!.rebuildRequestedAt).not.toBeNull()
    expect(
      await previewCatalogPurge(asOwner, workspaceId, { text: "anything" }),
    ).toMatchObject({ unfinished: 0 })
  })

  it("is refused while another removal runs, and needs the Git container", async () => {
    await plant()
    const busy = refuseDuringTransactions(
      {
        readJournal: () =>
          Promise.resolve({ journalId: gitJournal.id, entries: [], last: 0 }),
        startPurge: () =>
          Promise.reject(
            new GitServiceError(
              409,
              "purge-running",
              "Text is already being removed",
            ),
          ),
      } as unknown as GitClient,
      "git",
    )
    const refused: unknown = await purgeWith(asOwner, busy, workspaceId, {
      text: secret,
      reason: "Leak.",
    }).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(BusyError)
    expect((refused as BusyError).message).toBe(
      "Text is already being removed from this catalog's history: try again in a few minutes",
    )
    await expect(
      purgeWith(asOwner, undefined, workspaceId, {
        text: secret,
        reason: "Leak.",
      }),
    ).rejects.toBeInstanceOf(UnavailableError)
    expect(await listCatalogPurges(asOwner, workspaceId)).toEqual([])
  })

  it("reports a short text in another case on the timeline only as a word of its own", async () => {
    await event("Written in markdown, with a bookmark and a Watermark")
    await event("Ask MARK (the owner) about it")
    const preview = await previewCatalogPurge(asOwner, workspaceId, {
      text: "Mark",
    })
    expect(preview.mayAppearEncoded).toEqual([
      { encoding: "other-case", places: 1 },
    ])
  })

  it("purges catalog IDs in the record of the move into Git", async () => {
    await db.insert(schema.catalogMoves).values({
      workspaceId,
      revision: 3,
      documents: 2,
      firstCommit: "e".repeat(40),
      waitingProposals: [{ number: 8, touches: [`machine/${secret}`] }],
      problems: [
        {
          code: "invalid-id",
          severity: "blocking",
          document: `machine/${secret}`,
        },
      ],
    })
    expect(
      await previewCatalogPurge(asOwner, workspaceId, { text: secret }),
    ).toMatchObject({ moves: 1 })
    await purgeCatalogText(asOwner, workspaceId, {
      text: secret,
      reason: "A passphrase in an ID.",
    })
    expect(await tablesHolding(secret)).toEqual([])
    const [move] = await db
      .select()
      .from(schema.catalogMoves)
      .where(eq(schema.catalogMoves.workspaceId, workspaceId))
    expect(move).toMatchObject({
      // Catalog IDs keep their form: the text becomes `purged`, as in paths.
      waitingProposals: [{ number: 8, touches: ["machine/purged"] }],
      problems: [{ document: "machine/purged" }],
    })
    // Outside a purge's own transaction, the record never changes.
    await expect(
      db
        .update(schema.catalogMoves)
        .set({ problems: [] })
        .where(eq(schema.catalogMoves.workspaceId, workspaceId)),
    ).rejects.toMatchObject({ cause: { code: "42501" } })
  })
})

describe("the database's append-only rules", () => {
  const emptyCounts = {
    revisionTexts: 0,
    documents: 0,
    latestDocuments: 0,
    proposals: 0,
    rejectedProposals: 0,
    events: 0,
    comments: 0,
  }

  async function recordPurge(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    workspace = workspaceId,
  ) {
    await tx.insert(schema.catalogPurges).values({
      workspaceId: workspace,
      number: 1,
      actorKind: "person",
      actorPersonId: owner.id,
      actorLabel: owner.handle,
      confidence: "recorded",
      reason: "Test.",
      counts: emptyCounts,
    })
  }

  const refused = (promise: Promise<unknown>) =>
    expect(promise).rejects.toMatchObject({
      cause: { code: "42501" },
    })

  it("keep a purge's record: never deleted, and only its counts filled in, by its own transaction", async () => {
    const id = await event(`Mentions ${secret}`)
    const e = schema.events
    const p = schema.catalogPurges
    // Rewriting history and then removing the record that allowed it fails
    // as a whole.
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx)
        await tx.update(e).set({ summary: "Changed" }).where(eq(e.id, id))
        await tx.delete(p).where(eq(p.workspaceId, workspaceId))
      }),
    )
    const [unchanged] = await db.select().from(e).where(eq(e.id, id))
    expect(unchanged!.summary).toBe(`Mentions ${secret}`)

    // Only its counts, even in its own transaction.
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx)
        await tx
          .update(p)
          .set({ reason: "Other." })
          .where(eq(p.workspaceId, workspaceId))
      }),
    )
    await db.transaction(async (tx) => {
      await recordPurge(tx)
      await tx
        .update(p)
        .set({ counts: { ...emptyCounts, events: 1 } })
        .where(eq(p.workspaceId, workspaceId))
    })
    // Afterwards, nothing at all.
    await refused(
      db
        .update(p)
        .set({ reason: "Other." })
        .where(eq(p.workspaceId, workspaceId)),
    )
    await refused(
      db
        .update(p)
        .set({ counts: emptyCounts })
        .where(eq(p.workspaceId, workspaceId)),
    )
    await refused(db.delete(p).where(eq(p.workspaceId, workspaceId)))
    await refused(db.execute(sql`truncate catalog_purges cascade`))
  })

  it("let a purge change only events' summary and data, and only in its own transaction, and never the security log", async () => {
    const id = await event(`Mentions ${secret}`)
    const e = schema.events
    // Outside a purge: refused.
    await refused(db.update(e).set({ summary: "Changed" }).where(eq(e.id, id)))
    // In a transaction that records a purge of another workspace: refused.
    const other = await createWorkspace(asOwner, { name: "Other" })
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx, other.workspace.id)
        await tx.update(e).set({ summary: "Changed" }).where(eq(e.id, id))
      }),
    )
    // In the purge's transaction: other columns and deletes are refused.
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx)
        await tx.update(e).set({ kind: "other" }).where(eq(e.id, id))
      }),
    )
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx)
        await tx.delete(e).where(eq(e.id, id))
      }),
    )
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx)
        await tx
          .update(schema.securityLog)
          .set({ details: {} })
          .where(eq(schema.securityLog.workspaceId, workspaceId))
      }),
    )
    await db.transaction(async (tx) => {
      await recordPurge(tx)
      await tx
        .update(e)
        .set({ summary: "Purged", data: { purged: true } })
        .where(eq(e.id, id))
    })
    const [row] = await db.select().from(e).where(eq(e.id, id))
    expect(row).toMatchObject({ summary: "Purged", data: { purged: true } })
  })

  it("let a purge change only the push log's branch names, and only in its own transaction", async () => {
    const [agent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, workspaceId))
    const [member] = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.workspaceId, workspaceId))
    const push = "6a1f0000-0000-4000-8000-0000000000bb"
    await db.insert(schema.catalogPushes).values({
      id: push,
      workspaceId,
      journalId: push,
      journalEntry: 1,
      pushedAt: new Date(),
      agentId: agent!.id,
      memberId: member!.id,
      personId: owner.id,
      byLabel: owner.handle,
      outcome: "accepted",
      receivedBytes: 0,
      receivedObjects: 0,
      newCommits: 1,
    })
    await db.insert(schema.catalogPushRefs).values({
      pushId: push,
      position: 0,
      ref: `refs/heads/${secret}`,
      newCommit: "c".repeat(40),
      kind: "create",
    })
    await db.insert(schema.catalogCommitFirstPushes).values({
      workspaceId,
      commit: "c".repeat(40),
      pushId: push,
      ref: `refs/heads/${secret}`,
      firstPushedAt: new Date(),
      pusherKind: "agent",
      agentId: agent!.id,
      personId: owner.id,
      byLabel: owner.handle,
    })
    const r = schema.catalogPushRefs
    const f = schema.catalogCommitFirstPushes
    await refused(
      db.update(r).set({ ref: "refs/heads/x" }).where(eq(r.pushId, push)),
    )
    await refused(
      db
        .update(f)
        .set({ ref: "refs/heads/x" })
        .where(eq(f.workspaceId, workspaceId)),
    )
    const other = await createWorkspace(asOwner, { name: "Other" })
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx, other.workspace.id)
        await tx
          .update(r)
          .set({ ref: "refs/heads/x" })
          .where(eq(r.pushId, push))
      }),
    )
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx)
        await tx
          .update(r)
          .set({ newCommit: "d".repeat(40) })
          .where(eq(r.pushId, push))
      }),
    )
    await refused(
      db.transaction(async (tx) => {
        await recordPurge(tx)
        await tx.delete(f).where(eq(f.workspaceId, workspaceId))
      }),
    )
    await db.transaction(async (tx) => {
      await recordPurge(tx)
      await tx
        .update(r)
        .set({ ref: "refs/heads/purged" })
        .where(eq(r.pushId, push))
      await tx
        .update(f)
        .set({ ref: "refs/heads/purged" })
        .where(eq(f.workspaceId, workspaceId))
    })
    expect(await tablesHolding(secret)).toEqual([])
  })
})
