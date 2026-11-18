import markdownIt from "markdown-it"
import type { MarkdownIt } from "markdown-it"

/**
 * The one Markdown configuration Shinan reads catalog bodies with: the
 * server's body model (sections, anchors, links) and the wiki's renderer
 * use it alike, so they agree on what is a heading and what is a link
 * (catalog §2.5, human experience: an entity page).
 *
 * - CommonMark, plus GitHub-style tables and strikethrough, which catalog
 *   documents copied from the `workspace` repository use.
 * - `html: false`: raw HTML is shown as text, never rendered.
 * - No linkify (bare addresses do not become links) and no typographer
 *   (text is shown as written).
 * - `maxNesting: 100`: well above the deepest nesting the body limits allow
 *   (catalog §2.1: 32 quote or list markers on a line, each list using two
 *   levels), so nothing a stored document holds is cut off.
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

/** A new parser with Shinan's configuration. Each caller gets its own instance. */
export function createMarkdown(): MarkdownIt {
  const md = markdownIt("commonmark", markdownOptions)
  md.enable(["table", "strikethrough"])
  return md
}

export type { MarkdownIt, StateBlock, StateInline, Token } from "markdown-it"
