import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import type { CatalogTreeItem } from "@shinan/api-client"

import { catalogFolders, catalogState } from "../catalog-tree"
import {
  account,
  catalogCommit,
  currentPath,
  fakeApi,
  renderApp,
  workspaceId,
} from "../test/render"

const item = (
  path: string,
  title: string | null,
  over: Partial<CatalogTreeItem> = {},
): CatalogTreeItem => ({
  path,
  id: path.replace(/\.md$/, ""),
  title,
  kind: path.startsWith("schema/") ? "schema" : "entity",
  status: "active",
  ...over,
})

const items = [
  item("schema/domain.md", "Domain"),
  item("service/registry.md", "Container registry"),
  item("service/email.md", "Email"),
  item("machine/musashi.md", "Musashi"),
  item("machine/takezo.md", "Takezo", { status: "retired" }),
  item("machine/odd\nname.md", null, { id: null }),
  item("project/shinan.md", "Shinan"),
]

const tree = {
  catalog_commit: catalogCommit,
  index_behind: false,
  attention: 3,
  items,
}

describe("the catalog's folders", () => {
  it("are sorted by name with schema last, pages by title, leaving out retired and unreadable files", () => {
    expect(
      catalogFolders(items).map((f) => [f.name, f.items.map((i) => i.title)]),
    ).toEqual([
      ["machine", ["Musashi"]],
      ["project", ["Shinan"]],
      ["service", ["Container registry", "Email"]],
      ["schema", ["Domain"]],
    ])
  })

  it("follow the three states of an index answer", () => {
    expect(catalogState({ catalog_commit: null, index_behind: false })).toBe(
      "setting-up",
    )
    expect(catalogState({ catalog_commit: null, index_behind: true })).toBe(
      "catching-up",
    )
    expect(
      catalogState({ catalog_commit: catalogCommit, index_behind: true }),
    ).toBe("catching-up")
    expect(
      catalogState({ catalog_commit: catalogCommit, index_behind: false }),
    ).toBe("ready")
  })
})

