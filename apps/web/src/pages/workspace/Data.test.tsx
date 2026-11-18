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

const path = `/w/${workspaceId}/settings/data`
const secret = "plum-otter-1234-lantern"

const preview: CatalogPurgePreview = {
  revisionTexts: 3,
  documents: 2,
  latestDocuments: ["machine/daedalus"],
  proposals: 2,
  waitingProposals: 1,
  events: 1,
  comments: 0,
  writtenDifferently: [],
  acrossLines: { revisionTexts: 1, latestDocuments: ["machine/daedalus"] },
  alsoWrittenAs: [],
  structure: [{ id: "machine/daedalus", where: "alias" }],
}

const purge: CatalogPurge = {
  id: "99999999-9999-4999-8999-999999999999",
  number: 1,
  createdAt: "2026-11-18T10:00:00.000Z",
  purgedBy: "guneet",
  reason: "A passphrase was written into the catalog.",
  revision: 7,
  counts: {
    revisionTexts: 3,
    documents: 2,
    latestDocuments: 1,
    proposals: 2,
    rejectedProposals: 1,
    events: 1,
    comments: 0,
  },
}

describe("the data screen", () => {
  it("shows where a text is, then purges it after a typed confirmation", async () => {
    const api = fakeApi({
      catalogPurges: () => Promise.resolve([]),
      previewCatalogPurge: () => Promise.resolve(preview),
      purgeCatalogText: () =>
        Promise.resolve({
          ...purge,
          newProblems: [
            {
              id: "machine/daedalus",
              problems: ['The alias "machine/(purged)" is not an ID'],
            },
          ],
        }),
    })
    renderApp(path, api)

    expect(
      await screen.findByText(/A purge cleans Shinan, not copies that left it/),
    ).toBeTruthy()
    expect(screen.getByText(/rotate it where it was issued/)).toBeTruthy()
    expect(await screen.findByText("Nothing has been purged.")).toBeTruthy()

    await userEvent.type(screen.getByLabelText("Text to purge"), secret)
    await userEvent.click(screen.getByRole("button", { name: "Find it" }))
    expect(api.previewCatalogPurge).toHaveBeenCalledWith(workspaceId, secret)
    expect(
      await screen.findByText(
        "machine/daedalus, stored again as a new revision",
      ),
    ).toBeTruthy()
    expect(screen.getByText(/1 waiting proposal will be rejected/)).toBeTruthy()
    expect(
      screen.getByText("machine/daedalus: the text is in an alias"),
    ).toBeTruthy()
    expect(
      screen.getByText(/Found across a line break in 1 stored text/),
    ).toBeTruthy()

    const button = screen.getByRole("button", { name: "Purge everywhere" })
    await userEvent.type(
      screen.getByLabelText("Reason"),
      "A passphrase was written into the catalog.",
    )
    expect((button as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(
      screen.getByLabelText("Type purge to confirm"),
      "purge",
    )
    await userEvent.click(button)
    expect(api.purgeCatalogText).toHaveBeenCalledWith(workspaceId, {
      text: secret,
      reason: "A passphrase was written into the catalog.",
    })
    expect(await screen.findByText(/Purged \(purge 1\)/)).toBeTruthy()
    expect(screen.getByText(/Press Find it again in a minute/)).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "machine/daedalus" })
        .getAttribute("href"),
    ).toBe(`/w/${workspaceId}/wiki/e/machine/daedalus`)
    // The text is gone from the form.
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Text to purge").value,
    ).toBe("")
    expect(api.catalogPurges).toHaveBeenCalledTimes(2)
  })

  it("asks to sign in again before searching", async () => {
    const api = fakeApi({
      catalogPurges: () => Promise.resolve([]),
      previewCatalogPurge: () => Promise.reject(reauthenticationRequired()),
    })
    renderApp(path, api)
    await userEvent.type(await screen.findByLabelText("Text to purge"), secret)
    await userEvent.click(screen.getByRole("button", { name: "Find it" }))
    expect(
      await screen.findByRole("heading", { name: "Sign in again to continue" }),
    ).toBeTruthy()
  })

  it("says when nothing holds the text, or the stored text writes it differently", async () => {
    const api = fakeApi({
      catalogPurges: () => Promise.resolve([]),
      previewCatalogPurge: () =>
        Promise.resolve({
          ...preview,
          revisionTexts: 0,
          documents: 0,
          latestDocuments: [],
          proposals: 0,
          waitingProposals: 0,
          events: 0,
          writtenDifferently: ["machine/escaped"],
          alsoWrittenAs: [
            {
              form: "percent",
              text: "plum%2Dotter%2D1234%2Dlantern",
              revisionTexts: 1,
              proposals: 0,
              events: 0,
              comments: 0,
            },
          ],
        }),
    })
    renderApp(path, api)
    await userEvent.type(await screen.findByLabelText("Text to purge"), secret)
    await userEvent.click(screen.getByRole("button", { name: "Find it" }))
    expect(
      await screen.findByText(/holds this text for machine\/escaped/),
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Purge everywhere" }),
    ).toBeNull()
    // Another form, found in one click.
    expect(screen.getByText("Percent-encoded")).toBeTruthy()
    await userEvent.click(
      screen.getByRole("button", { name: "Find this form" }),
    )
    expect(api.previewCatalogPurge).toHaveBeenLastCalledWith(
      workspaceId,
      "plum%2Dotter%2D1234%2Dlantern",
    )
  })

  it("lists past purges to contributors, without the purge form", async () => {
    const api = fakeApi({
      workspace: () => Promise.resolve({ ...workspace, role: "contributor" }),
      catalogPurges: () => Promise.resolve([purge]),
    })
    renderApp(path, api)
    expect(
      await screen.findByText("A passphrase was written into the catalog."),
    ).toBeTruthy()
    expect(
      screen.getByText("Only workspace owners purge catalog text."),
    ).toBeTruthy()
    expect(screen.queryByLabelText("Text to purge")).toBeNull()
  })
})
