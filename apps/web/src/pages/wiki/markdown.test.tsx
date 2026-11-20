import { render } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import { ageText, entityPath, freshnessSummary, summaryParts } from "./format"
import { linkTarget } from "./links"
import { Markdown } from "./markdown"

function renderMarkdown(text: string, anchors: (string | null)[] = []) {
  return render(
    <MemoryRouter>
      <Markdown
        text={text}
        anchors={anchors}
        entityPath={(id) => `/w/1/wiki/e/${id}`}
      />
    </MemoryRouter>,
  ).container
}

describe("link destinations in catalog Markdown", () => {
  it.each([
    [
      "https://example.com/a",
      { kind: "external", href: "https://example.com/a" },
    ],
    ["HTTP://EXAMPLE.COM", { kind: "external", href: "HTTP://EXAMPLE.COM" }],
    [
      "mailto:a@example.com",
      { kind: "external", href: "mailto:a@example.com" },
    ],
    [
      "machine/musashi",
      { kind: "entity", id: "machine/musashi", anchor: null },
    ],
    [
      "machine/musashi#cautions",
      { kind: "entity", id: "machine/musashi", anchor: "cautions" },
    ],
    ["#cautions", { kind: "section", anchor: "cautions" }],
    [
      "schema/dns-zone",
      { kind: "entity", id: "schema/dns-zone", anchor: null },
    ],
    [
      "machine/musashi#identity-and-role",
      { kind: "entity", id: "machine/musashi", anchor: "identity-and-role" },
    ],
    ["start-here", { kind: "entity", id: "start-here", anchor: null }],
  ])("follows %s", (destination, target) => {
    expect(linkTarget(destination)).toEqual(target)
  })

  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "ftp://example.com",
    "/api/workspaces",
    "./x",
    "../x",
    "?q=1",
    "#",
    "",
    "musashi",
    "Machine/Musashi",
    // Only the ID form: no `.` or `..` segment, empty segment or extra `/`.
    "a/../../../api/account",
    "machine/../../../settings",
    "machine/../x",
    "a/./b",
    "a//b",
    "machine/musashi/x",
    "machine/%2e%2e",
    "machine/musashi.old",
    "machine/musashi#../../x",
    "#a/b",
    "Start-Here",
  ])("does not follow %j", (destination) => {
    expect(linkTarget(destination)).toBeNull()
  })
})

describe("the Markdown renderer", () => {
  it("gives top-level headings the sections' anchors, under the page's headings", () => {
    const container = renderMarkdown(
      "Intro\n\n# Musashi\n\n> # Quoted heading\n\n## Cautions\n\ntext\n",
      ["musashi", "cautions"],
    )
    const headings = [...container.querySelectorAll("h3, h4, h5")]
    expect(headings.map((h) => [h.tagName, h.id, h.textContent])).toEqual([
      ["H3", "section-musashi", "Musashi"],
      ["H3", "", "Quoted heading"],
      ["H4", "section-cautions", "Cautions"],
    ])
  })

  it("leads type schema and start-here references to their own pages", () => {
    expect(entityPath("1", "schema/dns-zone")).toBe("/w/1/wiki/types/dns-zone")
    expect(entityPath("1", "start-here")).toBe("/w/1/wiki/start-here")
    expect(entityPath("1", "machine/musashi")).toBe(
      "/w/1/wiki/e/machine/musashi",
    )
    const container = render(
      <MemoryRouter>
        <Markdown
          text="See the [domain type](schema/domain), [start here](start-here) and [its cautions](schema/domain#cautions)."
          entityPath={(id) => entityPath("1", id)}
        />
      </MemoryRouter>,
    ).container
    expect(
      [...container.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    ).toEqual([
      "/w/1/wiki/types/domain",
      "/w/1/wiki/start-here",
      "/w/1/wiki/types/domain#section-cautions",
    ])
  })

  it("shows a link that would leave the wiki as plain text", () => {
    const container = renderMarkdown(
      "[account](a/../../../api/account) and [settings](machine/../../../settings), but [Musashi](machine/musashi#cautions)",
    )
    expect(
      [...container.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    ).toEqual(["/w/1/wiki/e/machine/musashi#section-cautions"])
    expect(container.textContent).toBe("account and settings, but Musashi")
  })

  it("renders lists, code, emphasis and strikethrough without HTML", () => {
    const container = renderMarkdown(
      "- one\n- **two** and *three*\n\n3. a\n4. b\n\n```sh\n<b>raw</b>\n```\n\n~~gone~~ `code`",
    )
    expect(container.querySelectorAll("ul > li")).toHaveLength(2)
    expect(container.querySelector("ol")?.getAttribute("start")).toBe("3")
    expect(container.querySelector("strong")?.textContent).toBe("two")
    expect(container.querySelector("em")?.textContent).toBe("three")
    expect(container.querySelector("pre code")?.textContent).toBe(
      "<b>raw</b>\n",
    )
    expect(container.querySelector("b")).toBeNull()
    expect(container.querySelector("s")?.textContent).toBe("gone")
    // A tight list's items hold no paragraphs.
    expect(container.querySelector("li p")).toBeNull()
  })

  it("shows an image inside a link as its text, never a link in a link", () => {
    const container = renderMarkdown(
      "[![logo](https://example.com/logo.png)](https://example.com)",
    )
    const links = container.querySelectorAll("a")
    expect(links).toHaveLength(1)
    expect(links[0]!.textContent).toBe("logo")
    expect(links[0]!.querySelector("a")).toBeNull()
  })
})

describe("freshness in words", () => {
  it("says how long ago, never right or wrong", () => {
    expect(ageText(0)).toBe("checked today")
    expect(ageText(1)).toBe("checked yesterday")
    expect(ageText(3)).toBe("checked 3 days ago")
    expect(ageText(90)).toBe("checked 3 months ago")
    expect(ageText(800)).toBe("checked 2 years ago")
  })

  it("sums up an entity's facts in one line", () => {
    const now = Date.parse("2026-11-18T00:00:00Z")
    const fact = (
      status: "fresh" | "due" | "not-checked" | "none",
      age: number | null,
      state: "observed" | "unknown" | "planned" = "observed",
    ) => ({
      identity: `k${Math.random()}`,
      key: "k",
      state,
      many: false,
      relation: false,
      in_schema: true,
      check: null,
      freshness: {
        status,
        age_days: age,
        recheck_days: 30,
        due_at: null,
      },
    })
    const summary = freshnessSummary(
      [
        fact("fresh", 3),
        fact("due", 40),
        fact("not-checked", null, "unknown"),
        fact("none", null, "planned"),
      ],
      now,
    )
    expect(summary).toEqual({
      facts: 4,
      oldest_checked_at: new Date(now - 40 * 86_400_000).toISOString(),
      due: 1,
      not_checked: 1,
      unknown: 1,
    })
    expect(summaryParts(summary, now)).toEqual([
      "4 facts",
      "oldest checked 40 days ago",
      "1 due for recheck",
      "1 never checked",
      "1 unknown",
    ])
  })
})
