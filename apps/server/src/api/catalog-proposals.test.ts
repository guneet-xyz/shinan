import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type * as Api from "@shinan/api-client"
import { factIdentity, presentFact } from "@shinan/api-client"
import {
  addMember,
  createWorkspace,
  expectationOf,
  proposeCatalogChange,
  readCatalog,
} from "@shinan/core"
import type { Context, Person } from "@shinan/core"
import { asAgent, storeCatalogRevision } from "@shinan/core/testing"
import { connectTestDatabase } from "@shinan/db/testing"

import * as fixtures from "../../../../packages/core/test/catalog-index-fixtures.js"
import { insertPerson } from "../../test/people.js"
import { as, testSignIn } from "../../test/sign-in.js"
import { proposalBodyLimit, proposalInFlight } from "./catalog-proposals.js"
import { createApi } from "./routes.js"

const { db, pool } = connectTestDatabase()

afterAll(async () => {
  await pool.end()
})

const api = createApi({
  db,
  signIn: testSignIn,
  jobs: { send: () => Promise.resolve(null) },
  installationUrl: "http://shinan.test",
  rateLimit: false,
})

const today = new Date().toISOString().slice(0, 10)
const check = { checked: today, scope: "A look", source: "ssh musashi" }

let owner: Person
let contributor: Person
let outsider: Person
let workspaceId: string
let agent: Context

beforeAll(async () => {
  owner = await insertPerson(db, "owner")
  contributor = await insertPerson(db, "contributor")
  outsider = await insertPerson(db, "outsider")
  const created = await createWorkspace(
    { db, actor: { kind: "person", personId: owner.id } },
    { name: "Proposals" },
  )
  workspaceId = created.workspace.id
  await addMember(
    {
      db,
      actor: { kind: "person", personId: owner.id, reauthenticated: true },
    },
    { workspaceId, personId: contributor.id, role: "contributor" },
  )
  agent = await asAgent(db, owner, workspaceId)
})

const ws = (path: string) => `/workspaces/${workspaceId}/catalog${path}`

async function send<T>(
  method: "GET" | "POST",
  path: string,
  who: Person = owner,
  body?: unknown,
) {
  const text =
    body === undefined
      ? undefined
      : typeof body === "string"
        ? body
        : JSON.stringify(body)
  const response = await api.request(path, {
    method,
    headers: {
      origin: "http://shinan.test",
      // As browsers send it: the proposal routes refuse a body of
      // undeclared size.
      ...(text === undefined
        ? {}
        : {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(text)),
          }),
      ...as(who),
    },
    ...(text === undefined ? {} : { body: text }),
  })
  return { status: response.status, body: (await response.json()) as T }
}

const person = () => `person/${owner.handle}`

const create: () => Api.CatalogProposalInput = () => ({
  explanation: "The first entities.",
  operations: [
    {
      op: "create-entity",
      id: person(),
      title: "Owner",
      summary: "Owns the workspace.",
      owner: person(),
      facts: [
        {
          fact: { key: "member", state: "observed", value: owner.handle },
          check,
        },
      ],
    },
    {
      op: "create-entity",
      id: "machine/musashi",
      title: "Musashi",
      summary: "The production host.",
      owner: person(),
      facts: [
        {
          fact: { key: "hostname", state: "observed", value: "musashi" },
          check,
        },
      ],
      body: "# Musashi\n\nThe shared production host.\n",
    },
  ],
})

const deprecate: Api.CatalogOperation = {
  op: "set-field",
  document: "machine/musashi",
  field: "status",
  value: "deprecated",
  expect: { value: "active" },
}

