import { render } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import {
  ageText,
  andList,
  byText,
  countWord,
  entityPath,
  relativeTime,
} from "./format"
import { linkTarget } from "./links"
import { Markdown } from "./markdown"

function renderMarkdown(text: string, anchors: (string | null)[] = []) {
  return render(
    <MemoryRouter>
      <Markdown
        text={text}
        anchors={anchors}
        entityPath={(id) => `/w/1/catalog/p/${id}`}
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

  it("leads type schema and start-here references to their pages", () => {
    expect(entityPath("1", "schema/dns-zone")).toBe(
      "/w/1/catalog/p/schema/dns-zone",
    )
    expect(entityPath("1", "start-here")).toBe("/w/1/catalog")
    expect(entityPath("1", "machine/musashi")).toBe(
      "/w/1/catalog/p/machine/musashi",
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
      "/w/1/catalog/p/schema/domain",
      "/w/1/catalog",
      "/w/1/catalog/p/schema/domain#section-cautions",
    ])
  })

  it("shows a link that would leave the wiki as plain text", () => {
    const container = renderMarkdown(
      "[account](a/../../../api/account) and [settings](machine/../../../settings), but [Musashi](machine/musashi#cautions)",
    )
    expect(
      [...container.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    ).toEqual(["/w/1/catalog/p/machine/musashi#section-cautions"])
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

  it("says when something happened in words", () => {
    const now = Date.parse("2026-11-18T12:00:00Z")
    const at = (minutes: number) =>
      new Date(now - minutes * 60_000).toISOString()
    expect(relativeTime(at(0), now)).toBe("just now")
    expect(relativeTime(at(1), now)).toBe("a minute ago")
    expect(relativeTime(at(12), now)).toBe("12 minutes ago")
    expect(relativeTime(at(60), now)).toBe("an hour ago")
    expect(relativeTime(at(150), now)).toBe("2 hours ago")
    expect(relativeTime(at(26 * 60), now)).toBe("yesterday")
    expect(relativeTime(at(5 * 24 * 60), now)).toBe("5 days ago")
  })

  it("puts check authors, counts and lists in words", () => {
    expect(byText("guneet via opencode-daedalus")).toBe(
      "guneet, through opencode-daedalus",
    )
    expect(byText("guneet")).toBe("guneet")
    expect(countWord(2)).toBe("Two")
    expect(countWord(12)).toBe("12")
    expect(andList(["a", "b", "c"])).toBe("a, b and c")
  })
})
