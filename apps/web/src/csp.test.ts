import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const webRoot = dirname(import.meta.dirname)

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory())
      return entry.name === "test" ? [] : sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : []
  })
}

/**
 * The server's Content Security Policy allows no inline script or style
 * (architecture §10.2), so the web app must have none, or its pages break.
 */
describe("the web app under the Content Security Policy", () => {
  it("has no inline script or style in its page", () => {
    const html = readFileSync(join(webRoot, "index.html"), "utf8")
    for (const script of html.match(/<script\b[^>]*>/g) ?? []) {
      expect(script).toMatch(/\bsrc=/)
    }
    expect(html).not.toMatch(/<style\b|\sstyle=|\son[a-z]+=/i)
  })

  it("turns off the <style> tags Base UI adds, and has their rules in its stylesheet", () => {
    const main = readFileSync(join(webRoot, "src", "main.tsx"), "utf8")
    expect(main).toMatch(/<CSPProvider disableStyleElements>/)
    const css = readFileSync(join(webRoot, "src", "index.css"), "utf8")
    expect(css).toMatch(
      /\.base-ui-disable-scrollbar\s*\{\s*scrollbar-width: none;/,
    )
  })

  it("writes no raw HTML, whose inline scripts and styles would be refused", () => {
    for (const file of sourceFiles(join(webRoot, "src"))) {
      const source = readFileSync(file, "utf8")
      expect(source, relative(webRoot, file)).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document\.write/,
      )
    }
  })
})

/**
 * Catalog Markdown is written by people and agents, and agents may have
 * read outside text, so it is hostile input (security checklist 10.3). The
 * wiki renders it into React elements: nothing in it can add a script, an
 * inline style or event handler, an image from elsewhere, or a link that
 * runs code.
 */
describe("catalog Markdown in the wiki", () => {
  const hostile = [
    "<script>alert(1)</script>",
    '<img src="https://evil.example/x.png" onerror="alert(1)">',
    '<p style="color: red" onclick="alert(1)">styled</p>',
    '<a href="javascript:alert(1)">html link</a>',
    "[js](javascript:alert(1))",
    "[JS](JAVASCRIPT:alert(1))",
    "[spaced]( javascript:alert(1) )",
    "[vb](vbscript:msgbox)",
    "[file](file:///etc/passwd)",
    "[data](data:text/html;base64,PHNjcmlwdD4=)",
    "![tracker](https://evil.example/pixel.png)",
    "![data image](data:image/png;base64,iVBORw0KGgo=)",
    "[relative](../../etc)",
    "[root](/api/workspaces)",
    "<javascript:alert(1)>",
    "<https://example.com>",
    '[titled](https://example.com "x\\" onmouseover=\\"alert(1)")',
    "| a | b |\n|:-:|--:|\n| 1 | 2 |",
    "<style>body{display:none}</style>",
    "<iframe src=https://evil.example></iframe>",
    "[entity](machine/musashi#cautions) and [section](#cautions)",
    "[mail](mailto:guneet@example.com)",
    "[up](a/../../../../../../api/account)",
    "[settings](machine/../../../settings)",
    "[dot](a/./b) [empty](a//b) [encoded](machine/%2e%2e/x) [deeper](machine/musashi/../x)",
    "[odd anchor](machine/musashi#../../x)",
  ].join("\n\n")

  async function render() {
    const { render: renderReact } = await import("@testing-library/react")
    const { MemoryRouter } = await import("react-router")
    const { Markdown } = await import("./pages/wiki/markdown")
    const { createElement } = await import("react")
    return renderReact(
      createElement(
        MemoryRouter,
        null,
        createElement(Markdown, {
          text: hostile,
          entityPath: (id: string) => `/w/1/wiki/e/${id}`,
        }),
      ),
    ).container
  }

  it("renders no script, style, event handler, frame or image", async () => {
    const container = await render()
    expect(
      container.querySelectorAll("script, style, iframe, img, object, embed"),
    ).toHaveLength(0)
    for (const element of container.querySelectorAll("*")) {
      for (const attribute of element.attributes) {
        expect(attribute.name, element.outerHTML).not.toMatch(/^on|^style$/i)
      }
    }
    // Raw HTML is shown as text.
    expect(container.textContent).toContain("<script>alert(1)</script>")
  })

  it("links only to web and mail addresses, entity pages and sections", async () => {
    const container = await render()
    const hrefs = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    )
    for (const href of hrefs)
      expect(href).toMatch(
        /^(?:https?:|mailto:|\/w\/1\/wiki\/e\/[a-z0-9-]+\/[a-z0-9-]+(?:#section-[\p{L}\p{N}\p{M}_-]+)?$|#section-[\p{L}\p{N}\p{M}_-]+$)/u,
      )
    expect(hrefs.some((h) => h!.includes(".."))).toBe(false)
    expect(hrefs).toContain("/w/1/wiki/e/machine/musashi#section-cautions")
    expect(hrefs).toContain("#section-cautions")
    expect(hrefs).toContain("mailto:guneet@example.com")
    // An image is a link to it, never an image.
    expect(hrefs).toContain("https://evil.example/pixel.png")
    for (const text of [
      "js",
      "JS",
      "vb",
      "file",
      "data",
      "relative",
      "root",
      "up",
      "settings",
      "dot",
      "empty",
      "encoded",
      "deeper",
      "odd anchor",
    ])
      expect(container.textContent).toContain(text)
    expect(hrefs.some((h) => /javascript|vbscript|data:|file:/i.test(h!))).toBe(
      false,
    )
  })

  it("aligns table cells with classes, not styles", async () => {
    const container = await render()
    const cells = [...container.querySelectorAll("th, td")]
    expect(cells.map((c) => c.getAttribute("class") ?? "").join(" ")).toMatch(
      /align-center[\s\S]*align-right/,
    )
  })
})
