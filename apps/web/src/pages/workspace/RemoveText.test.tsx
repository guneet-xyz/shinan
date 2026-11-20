import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import type { CatalogPurge, CatalogPurgePreview } from "@shinan/api-client"

import {
  fakeApi,
  reauthenticationRequired,
  renderApp,
  workspace,
  workspaceId,
} from "../../test/render"

const path = `/w/${workspaceId}/settings/catalog/remove-text`
const secret = "plum-otter-1234-lantern"

const preview: CatalogPurgePreview = {
  history: {
    commits: { main: 1, branches: 2 },
    files: { main: 1, branches: 1 },
    messages: { main: 0, branches: 1 },
    branchNames: 1,
    currentFiles: ["machine/daedalus.md"],
    currentFilesMore: 0,
    acrossLines: 1,
    structure: [{ path: "machine/daedalus.md", where: "alias" }],
    alsoWrittenAs: [],
    journalEntries: 0,
  },
  pushLog: 2,
  events: 1,
  indexDocuments: 1,
  earlier: { revisionTexts: 0, proposals: 0, comments: 0 },
  acrossLines: 1,
  alsoWrittenAs: [],
  unfinished: 0,
}

const nowhere: CatalogPurgePreview = {
  history: {
    ...preview.history!,
    commits: { main: 0, branches: 0 },
    files: { main: 0, branches: 0 },
    messages: { main: 0, branches: 0 },
    branchNames: 0,
    currentFiles: [],
    acrossLines: 0,
    structure: [],
  },
  pushLog: 0,
  events: 0,
  indexDocuments: 0,
  earlier: { revisionTexts: 0, proposals: 0, comments: 0 },
  acrossLines: 0,
  alsoWrittenAs: [],
  unfinished: 0,
}

const removal: CatalogPurge = {
  id: "99999999-9999-4999-8999-999999999999",
  number: 1,
  createdAt: "2026-11-18T10:00:00.000Z",
  purgedBy: "guneet",
  reason: "A passphrase was pushed to the catalog.",
  counts: {
    history: {
      commits: 3,
      rewrittenCommits: 5,
      removedCommits: 6,
      files: 2,
      messages: 1,
      renamedBranches: 1,
      journalEntries: 0,
    },
    pushLog: 2,
    indexDocuments: 1,
    revisionTexts: 0,
    documents: 0,
    latestDocuments: 0,
    proposals: 0,
    rejectedProposals: 0,
    events: 1,
    comments: 0,
  },
}

