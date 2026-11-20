// Seeds a database the way Shinan v0.3.0 (M2) leaves it, through v0.3.0's
// own code, for the test of the upgrade to v0.4.0 (Git-based catalog plan
// §4.1, GC-6). Its dump is `v0.3.0-dataset.sql` beside this file; run this
// again only to change the dataset:
//
//   git worktree add --detach /tmp/v030 v0.3.0 && cd /tmp/v030
//   pnpm install --frozen-lockfile
//   DATABASE_URL=postgres://… npx tsx --conditions=@shinan/source \
//     <this checkout>/deploy/test/v0.3.0-dataset.mjs
//   pg_dump --no-owner --no-privileges --inserts <database> \
//     | grep -v '^\\' > <this checkout>/deploy/test/v0.3.0-dataset.sql
//
// The database must be empty: this runs v0.3.0's migrations first. Every
// value is made up (example.com, documentation addresses); nothing here
// describes a real installation.
//
// - "Trial": shaped like the trial installation's catalog: person/guneet
//   and 16 entities with fact checks by the owner's agent, all applied,
//   then two proposals left waiting for approval (a new service, and the
//   start-here document with the `waiting-for-approval` list that parser
//   version 5 refuses).
// - "Shapes": every other kind of thing M2 stores: a type schema document
//   and an entity of its type, a retired document, an ID changed (with
//   its alias), the start-here document applied with the
//   `waiting-for-approval` list, text that is not ASCII, a rejected
//   proposal, a comment, a page visit and a purge.
// - "Empty": a workspace with no catalog documents.

import { resolve } from "node:path"

const root = process.cwd()
const core = await import(resolve(root, "packages/core/src/index.ts"))
const db = await import(resolve(root, "packages/db/src/index.ts"))
const { createPerson } = await import(
  resolve(root, "packages/core/src/identity/people.ts")
)

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("Set DATABASE_URL")

await db.migrateDatabase(databaseUrl)
const { migrateJobQueue } = await import(
  resolve(root, "apps/server/src/jobs.ts")
)
await migrateJobQueue(databaseUrl)
const { db: database, pool } = db.createDatabase(databaseUrl)
await core.setUpInstallation(
  { db: database, actor: core.shinan },
  { name: "Shinan" },
)

// The address the upgrade test serves the installation on
// (deploy/test/upgrade.mjs): agent tokens are only good there.
const installationUrl = "https://localhost:18444"
// Jobs (emails about new tokens, M2's index updates) are dropped: the
// dump holds only what M2 stored, and v0.4.0 rebuilds the index from Git.
const jobs = { send: () => Promise.resolve(null) }
const asShinan = { db: database, jobs, actor: core.shinan }
const asPerson = (person) => ({
  db: database,
  jobs,
  installationUrl,
  actor: { kind: "person", personId: person.id, reauthenticated: true },
  request: { networkAddress: "192.0.2.10", client: "v0.3.0 dataset" },
})

const guneet = await createPerson(asShinan, {
  handle: "guneet",
  name: "Guneet",
  email: "guneet@example.com",
})
const ana = await createPerson(asShinan, {
  handle: "ana",
  name: "Ana",
  email: "ana@example.com",
})

/** The person's agent on Daedalus in the workspace, with its token's actor. */
async function agentOf(person, workspaceId) {
  const issued = await core.createAgentToken(asPerson(person), {
    workspaceId,
    codingTool: "opencode",
    machine: "daedalus",
    access: "full",
  })
  const { rows } = await pool.query(
    "select id, scopes from agent_tokens where agent_id = $1 and revoked_at is null",
    [issued.agent.id],
  )
  return {
    db: database,
    jobs,
    installationUrl,
    origin: "mcp_call",
    actor: {
      kind: "agent",
      agentId: issued.agent.id,
      tokenId: rows[0].id,
      agentHandle: issued.agent.handle,
      personId: person.id,
      workspaceId,
      scopes: rows[0].scopes,
    },
  }
}

/** A document's whole body now, as `edit-body` expects it. */
async function bodyOf(ctx, workspaceId, id) {
  const { text } = await core.getCatalogDocumentText(ctx, workspaceId, { id })
  return core.parseCatalogDocument(text).body.text
}

/** `edit-body` of a document's whole body. */
async function editBody(ctx, workspaceId, id, text) {
  return {
    op: "edit-body",
    document: id,
    text,
    expect: { text: await bodyOf(ctx, workspaceId, id) },
  }
}

