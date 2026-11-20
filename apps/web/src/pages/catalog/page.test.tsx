import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { CatalogEntity, CatalogHistoryAnswer } from "@shinan/api-client"

import { answer, check, musashi, tree } from "../../test/catalog"
import {
  apiError,
  currentPath,
  fakeApi,
  renderApp,
  workspaceId,
} from "../../test/render"

const base = `/w/${workspaceId}/catalog`
const musashiPath = `${base}/p/machine/musashi`

function api(entity: CatalogEntity = musashi, more = {}) {
  return fakeApi({
    catalogEntity: () => Promise.resolve({ ...answer, entity }),
    ...more,
  })
}

const unavailable = () =>
  Promise.reject(
    apiError(503, {
      error: "unavailable",
      message: "The catalog's repository can't be read right now",
    }),
  )

/** A history answer with these changes, newest first. */
function history(
  changes: { message: string; minutesAgo: number; commit?: string }[],
  next_after: string | null = null,
): CatalogHistoryAnswer {
  return {
    ...answer,
    path: "machine/musashi.md",
    title: "Musashi",
    changes: changes.map((c, i) => ({
      commit: c.commit ?? `${String(i).repeat(7)}${"0".repeat(33)}`,
      subject: c.message.split("\n")[0]!,
      body: c.message.split("\n").slice(1).join("\n").trim(),
      time: new Date(Date.now() - c.minutesAgo * 60_000).toISOString(),
      merge: false,
      pushed_by: null,
    })),
    next_after,
  }
}

/** The row of the facts list with this label: its value's text. */
function factRow(label: string): HTMLElement {
  const facts = screen
    .getByRole("heading", { name: "Facts" })
    .closest("section")!
  const term = within(facts).getByText(label, { selector: "dt" })
  return term.nextElementSibling as HTMLElement
}

