import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { answer, fact, musashi, tree } from "../../test/catalog"
import { currentPath, fakeApi, renderApp, workspaceId } from "../../test/render"

const entityPath = `/w/${workspaceId}/catalog/p/machine/musashi`

describe("moving around the catalog", () => {
  it("searches from the sidebar: titles, folders and one line, retired pages one click away", async () => {
    const result = (
      id: string,
      title: string,
      status: string,
      text: string,
    ) => ({
      entity: {
        id,
        type: id.split("/")[0]!,
        title,
        summary: "The host.",
        status,
        owner: null,
      },
      rank: 1,
      sections: [
        {
          heading: "Cautions",
          level: 2,
          anchor: "cautions",
          text: `## Cautions\n\n${text}\n`,
        },
      ],
    })
    const fake = fakeApi({
      catalogSearch: () =>
        Promise.resolve({
          ...answer,
          items: [
            result(
              "machine/musashi",
              "Musashi",
              "active",
              "Never **reboot** on [Fridays](https://example.com).",
            ),
            result("machine/takezo", "Takezo", "retired", "Old."),
          ],
        }),
    })
    renderApp(`/w/${workspaceId}/catalog`, fake)
    const sidebar = await screen.findByRole("complementary")
    await userEvent.type(
      within(sidebar).getByLabelText("Search the catalog"),
      "musashi{Enter}",
    )
    await waitFor(() =>
      expect(currentPath()).toBe(`/w/${workspaceId}/catalog/search?q=musashi`),
    )
    const content = within(screen.getByRole("main"))
    const link = await content.findByRole("link", { name: "Musashi" })
    expect(link.getAttribute("href")).toBe(
      `/w/${workspaceId}/catalog/p/machine/musashi`,
    )
    const item = link.closest("li")!
    expect(item.textContent).toContain("machine")
    expect(item.textContent).toContain("Never reboot on Fridays.")
    expect(content.queryByRole("link", { name: "Takezo" })).toBeNull()
    await userEvent.click(
      content.getByRole("button", { name: "Show 1 retired page" }),
    )
    expect(content.getByRole("link", { name: "Takezo" })).toBeTruthy()
    expect(fake.catalogSearch).toHaveBeenCalledWith(workspaceId, {
      text: "musashi",
      includeRetired: true,
    })
  })

  it("lists what needs attention in short sections, by page title", async () => {
    const page = {
      id: "machine/musashi",
      type: "machine",
      title: "Musashi",
      summary: null,
      status: "active",
      owner: null,
    }
    renderApp(
      `/w/${workspaceId}/catalog/needs-attention`,
      fakeApi({
        catalogTree: () =>
          Promise.resolve({
            ...tree,
            items: [
              ...tree.items,
              {
                path: "machine/new\nline.md",
                id: null,
                title: null,
                kind: "entity",
                status: null,
              },
            ],
          }),
        catalogList: (_w, list) =>
          Promise.resolve({
            ...answer,
            next_offset: null,
            items:
              list === "discrepancies"
                ? [
                    {
                      ...musashi.discrepancies[0]!,
                      entity: page,
                      fact_details: [],
                    },
                    {
                      key: "role",
                      values: ["a", "b"],
                      accepted: true,
                      facts: [],
                      entity: page,
                      fact_details: [],
                    },
                  ]
                : list === "due-for-recheck"
                  ? [{ entity: page, fact: musashi.facts[2]! }]
                  : [
                      {
                        entity: page,
                        fact: fact({
                          key: "network.public_ipv6",
                          state: "unknown",
                          note: "Reachability not tested",
                          check: null,
                        }),
                      },
                    ],
          }),
      }),
    )
    expect(
      await screen.findByRole("heading", { level: 1, name: "Needs attention" }),
    ).toBeTruthy()
    const main = within(screen.getByRole("main"))
    const section = (name: string) =>
      main.getByRole("heading", { level: 2, name }).closest("section")!
    await main.findByRole("heading", { level: 2, name: "These disagree" })
    // An accepted difference does not need attention.
    expect(section("These disagree").textContent).toBe(
      "These disagreeMusashiDisk data size: 128 GiB and 64 GB",
    )
    expect(section("Not checked in a while").textContent).toContain(
      "checked 40 days ago",
    )
    expect(section("Unknown").textContent).toContain(
      "Network public ipv6: Reachability not tested",
    )
    expect(section("Files that can't be read").textContent).toContain(
      "machine/new⟨U+000A⟩ (hidden character: line break) line.md",
    )
  })

  it("names the empty search page after what it does", async () => {
    renderApp(`/w/${workspaceId}/catalog/search`, fakeApi())
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Search the catalog",
      }),
    ).toBeTruthy()
  })

  it("says when nothing needs attention", async () => {
    renderApp(
      `/w/${workspaceId}/catalog/needs-attention`,
      fakeApi({
        catalogList: () =>
          Promise.resolve({ ...answer, next_offset: null, items: [] }),
      }),
    )
    expect(await screen.findByText("Nothing needs attention.")).toBeTruthy()
  })
})