let keys = 0
/** Proposes; a proposal that waits is approved by `approver` unless told not to. */
async function propose(ctx, workspaceId, operations, options = {}) {
  const outcome = await core.proposeCatalogChange(ctx, workspaceId, {
    explanation: options.explanation ?? "Recording what was checked.",
    operations,
    idempotencyKey: `dataset-${++keys}`,
  })
  if (!("proposal" in outcome))
    throw new Error(`Not stored: ${JSON.stringify(outcome)}`)
  let { proposal } = outcome
  if (proposal.state === "pending" && options.approver) {
    const approved = await core.approveCatalogProposal(
      asPerson(options.approver),
      workspaceId,
      proposal.id,
    )
    if (approved.outcome !== "applied")
      throw new Error(`Not applied: ${JSON.stringify(approved)}`)
    proposal = approved.proposal
  }
  return proposal
}

const checked = "2026-11-19T06:40:00Z"
const check = (scope, source) => ({ checked, scope, source })
const fact = (key, value, scope = `Read ${key}`, source = "The host") => ({
  fact: { key, state: "observed", value },
  check: check(scope, source),
})
const relation = (key, to, scope = `Read ${key}`, source = "The host") => ({
  fact: { key, state: "observed", to },
  check: check(scope, source),
})
const entity = (id, title, summary, facts, body) => ({
  op: "create-entity",
  id,
  title,
  summary,
  owner: "person/guneet",
  facts,
  ...(body ? { body } : {}),
})

// The trial-shaped workspace.
const trial = (await core.createWorkspace(asPerson(guneet), { name: "Trial" }))
  .workspace.id
const trialAgent = await agentOf(guneet, trial)
await propose(
  trialAgent,
  trial,
  [
    entity(
      "person/guneet",
      "Guneet",
      "Owner of the workspace's projects, machines and services.",
      [fact("member", "guneet", "Membership", "Shinan's member list")],
    ),
  ],
  { approver: guneet },
)
const machine = (slug, title, role, address) =>
  entity(`machine/${slug}`, title, `A ${role} machine for the dataset.`, [
    fact("role", role),
    fact("environment", "production"),
    fact("access.method", "ssh"),
    fact("access.address", address),
    fact("platform.os", "debian-13"),
  ])
const service = (slug, title, endpoint, runsOn) =>
  entity(`service/${slug}`, title, `${title}, as the dataset has it.`, [
    fact("endpoint", endpoint, "Opened the endpoint", "curl -I"),
    fact("environment", "production"),
    relation("runs-on", `machine/${runsOn}`),
  ])
const project = (slug, title, repository) =>
  entity(
    `project/${slug}`,
    title,
    `The ${title} project.`,
    [fact("repository", repository, "Read the remote", "git remote -v")],
    `# ${title}\n\nNotes kept by agents.\n`,
  )
for (const operation of [
  machine("musashi", "Musashi", "public-stacks", "203.0.113.10"),
  machine("anzen", "Anzen", "storage", "203.0.113.11"),
  machine("daedalus", "Daedalus", "development", "203.0.113.12"),
  service("obscuro", "Secrets", "https://secrets.example.com", "musashi"),
  service("cloudflare-dns", "DNS", "https://dns.example.com", "musashi"),
  service("ingress", "HTTPS ingress", "https://ingress.example.com", "musashi"),
  service("forgejo", "Git hosting", "https://git.example.com", "musashi"),
  service("monitoring", "Monitoring", "https://monitor.example.com", "anzen"),
  service("email", "Email", "https://mail.example.com", "musashi"),
  service("shinan", "Shinan", "https://shinan.example.com", "musashi"),
  service("mon-private", "Private board", "https://mon.example.com", "anzen"),
  service(
    "mon-public",
    "Public board",
    "https://status.example.com",
    "musashi",
  ),
  service("easyshell", "Shell lessons", "https://shell.example.com", "musashi"),
  project("shinan", "Shinan", "https://github.com/example/shinan"),
  project("mon", "mon", "https://github.com/example/mon"),
  project("easyshell", "easyshell", "https://github.com/example/easyshell"),
])
  await propose(trialAgent, trial, [operation], { approver: guneet })
