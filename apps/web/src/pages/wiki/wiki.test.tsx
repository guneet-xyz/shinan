import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import type {
  CatalogEntity,
  CatalogFact,
  CatalogHistoryAnswer,
} from "@shinan/api-client"

import { currentPath, fakeApi, renderApp, workspaceId } from "../../test/render"

const answer = { catalog_revision: 7, index_behind: false }

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
  revision: 7,
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
      changed_in: 7,
      changed_by: "guneet",
      changed_by_kind: "person",
      written_by: "guneet",
      written_by_kind: "person",
    },
    {
      heading: "Cautions",
      level: 2,
      anchor: "cautions",
      text: "## Cautions\n\n<script>alert(1)</script> Never reboot on Fridays.\n",
      changed_in: 7,
      changed_by: "guneet",
      changed_by_kind: "person",
      written_by: "guneet",
      written_by_kind: "person",
    },
  ],
  problems: [],
  pending_proposals: [],
}

const history: CatalogHistoryAnswer = {
  ...answer,
  id: "machine/musashi",
  kind: "entity",
  items: [
    {
      revision: 7,
      at: "2026-11-16T10:00:00.000Z",
      changed_by: "guneet",
      changed_by_kind: "person",
      confidence: "recorded",
    },
    {
      revision: 3,
      at: "2026-11-14T10:00:00.000Z",
      changed_by: "guneet via opencode-daedalus",
      changed_by_kind: "agent",
      confidence: "recorded",
    },
  ],
  next_before: null,
}

const entityPath = `/w/${workspaceId}/wiki/e/machine/musashi`

function api(entity: CatalogEntity = musashi) {
  return fakeApi({
    catalogEntity: () => Promise.resolve({ ...answer, entity }),
    catalogHistory: () => Promise.resolve(history),
  })
}

describe("an entity page", () => {
  it("shows the entity's parts in order of importance", async () => {
    const fake = api()
    renderApp(entityPath, fake)
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
      "History",
    ])
    // It records that the person opened it, for the start-here markers.
    await waitFor(() =>
      expect(fake.markCatalogPageOpened).toHaveBeenCalledWith(
        workspaceId,
        "machine/musashi",
      ),
    )
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
    ).toBe(`/w/${workspaceId}/wiki/e/service/registry`)
    expect(links.textContent).toContain("for the whole workspace")
  })

  it("renders the body without its raw HTML, with entity links to the wiki", async () => {
    const { container } = renderApp(entityPath, api())
    const body = (
      await screen.findByRole("heading", { name: "Description" })
    ).closest("section")!
    expect(body.textContent).toContain("<script>alert(1)</script>")
    expect(container.querySelector("script")).toBeNull()
    expect(
      within(body).getByRole("link", { name: "registry" }).getAttribute("href"),
    ).toBe(`/w/${workspaceId}/wiki/e/service/registry`)
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
        `/w/${workspaceId}/wiki/e/service/registry`,
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
          catalogHistory: () => Promise.resolve(history),
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

  it("says first when an entity is retired, with its replacement", async () => {
    renderApp(
      entityPath,
      api({ ...musashi, status: "retired", replaced_by: "machine/musashi-2" }),
    )
    const notice = await screen.findByText(/This machine is retired/)
    expect(notice.closest("div")?.textContent).toContain("machine/musashi-2")
  })

  it("leads a former ID to the current page", async () => {
    renderApp(`/w/${workspaceId}/wiki/e/machine/old-musashi`, api())
    await waitFor(() => expect(currentPath()).toBe(entityPath))
    expect(await screen.findByText(/is now/)).toBeTruthy()
  })

  it("lists its history and compares an earlier revision with now", async () => {
    const fake = fakeApi({
      catalogEntity: () => Promise.resolve({ ...answer, entity: musashi }),
      catalogHistory: () => Promise.resolve(history),
      catalogText: (_w, _id, revision) =>
        Promise.resolve({
          ...answer,
          id: "machine/musashi",
          kind: "entity",
          revision: revision ?? 7,
          at: "2026-11-14T10:00:00.000Z",
          changed_by: "guneet",
          changed_by_kind: "person",
          text:
            revision === 3
              ? "---\nid: machine/musashi\ndisk: 64\n---\n"
              : "---\nid: machine/musashi\ndisk: 128\n---\n",
        }),
    })
    renderApp(entityPath, fake)
    const historySection = (
      await screen.findByRole("heading", { name: "History" })
    ).closest("section")!
    await within(historySection).findByText("Revision 3")
    expect(historySection.textContent).toContain("current")
    await userEvent.click(
      within(historySection).getByRole("link", { name: "Compare with now" }),
    )
    await waitFor(() => expect(currentPath()).toBe(`${entityPath}?revision=3`))
    const comparison = await screen.findByRole("heading", {
      name: "Revision 3 compared with revision 7",
    })
    const text = comparison.closest("section")!.textContent
    expect(text).toContain("Removed: disk: 64")
    expect(text).toContain("Added: disk: 128")
  })

  it("answers not found for an unknown entity", async () => {
    const { apiError } = await import("../../test/render")
    renderApp(
      `/w/${workspaceId}/wiki/e/machine/nowhere`,
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
  it("numbers the people's steps with opened markers, and previews the agents' path", async () => {
    // What MCP's workspace_context sends: compact JSON with trust labels.
    const given = JSON.stringify({
      path: "agents",
      steps: [
        {
          url: "https://git.guneet.dev/guneet/workspace",
          note: "Follow it before touching any machine.",
          label: { author_kind: "member", author: "guneet", instruction: "no" },
        },
      ],
      label: { author_kind: "member", author: "guneet", instruction: "no" },
    })
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
            revision: 2,
            steps:
              path === "people"
                ? [
                    {
                      to: "machine/musashi",
                      note: "The production host.",
                      entity: summary("machine/musashi", "Musashi"),
                    },
                    {
                      to: "project/dockyard",
                      note: "The registry.",
                      entity: summary("project/dockyard", "Dockyard"),
                    },
                    {
                      to: "service/vault",
                      note: "Where secrets live.",
                      entity: summary("service/vault", "Vault"),
                    },
                    { list: "discrepancies", note: "What disagrees." },
                  ]
                : [
                    {
                      url: "https://git.guneet.dev/guneet/workspace/src/branch/main/docs/access-and-safety.md",
                      note: "Follow it before touching any machine.",
                    },
                  ],
          },
        }),
      catalogAgentPreview: () =>
        Promise.resolve({
          ...answer,
          start_here: {},
          text: given,
          bytes: 9000,
        }),
      catalogPagesOpened: () =>
        Promise.resolve({
          items: [
            {
              id: "machine/musashi",
              revision: 7,
              opened_revision: 7,
              opened_at: "2026-11-17T10:00:00.000Z",
            },
            {
              id: "project/dockyard",
              revision: 9,
              opened_revision: 4,
              opened_at: "2026-11-10T10:00:00.000Z",
            },
            {
              id: "service/vault",
              revision: 2,
              opened_revision: null,
              opened_at: null,
            },
          ],
        }),
    })
    renderApp(`/w/${workspaceId}/wiki/start-here`, fake)
    const people = (
      await screen.findByRole("heading", { name: "For people" })
    ).closest("section")!
    const steps = within(people).getAllByRole("listitem")
    expect(steps.map((s) => s.textContent)).toEqual([
      expect.stringMatching(/^1Musashi.*opened.*The production host\.$/),
      expect.stringMatching(/^2Dockyard.*changed since you opened it/),
      expect.stringMatching(/^3Vault.*not opened yet/),
      expect.stringMatching(/^4Discrepancies.*What disagrees\.$/),
    ])
    const agents = screen
      .getByRole("heading", { name: "For agents" })
      .closest("section")!
    // The size is the server's measure of exactly that text.
    expect(agents.textContent).toContain("Its size: 8.8 KB.")
    expect(agents.textContent).toContain("The agents' path is large (8.8 KB)")
    await userEvent.click(
      within(agents).getByRole("button", { name: "Preview as agent" }),
    )
    expect(
      within(agents).getByLabelText("What an agent is given").textContent,
    ).toBe(given)
  })
})

