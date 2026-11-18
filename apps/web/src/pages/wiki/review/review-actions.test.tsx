import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import type {
  CatalogProposal,
  CatalogProposalComment,
} from "@shinan/api-client"

import {
  account,
  fakeApi,
  ownerMember,
  renderApp,
  workspace,
  workspaceId,
} from "../../../test/render"

const answer = { catalog_revision: 8, index_behind: false }

const proposal = (over: Partial<CatalogProposal> = {}): CatalogProposal => ({
  id: "22222222-2222-4222-8222-222222222222",
  number: 5,
  state: "pending",
  createdAt: "2026-11-18T10:00:00.000Z",
  author: {
    kind: "agent",
    label: `${account.person.handle} via opencode-daedalus`,
    personId: "99999999-9999-4999-8999-999999999999",
    agentId: "88888888-8888-4888-8888-888888888888",
  },
  explanation: "Deprecated.",
  relatedTask: "SHN-12",
  operations: [
    {
      op: "set-field",
      document: "machine/musashi",
      field: "status",
      value: "deprecated",
      expect: { value: "active" },
    },
  ],
  basedOnRevision: 7,
  approvalClasses: ["lifecycle"],
  approvalReasons: ["Changes the status of machine/musashi"],
  warnings: [],
  touches: ["machine/musashi"],
  appliedRevision: null,
  decidedAt: null,
  decidedBy: null,
  rejectionReason: null,
  revertsProposalId: null,
  authorStatus: "current",
  ...over,
})

const comment = (
  n: number,
  over: Partial<CatalogProposalComment> = {},
): CatalogProposalComment => ({
  id: `c${n}`,
  proposalId: proposal().id,
  createdAt: "2026-11-18T11:00:00.000Z",
  author: { kind: "person", label: "ana", personId: "p", agentId: null },
  text: `Comment ${n}`,
  ...over,
})

const page = `/w/${workspaceId}/wiki/proposals/${proposal().id}`

describe("comments on a proposal", () => {
  it("lists them, marking agents and hidden characters, a page at a time", async () => {
    const fake = fakeApi({
      catalogProposal: () => Promise.resolve(proposal()),
      members: () => Promise.resolve([ownerMember]),
      catalogProposalComments: (_w, _id, options) =>
        Promise.resolve(
          options?.cursor
            ? { items: [comment(3)], nextCursor: null, total: 3 }
            : {
                items: [
                  comment(1),
                  comment(2, {
                    author: {
                      kind: "agent",
                      label: "ana via opencode-musashi",
                      personId: "p",
                      agentId: "a",
                    },
                    text: "Looks right.\u202e",
                  }),
                ],
                nextCursor: "next",
                total: 3,
              },
        ),
    })
    renderApp(page, fake)
    const section = (
      await screen.findByRole("heading", { name: "Comments" })
    ).closest("section")!
    await within(section).findByText("Comment 1")
    expect(section.textContent).toContain("ana via opencode-musashi (an agent)")
    expect(section.textContent).toContain("Looks right.⟨U+202E⟩")
    await userEvent.click(
      within(section).getByRole("button", {
        name: /Older comments \(1 more\)/,
      }),
    )
    await within(section).findByText("Comment 3")
    expect(fake.catalogProposalComments).toHaveBeenCalledWith(
      workspaceId,
      proposal().id,
      { cursor: "next" },
    )
  })

  it("posts a comment once, with an idempotency key", async () => {
    const fake = fakeApi({
      catalogProposal: () => Promise.resolve(proposal()),
      members: () => Promise.resolve([ownerMember]),
      commentOnCatalogProposal: (_w, _id, text) =>
        Promise.resolve(comment(9, { text })),
    })
    renderApp(page, fake)
    await userEvent.type(
      await screen.findByLabelText("Add a comment"),
      "Check the disk first.",
    )
    await userEvent.click(screen.getByRole("button", { name: "Comment" }))
    await waitFor(() =>
      expect(fake.commentOnCatalogProposal).toHaveBeenCalledWith(
        workspaceId,
        proposal().id,
        "Check the disk first.",
        expect.stringMatching(/^[0-9a-f-]{36}$/),
      ),
    )
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLTextAreaElement>("Add a comment").value,
      ).toBe(""),
    )
  })

  it("says when the author has left or the agent is disabled", async () => {
    renderApp(
      page,
      fakeApi({
        catalogProposal: () =>
          Promise.resolve(proposal({ authorStatus: "agent-disabled" })),
        members: () => Promise.resolve([ownerMember]),
      }),
    )
    expect(await screen.findByText("agent disabled")).toBeTruthy()
    expect(
      screen.getByText(
        /The agent that made this proposal has since been disabled/,
      ),
    ).toBeTruthy()
  })
})