// A later change to three documents at once, as the trial had.
await propose(
  trialAgent,
  trial,
  [
    await editBody(
      trialAgent,
      trial,
      "machine/anzen",
      "# Anzen\n\nThe backup repository is paused.\n",
    ),
    await editBody(
      trialAgent,
      trial,
      "project/mon",
      "# mon\n\nTiles for every check.\n",
    ),
    await editBody(
      trialAgent,
      trial,
      "service/mon-private",
      "# Private board\n\nReachable on the private network only.\n",
    ),
  ],
  { approver: guneet },
)
// From here on every proposal waits for a person's approval.
await core.setCatalogStrict(asPerson(guneet), {
  workspaceId: trial,
  strict: true,
})
await propose(trialAgent, trial, [
  service(
    "container-registry",
    "Container registry",
    "https://registry.example.com",
    "musashi",
  ),
])
await propose(trialAgent, trial, [
  {
    op: "create-start-here",
    title: "Start here",
    people: [
      { to: "machine/musashi", note: "Where the public stacks run." },
      { list: "waiting-for-approval", note: "What waits for a person." },
    ],
    agents: [
      { list: "due-for-recheck", note: "Recheck these first." },
      { url: "https://example.com/workspace", note: "Policies." },
    ],
  },
])

// The workspace with every other shape.
const shapes = (
  await core.createWorkspace(asPerson(guneet), { name: "Shapes" })
).workspace.id
await core.addMember(asPerson(guneet), {
  workspaceId: shapes,
  personId: ana.id,
  role: "contributor",
})
const shapesAgent = await agentOf(guneet, shapes)
const approve = { approver: ana }
await propose(
  shapesAgent,
  shapes,
  [
    entity("person/guneet", "Guneet", "The owner.", [
      fact("member", "guneet", "Membership", "Shinan's member list"),
    ]),
    {
      op: "create-schema",
      type: "domain",
      title: "Domains",
      summary: "Internet domains the workspace holds.",
      owner: "person/guneet",
      keys: { registrar: {}, expires: { recheck: "90d" } },
      required: ["registrar"],
    },
  ],
  approve,
)
await propose(
  shapesAgent,
  shapes,
  [
    {
      op: "create-entity",
      id: "domain/example-org",
      title: "example.org",
      summary: "A domain of the dataset.",
      owner: "person/guneet",
      facts: [fact("registrar", "Example Registrar", "Read WHOIS", "whois")],
      body: "# example.org\n\nRenouvelé chaque année — 日本語のメモ — ✅\n",
    },
    machine("old-box", "Old box", "retired-host", "203.0.113.20"),
    machine("kojiro", "Kojiro", "build", "203.0.113.21"),
  ],
  approve,
)
await propose(
  shapesAgent,
  shapes,
  [{ op: "retire", document: "machine/old-box", expect: { status: "active" } }],
  approve,
)
await propose(
  shapesAgent,
  shapes,
  [{ op: "change-id", document: "machine/kojiro", id: "machine/miyamoto" }],
  approve,
)
await propose(
  shapesAgent,
  shapes,
  [
    {
      op: "create-start-here",
      title: "Start here",
      people: [
        { to: "machine/miyamoto", note: "The build machine." },
        { list: "waiting-for-approval", note: "What waits for a person." },
      ],
      agents: [{ list: "known-unknowns", note: "What nobody knows yet." }],
    },
  ],
  approve,
)
const rejected = await propose(shapesAgent, shapes, [
  {
    op: "retire",
    document: "domain/example-org",
    expect: { status: "active" },
  },
])
await core.commentOnCatalogProposal(asPerson(ana), shapes, {
  proposalId: rejected.id,
  text: "We still hold this domain.",
})
await core.rejectCatalogProposal(asPerson(ana), shapes, {
  proposalId: rejected.id,
  reason: "Still in use.",
})
await core.recordCatalogPageOpened(asPerson(ana), shapes, {
  id: "machine/miyamoto",
})
// A purge of a text that was in a document: it stores a cleaned revision.
await propose(
  shapesAgent,
  shapes,
  [
    await editBody(
      shapesAgent,
      shapes,
      "machine/miyamoto",
      "# Miyamoto\n\nThe spare key is kept under the blue mat.\n",
    ),
  ],
  approve,
)
await core.purgeCatalogText(asPerson(guneet), shapes, {
  text: "under the blue mat",
  reason: "Not to be kept.",
})

// A workspace with nothing in its catalog.
await core.createWorkspace(asPerson(ana), { name: "Empty" })

const { rows } = await pool.query(`
  select w.name,
    (select count(*) from catalog_documents d where d.workspace_id = w.id)::int as documents,
    (select coalesce(max(number), 0) from catalog_revisions r where r.workspace_id = w.id)::int as revision,
    (select count(*) from catalog_proposals p where p.workspace_id = w.id and p.state = 'pending')::int as waiting
  from workspaces w order by w.created_at`)
console.info(JSON.stringify(rows))
await pool.end()
// The catalog worker's threads would keep this process running.
process.exit(0)