describe("removing text from the catalog's history", () => {
  it("is a quiet link at the bottom of Settings › Catalog, for owners", async () => {
    renderApp(`/w/${workspaceId}/settings/catalog`, fakeApi())
    const link = await screen.findByRole("link", {
      name: "Remove text from the catalog's history",
    })
    expect(link.getAttribute("href")).toBe(
      `/w/${workspaceId}/settings/catalog/remove-text`,
    )
  })

  it("shows where a text is, in plain words, then removes it after a typed confirmation", async () => {
    const api = fakeApi({
      catalogPurges: () => Promise.resolve([]),
      previewCatalogPurge: () => Promise.resolve(preview),
      purgeCatalogText: () => Promise.resolve(removal),
    })
    renderApp(path, api)

    expect(
      await screen.findByText("Copies outside Shinan keep the text"),
    ).toBeTruthy()
    expect(
      screen.getByText(/Whoever runs those machines deletes each copy/),
    ).toBeTruthy()
    expect(screen.getByText(/change it where it was issued/)).toBeTruthy()
    expect(await screen.findByText("No text has been removed.")).toBeTruthy()

    await userEvent.type(screen.getByLabelText("Text to remove"), secret)
    await userEvent.click(screen.getByRole("button", { name: "Find it" }))
    expect(api.previewCatalogPurge).toHaveBeenCalledWith(workspaceId, secret)
    expect(
      await screen.findByText(
        "3 changes to the catalog (2 on agents' branches)",
      ),
    ).toBeTruthy()
    expect(
      screen.getByText("1 change message, or who made the change"),
    ).toBeTruthy()
    expect(screen.getByText("1 branch name of agents")).toBeTruthy()
    expect(screen.getByText("4 records Shinan keeps")).toBeTruthy()
    expect(screen.getByText("machine/daedalus.md")).toBeTruthy()
    expect(
      screen.getByText(
        "machine/daedalus.md: the text is in one of its old IDs",
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(/Found across a line break in 1 place/),
    ).toBeTruthy()
    // No word of Git's own on the screen.
    expect(screen.queryByText(/commit|\bpurge\b|rewrit/i)).toBeNull()

    const button = screen.getByRole("button", { name: "Remove everywhere" })
    await userEvent.type(
      screen.getByLabelText("Reason"),
      "A passphrase was pushed to the catalog.",
    )
    expect((button as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(
      screen.getByLabelText("Type remove to confirm"),
      "remove",
    )
    await userEvent.click(button)
    expect(api.purgeCatalogText).toHaveBeenCalledWith(workspaceId, {
      text: secret,
      reason: "A passphrase was pushed to the catalog.",
    })
    expect(await screen.findByText(/Removed \(removal 1\)/)).toBeTruthy()
    // The text is gone from the form.
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Text to remove").value,
    ).toBe("")
    expect(api.catalogPurges).toHaveBeenCalledTimes(2)
  })

  it("asks to sign in again before searching", async () => {
    const api = fakeApi({
      catalogPurges: () => Promise.resolve([]),
      previewCatalogPurge: () => Promise.reject(reauthenticationRequired()),
    })
    renderApp(path, api)
    await userEvent.type(await screen.findByLabelText("Text to remove"), secret)
    await userEvent.click(screen.getByRole("button", { name: "Find it" }))
    expect(
      await screen.findByRole("heading", { name: "Sign in again to continue" }),
    ).toBeTruthy()
  })

  it("says when nothing holds the text, and offers its other forms", async () => {
    const api = fakeApi({
      catalogPurges: () => Promise.resolve([]),
      previewCatalogPurge: () =>
        Promise.resolve({
          ...nowhere,
          alsoWrittenAs: [
            {
              form: "percent",
              text: "plum%2Dotter%2D1234%2Dlantern",
              places: 2,
            },
          ],
        }),
    })
    renderApp(path, api)
    await userEvent.type(await screen.findByLabelText("Text to remove"), secret)
    await userEvent.click(screen.getByRole("button", { name: "Find it" }))
    expect(
      await screen.findByText(/Shinan keeps this text nowhere in this catalog/),
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Remove everywhere" }),
    ).toBeNull()
    expect(screen.getByText("Percent-encoded")).toBeTruthy()
    await userEvent.click(
      screen.getByRole("button", { name: "Find this form" }),
    )
    expect(api.previewCatalogPurge).toHaveBeenLastCalledWith(
      workspaceId,
      "plum%2Dotter%2D1234%2Dlantern",
    )
  })

  it("lists earlier removals to contributors, without the form, and keeps M2's address", async () => {
    const api = fakeApi({
      workspace: () => Promise.resolve({ ...workspace, role: "contributor" }),
      catalogPurges: () => Promise.resolve([removal]),
    })
    renderApp(`/w/${workspaceId}/settings/data`, api)
    expect(
      await screen.findByText("A passphrase was pushed to the catalog."),
    ).toBeTruthy()
    expect(
      screen.getByText("5 changes rewritten, 1 branch renamed, 4 records"),
    ).toBeTruthy()
    expect(
      screen.getByText(
        "Only workspace owners remove text from the catalog's history.",
      ),
    ).toBeTruthy()
    expect(screen.queryByLabelText("Text to remove")).toBeNull()
  })
})