describe("a page", () => {
  it("reads in order: title and summary, disagreements, facts, body, related pages, footer", async () => {
    renderApp(musashiPath, api())
    expect(
      await screen.findByRole("heading", { level: 1, name: "Musashi" }),
    ).toBeTruthy()
    expect(
      screen.getByText("Azure VM that runs the shared production stacks."),
    ).toBeTruthy()
    // The body's first heading repeats the title, so it is left out.
    expect(screen.getAllByRole("heading", { name: "Musashi" })).toHaveLength(1)
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["Facts", "Cautions", "Related pages", "About this page"])
    // None of M2's page furniture.
    for (const gone of [
      "Discrepancies",
      "Owning sources",
      "Description",
      "Links",
    ])
      expect(screen.queryByRole("heading", { name: gone })).toBeNull()
    expect(screen.queryByText(/Not yet recorded/)).toBeNull()
    expect(screen.queryByText("Type")).toBeNull()
    expect(screen.queryByRole("link", { name: "Suggest a change" })).toBeNull()
  })

  it("says in one sentence when two checks disagree, and doesn't repeat the values below", async () => {
    renderApp(musashiPath, api())
    expect(
      await screen.findByText(
        "Two checks disagree about disk data size: 128 GiB and 64 GB (both seen 4 days ago).",
      ),
    ).toBeTruthy()
    // The row doesn't repeat the values: each, with its check, is one tap
    // away.
    const row = factRow("Disk data size")
    const show = within(row).getByRole("button", {
      name: "disagree · show both checks",
    })
    expect(row.textContent).toBe("disagree · show both checks")
    expect(show.getAttribute("aria-expanded")).toBe("false")
    await userEvent.click(show)
    expect(show.getAttribute("aria-expanded")).toBe("true")
    expect(show.textContent).toBe("disagree · hide checks")
    const checks = within(
      document.getElementById(show.getAttribute("aria-controls")!)!,
    ).getAllByRole("listitem")
    expect(checks.map((c) => c.querySelector("p")!.textContent)).toEqual([
      "128 GiB · seen 4 days ago",
      "64 GB · seen 4 days ago",
    ])
    expect(checks[1]!.textContent).toContain(
      "Byguneet, through opencode-daedalus",
    )
    expect(checks[1]!.textContent).toContain("Seen throughinstance-metadata")
    expect(checks[1]!.textContent).toContain("NoteMetadata lags after a resize")
  })

  it("gives each disagreeing value its own age when they differ", async () => {
    renderApp(
      musashiPath,
      api({
        ...musashi,
        facts: musashi.facts.map((f) =>
          f.value === "64 GB"
            ? { ...f, freshness: { ...f.freshness, age_days: 30 } }
            : f,
        ),
      }),
    )
    expect(
      await screen.findByText(
        "Two checks disagree about disk data size: 128 GiB (seen 4 days ago) and 64 GB (seen 30 days ago).",
      ),
    ).toBeTruthy()
  })

  it("lists facts as label, value and age, the state only when it isn't seen", async () => {
    renderApp(musashiPath, api())
    await screen.findByRole("heading", { name: "Facts" })
    expect(factRow("Disk data free").textContent).toBe(
      "74 GiB · checked 40 days ago · due for a recheck",
    )
    expect(factRow("Network public ipv6").textContent).toBe(
      "unknown: Reachability not tested · not checked yet",
    )
    expect(factRow("Configured by").textContent).toBe(
      "should be Infrastructure · checked 4 days ago",
    )
    expect(
      within(factRow("Configured by"))
        .getByRole("link", { name: "Infrastructure" })
        .getAttribute("href"),
    ).toBe(`${base}/p/project/infra`)
    // A secret is shown as where it is kept, never a value.
    expect(factRow("Secrets in").textContent).toBe(
      "kept in service/vault as musashi/ssh · checked 4 days ago",
    )
  })

  it("shows who checked a fact, what and how, one tap away on its age", async () => {
    renderApp(musashiPath, api())
    await screen.findByRole("heading", { name: "Facts" })
    const age = within(factRow("Disk data free")).getByRole("button", {
      name: "checked 40 days ago",
    })
    expect(age.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("df -h on the data disk")).toBeNull()
    await userEvent.click(age)
    expect(age.getAttribute("aria-expanded")).toBe("true")
    const details = document.getElementById(age.getAttribute("aria-controls")!)!
    expect(details.textContent).toBe(
      [
        "Checked2026-11-14",
        "Byguneet, through opencode-daedalus",
        "What was checkeddf -h on the data disk",
        `Source${check.source}`,
        "Not checkedRoot disk not inspected",
      ].join(""),
    )
    expect(
      within(details).getByRole("link", { name: check.source }),
    ).toBeTruthy()
    await userEvent.click(age)
    expect(
      document.getElementById(age.getAttribute("aria-controls")!),
    ).toBeNull()
  })

  it("renders the body without raw HTML, with links to pages and section anchors", async () => {
    const { container } = renderApp(musashiPath, api())
    const cautions = await screen.findByRole("heading", {
      level: 2,
      name: "Cautions",
    })
    expect(cautions.id).toBe("section-cautions")
    expect(container.textContent).toContain(
      "<script>alert(1)</script> Never reboot on Fridays.",
    )
    expect(container.querySelector("script")).toBeNull()
    expect(
      screen.getByRole("link", { name: "registry" }).getAttribute("href"),
    ).toBe(`${base}/p/service/registry`)
  })

  it("lists related pages by title under plain headings, each once", async () => {
    const incoming = musashi.relations.incoming[0]!
    renderApp(
      musashiPath,
      api({
        ...musashi,
        relations: {
          ...musashi.relations,
          // The registry links Musashi with two facts.
          incoming: [
            incoming,
            { ...incoming, identity: "runs-on|observed|to=machine/musashi" },
          ],
        },
        // It applies too: it shows under the first heading only.
        applies: {
          ...musashi.applies,
          runbooks: [
            {
              entity: incoming.from,
              through: "type",
              state: "intended",
              identity: "applies-to|intended|to=schema/machine",
            },
          ],
        },
      }),
    )
    const related = (
      await screen.findByRole("heading", { name: "Related pages" })
    ).closest("section")!
    expect(
      within(related)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(["Services", "Policies and runbooks that apply"])
    const [registry, ...again] = within(related).getAllByRole("link", {
      name: "Container registry",
    })
    expect(again).toEqual([])
    expect(registry!.getAttribute("href")).toBe(`${base}/p/service/registry`)
    // No IDs in brackets after links.
    expect(related.textContent).not.toContain("(service/registry)")
    expect(
      within(related).getByRole("link", { name: "Deployment approval" }),
    ).toBeTruthy()
  })

  it("ends with when it last changed, History, View source and About this page", async () => {
    renderApp(
      musashiPath,
      api(musashi, {
        catalogHistory: () =>
          Promise.resolve(history([{ message: "Recheck", minutesAgo: 150 }])),
      }),
    )
    const footer = (
      await screen.findByRole("link", { name: "History" })
    ).closest("footer")!
    await waitFor(() =>
      expect(footer.textContent).toContain(
        "Last changed 2 hours ago · History · View source",
      ),
    )
    expect(
      within(footer)
        .getByRole("link", { name: "History" })
        .getAttribute("href"),
    ).toBe(`${base}/history/machine/musashi`)
    expect(
      within(footer)
        .getByRole("link", { name: "View source" })
        .getAttribute("href"),
    ).toBe(`${base}/source/machine/musashi`)
    const about = within(footer)
      .getByRole("heading", { name: "About this page" })
      .closest("div")!
    expect(about.textContent).toBe(
      // The ID is the file's name without .md, so it isn't repeated.
      "About this pageFilemachine/musashi.mdOld IDmachine/old-musashiOwnerperson/guneetStatusactive",
    )
  })

  it("names pages by their titles from the sidebar's tree when the answer has only IDs", async () => {
    renderApp(
      musashiPath,
      api(musashi, {
        catalogTree: () =>
          Promise.resolve({
            ...tree,
            items: [
              ...tree.items,
              {
                path: "person/guneet.md",
                id: "person/guneet",
                title: "Guneet",
                kind: "entity",
                status: "active",
              },
            ],
          }),
      }),
    )
    const owner = await screen.findByRole("link", { name: "Guneet" })
    expect(owner.getAttribute("href")).toBe(`${base}/p/person/guneet`)
  })

  it("names its ID in About this page when it isn't the file's name", async () => {
    renderApp(musashiPath, api({ ...musashi, path: "machine/Musashi.md" }))
    const about = (
      await screen.findByRole("heading", { name: "About this page" })
    ).closest("div")!
    expect(about.textContent).toContain(
      "Filemachine/Musashi.mdIDmachine/musashi",
    )
  })

  it("leaves out when it last changed while the repository can't be read", async () => {
    renderApp(musashiPath, api(musashi, { catalogHistory: unavailable }))
    const footer = (
      await screen.findByRole("link", { name: "History" })
    ).closest("footer")!
    await waitFor(() =>
      expect(footer.querySelector("p")!.textContent).toBe(
        "History · View source",
      ),
    )
  })

  it("says first, calmly, when it is retired, and where to go instead", async () => {
    renderApp(
      musashiPath,
      api({ ...musashi, status: "retired", replaced_by: "machine/musashi-2" }),
    )
    const notice = await screen.findByText(/This page is retired\./)
    expect(notice.textContent).toBe(
      "This page is retired. See machine/musashi-2.",
    )
    expect(
      within(notice).getByRole("link", { name: "machine/musashi-2" }),
    ).toBeTruthy()
  })

  it("says when its summary has hidden characters too", async () => {
    renderApp(musashiPath, api({ ...musashi, summary: "Runs \u202Egnp.exe" }))
    expect(
      await screen.findByText(
        "This page's title or summary has hidden characters, shown as ⟨U+…⟩: they can make text read as something else.",
      ),
    ).toBeTruthy()
  })

  it("lets the keyboard scroll a code block", async () => {
    renderApp(
      musashiPath,
      api({
        ...musashi,
        body: [
          {
            heading: null,
            level: 0,
            anchor: null,
            text: "```\nsudo systemctl restart docker\n```\n",
          },
        ],
      }),
    )
    const code = (
      await screen.findByText("sudo systemctl restart docker")
    ).closest("pre")!
    expect(code.tabIndex).toBe(0)
  })

  it("explains hidden characters in its title once, under it", async () => {
    renderApp(musashiPath, api({ ...musashi, title: "Invoice \u202Egnp.exe" }))
    expect(
      await screen.findByText(
        "This title has hidden characters, shown as ⟨U+…⟩: they can make text read as something else.",
      ),
    ).toBeTruthy()
    expect(screen.getByTitle("right-to-left override")).toBeTruthy()
  })

  it("lists what could not be read, with nothing to repair it in the browser", async () => {
    renderApp(
      musashiPath,
      api({
        ...musashi,
        problems: [
          { code: "fact-invalid", message: "A fact could not be read." },
        ],
      }),
    )
    const notice = await screen.findByText(
      "Part of this page couldn't be read:",
    )
    expect(notice.parentElement!.textContent).toContain(
      "A fact could not be read.",
    )
    expect(screen.queryByRole("link", { name: /Repair/ })).toBeNull()
  })

  it("leads a former ID to the current page, saying so", async () => {
    renderApp(`${base}/p/machine/old-musashi`, api())
    await waitFor(() => expect(currentPath()).toBe(musashiPath))
    expect(await screen.findByText(/You followed an old address/)).toBeTruthy()
  })

  it("answers not found for an unknown page", async () => {
    renderApp(
      `${base}/p/machine/nowhere`,
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
        `${base}/p/service/registry`,
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
      expect(currentPath()).toBe(`${musashiPath}#section-cautions`)
    } finally {
      if (original)
        Object.defineProperty(Element.prototype, "scrollIntoView", original)
      else delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })
})

describe("catching up", () => {
  it("follows where the catalog stands now, and reads the page again once it has caught up", async () => {
    const newer = "fedcba9876543210fedcba9876543210fedcba98"
    let caughtUp = false
    const fake = fakeApi({
      catalogTree: () =>
        Promise.resolve(
          caughtUp
            ? { ...tree, catalog_commit: newer }
            : { ...tree, index_behind: true },
        ),
      catalogState: () => {
        caughtUp = true
        return Promise.resolve({ catalog_commit: newer, index_behind: false })
      },
      catalogEntity: () =>
        Promise.resolve(
          caughtUp
            ? { catalog_commit: newer, index_behind: false, entity: musashi }
            : { ...answer, index_behind: true, entity: musashi },
        ),
    })
    renderApp(musashiPath, fake)
    expect(
      await screen.findByText("Catching up with the latest changes…"),
    ).toBeTruthy()
    // The sidebar asks where the catalog stands a few seconds later.
    await waitFor(
      () =>
        expect(
          screen.queryByText("Catching up with the latest changes…"),
        ).toBeNull(),
      { timeout: 6000 },
    )
    await waitFor(() => expect(fake.catalogEntity).toHaveBeenCalledTimes(2))
  }, 10_000)

  it("doesn't say so when the page's answer is behind but the catalog has caught up", async () => {
    renderApp(
      musashiPath,
      fakeApi({
        catalogEntity: () =>
          Promise.resolve({ ...answer, index_behind: true, entity: musashi }),
      }),
    )
    await screen.findByRole("heading", { level: 1, name: "Musashi" })
    expect(
      screen.queryByText("Catching up with the latest changes…"),
    ).toBeNull()
  })
})

describe("a type schema's page", () => {
  const domain = {
    ...answer,
    document: {
      id: "schema/domain",
      kind: "schema",
      path: "schema/domain.md",
      blob: "abcdef1234567890abcdef1234567890abcdef12",
      title: "Domain",
      summary: "A DNS name the workspace owns.",
      status: "active",
      owner: null,
      body: [
        {
          heading: "Domain",
          level: 1,
          anchor: "domain",
          text: "# Domain\n\nOne page per name.\n",
        },
      ],
      problems: [],
    },
  }

  it("is a page like any other, and a type's old address leads to it", async () => {
    const fake = fakeApi({ catalogDocument: () => Promise.resolve(domain) })
    renderApp(`${base}/types/domain`, fake)
    await waitFor(() => expect(currentPath()).toBe(`${base}/p/schema/domain`))
    expect(
      await screen.findByRole("heading", { level: 1, name: "Domain" }),
    ).toBeTruthy()
    expect(screen.getByText("One page per name.")).toBeTruthy()
    expect(fake.catalogDocument).toHaveBeenCalledWith(
      workspaceId,
      "schema/domain",
    )
    expect(
      screen.getByRole("link", { name: "View source" }).getAttribute("href"),
    ).toBe(`${base}/source/schema/domain`)
    expect(
      screen.getByRole("heading", { name: "About this page" }).closest("div")!
        .textContent,
    ).toBe("About this pageFileschema/domain.mdStatusactive")
    expect(screen.getByText(/Describes the pages in the/).textContent).toBe(
      "Describes the pages in the domain folder.",
    )
  })
})

describe("start here", () => {
  const startHere = {
    ...answer,
    document: {
      id: "start-here",
      kind: "start-here",
      path: "start-here.md",
      blob: "abcdef1234567890abcdef1234567890abcdef12",
      title: "Start here",
      summary: "The short path through this catalog.",
      status: null,
      owner: "person/guneet",
      body: [
        {
          heading: "Start here",
          level: 1,
          anchor: "start-here",
          text: "# Start here\n\nAsk in #infra.\n",
        },
      ],
      problems: [],
    },
  }

  it("is start-here.md rendered as a page, its people's steps first", async () => {
    const fake = fakeApi({
      catalogTree: () => Promise.resolve(tree),
      catalogDocument: () => Promise.resolve(startHere),
      catalogStartHere: (_w, path) =>
        Promise.resolve({
          ...answer,
          start_here: {
            path,
            title: "Start here",
            summary: null,
            document: { path: "start-here.md", blob: startHere.document.blob },
            steps: [
              {
                to: "machine/musashi",
                note: "The production host.",
                entity: {
                  id: "machine/musashi",
                  type: "machine",
                  title: "Musashi",
                  summary: null,
                  status: "active",
                  owner: null,
                },
              },
              { list: "discrepancies", note: "What disagrees." },
              { list: "recent-changes", note: "What changed." },
            ],
          },
        }),
    })
    renderApp(base, fake)
    expect(
      await screen.findByRole("heading", { level: 1, name: "Start here" }),
    ).toBeTruthy()
    expect(
      screen.getByText("The short path through this catalog."),
    ).toBeTruthy()
    const main = within(screen.getByRole("main"))
    const steps = main.getAllByRole("listitem")
    expect(steps.map((s) => s.textContent)).toEqual([
      "1MusashiThe production host.",
      "2These disagreeWhat disagrees.",
      "3Recent changesWhat changed.",
    ])
    expect(
      main.getByRole("link", { name: "These disagree" }).getAttribute("href"),
    ).toBe(`${base}/needs-attention`)
    expect(
      main.getByRole("link", { name: "Recent changes" }).getAttribute("href"),
    ).toBe(`${base}/changes`)
    expect(main.getByText("Ask in #infra.")).toBeTruthy()
    expect(fake.catalogStartHere).toHaveBeenCalledWith(workspaceId, "people")
    expect(
      main.getByRole("link", { name: "History" }).getAttribute("href"),
    ).toBe(`${base}/history/start-here`)
  })

  it("shows the README without start-here.md", async () => {
    renderApp(
      base,
      fakeApi({
        catalogTree: () => Promise.resolve(tree),
        catalogReadme: () =>
          Promise.resolve({
            ...answer,
            readme: {
              path: "README.md",
              text: "# Our catalog\n\nAsk **Guneet** first.\n\n## Folders\n\nOne per kind.\n",
              size: 60,
            },
          }),
      }),
    )
    expect(
      await screen.findByRole("heading", { level: 1, name: "Our catalog" }),
    ).toBeTruthy()
    expect(screen.getByText(/From the catalog's README.md/)).toBeTruthy()
    expect(
      screen.getByRole("heading", { level: 2, name: "Folders" }),
    ).toBeTruthy()
  })

  it("says how to get one without either, or while the repository can't be read", async () => {
    renderApp(
      base,
      fakeApi({
        catalogTree: () => Promise.resolve(tree),
        catalogReadme: unavailable,
      }),
    )
    expect(
      await screen.findByText(
        "There's no Start here page yet. Open a page from the folders, or ask an agent to write start-here.md.",
      ),
    ).toBeTruthy()
  })

  it("says what to do first in an empty catalog, whatever its README says", async () => {
    const fake = fakeApi()
    renderApp(base, fake)
    expect(
      await screen.findByRole("heading", { name: "Your catalog is empty." }),
    ).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Set up an agent" })
        .getAttribute("href"),
    ).toBe("/account/agents/setup")
    expect(fake.catalogReadme).not.toHaveBeenCalled()
  })
})

describe("a page's history", () => {
  it("lists its changes by day, newest first, with the short commit ID", async () => {
    const older = "a".repeat(40)
    const fake = fakeApi({
      catalogHistory: (_w, _id, options) =>
        Promise.resolve(
          options?.after
            ? history([
                {
                  message: "Import the catalog",
                  minutesAgo: 60 * 24 * 30,
                  commit: "c".repeat(40),
                },
              ])
            : history(
                [
                  {
                    message:
                      "Recheck the data disk \u202Egnp.exe\n\nAfter the resize.",
                    minutesAgo: 1,
                    commit: "b".repeat(40),
                  },
                  {
                    message: "Add Musashi",
                    minutesAgo: 60 * 26,
                    commit: older,
                  },
                ],
                older,
              ),
        ),
    })
    renderApp(`${base}/history/machine/musashi`, fake)
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "History of Musashi",
      }),
    ).toBeTruthy()
    const days = () =>
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    expect(days()[0]).toBe("Today")
    const first = screen.getAllByRole("listitem")[0]!
    expect(first.textContent).toContain(
      "Recheck the data disk ⟨U+202E⟩ (hidden character: right-to-left override) gnp.exe",
    )
    expect(first.textContent).toContain("After the resize.")
    expect(first.textContent).toContain("bbbbbbb")
    expect(first.textContent).not.toContain("b".repeat(8))

    await userEvent.click(
      screen.getByRole("button", { name: "Show older changes" }),
    )
    expect(await screen.findByText("Import the catalog")).toBeTruthy()
    expect(fake.catalogHistory).toHaveBeenLastCalledWith(
      workspaceId,
      "machine/musashi",
      { after: older },
    )
    expect(
      screen.queryByRole("button", { name: "Show older changes" }),
    ).toBeNull()
    expect(
      screen.getByRole("link", { name: "this page" }).getAttribute("href"),
    ).toBe(musashiPath)
  })

  it("says when the repository can't be read right now", async () => {
    renderApp(
      `${base}/history/machine/musashi`,
      fakeApi({ catalogHistory: unavailable }),
    )
    expect(
      await screen.findByText(
        "This isn't available right now. Try again in a minute.",
      ),
    ).toBeTruthy()
  })
})

