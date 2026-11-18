import { readdirSync, readFileSync } from "node:fs"
import { join, sep } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The theme's colours meet WCAG AA in both themes: text 4.5:1 against what
 * it sits on, and focus indicators 3:1 (WCAG 1.4.3, 1.4.11, 2.4.7). The
 * pairs are the ones the screens use; a new pairing gets a line here.
 */

type Rgba = [number, number, number, number]

const css = readFileSync(join(import.meta.dirname, "index.css"), "utf8")

function block(start: string): string {
  const from = css.indexOf(start)
  if (from < 0) throw new Error(`No ${start} in index.css`)
  return css.slice(from, css.indexOf("}", from))
}

function variables(source: string): Map<string, string> {
  return new Map(
    [...source.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!]),
  )
}

const themes = {
  light: variables(block(":root {\n  color-scheme: light")),
  dark: variables(block(":root {\n    color-scheme: dark")),
}

function parseOklch(value: string): Rgba {
  const m = value.match(
    /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/,
  )
  if (!m) throw new Error(`Not an oklch() colour: ${value}`)
  const [l, c, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180]
  const alpha = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1)
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((v) => Math.min(1, Math.max(0, v)))
  const [r, g, bl] = linear.map((v) =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055,
  )
  return [r!, g!, bl!, alpha]
}

function color(theme: Map<string, string>, name: string, opacity = 1): Rgba {
  const value = theme.get(name)
  if (!value) throw new Error(`No --${name}`)
  const [r, g, b, a] = parseOklch(value)
  return [r, g, b, a * opacity]
}

/** `top` drawn over the layers below it, last first. */
function over(top: Rgba, ...below: Rgba[]): Rgba {
  const base = below.length > 1 ? over(below[0]!, ...below.slice(1)) : below[0]!
  const a = top[3]
  return [0, 1, 2]
    .map((i) => top[i]! * a + base[i]! * (1 - a))
    .concat(1) as Rgba
}

function luminance([r, g, b]: Rgba): number {
  const lin = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(fg: Rgba, bg: Rgba): number {
  const [a, b] = [luminance(over(fg, bg)), luminance(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe.each(Object.entries(themes))("the %s theme", (name, theme) => {
  const c = (variable: string, opacity?: number) =>
    color(theme, variable, opacity)
  const dark = name === "dark"
  const background = c("background")
  const card = c("card")
  const popover = c("popover")
  const muted = c("muted")
  // Destructive buttons and badges: bg-destructive/10 (light) or /20 (dark).
  const destructiveFill = c("destructive", dark ? 0.2 : 0.1)
  // The in-place confirmations (`Confirm`) sit on bg-destructive/5.
  const confirm = over(c("destructive", 0.05), card)

  it.each([
    ["text on the page", c("foreground"), background],
    ["text on cards", c("card-foreground"), card],
    ["text in dialogs and menus", c("popover-foreground"), popover],
    ["muted text on the page", c("muted-foreground"), background],
    ["muted text on cards", c("muted-foreground"), card],
    ["muted text in dialogs and menus", c("muted-foreground"), popover],
    ["inactive settings tabs", c("foreground", 0.7), muted],
    [
      "roles in the highlighted switcher item",
      c("foreground", 0.7),
      over(c("accent"), popover),
    ],
    ["primary buttons and badges", c("primary-foreground"), c("primary")],
    ["secondary badges", c("secondary-foreground"), c("secondary")],
    ["outline badges and buttons on cards", c("foreground"), card],
    [
      "destructive buttons on cards",
      c("destructive"),
      over(destructiveFill, card),
    ],
    [
      "destructive buttons in dialogs",
      c("destructive"),
      over(destructiveFill, popover),
    ],
    [
      "destructive buttons in a confirmation",
      c("destructive"),
      over(destructiveFill, confirm),
    ],
    ["confirmation text", c("card-foreground"), confirm],
    ["error alerts", c("destructive", 0.9), card],
  ])("has readable %s (4.5:1)", (_, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    ["the page", background],
    ["cards", card],
    ["dialogs and menus", popover],
    ["the settings tabs", muted],
  ])("has a focus ring that stands out on %s (3:1)", (_, bg) => {
    expect(contrast(c("ring"), bg)).toBeGreaterThanOrEqual(3)
  })

  it("has a destructive focus ring that stands out on cards (3:1)", () => {
    expect(contrast(c("destructive"), card)).toBeGreaterThanOrEqual(3)
  })
})

describe("the focus styles", () => {
  it("are never faded", () => {
    const sources = [css, ...componentSources()]
    for (const source of sources) {
      expect(source).not.toMatch(/(ring|outline)-ring\/\d+/)
      expect(source).not.toMatch(/focus-visible:ring-destructive\/\d+/)
    }
  })

  it("outline plain links", () => {
    expect(css).toMatch(
      /a:focus-visible\s*\{\s*@apply outline-2 outline-offset-2;/,
    )
  })
})

/**
 * Every component and screen of the web app: the shadcn/ui components, the
 * shell (`Layout.tsx`), the workspace layout and every page, including ones
 * added later. Tests are left out.
 */
function componentSources(): string[] {
  const files = (
    readdirSync(import.meta.dirname, { recursive: true }) as string[]
  ).filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
  // The scan covers what it must, however the folders change.
  for (const required of [
    "components/ui/button.tsx",
    "components/ui/dialog.tsx",
    "components/Layout.tsx",
    "pages/workspace/WorkspaceLayout.tsx",
  ])
    expect(files.map((f) => f.split(sep).join("/"))).toContain(required)
  return files.map((file) =>
    readFileSync(join(import.meta.dirname, file), "utf8"),
  )
}