describe("catalog proposals over REST", () => {
  it("previews, then makes a person's change, which applies at once", async () => {
    const previewed = await send<Api.CatalogPreviewOutcome>(
      "POST",
      ws("/proposals/preview"),
      owner,
      create(),
    )
    expect(previewed.status).toBe(200)
    expect(previewed.body).toMatchObject({
      outcome: "applies",
      asApproval: true,
      approvalClasses: expect.arrayContaining(["people-and-agents"]) as unknown,
    })
    const none = await send<Api.CatalogProposalList>("GET", ws("/proposals"))
    expect(none.body.items).toEqual([])

    const made = await send<Api.CatalogProposalOutcome>(
      "POST",
      ws("/proposals"),
      owner,
      create(),
    )
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({
      outcome: "applied",
      proposal: {
        number: 1,
        state: "applied",
        author: { kind: "person", personId: owner.id, agentId: null },
        appliedRevision: 1,
        createdAt: expect.stringMatching(/^\d{4}-/) as unknown,
      },
    })
    // The same again conflicts: the documents exist now.
    const again = await send<Api.CatalogProposalOutcome>(
      "POST",
      ws("/proposals"),
      owner,
      create(),
    )
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({
      outcome: "conflict",
      problems: [
        { operation: 0, code: "document-exists" },
        { operation: 1, code: "document-exists" },
      ],
    })
  })

  it("builds expectations from the entity page's facts that apply", async () => {
    const entity = await send<Api.CatalogEntityAnswer>(
      "GET",
      ws("/entity?id=machine/musashi"),
    )
    const hostname = entity.body.entity.facts.find((f) => f.key === "hostname")!
    const made = await send<Api.CatalogProposalOutcome>(
      "POST",
      ws("/proposals"),
      contributor,
      {
        explanation: "Checked again.",
        operations: [
          {
            op: "recheck-facts",
            document: "machine/musashi",
            facts: [presentFact(hostname)],
            check: { ...check, scope: "hostname" },
          },
        ],
      } satisfies Api.CatalogProposalInput,
    )
    expect(made.body).toMatchObject({
      outcome: "applied",
      proposal: { approvalClasses: ["recheck"] },
    })
  })

  it("lists, reads, approves, rejects and withdraws an agent's proposals", async () => {
    const pending = async () => {
      const outcome = await proposeCatalogChange(agent, workspaceId, {
        explanation: "No longer the main host.",
        operations: [deprecate],
      })
      if (!("proposal" in outcome)) throw new Error(outcome.outcome)
      expect(outcome.outcome).toBe("pending")
      return outcome.proposal
    }
    const first = await pending()
    const waiting = await send<Api.CatalogProposalList>(
      "GET",
      ws("/proposals?state=pending&order=oldest"),
    )
    expect(waiting.body.items.map((p) => p.id)).toEqual([first.id])
    const read = await send<Api.CatalogProposal>(
      "GET",
      ws(`/proposals/${first.id}`),
      contributor,
    )
    expect(read.body).toMatchObject({
      state: "pending",
      author: { kind: "agent", personId: owner.id },
      approvalClasses: ["lifecycle"],
      operations: [deprecate],
    })

    // Another member, never the agent's own person once there are two.
    const own = await send<Api.ErrorBody>(
      "POST",
      ws(`/proposals/${first.id}/approve`),
      owner,
    )
    expect(own).toMatchObject({ status: 409, body: { rule: "own-agent" } })
    const rejected = await send<Api.CatalogProposal>(
      "POST",
      ws(`/proposals/${first.id}/reject`),
      contributor,
      { reason: "Musashi is still the main host." },
    )
    expect(rejected.body).toMatchObject({
      state: "rejected",
      rejectionReason: "Musashi is still the main host.",
      decidedBy: contributor.handle,
    })

    const second = await pending()
    expect(
      (
        await send<Api.ErrorBody>(
          "POST",
          ws(`/proposals/${second.id}/withdraw`),
          contributor,
        )
      ).body,
    ).toMatchObject({ rule: "not-author" })
    expect(
      (
        await send<Api.CatalogProposal>(
          "POST",
          ws(`/proposals/${second.id}/withdraw`),
          owner,
        )
      ).body,
    ).toMatchObject({ state: "withdrawn", decidedBy: owner.handle })

    const third = await pending()
    const approved = await send<Api.CatalogApprovalOutcome>(
      "POST",
      ws(`/proposals/${third.id}/approve`),
      contributor,
    )
    expect(approved.body).toMatchObject({
      outcome: "applied",
      proposal: { state: "applied", decidedBy: contributor.handle },
    })
  })

  it("refuses bad input, other workspaces' members and large requests", async () => {
    expect(
      (await send("POST", ws("/proposals"), owner, "{not json")).status,
    ).toBe(422)
    expect(
      await send<Api.ErrorBody>("POST", ws("/proposals"), owner, {
        explanation: "",
        operations: [deprecate],
      }),
    ).toMatchObject({ status: 422, body: { rule: "explanation-blank" } })
    expect(
      (
        await send("POST", ws("/proposals/x/reject"), contributor, {
          reason: 3,
        })
      ).status,
    ).toBe(422)
    expect((await send("GET", ws("/proposals?state=open"))).status).toBe(422)
    expect((await send("GET", ws("/proposals"), outsider)).status).toBe(404)
    expect(
      (await send("POST", ws("/proposals/preview"), outsider, create())).status,
    ).toBe(404)
    expect(
      (await send("GET", ws(`/proposals/${crypto.randomUUID()}`))).status,
    ).toBe(404)

    // A body edit may carry a whole document, past the API's usual 64 KB.
    const body = "x".repeat(100 * 1024)
    const large = await send<Api.CatalogProposalOutcome>(
      "POST",
      ws("/proposals/preview"),
      owner,
      {
        explanation: "A long body.",
        operations: [
          {
            op: "edit-body",
            document: "machine/musashi",
            text: body,
            expect: { text: "# Musashi\n\nThe shared production host.\n" },
          },
        ],
      },
    )
    expect(large.status).not.toBe(413)
    const tooLarge = await send(
      "POST",
      ws("/proposals"),
      owner,
      JSON.stringify({ explanation: "x".repeat(proposalBodyLimit) }),
    )
    expect(tooLarge.status).toBe(413)
  })
})

