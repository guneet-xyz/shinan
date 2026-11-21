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
import { removalPolling } from "./removal"

removalPolling.intervalMs = 1

const path = `/w/${workspaceId}/settings/catalog/remove-text`
const secret = "plum-otter-1234-lantern"

const preview: CatalogPurgePreview = {
  history: {
    commits: { main: 1, branches: 2 },
    files: { main: 1, branches: 1 },
    messages: { main: 0, branches: 1 },
    branchNames: 1,
    currentFiles: [{ path: "machine/daedalus.md", title: "Daedalus" }],
    currentFilesMore: 0,
    acrossLines: 1,
    structure: [{ path: "machine/daedalus.md", where: "alias" }],
    alsoWrittenAs: [],
    mayAppearEncoded: [],
    journalEntries: 0,
  },
  pushLog: 2,
  events: 1,
  indexDocuments: 1,
  moves: 0,
  acrossLines: 1,
  alsoWrittenAs: [],
  mayAppearEncoded: [],
  unfinished: 0,
  finishesUnfinished: false,
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
  moves: 0,
  acrossLines: 0,
  alsoWrittenAs: [],
  mayAppearEncoded: [],
  unfinished: 0,
  finishesUnfinished: false,
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
      // A removal that runs a while: asked once more before it is done.
      purgeCatalogText: () =>
        Promise.resolve({ id: removal.id, state: "running" as const }),
      catalogPurgeStatus: () =>
        Promise.resolve({
          id: removal.id,
          state: "done" as const,
          purge: removal,
        }),
    })
    renderApp(path, api)

    expect(
      await screen.findByText("Copies outside Shinan keep the text"),
    ).toBeTruthy()
    // Changing the secret comes first.
    expect(
      screen
        .getAllByRole("listitem")[0]!
        .textContent?.startsWith("If it is a secret, change it"),
    ).toBe(true)
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
    expect(screen.getByText("1 change's message or author")).toBeTruthy()
    expect(screen.getByText("1 branch name")).toBeTruthy()
    expect(screen.getByText("2 entries in Shinan's push records")).toBeTruthy()
    expect(screen.getByText("1 entry on the catalog's timeline")).toBeTruthy()
    expect(screen.getByText("Daedalus (machine/daedalus.md)")).toBeTruthy()
    expect(
      screen.getByText(/They redo any work they haven't pushed on top of it/),
    ).toBeTruthy()
    expect(screen.getByText("This can't be undone.")).toBeTruthy()
    expect(
      screen.getByText(
        "machine/daedalus.md: the text is in one of its old IDs",
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(/Found across a line break in 1 place/),
    ).toBeTruthy()
    // No word of Git's own on the screen.
    expect(screen.queryByText(/commit|\bpurge\b/i)).toBeNull()

    const button = screen.getByRole("button", {
      name: "Remove from Shinan's history",
    })
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
    const after = (
      await screen.findByText("Removed from Shinan's history")
    ).closest('[role="status"]')!
    expect(after.textContent).toContain("Removed from Shinan's history")
    expect(
      [...after.querySelectorAll("ol > li")].map(
        (li) => li.textContent?.split(".")[0],
      ),
    ).toEqual([
      "If it was a secret, change it where it was issued",
      "Ask whoever runs each agent's machine to delete its copy of the catalog and make a new one (step 2 of the Set up an agent page)",
      "Tell your agents the history changed",
    ])
    expect(
      screen
        .getByRole("link", { name: "Set up an agent" })
        .getAttribute("href"),
    ).toBe("/account/agents/setup")
    // The text is gone from the form.
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Text to remove").value,
    ).toBe("")
    expect(api.catalogPurges).toHaveBeenCalledTimes(2)
    // The steps stay while the owner looks for something else.
    await userEvent.type(screen.getByLabelText("Text to remove"), "other")
    expect(screen.getByText("Removed from Shinan's history")).toBeTruthy()
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
      await screen.findByText(
        "Shinan doesn't hold this text anywhere in this catalog. Nothing to remove.",
      ),
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Remove from Shinan's history" }),
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
      screen.getByText(
        "5 changes rewritten, 1 branch renamed, 2 push records cleaned, 1 timeline entry cleaned",
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(
        "Only workspace owners remove text from the catalog's history.",
      ),
    ).toBeTruthy()
    expect(screen.queryByLabelText("Text to remove")).toBeNull()
  })

  it("says what may be left encoded after the pages, says a removal goes on, and shows why it failed", async () => {
    let answer!: (status: {
      id: string
      state: "unfinished"
      message: string
    }) => void
    const api = fakeApi({
      catalogPurges: () => Promise.resolve([]),
      previewCatalogPurge: () =>
        Promise.resolve({
          ...preview,
          mayAppearEncoded: [{ encoding: "base64", places: 2 }],
          unfinished: 1,
          finishesUnfinished: true,
        }),
      purgeCatalogText: () =>
        Promise.resolve({ id: removal.id, state: "running" as const }),
      catalogPurgeStatus: () => new Promise((resolve) => (answer = resolve)),
    })
    renderApp(path, api)
    await userEvent.type(await screen.findByLabelText("Text to remove"), secret)
    await userEvent.click(screen.getByRole("button", { name: "Find it" }))
    const encoded = await screen.findByText(
      /It may also be in the catalog encoded: base64 \(2 places\)\. Those copies stay\. If it's a secret, changing it where it was issued makes them harmless\. Otherwise, ask an agent for the encoded form and remove that here as well\./,
    )
    expect(encoded.textContent).toMatch(
      /^Shinan removes only the text exactly as written\./,
    )
    // What is removed first, then what isn't.
    const pages = screen.getByText("Pages that show it now:")
    expect(
      pages.compareDocumentPosition(encoded) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      screen.getByText("an earlier removal of this text that didn't finish"),
    ).toBeTruthy()
    await userEvent.type(screen.getByLabelText("Reason"), "Finishing.")
    await userEvent.type(
      screen.getByLabelText("Type remove to confirm"),
      "remove",
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Remove from Shinan's history" }),
    )
    const removing = await screen.findByText(/This can take a few minutes/)
    expect(removing.textContent).toBe(
      "Removing… This can take a few minutes on a large catalog. You can leave this page: it goes on, and it appears under Earlier removals when it's done. Agents can keep pushing, except for a few seconds near the end.",
    )
    answer({
      id: removal.id,
      state: "unfinished",
      message: "The removal was not recorded: remove the same text again",
    })
    expect(
      await screen.findByText(
        "The removal was not recorded: remove the same text again",
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/This can take a few minutes/)).toBeNull()
  })

  it("says what may be left encoded when the text itself is nowhere", async () => {
    const api = fakeApi({
      catalogPurges: () => Promise.resolve([]),
      previewCatalogPurge: () =>
        Promise.resolve({
          ...nowhere,
          mayAppearEncoded: [
            { encoding: "base64", places: 1 },
            { encoding: "other-case", places: 3 },
          ],
        }),
    })
    renderApp(path, api)
    await userEvent.type(await screen.findByLabelText("Text to remove"), secret)
    await userEvent.click(screen.getByRole("button", { name: "Find it" }))
    expect(await screen.findByText(/Nothing to remove\./)).toBeTruthy()
    expect(
      screen.getByText(
        /encoded: base64 \(1 place\), in another letter case \(3 places\)\. Those copies stay\./,
      ),
    ).toBeTruthy()
    expect(screen.queryByLabelText("Reason")).toBeNull()
  })
})