describe("titles and one-line texts written by agents", () => {
  // A right-to-left override makes "Invoice gnp.exe" read "Invoice exe.png".
  const spoof = "Invoice \u202Egnp.exe"
  // The marker is seen; screen readers hear the character's name instead.
  const named = "Invoice (hidden character: right-to-left override)gnp.exe"
  const rlo = "⟨U+202E⟩ (hidden character: right-to-left override) "

  it("show hidden characters as markers on the page, in search and in Needs attention", async () => {
    const summary = "Pay \u202Egnp.exe now"
    const markedSummary = `Pay ${rlo}gnp.exe now`
    const page = {
      id: "machine/musashi",
      type: "machine",
      title: spoof,
      summary,
      status: "active",
      owner: null,
    }
    const fake = fakeApi({
      catalogEntity: () =>
        Promise.resolve({
          ...answer,
          entity: { ...musashi, title: spoof, summary },
        }),
      catalogSearch: () =>
        Promise.resolve({
          ...answer,
          items: [{ entity: page, rank: 1, sections: [] }],
        }),
      catalogList: (_w, list) =>
        Promise.resolve({
          ...answer,
          next_offset: null,
          items:
            list === "known-unknowns"
              ? [
                  {
                    entity: page,
                    fact: fact({
                      key: "network.public_ipv6",
                      state: "unknown",
                      note: "Not tested \u202Eyes",
                      check: null,
                    }),
                  },
                ]
              : [],
        }),
    })
    const { unmount } = renderApp(entityPath, fake)
    expect(
      await screen.findByRole("heading", { level: 1, name: named }),
    ).toBeTruthy()
    expect(document.body.textContent).toContain(markedSummary)
    unmount()

    const search = renderApp(`/w/${workspaceId}/catalog/search?q=invoice`, fake)
    expect(
      // The sidebar's tree is empty: the one link is in the page.
      await screen.findByRole("link", { name: named }),
    ).toBeTruthy()
    expect(document.body.textContent).toContain(markedSummary)
    search.unmount()

    renderApp(`/w/${workspaceId}/catalog/needs-attention`, fake)
    expect(
      // The sidebar's tree is empty: the one link is in the page.
      await screen.findByRole("link", { name: named }),
    ).toBeTruthy()
    expect(document.body.textContent).toContain(
      `Network public ipv6: Not tested ${rlo}yes`,
    )
  })
})

describe("the wiki's old addresses", () => {
  it.each([
    ["wiki", "catalog"],
    ["wiki/start-here", "catalog"],
    [
      "wiki/e/machine/musashi#section-cautions",
      "catalog/p/machine/musashi#section-cautions",
    ],
    ["wiki/search?q=disk", "catalog/search?q=disk"],
    ["wiki/changes", "catalog/changes"],
    ["wiki/lists/discrepancies", "catalog/needs-attention"],
    // A type's page is its schema's page now.
    ["wiki/types/machine", "catalog/p/schema/machine"],
  ])("/w/…/%s leads to /w/…/%s", async (from, to) => {
    renderApp(`/w/${workspaceId}/${from}`, fakeApi())
    await waitFor(() => expect(currentPath()).toBe(`/w/${workspaceId}/${to}`))
  })
})

describe("the removed M2 screens", () => {
  it.each([
    "wiki/review",
    "wiki/proposals/66666666-6666-4666-8666-666666666666",
    "wiki/edit/machine/musashi",
    "wiki/edit/start-here",
    "wiki/check/machine/musashi",
    "wiki/new",
    "wiki/new-type",
    "wiki/repair/machine/musashi",
  ])("/w/…/%s is not found", async (path) => {
    renderApp(`/w/${workspaceId}/${path}`, fakeApi())
    expect(
      await screen.findByRole("heading", { level: 1, name: "Not found" }),
    ).toBeTruthy()
  })

  it("says the catalog is being set up while its repository is made, then shows it", async () => {
    let calls = 0
    const fake = fakeApi({
      catalogTree: () =>
        Promise.resolve(
          calls++ === 0 ? { ...tree, catalog_commit: null, items: [] } : tree,
        ),
      catalogState: () => Promise.resolve(answer),
    })
    renderApp(`/w/${workspaceId}/catalog`, fake)
    expect(
      await screen.findByText("Your catalog is being set up."),
    ).toBeTruthy()
    // While it waits, the sidebar's tree shows no folders and no empty
    // divider.
    const sidebar = within(screen.getByRole("complementary"))
    expect(sidebar.queryByRole("navigation", { name: "Pages" })).toBeNull()
    expect(sidebar.getAllByRole("separator")).toHaveLength(1)
    // It asks only where the catalog stands, a few seconds later, and reads
    // the tree again once that has changed.
    expect(
      await screen.findByText(
        /There's no Start here page yet/,
        {},
        { timeout: 6000 },
      ),
    ).toBeTruthy()
    expect(fake.catalogState).toHaveBeenCalledTimes(1)
    expect(fake.catalogTree).toHaveBeenCalledTimes(2)
  }, 10_000)

  it("says it is catching up while the index is behind", async () => {
    renderApp(
      `/w/${workspaceId}/catalog`,
      fakeApi({
        catalogTree: () => Promise.resolve({ ...tree, index_behind: true }),
        catalogState: () => new Promise(() => {}),
      }),
    )
    expect(
      await screen.findByText("Catching up with the latest changes…"),
    ).toBeTruthy()
  })

  it("leaves Start here with no editing or review", async () => {
    renderApp(`/w/${workspaceId}/catalog`, fakeApi())
    expect(
      await screen.findByRole("heading", { name: "Your catalog is empty." }),
    ).toBeTruthy()
    for (const name of ["New entity", "New type", "Catalog review", "Review"])
      expect(screen.queryByRole("link", { name })).toBeNull()
  })
})
