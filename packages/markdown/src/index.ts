import markdownIt from "markdown-it"
import type { MarkdownIt, Token } from "markdown-it"

/**
 * The one Markdown configuration Shinan reads catalog bodies with: the
 * server's body model (sections, anchors, links) and the catalog pages' renderer
 * use it alike, so they agree on what is a heading and what is a link
 * (catalog §2.5, human experience: an entity page).
 *
 * - CommonMark, plus GitHub-style tables and strikethrough, which catalog
 *   documents copied from the `workspace` repository use.
 * - `html: false`: raw HTML is shown as text, never rendered.
 * - No linkify (bare addresses do not become links) and no typographer
 *   (text is shown as written).
 * - `maxNesting: 100`. markdown-it silently stops reading where blocks nest
 *   deeper than this; the server's body model notices and refuses such a
 *   body (catalog §2.1), so no stored document is cut off when rendered.
 *
 * markdown-it reads in time that grows about linearly with the text, on
 * the hostile inputs that made the earlier parser quadratic (#102).
 */
export const markdownOptions = {
  html: false,
  linkify: false,
  typographer: false,
  maxNesting: 100,
} as const

/**
 * Link and image destinations that are never made clickable. markdown-it
 * refuses the first three itself but lets `data:` images through.
 */
const refusedSchemes = /^(?:javascript|vbscript|file|data):/

/** The classes table cells get instead of `style="text-align: …"`. */
export const alignmentClasses = {
  left: "align-left",
  center: "align-center",
  right: "align-right",
} as const

/**
 * A new parser with Shinan's configuration. Each caller gets its own
 * instance.
 *
 * Its HTML suits Shinan's Content Security Policy, which allows no inline
 * styles and images only from Shinan itself: table alignment is a class
 * (see `alignmentClasses`), an image is shown as a link to it (its
 * alternative text as the link text), and `javascript:`, `vbscript:`,
 * `file:` and `data:` destinations are never links.
 */
export function createMarkdown(): MarkdownIt {
  const md = markdownIt("commonmark", markdownOptions)
  md.enable(["table", "strikethrough"])

  md.validateLink = (url) => !refusedSchemes.test(url.trim().toLowerCase())

  md.core.ruler.push("alignment_classes", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "th_open" && token.type !== "td_open") continue
      const style = token.attrGet("style")
      if (style === null) continue
      const align = String(style)
      token.attrs = (token.attrs ?? []).filter(([name]) => name !== "style")
      const side = /text-align:\s*(left|center|right)/.exec(align)?.[1]
      if (side)
        token.attrJoin(
          "class",
          alignmentClasses[side as keyof typeof alignmentClasses],
        )
    }
  })

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx] as Token
    const alt = self.renderInlineAsText(token.children ?? [], options, env)
    const src = String(token.attrGet("src") ?? "")
    const text = md.utils.escapeHtml(alt || src)
    // A link cannot hold another link, so inside one the image is its text.
    if (insideLink(tokens, idx)) return text
    return `<a href="${md.utils.escapeHtml(src)}">${text}</a>`
  }
  return md
}

function insideLink(tokens: Token[], idx: number): boolean {
  let depth = 0
  for (let i = 0; i < idx; i++) {
    if (tokens[i]?.type === "link_open") depth++
    else if (tokens[i]?.type === "link_close") depth--
  }
  return depth > 0
}

export type {
  Env,
  MarkdownIt,
  StateBlock,
  StateInline,
  Token,
} from "markdown-it"
