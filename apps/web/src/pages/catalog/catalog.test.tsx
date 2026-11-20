import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import type { CatalogEntity, CatalogFact } from "@shinan/api-client"

import { currentPath, fakeApi, renderApp, workspaceId } from "../../test/render"

const answer = {
  catalog_commit: "1234567890abcdef1234567890abcdef12345678",
  index_behind: false,
}

/** A small catalog's tree, as the sidebar reads it. */
const tree = {
  ...answer,
  attention: 2,
  items: [
    {
      path: "machine/musashi.md",
      id: "machine/musashi",
      title: "Musashi",
      kind: "entity",
      status: "active",
    },
    {
      path: "service/registry.md",
      id: "service/registry",
      title: "Container registry",
      kind: "entity",
      status: "active",
    },
  ],
}

const check = {
  checked: "2026-11-14",
  by: "guneet via opencode-daedalus",
  scope: "df -h on the data disk",
  source: "https://git.guneet.dev/infra/musashi/issues/93",
  limits: "Root disk not inspected",
}

function fact(over: Partial<CatalogFact> & { key: string }): CatalogFact {
  return {
    identity: `${over.key}|${over.state ?? "observed"}`,
    state: "observed",
    many: false,
    relation: false,
    in_schema: true,
    check,
    freshness: { status: "fresh", age_days: 4, recheck_days: 30, due_at: null },
    ...over,
  }
}

const musashi: CatalogEntity = {
  id: "machine/musashi",
  type: "machine",
  title: "Musashi",
  summary: "Azure VM that runs the shared production stacks.",
  status: "active",
  owner: "person/guneet",
  replaced_by: null,
  aliases: ["machine/old-musashi"],
  imported_from: null,
  path: "machine/musashi.md",
  blob: "abcdef1234567890abcdef1234567890abcdef12",
  facts: [
    fact({
      key: "disk.data.size",
      identity: "disk.data.size|observed|via=filesystem",
      value: "128 GiB",
      via: "filesystem",
    }),
    fact({
      key: "disk.data.size",
      identity: "disk.data.size|observed|via=instance-metadata",
      value: "64 GB",
      via: "instance-metadata",
      note: "Metadata lags after a resize",
    }),
    fact({
      key: "disk.data.free",
      value: "74 GiB",
      freshness: {
        status: "due",
        age_days: 40,
        recheck_days: 7,
        due_at: "2026-10-21T00:00:00.000Z",
      },
    }),
    fact({
      key: "network.public_ipv6",
      state: "unknown",
      note: "Reachability not tested",
      check: null,
      freshness: {
        status: "not-checked",
        age_days: null,
        recheck_days: null,
        due_at: null,
      },
    }),
    fact({
      key: "configured-by",
      identity: "configured-by|intended|to=project/infra",
      state: "intended",
      relation: true,
      many: true,
      to: "project/infra",
    }),
    fact({
      key: "secrets-in",
      identity: "secrets-in|observed|to=service/vault|item=musashi/ssh",
      relation: true,
      many: true,
      to: "service/vault",
      attributes: { item: "musashi/ssh" },
    }),
  ],
  relations: {
    outgoing: [
      {
        key: "configured-by",
        to: "project/infra",
        state: "intended",
        identity: "configured-by|intended|to=project/infra",
        attributes: {},
        entity: {
          id: "project/infra",
          type: "project",
          title: "Infrastructure",
          summary: null,
          status: "active",
          owner: null,
        },
      },
    ],
    incoming: [
      {
        key: "runs-on",
        inverse: "services",
        from: {
          id: "service/registry",
          type: "service",
          title: "Container registry",
          summary: null,
          status: "active",
          owner: null,
        },
        state: "intended",
        identity: "runs-on|intended|to=machine/musashi",
        attributes: {},
      },
    ],
  },
  discrepancies: [
    {
      key: "disk.data.size",
      values: ["128 GiB", "64 GB"],
      accepted: false,
      facts: [
        "disk.data.size|observed|via=filesystem",
        "disk.data.size|observed|via=instance-metadata",
      ],
    },
  ],
  known_unknowns: ["network.public_ipv6|unknown"],
  not_yet_recorded: { missing_keys: ["role"], not_checked: [] },
  applies: {
    policies: [
      {
        entity: {
          id: "policy/deploy-approval",
          type: "policy",
          title: "Deployment approval",
          summary: null,
          status: "active",
          owner: null,
        },
        through: "workspace",
        state: "intended",
        identity: "applies-to|intended|to=workspace",
      },
    ],
    runbooks: [],
  },
  body: [
    {
      heading: "Musashi",
      level: 1,
      anchor: "musashi",
      text: "# Musashi\n\nRuns the [registry](service/registry).\n\n",
    },
    {
      heading: "Cautions",
      level: 2,
      anchor: "cautions",
      text: "## Cautions\n\n<script>alert(1)</script> Never reboot on Fridays.\n",
    },
  ],
  problems: [],
}

