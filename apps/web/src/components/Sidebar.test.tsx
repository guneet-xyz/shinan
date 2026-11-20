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

  it("folds into a menu on narrow screens, closed by following a link", async () => {
    renderApp(
      `/w/${workspaceId}/catalog`,
      fakeApi({ catalogTree: () => Promise.resolve(tree) }),
    )
    const banner = within(await screen.findByRole("banner"))
    await userEvent.click(banner.getByRole("button", { name: "Menu" }))
    const menu = within(await screen.findByRole("dialog", { name: "Menu" }))
    await userEvent.click(menu.getByRole("link", { name: /Needs attention/ }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(currentPath()).toBe(`/w/${workspaceId}/catalog/needs-attention`)
  })
})
