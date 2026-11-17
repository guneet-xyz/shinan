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