const entityPath = `/w/${workspaceId}/catalog/p/machine/musashi`

function api(entity: CatalogEntity = musashi) {
  return fakeApi({
    catalogEntity: () => Promise.resolve({ ...answer, entity }),
  })
}

describe("an entity page", () => {
  it("shows the entity's parts in order of importance", async () => {
    renderApp(entityPath, api())
    expect(
      await screen.findByRole("heading", { level: 1, name: "Musashi" }),
    ).toBeTruthy()
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent)
    expect(headings).toEqual([
      "Discrepancies",
      "Owning sources",
      "Facts",
      "Description",
      "Links",
    ])
    // Nothing to change it with: agents change the catalog in Git.
    expect(screen.queryByRole("link", { name: "Suggest a change" })).toBeNull()
    expect(screen.queryByRole("link", { name: /Record a check/ })).toBeNull()
  })

  it("shows discrepancies with both sides, neither as right", async () => {
    renderApp(entityPath, api())
    const section = (
      await screen.findByRole("heading", { name: "Discrepancies" })
    ).closest("section")!
    expect(section.textContent).toContain("128 GiB")
    expect(section.textContent).toContain("64 GB")
    expect(section.textContent).toContain("needs a look")
  })

  it("shows each fact's state in words, its age, and its check one step away", async () => {
    renderApp(entityPath, api())
    const facts = (
      await screen.findByRole("heading", { name: "Facts" })
    ).closest("section")!
    expect(facts.textContent).toContain(
      "6 facts · oldest checked 40 days ago · 1 due for recheck · 1 never checked · 1 unknown",
    )
    expect(within(facts).getAllByText("seen").length).toBeGreaterThan(0)
    expect(within(facts).getByText("should be")).toBeTruthy()
    expect(within(facts).getByText("due for recheck")).toBeTruthy()
    expect(within(facts).getByText("not checked")).toBeTruthy()
    expect(facts.textContent).toContain("Reachability not tested")
    // A secret is shown as where it is kept, never a value.
    expect(facts.textContent).toContain("kept in service/vault as musashi/ssh")
    expect(facts.textContent).toContain("Not yet recorded: role")
    const details = within(facts).getAllByText("How it was checked")[0]!
    await userEvent.click(details)
    expect(facts.textContent).toContain("2026-11-14")
    expect(facts.textContent).toContain("df -h on the data disk")
  })

  it("shows owning sources, links both ways and what applies", async () => {
    renderApp(entityPath, api())
    const sources = (
      await screen.findByRole("heading", { name: "Owning sources" })
    ).closest("section")!
    expect(
      within(sources).getByRole("link", { name: /Infrastructure/ }),
    ).toBeTruthy()
    expect(
      within(sources)
        .getByRole("link", { name: check.source })
        .getAttribute("href"),
    ).toBe(check.source)
    const links = screen
      .getByRole("heading", { name: "Links" })
      .closest("section")!
    expect(within(links).getByText("services")).toBeTruthy()
    expect(
      within(links)
        .getByRole("link", { name: /Container registry/ })
        .getAttribute("href"),
    ).toBe(`/w/${workspaceId}/catalog/p/service/registry`)
    expect(links.textContent).toContain("for the whole workspace")
  })

  it("renders the body without its raw HTML, with entity links to the catalog", async () => {
    const { container } = renderApp(entityPath, api())
    const body = (
      await screen.findByRole("heading", { name: "Description" })
    ).closest("section")!
    expect(body.textContent).toContain("<script>alert(1)</script>")
    expect(container.querySelector("script")).toBeNull()
    expect(
      within(body).getByRole("link", { name: "registry" }).getAttribute("href"),
    ).toBe(`/w/${workspaceId}/catalog/p/service/registry`)
    expect(body.querySelector("#section-cautions")?.textContent).toBe(
      "Cautions",
    )
  })

  it("scrolls to a section linked from another page once it has rendered", async () => {
    const scrolled: string[] = []
    // The test DOM does not scroll; record what would be scrolled to.
    const original = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollIntoView",
    )
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id)
    }
    try {
      const registry: CatalogEntity = {
        ...musashi,
        id: "service/registry",
        type: "service",
        title: "Container registry",
        aliases: [],
        body: [
          {
            ...musashi.body[0]!,
            heading: "Container registry",
            anchor: "container-registry",
            text: "# Container registry\n\nRuns on [Musashi, with care](machine/musashi#cautions).\n",
          },
        ],
      }
      renderApp(
        `/w/${workspaceId}/catalog/p/service/registry`,
        fakeApi({
          catalogEntity: (_w, id) =>
            // Answered later than the navigation, as over the network.
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    ...answer,
                    entity: id === "service/registry" ? registry : musashi,
                  }),
                20,
              ),
            ),
        }),
      )
      await userEvent.click(
        await screen.findByRole("link", { name: "Musashi, with care" }),
      )
      await waitFor(() => expect(scrolled).toEqual(["section-cautions"]))
      expect(currentPath()).toBe(`${entityPath}#section-cautions`)
    } finally {
      if (original)
        Object.defineProperty(Element.prototype, "scrollIntoView", original)
      else delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  it("lists what could not be read, with nothing to repair it in the browser", async () => {
    renderApp(
      entityPath,
      api({
        ...musashi,
        problems: [
          { code: "fact-invalid", message: "A fact could not be read." },
        ],
      }),
    )
    const notice = await screen.findByText(
      "This page could not be read in full:",
    )
    expect(notice.closest("div")!.textContent).toContain(
      "A fact could not be read.",
    )
    expect(screen.queryByRole("link", { name: /Repair/ })).toBeNull()
  })

  it("says first when an entity is retired, with its replacement", async () => {
    renderApp(
      entityPath,
      api({ ...musashi, status: "retired", replaced_by: "machine/musashi-2" }),
    )
    const notice = await screen.findByText(/This machine is retired/)
    expect(notice.closest("div")?.textContent).toContain("machine/musashi-2")
  })

  it("leads a former ID to the current page", async () => {
    renderApp(`/w/${workspaceId}/catalog/p/machine/old-musashi`, api())
    await waitFor(() => expect(currentPath()).toBe(entityPath))
    expect(await screen.findByText(/is now/)).toBeTruthy()
  })

  it("answers not found for an unknown entity", async () => {
    const { apiError } = await import("../../test/render")
    renderApp(
      `/w/${workspaceId}/catalog/p/machine/nowhere`,
      fakeApi({
        catalogEntity: () =>
          Promise.reject(
            apiError(404, { error: "not-found", message: "Not found" }),
          ),
      }),
    )
    expect(
      await screen.findByRole("heading", { name: /not found/i }),
    ).toBeTruthy()
  })
})