describe("expectations built from the entity page", () => {
  it("are what core expects of every fact, for every kind of fact", async () => {
    const created = await createWorkspace(
      { db, actor: { kind: "person", personId: owner.id } },
      { name: "Fixtures" },
    )
    const id = created.workspace.id
    await storeCatalogRevision(
      db,
      id,
      {
        kind: "person",
        personId: owner.id,
        agentId: null,
        agentSessionId: null,
        label: owner.handle,
        confidence: "recorded",
      },
      fixtures.allDocuments.map((text) => ({ text })),
    )
    const catalog = readCatalog(fixtures.allDocuments)
    let compared = 0
    for (const [entityId, resolved] of catalog.entities) {
      const page = await send<Api.CatalogEntityAnswer>(
        "GET",
        `/workspaces/${id}/catalog/entity?id=${entityId}`,
      )
      expect(page.body.entity.facts).toHaveLength(resolved.facts.length)
      for (const [i, fact] of resolved.facts.entries()) {
        const shown = page.body.entity.facts.find(
          (f) => f.identity === fact.identity,
        )
        expect(shown, `${entityId} fact ${i}`).toBeDefined()
        expect(presentFact(shown!)).toEqual(expectationOf(fact))
        // The editor's identity for the fact as it would write it.
        const schemaKey = resolved.schema?.keys.get(fact.key)
        expect(
          factIdentity(
            {
              key: fact.key,
              state: fact.state,
              ...(fact.value === undefined || fact.value === null
                ? {}
                : { value: fact.value }),
              ...(fact.to === undefined ? {} : { to: fact.to }),
              ...(fact.via === undefined ? {} : { via: fact.via }),
              attributes: Object.fromEntries(
                Object.entries(fact.attributes).filter(([, v]) => v !== null),
              ) as Record<string, string | number | boolean>,
            },
            schemaKey
              ? {
                  many: schemaKey.many,
                  relation: schemaKey.relation
                    ? {
                        targets: [...schemaKey.relation.targets],
                        identified_by: [...schemaKey.relation.identifiedBy],
                        inverse: schemaKey.relation.inverse,
                      }
                    : null,
                }
              : null,
          ),
        ).toBe(fact.identity)
        compared++
      }
    }
    expect(compared).toBeGreaterThan(20)
  })
})