describe("a page's source", () => {
  it("shows the file as it is, hidden characters marked, and copies it exactly", async () => {
    const text = "---\nid: machine/musashi\ntitle: Musashi \u202Eevil\n---\n"
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    renderApp(
      `${base}/source/machine/musashi`,
      fakeApi({
        catalogSource: () =>
          Promise.resolve({
            ...answer,
            title: "Musashi",
            source: { path: "machine/musashi.md", text, size: text.length },
          }),
      }),
    )
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Source of Musashi",
      }),
    ).toBeTruthy()
    const code = screen.getByRole("main").querySelector("pre")!
    expect(code.textContent).toContain(
      "title: Musashi ⟨U+202E⟩ (hidden character: right-to-left override) evil\n",
    )
    await userEvent.click(screen.getByRole("button", { name: "Copy" }))
    expect(writeText).toHaveBeenCalledWith(text)
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy()
  })

  it("says when a file is too large to show", async () => {
    renderApp(
      `${base}/source/machine/musashi`,
      fakeApi({
        catalogSource: () =>
          Promise.resolve({
            ...answer,
            title: "Musashi",
            source: { path: "machine/musashi.md", text: null, size: 2_000_000 },
          }),
      }),
    )
    expect(await screen.findByText(/too large to show here/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull()
  })
})