describe("moving around the wiki", () => {
  it("indexes a type with its schema and a sortable table", async () => {
    renderApp(
      `/w/${workspaceId}/wiki/types/machine`,
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
      `/w/${workspaceId}/wiki/types/domain`,
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

  it("searches, leaving out retired entities unless asked", async () => {
    const fake = fakeApi({
      catalogSearch: () =>
        Promise.resolve({
          ...answer,
          items: [
            {
              entity: {
                id: "machine/musashi",
                type: "machine",
                title: "Musashi",
                summary: "The host.",
                status: "active",
                owner: null,
              },
              rank: 1,
              sections: [],
            },
          ],
        }),
    })
    renderApp(`/w/${workspaceId}/wiki`, fake)
    await userEvent.type(
      await screen.findByLabelText("Search the catalog"),
      "musashi",
    )
    await userEvent.click(screen.getByRole("button", { name: "Search" }))
    await waitFor(() =>
      expect(currentPath()).toBe(`/w/${workspaceId}/wiki/search?q=musashi`),
    )
    expect(await screen.findByRole("link", { name: /Musashi/ })).toBeTruthy()
    expect(fake.catalogSearch).toHaveBeenCalledWith(workspaceId, {
      text: "musashi",
      includeRetired: false,
    })
  })

  it("shows a workspace list with each fact's freshness", async () => {
    renderApp(
      `/w/${workspaceId}/wiki/lists/due-for-recheck`,
      fakeApi({
        catalogList: () =>
          Promise.resolve({
            ...answer,
            next_offset: null,
            items: [
              {
                entity: {
                  id: "machine/musashi",
                  type: "machine",
                  title: "Musashi",
                  summary: null,
                  status: "active",
                  owner: null,
                },
                fact: musashi.facts[2]!,
              },
            ],
          }),
      }),
    )
    expect(
      await screen.findByRole("heading", { level: 1, name: "Due for recheck" }),
    ).toBeTruthy()
    expect(await screen.findByText("due for recheck")).toBeTruthy()
    expect(screen.getByText("checked 40 days ago")).toBeTruthy()
  })

  it("shows recent changes newest first", async () => {
    renderApp(
      `/w/${workspaceId}/wiki/changes`,
      fakeApi({
        catalogChanges: (_w, options) =>
          Promise.resolve({
            ...answer,
            catalog_revision: 2,
            since: options?.since ?? 0,
            next_since: null,
            items:
              options?.limit === 1
                ? []
                : [1, 2].map((revision) => ({
                    revision,
                    at: "2026-11-16T10:00:00.000Z",
                    changed_by: "guneet",
                    changed_by_kind: "person",
                    documents: [{ id: "machine/musashi", kind: "entity" }],
                  })),
          }),
      }),
    )
    const items = await screen.findAllByText(/^Revision \d$/)
    expect(items.map((i) => i.textContent)).toEqual([
      "Revision 2",
      "Revision 1",
    ])
  })
})