describe("start here", () => {
  it("numbers the people's steps and lists the agents' path", async () => {
    const summary = (id: string, title: string) => ({
      id,
      type: id.split("/")[0]!,
      title,
      summary: null,
      status: "active",
      owner: null,
    })
    const fake = fakeApi({
      catalogStartHere: (_w, path) =>
        Promise.resolve({
          ...answer,
          start_here: {
            path,
            title: "Start here",
            summary: "The paths through the catalog.",
            document: {
              path: "start-here.md",
              blob: "abcdef1234567890abcdef1234567890abcdef12",
            },
            steps:
              path === "people"
                ? [
                    {
                      to: "machine/musashi",
                      note: "The production host.",
                      entity: summary("machine/musashi", "Musashi"),
                    },
                    { list: "discrepancies", note: "What disagrees." },
                    { list: "recent-changes", note: "What changed." },
                  ]
                : [
                    {
                      url: "https://git.guneet.dev/guneet/workspace/src/branch/main/docs/access-and-safety.md",
                      note: "Follow it before touching any machine.",
                    },
                  ],
          },
        }),
    })
    renderApp(`/w/${workspaceId}/catalog`, fake)
    const people = (
      await screen.findByRole("heading", { name: "For people" })
    ).closest("section")!
    const steps = within(people).getAllByRole("listitem")
    expect(steps.map((s) => s.textContent)).toEqual([
      "1Musashi(machine/musashi)The production host.",
      "2These disagreeWhat disagrees.",
      "3Recent changesWhat changed.",
    ])
    expect(
      within(people)
        .getByRole("link", { name: "These disagree" })
        .getAttribute("href"),
    ).toBe(`/w/${workspaceId}/catalog/needs-attention`)
    // Recent changes come from `main`'s commits later in GC-7: until then
    // the step is not a link.
    expect(
      within(people).queryByRole("link", { name: "Recent changes" }),
    ).toBeNull()
    const agents = screen
      .getByRole("heading", { name: "For agents" })
      .closest("section")!
    expect(agents.textContent).toContain(
      "Follow it before touching any machine.",
    )
    // No editing, and no preview of what MCP gave agents.
    expect(screen.queryByRole("link", { name: "Suggest a change" })).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Preview as agent" }),
    ).toBeNull()
  })

  it("says when there is no start-here page", async () => {
    renderApp(
      `/w/${workspaceId}/catalog`,
      fakeApi({ catalogTree: () => Promise.resolve(tree) }),
    )
    expect(
      await screen.findByText(/There's no Start here page yet/),
    ).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Write Start here" })).toBeNull()
  })

  it("says what to do first in an empty catalog", async () => {
    renderApp(`/w/${workspaceId}/catalog`, fakeApi())
    expect(
      await screen.findByRole("heading", { name: "Your catalog is empty." }),
    ).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Set up an agent" })
        .getAttribute("href"),
    ).toBe("/account/agents/setup")
  })
})