describe("recent changes", () => {
  const change = (
    subject: string,
    minutesAgo: number,
    commit: string,
    pages: { path: string; id: string | null; title: string | null }[],
    page_count = pages.length,
  ) => ({
    commit: commit.repeat(40),
    subject,
    body: "",
    time: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    merge: false,
    pushed_by: null,
    pages,
    page_count,
    page_count_at_least: false,
  })
  const projects = [1, 2, 3].map((i) => ({
    path: `project/p${i}.md`,
    id: `project/p${i}`,
    title: `Project ${i}`,
  }))

  it("lists main's changes by day, each with the pages it changed by title", async () => {
    const fake = fakeApi({
      catalogChanges: (_w, options) =>
        Promise.resolve(
          options?.after
            ? {
                ...answer,
                changes: [
                  change("Import the catalog", 60 * 24 * 40, "e", [
                    projects[0]!,
                  ]),
                ],
                next_after: null,
              }
            : {
                ...answer,
                changes: [
                  change(
                    "Add five projects \u202Egnp.exe",
                    1,
                    "a",
                    projects,
                    5,
                  ),
                  change("Recheck Musashi and Daedalus", 2, "b", [
                    {
                      path: "machine/musashi.md",
                      id: "machine/musashi",
                      title: "Musashi",
                    },
                    {
                      path: "machine/daedalus.md",
                      id: "machine/daedalus",
                      title: "Daedalus",
                    },
                  ]),
                  change("Write the README", 3, "c", [
                    { path: "README.md", id: null, title: null },
                  ]),
                ],
                next_after: "opaque-cursor",
              },
        ),
    })
    renderApp(base, fake)
    await userEvent.click(
      within(await screen.findByRole("complementary")).getByRole("link", {
        name: "Recent changes",
      }),
    )
    expect(currentPath()).toBe(`${base}/changes`)
    expect(
      await screen.findByRole("heading", { level: 1, name: "Recent changes" }),
    ).toBeTruthy()
    expect(screen.getAllByRole("heading", { level: 2 })[0]!.textContent).toBe(
      "Today",
    )
    const items = within(screen.getByRole("main")).getAllByRole("listitem")
    expect(items[0]!.textContent).toContain(
      "Add five projects ⟨U+202E⟩ (hidden character: right-to-left override) gnp.exe",
    )
    expect(items[0]!.textContent).toContain("aaaaaaa")
    expect(items[0]!.textContent).toContain(
      "Project 1, Project 2, Project 3 and 2 more",
    )
    expect(
      within(items[0]!)
        .getByRole("link", { name: "Project 2" })
        .getAttribute("href"),
    ).toBe(`${base}/p/project/p2`)
    expect(items[1]!.textContent).toContain("Musashi and Daedalus")
    expect(items[2]!.textContent).toContain("README.md")
    expect(within(items[2]!).queryByRole("link")).toBeNull()

    await userEvent.click(
      screen.getByRole("button", { name: "Show older changes" }),
    )
    expect(await screen.findByText("Import the catalog")).toBeTruthy()
    expect(fake.catalogChanges).toHaveBeenLastCalledWith(workspaceId, {
      after: "opaque-cursor",
    })
    expect(
      screen.queryByRole("button", { name: "Show older changes" }),
    ).toBeNull()
  })

  it("says when the repository can't be read right now", async () => {
    renderApp(`${base}/changes`, fakeApi({ catalogChanges: unavailable }))
    expect(
      await screen.findByText(
        "This isn't available right now. Try again in a minute.",
      ),
    ).toBeTruthy()
  })
})