describe("the editable form of a document", () => {
  it("expects exactly what is stored: rewriting each part as it is changes nothing", async () => {
    const created = await createWorkspace(
      { db, actor: { kind: "person", personId: owner.id } },
      { name: "Editable" },
    )
    const id = created.workspace.id
    const texts = [
      ...fixtures.allDocuments,
      fixtures.machineExtension,
      `---
id: decision/release-versioning
type: decision
title: Release versioning
summary: How releases are numbered.
status: active
owner: person/guneet
decision_state: accepted
decided_on: 2026-11-01
decided_by: person/guneet
---

# Release versioning

Semantic versions.
`,
    ]
    await storeCatalogRevision(
      db,
      id,
      {
        kind: "person",
        personId: owner.id,
        agentId: null,
        agentSessionId: null,
        label: owner.handle,
        confidence: "recorded",
      },
      texts.map((text) => ({ text })),
    )
    const catalog = readCatalog(texts)
    const ids = catalog.documents.map((d) => d.id!)
    expect(ids).toEqual(
      expect.arrayContaining([
        "schema/domain",
        "schema/machine",
        "start-here",
        "decision/release-versioning",
      ]) as unknown,
    )
    let checked = 0
    for (const documentId of ids) {
      const editable = await send<Api.CatalogEditableAnswer>(
        "GET",
        `/workspaces/${id}/catalog/editable?id=${documentId}`,
      )
      expect(editable.status).toBe(200)
      const { document } = editable.body
      const operations: Api.CatalogOperation[] = [
        ...Object.entries(document.fields)
          // A retired document stays retired: no operation sets it.
          .filter(([, value]) => value !== null && value !== "retired")
          .map(([field, value]): Api.CatalogOperation => ({
            op: "set-field",
            document: documentId,
            field: field as Api.DocumentField,
            value: value!,
            expect: { value: value! },
          })),
        ...(documentId === "start-here"
          ? []
          : [
              {
                op: "edit-body" as const,
                document: documentId,
                text: document.body.text,
                expect: { text: document.body.text },
              },
            ]),
        ...document.body.sections.map((s): Api.CatalogOperation => ({
          op: "edit-body",
          document: documentId,
          section: s.anchor,
          text: s.text,
          expect: { text: s.text },
        })),
        ...(document.keys ?? []).map((k): Api.CatalogOperation => ({
          op: "set-schema-key",
          document: documentId,
          key: k.key,
          options: k.options,
          expect: { options: k.options },
        })),
        ...(["people", "agents"] as const).flatMap(
          (path): Api.CatalogOperation[] =>
            document.paths
              ? [
                  {
                    op: "set-start-here-path",
                    path,
                    steps: document.paths[path],
                    expect: { steps: document.paths[path] },
                  },
                ]
              : [],
        ),
      ]
      // Each alone, so a conflict names its operation.
      for (const operation of operations) {
        const preview = await send<Api.CatalogPreviewOutcome>(
          "POST",
          `/workspaces/${id}/catalog/proposals/preview`,
          owner,
          { explanation: "Nothing changes.", operations: [operation] },
        )
        expect(preview.body, JSON.stringify(operation)).toEqual({
          outcome: "unchanged",
        })
        checked++
      }
    }
    expect(checked).toBeGreaterThan(40)
  }, 120_000)
})

describe("catalog proposal requests of undeclared size", () => {
  it("refuses a body of undeclared size, so it never gets past the cap unseen", async () => {
    const response = await api.request(ws("/proposals/preview"), {
      method: "POST",
      headers: {
        origin: "http://shinan.test",
        "content-type": "application/json",
        ...as(owner),
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{}"))
          controller.close()
        },
      }),
      duplex: "half",
    })
    expect(response.status).toBe(411)
    expect(await response.json()).toMatchObject({ error: "length-required" })
    // A request without a body needs no size, and other routes are as before.
    expect((await send("GET", ws("/proposals"))).status).toBe(200)
  })
})

describe("catalog proposal requests in flight", () => {
  it("lets one person have only a few at once, refused before the body is read", async () => {
    // Requests whose bodies arrive slowly: each stays in flight until its
    // body ends.
    const open: ReadableStreamDefaultController<Uint8Array>[] = []
    const body = '{"explanation":"x"}'
    const slow = async (who: Person) =>
      api.request(ws("/proposals/preview"), {
        method: "POST",
        headers: {
          origin: "http://shinan.test",
          "content-type": "application/json",
          // Declared, so the body limit lets it through at once: the
          // handler then waits for the body.
          "content-length": String(body.length),
          ...as(who),
        },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            open.push(controller)
            controller.enqueue(new TextEncoder().encode(body.slice(0, 15)))
          },
        }),
        duplex: "half",
      })
    const held = Array.from({ length: proposalInFlight.perPerson }, () =>
      slow(owner),
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    const refused = await send<Api.ErrorBody>(
      "POST",
      ws("/proposals/preview"),
      owner,
      create(),
    )
    expect(refused).toMatchObject({
      status: 429,
      body: { error: "too-many-requests" },
    })
    // Another person is not held up.
    const other = await send("GET", ws("/proposals"), contributor)
    expect(other.status).toBe(200)

    for (const controller of open) {
      controller.enqueue(new TextEncoder().encode(body.slice(15)))
      controller.close()
    }
    const answers = await Promise.all(held)
    // Each finished (as a proposal without operations), and its place freed.
    expect(answers.map((r) => r.status)).toEqual(
      Array.from({ length: proposalInFlight.perPerson }, () => 422),
    )
    expect((await send("GET", ws("/proposals"))).status).toBe(200)
  })
})