describe("bulk approval", () => {
  const second = proposal({
    id: "33333333-3333-4333-8333-333333333334",
    number: 6,
    touches: ["machine/daedalus"],
  })

  function api(strict: boolean) {
    return fakeApi({
      catalogSettings: () => Promise.resolve({ strict }),
      catalogProposals: () => Promise.resolve({ items: [proposal(), second] }),
      bulkApproveCatalogProposals: () =>
        Promise.resolve({
          results: [
            {
              proposalId: proposal().id,
              number: 5,
              outcome: "applied",
              proposal: proposal({ state: "applied" }),
            },
            {
              proposalId: second.id,
              number: 6,
              outcome: "refused",
              rule: "own-agent",
              message: "Another member approves your agents' catalog proposals",
            },
          ],
        }),
      bulkRejectCatalogProposals: () =>
        Promise.resolve({
          results: [
            {
              proposalId: second.id,
              number: 6,
              outcome: "rejected",
              proposal: second,
            },
          ],
        }),
    })
  }

  it("is offered only while the strict setting is on", async () => {
    renderApp(`/w/${workspaceId}/wiki/review`, api(false))
    await screen.findByRole("link", { name: "Catalog proposal 5" })
    expect(
      screen.queryByRole("heading", { name: "Approve or reject several" }),
    ).toBeNull()
  })

  it("approves the chosen ones, or a task's, and reports each", async () => {
    const fake = api(true)
    renderApp(`/w/${workspaceId}/wiki/review`, fake)
    const bulk = (
      await screen.findByRole("heading", { name: "Approve or reject several" })
    ).closest("section")!
    await userEvent.click(
      within(bulk).getByLabelText(/Catalog proposal 5: machine\/musashi/),
    )
    await userEvent.click(
      within(bulk).getByLabelText(/Catalog proposal 6: machine\/daedalus/),
    )
    await userEvent.click(
      within(bulk).getByRole("button", { name: "Approve 2 proposals" }),
    )
    await waitFor(() =>
      expect(fake.bulkApproveCatalogProposals).toHaveBeenCalledWith(
        workspaceId,
        { proposalIds: [proposal().id, second.id] },
      ),
    )
    expect(await within(bulk).findByText(/approved and applied/)).toBeTruthy()
    expect(bulk.textContent).toContain(
      "not decided: Another member approves your agents' catalog proposals",
    )
    await userEvent.click(
      within(bulk).getByRole("button", { name: "Approve all of SHN-12" }),
    )
    await waitFor(() =>
      expect(fake.bulkApproveCatalogProposals).toHaveBeenLastCalledWith(
        workspaceId,
        { relatedTask: "SHN-12", seenUpTo: 6 },
      ),
    )
  })

  it("rejects the chosen ones with a reason", async () => {
    const fake = api(true)
    renderApp(`/w/${workspaceId}/wiki/review`, fake)
    const bulk = (
      await screen.findByRole("heading", { name: "Approve or reject several" })
    ).closest("section")!
    await userEvent.click(
      within(bulk).getByLabelText(/Catalog proposal 6: machine\/daedalus/),
    )
    const reject = within(bulk).getByRole<HTMLButtonElement>("button", {
      name: "Reject 1 proposal",
    })
    expect(reject.disabled).toBe(true)
    await userEvent.type(
      within(bulk).getByLabelText("Reason to reject the chosen ones"),
      "Daedalus stays.",
    )
    await userEvent.click(reject)
    await waitFor(() =>
      expect(fake.bulkRejectCatalogProposals).toHaveBeenCalledWith(
        workspaceId,
        { proposalIds: [second.id] },
        "Daedalus stays.",
      ),
    )
    expect(await within(bulk).findByText(/rejected\./)).toBeTruthy()
  })
})