describe("the sidebar", () => {
  it("holds search, Start here, Needs attention with its count, the folders, Settings and Your account", async () => {
    renderApp(
      `/w/${workspaceId}/catalog`,
      fakeApi({ catalogTree: () => Promise.resolve(tree) }),
    )
    const sidebar = within(await screen.findByRole("complementary"))
    expect(sidebar.getByRole("search")).toBeTruthy()
    await sidebar.findByRole("navigation", { name: "Pages" })
    const catalog = sidebar.getByRole("navigation", { name: "Catalog" })
    expect(
      within(catalog)
        .getAllByRole("link")
        .map((l) => [l.textContent, l.getAttribute("href")]),
    ).toEqual([
      ["Start here", `/w/${workspaceId}/catalog`],
      ["Recent changes", `/w/${workspaceId}/catalog/changes`],
      ["Needs attention3 things", `/w/${workspaceId}/catalog/needs-attention`],
    ])
    const pages = await sidebar.findByRole("navigation", { name: "Pages" })
    expect(
      within(pages)
        .getAllByRole("button")
        .map((b) => [b.textContent, b.getAttribute("aria-expanded")]),
    ).toEqual([
      ["machine", "false"],
      ["project", "false"],
      ["service", "false"],
      ["schema", "false"],
    ])
    const settings = sidebar.getByRole("navigation", {
      name: "Settings and account",
    })
    expect(
      within(settings)
        .getAllByRole("link")
        .map((l) => [l.textContent, l.getAttribute("href")]),
    ).toEqual([
      ["Settings", `/w/${workspaceId}/settings`],
      ["Your account", "/account"],
    ])
    // The old tabs are gone.
    expect(screen.queryByRole("navigation", { name: "Workspace" })).toBeNull()
    expect(screen.queryByRole("navigation", { name: "Wiki" })).toBeNull()
  })

  it("opens a folder to its pages by title, and opens the current page's folder by itself", async () => {
    renderApp(
      `/w/${workspaceId}/catalog/p/service/email`,
      fakeApi({
        catalogTree: () => Promise.resolve(tree),
        catalogEntity: () => new Promise(() => {}),
      }),
    )
    const sidebar = within(await screen.findByRole("complementary"))
    const pages = within(
      await sidebar.findByRole("navigation", { name: "Pages" }),
    )
    const service = pages.getByRole("button", { name: "service" })
    await waitFor(() =>
      expect(service.getAttribute("aria-expanded")).toBe("true"),
    )
    const email = pages.getByRole("link", { name: "Email" })
    expect(email.getAttribute("aria-current")).toBe("page")
    expect(pages.getByRole("link", { name: "Container registry" })).toBeTruthy()
    // File names are not shown beside titles.
    expect(pages.queryByText(/registry\.md/)).toBeNull()

    await userEvent.click(pages.getByRole("button", { name: "machine" }))
    await userEvent.click(pages.getByRole("link", { name: "Musashi" }))
    expect(currentPath()).toBe(`/w/${workspaceId}/catalog/p/machine/musashi`)
  })

  it("shows the catalog of the workspace last open on Your account, and Installation to operators", async () => {
    renderApp(
      "/account",
      fakeApi({
        account: () => Promise.resolve({ ...account, operator: true }),
        catalogTree: () => Promise.resolve(tree),
      }),
    )
    const sidebar = within(await screen.findByRole("complementary"))
    expect(
      await sidebar.findByRole("link", { name: "Start here" }),
    ).toBeTruthy()
    expect(
      sidebar.getByRole("link", { name: "Installation" }).getAttribute("href"),
    ).toBe("/installation")
    expect(
      sidebar
        .getByRole("link", { name: "Your account" })
        .getAttribute("aria-current"),
    ).toBe("page")
  })

  it("shows only Your account to someone with no workspace", async () => {
    renderApp(
      "/account",
      fakeApi({
        account: () => Promise.resolve({ ...account, workspaces: [] }),
      }),
    )
    const sidebar = within(await screen.findByRole("complementary"))
    expect(sidebar.getByRole("link", { name: "Your account" })).toBeTruthy()
    expect(sidebar.queryByRole("link", { name: "Start here" })).toBeNull()
    expect(sidebar.queryByRole("search")).toBeNull()
  })

  it("folds into a menu on narrow screens, closed by following a link, with focus on the new page's heading", async () => {
    renderApp(
      `/w/${workspaceId}/catalog`,
      fakeApi({
        catalogTree: () => Promise.resolve(tree),
        catalogList: () => new Promise(() => {}),
      }),
    )
    const banner = within(await screen.findByRole("banner"))
    await userEvent.click(banner.getByRole("button", { name: "Menu" }))
    const menu = within(await screen.findByRole("dialog", { name: "Menu" }))
    // Focus starts on the close button, not the search box: a phone would
    // open its keyboard over the menu.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        menu.getByRole("button", { name: "Close menu" }),
      ),
    )
    await userEvent.click(menu.getByRole("link", { name: /Needs attention/ }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(currentPath()).toBe(`/w/${workspaceId}/catalog/needs-attention`)
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 1, name: "Needs attention" }),
      ),
    )
  })

  it("closes the menu with its close button, and gives focus back to Menu", async () => {
    renderApp(
      `/w/${workspaceId}/catalog`,
      fakeApi({ catalogTree: () => Promise.resolve(tree) }),
    )
    const banner = within(await screen.findByRole("banner"))
    const button = banner.getByRole("button", { name: "Menu" })
    await userEvent.click(button)
    const menu = within(await screen.findByRole("dialog", { name: "Menu" }))
    await userEvent.click(menu.getByRole("button", { name: "Close menu" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(button))
  })

  it("shows hidden characters in titles and folder names as markers", async () => {
    renderApp(
      `/w/${workspaceId}/catalog/p/machine/musashi`,
      fakeApi({
        catalogTree: () =>
          Promise.resolve({
            ...tree,
            items: [item("machine/musashi.md", "Invoice \u202Egnp.exe")],
          }),
        catalogEntity: () => new Promise(() => {}),
      }),
    )
    const sidebar = within(await screen.findByRole("complementary"))
    // Seen as a marker, its name on hover; heard as its name.
    const link = await sidebar.findByRole("link", {
      name: "Invoice (hidden character: right-to-left override)gnp.exe",
    })
    expect(link.textContent).toContain("Invoice ⟨U+202E⟩")
    expect(within(link).getByTitle("right-to-left override")).toBeTruthy()
  })

  it("shows a folder of 20,000 pages a slice at a time, with the current page and its neighbours", async () => {
    const big = Array.from({ length: 20_000 }, (_, i) =>
      item(`machine/m${i}.md`, `Machine ${i}`),
    )
    renderApp(
      `/w/${workspaceId}/catalog/p/machine/m10000`,
      fakeApi({
        catalogTree: () => Promise.resolve({ ...tree, items: big }),
        catalogEntity: () => new Promise(() => {}),
      }),
    )
    const sidebar = within(await screen.findByRole("complementary"))
    const pages = within(
      await sidebar.findByRole("navigation", { name: "Pages" }),
    )
    const current = await pages.findByRole("link", { name: "Machine 10000" })
    expect(current.getAttribute("aria-current")).toBe("page")
    const links = pages.getAllByRole("link")
    // The first 100, then the current page with five on each side.
    expect(links).toHaveLength(100 + 11)
    expect(links[0]!.textContent).toBe("Machine 0")
    expect(links[99]!.textContent).toBe("Machine 99")
    expect(links[100]!.textContent).toBe("Machine 9995")
    expect(links[110]!.textContent).toBe("Machine 10005")
    expect(
      pages.getAllByRole("link", { current: "page" }).map((l) => l.textContent),
    ).toEqual(["Machine 10000"])

    await userEvent.click(
      pages.getByRole("button", { name: "Show 500 more (19,889 left)" }),
    )
    expect(pages.getAllByRole("link")).toHaveLength(600 + 11)
    expect(
      pages.getByRole("button", { name: "Show 500 more (19,389 left)" }),
    ).toBeTruthy()
  })

  it("offers the last pages of a folder by how many are left", async () => {
    renderApp(
      `/w/${workspaceId}/catalog`,
      fakeApi({
        catalogTree: () =>
          Promise.resolve({
            ...tree,
            items: Array.from({ length: 650 }, (_, i) =>
              item(`machine/m${i}.md`, `Machine ${i}`),
            ),
          }),
      }),
    )
    const sidebar = within(await screen.findByRole("complementary"))
    await userEvent.click(
      await sidebar.findByRole("button", { name: "machine" }),
    )
    await userEvent.click(
      sidebar.getByRole("button", { name: "Show 500 more (550 left)" }),
    )
    await userEvent.click(
      sidebar.getByRole("button", { name: "Show the last 50" }),
    )
    expect(
      within(sidebar.getByRole("navigation", { name: "Pages" })).getAllByRole(
        "link",
      ),
    ).toHaveLength(650)
  })
})