describe("moving around the catalog", () => {
  it("indexes a type with its schema and a sortable table", async () => {
    renderApp(
      `/w/${workspaceId}/catalog/types/machine`,
      fakeApi({
        catalogType: () =>
          Promise.resolve({
            ...answer,
            schema: {
              type: "machine",
              built_in: true,
              extended: false,
              document: null,
              status: "active",
              keys: [
                {
                  key: "role",
                  many: false,
                  relation: null,
                  recheck_days: 180,
                  built_in: true,
                },
              ],
              required: ["role"],
              sections: [],
              title: null,
              summary: null,
              body: [],
            },
          }),
        catalogTypeIndex: () =>
          Promise.resolve({
            ...answer,
            truncated: false,
            items: [
              {
                entity: {
                  id: "machine/takezo",
                  type: "machine",
                  title: "Takezo",
                  summary: null,
                  status: "active",
                  owner: "person/guneet",
                },
                freshness: {
                  facts: 3,
                  oldest_checked_at: "2026-11-01T00:00:00.000Z",
                  due: 0,
                  not_checked: 0,
                  unknown: 0,
                },
              },
              {
                entity: {
                  id: "machine/musashi",
                  type: "machine",
                  title: "Musashi",
                  summary: null,
                  status: "active",
                  owner: "person/guneet",
                },
                freshness: {
                  facts: 9,
                  oldest_checked_at: "2026-10-01T00:00:00.000Z",
                  due: 2,
                  not_checked: 1,
                  unknown: 1,
                },
              },
            ],
          }),
      }),
    )
    const table = await screen.findByRole("table", {
      name: /Entities of type machine/,
    })
    const names = () =>
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((r) => within(r).getAllByRole("cell")[0]!.textContent)
    expect(names()).toEqual([
      "Musashi(machine/musashi)",
      "Takezo(machine/takezo)",
    ])
    await userEvent.click(within(table).getByRole("button", { name: "Facts" }))
    expect(names()[0]).toContain("Takezo")
    await userEvent.click(within(table).getByRole("button", { name: "Facts" }))
    expect(names()[0]).toContain("Musashi")
    expect(
      within(table)
        .getByRole("columnheader", { name: /Facts/ })
        .getAttribute("aria-sort"),
    ).toBe("descending")
    expect(screen.getByText("required")).toBeTruthy()
  })

  it("says when a type's index holds only its first entities", async () => {
    renderApp(
      `/w/${workspaceId}/catalog/types/domain`,
      fakeApi({
        catalogType: () =>
          Promise.resolve({
            ...answer,
            schema: {
              type: "domain",
              built_in: false,
              extended: false,
              status: "active",
              document: null,
              keys: [],
              required: [],
              sections: [],
              title: null,
              summary: null,
              body: [],
            },
          }),
        catalogTypeIndex: () =>
          Promise.resolve({
            ...answer,
            truncated: true,
            items: [
              {
                entity: {
                  id: "domain/a",
                  type: "domain",
                  title: "A",
                  summary: null,
                  status: "active",
                  owner: null,
                },
                freshness: {
                  facts: 0,
                  oldest_checked_at: null,
                  due: 0,
                  not_checked: 0,
                  unknown: 0,
                },
              },
            ],
          }),
      }),
    )
    expect(
      await screen.findByText(
        /Only the first 1 by ID are listed, and sorting orders only those/,
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole("table", {
        name: /sort the table \(the first 1 by ID only\)\./,
      }),
    ).toBeTruthy()
  })

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
      "machine/new⟨U+000A⟩line.md",
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

describe("titles written by agents", () => {
  // A right-to-left override makes "Invoice gnp.exe" read "Invoice exe.png".
  const spoof = "Invoice \u202Egnp.exe"
  const marked = "Invoice ⟨U+202E⟩gnp.exe"

  it("show hidden characters as markers on the page, in search and in Needs attention", async () => {
    const page = {
      id: "machine/musashi",
      type: "machine",
      title: spoof,
      summary: null,
      status: "active",
      owner: null,
    }
    const fake = fakeApi({
      catalogEntity: () =>
        Promise.resolve({ ...answer, entity: { ...musashi, title: spoof } }),
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
            list === "due-for-recheck"
              ? [{ entity: page, fact: musashi.facts[2]! }]
              : [],
        }),
    })
    const { unmount } = renderApp(entityPath, fake)
    expect(
      await screen.findByRole("heading", { level: 1, name: marked }),
    ).toBeTruthy()
    unmount()

    const search = renderApp(`/w/${workspaceId}/catalog/search?q=invoice`, fake)
    expect(
      // The sidebar's tree is empty: the one link is in the page.
      await screen.findByRole("link", { name: marked }),
    ).toBeTruthy()
    search.unmount()

    renderApp(`/w/${workspaceId}/catalog/needs-attention`, fake)
    expect(
      // The sidebar's tree is empty: the one link is in the page.
      await screen.findByRole("link", { name: marked }),
    ).toBeTruthy()
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
    ["wiki/lists/discrepancies", "catalog/needs-attention"],
    ["wiki/types/machine", "catalog/types/machine"],
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
    "wiki/changes",
    "settings/catalog",
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
        catalogStartHere: () =>
          Promise.resolve({ ...answer, index_behind: true, start_here: null }),
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