describe("revert on recent changes", () => {
  const applied = proposal({
    number: 4,
    state: "applied",
    appliedRevision: 8,
    author: {
      kind: "person",
      label: "guneet",
      personId: account.person.id,
      agentId: null,
    },
  })
  const changes = (over: object = {}) => ({
    ...answer,
    since: 0,
    next_since: null,
    items: [
      {
        revision: 8,
        at: "2026-11-18T10:00:00.000Z",
        changed_by: "guneet",
        changed_by_kind: "person",
        approved_by: null,
        documents: [{ id: "machine/musashi", kind: "entity" }],
      },
    ],
    ...over,
  })

  function api(change: object) {
    return fakeApi({
      catalogChanges: () => Promise.resolve(changes()),
      recentCatalogChanges: () =>
        Promise.resolve({
          items: [
            {
              revision: 8,
              proposal: applied,
              approvedBy: null,
              revertible: true,
              revertedBy: null,
              ...change,
            },
          ],
          nextCursor: null,
        }),
      revertCatalogProposal: () =>
        Promise.resolve({
          outcome: "pending",
          proposal: proposal({ number: 9, revertsProposalId: applied.id }),
        }),
    })
  }

  it("makes a revert proposal once, after asking", async () => {
    const fake = api({})
    renderApp(`/w/${workspaceId}/wiki/changes`, fake)
    await userEvent.click(
      await screen.findByRole("button", { name: "Revert catalog proposal 4" }),
    )
    await userEvent.type(screen.getByLabelText("Why (optional)"), "Wrong host.")
    await userEvent.click(
      screen.getByRole("button", { name: "Revert catalog proposal 4" }),
    )
    await waitFor(() =>
      expect(fake.revertCatalogProposal).toHaveBeenCalledWith(
        workspaceId,
        applied.id,
        {
          explanation: "Wrong host.",
          idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
        },
      ),
    )
    expect(await screen.findByText(/waiting for catalog approval/)).toBeTruthy()
  })

  it("says when a change cannot be reverted, or already was", async () => {
    renderApp(`/w/${workspaceId}/wiki/changes`, api({ revertible: false }))
    expect(
      await screen.findByText(/a later change wrote the same documents/),
    ).toBeTruthy()
  })

  it("links the revert that undid a change", async () => {
    renderApp(
      `/w/${workspaceId}/wiki/changes`,
      api({
        revertedBy: { id: "r1", number: 9, state: "applied" },
      }),
    )
    expect(
      (
        await screen.findByRole("link", { name: "catalog proposal 9" })
      ).getAttribute("href"),
    ).toBe(`/w/${workspaceId}/wiki/proposals/r1`)
  })
})

describe("the strict setting", () => {
  it("is turned on by an owner, after confirming", async () => {
    const fake = fakeApi({
      catalogSettings: () => Promise.resolve({ strict: false }),
      setCatalogStrict: (_w, strict) => Promise.resolve({ strict }),
    })
    renderApp(`/w/${workspaceId}/settings/catalog`, fake)
    expect(await screen.findByText("Strict setting: off.")).toBeTruthy()
    await userEvent.click(
      screen.getByRole("button", { name: "Turn the strict setting on…" }),
    )
    fake.catalogSettings.mockResolvedValue({ strict: true })
    await userEvent.click(screen.getByRole("button", { name: "Turn it on" }))
    await waitFor(() =>
      expect(fake.setCatalogStrict).toHaveBeenCalledWith(workspaceId, true),
    )
    expect(await screen.findByText("Strict setting: on.")).toBeTruthy()
  })

  it("is shown to contributors, who cannot change it", async () => {
    renderApp(
      `/w/${workspaceId}/settings/catalog`,
      fakeApi({
        workspace: () => Promise.resolve({ ...workspace, role: "contributor" }),
        catalogSettings: () => Promise.resolve({ strict: true }),
      }),
    )
    expect(await screen.findByText("Strict setting: on.")).toBeTruthy()
    expect(screen.getByText("A workspace owner changes it.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /strict setting/ })).toBeNull()
  })
})
