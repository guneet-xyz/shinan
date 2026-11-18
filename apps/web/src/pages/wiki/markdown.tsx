import { Fragment, useMemo } from "react"
import type { ReactNode } from "react"
import { Link } from "react-router"

import { createMarkdown } from "@shinan/markdown"
import type { Token } from "@shinan/markdown"

import { cn } from "@/lib/utils"

import { linkTarget, sectionElementId } from "./links"

/**
 * Catalog Markdown, rendered in the browser into React elements (build
 * plan M2-7; security checklist 10.3). It reads with Shinan's one Markdown
 * configuration (`createMarkdown()`, the same the server's body model
 * uses, so the two agree on headings and links) and never produces HTML
 * text: raw HTML is shown as text, there are no `style` attributes (table
 * alignment is a class), images are links to the image, and only these
 * destinations are followed:
 *
 * - `http:`, `https:` and `mailto:` addresses;
 * - entity references (catalog §2.4), such as `machine/musashi#cautions`,
 *   rewritten to the wiki's own page;
 * - `#section` links within the page.
 *
 * Anything else (`javascript:`, `data:`, relative paths) is shown as its
 * text, not as a link. markdown-it already refuses the dangerous schemes;
 * the allow-list here is the second, stricter guard.
 */
const markdown = createMarkdown()

export interface MarkdownProps {
  text: string
  /** The path of an entity's wiki page, for entity references. */
  entityPath: (id: string) => string
  /**
   * The anchors of the body's headings, in order (from the agent index), so
   * each heading's element ID is the section's anchor.
   */
  anchors?: readonly (string | null)[]
  /** Added to every heading's level, so a body's `#` sits under the page's own headings. */
  headingOffset?: number
  className?: string
}

export function Markdown(props: MarkdownProps) {
  const tokens = useMemo(() => markdown.parse(props.text, {}), [props.text])
  const context: RenderContext = {
    entityPath: props.entityPath,
    anchors: props.anchors ?? [],
    heading: 0,
    offset: props.headingOffset ?? 2,
  }
  return (
    <div className={cn("flex flex-col gap-3 text-sm/6", props.className)}>
      {renderBlocks(tokens, 0, tokens.length, context)}
    </div>
  )
}

interface RenderContext {
  entityPath: (id: string) => string
  anchors: readonly (string | null)[]
  /** How many headings have been rendered, to match them with anchors. */
  heading: number
  offset: number
}

/** The position of the token that closes the one opened at `start`. */
function closing(tokens: Token[], start: number, end: number): number {
  let depth = 0
  for (let i = start; i < end; i++) {
    depth += tokens[i]!.nesting
    if (depth === 0) return i
  }
  return end - 1
}

function renderBlocks(
  tokens: Token[],
  start: number,
  end: number,
  context: RenderContext,
): ReactNode[] {
  const nodes: ReactNode[] = []
  let i = start
  while (i < end) {
    const token = tokens[i]!
    if (token.nesting === 1) {
      const close = closing(tokens, i, end)
      nodes.push(renderBlock(tokens, i, close, context))
      i = close + 1
      continue
    }
    nodes.push(renderLeaf(token, i, context))
    i++
  }
  return nodes
}

function renderLeaf(token: Token, key: number, context: RenderContext) {
  switch (token.type) {
    case "inline":
      return (
        <Fragment key={key}>
          {renderInline(token.children ?? [], context, false)}
        </Fragment>
      )
    case "code_block":
    case "fence":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs/5"
        >
          <code>{token.content}</code>
        </pre>
      )
    case "hr":
      return <hr key={key} className="border-border" />
    default:
      // `html: false` means there are no HTML tokens; anything unexpected
      // is shown as the text it holds.
      return token.content ? <p key={key}>{token.content}</p> : null
  }
}

function renderBlock(
  tokens: Token[],
  open: number,
  close: number,
  context: RenderContext,
): ReactNode {
  const token = tokens[open]!
  const children = () => renderBlocks(tokens, open + 1, close, context)
  const key = open
  switch (token.type) {
    case "paragraph_open":
      // A tight list's paragraphs are not shown as paragraphs.
      return token.hidden ? (
        <Fragment key={key}>{children()}</Fragment>
      ) : (
        <p key={key}>{children()}</p>
      )
    case "heading_open": {
      const level = Math.min(6, Number(token.tag.slice(1)) + context.offset)
      // The body is split into sections at its top-level headings only, as
      // the server's body model does.
      const anchor =
        token.level === 0 ? (context.anchors[context.heading++] ?? null) : null
      const Heading = `h${level}` as "h3"
      return (
        <Heading
          key={key}
          id={anchor ? sectionElementId(anchor) : undefined}
          className={cn(
            "scroll-mt-20 font-semibold tracking-tight",
            level <= 3 ? "mt-2 text-lg" : level === 4 ? "text-base" : "text-sm",
          )}
        >
          {children()}
        </Heading>
      )
    }
    case "blockquote_open":
      return (
        <blockquote
          key={key}
          className="flex flex-col gap-3 border-l-2 pl-4 text-muted-foreground"
        >
          {children()}
        </blockquote>
      )
    case "bullet_list_open":
      return (
        <ul key={key} className="flex list-disc flex-col gap-1 pl-6">
          {children()}
        </ul>
      )
    case "ordered_list_open": {
      const start = Number(attribute(token, "start") ?? 1)
      return (
        <ol
          key={key}
          start={Number.isFinite(start) ? start : undefined}
          className="flex list-decimal flex-col gap-1 pl-6"
        >
          {children()}
        </ol>
      )
    }
    case "list_item_open":
      return (
        <li key={key} className="[&>p+p]:mt-2">
          {children()}
        </li>
      )
    case "table_open":
      return (
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            {children()}
          </table>
        </div>
      )
    case "thead_open":
      return <thead key={key}>{children()}</thead>
    case "tbody_open":
      return <tbody key={key}>{children()}</tbody>
    case "tr_open":
      return (
        <tr key={key} className="border-b">
          {children()}
        </tr>
      )
    case "th_open":
    case "td_open": {
      const Cell = token.type === "th_open" ? "th" : "td"
      return (
        <Cell
          key={key}
          className={cn(
            "px-2 py-1 align-top",
            Cell === "th" && "font-semibold",
            alignment(attribute(token, "class")),
          )}
        >
          {children()}
        </Cell>
      )
    }
    default:
      return <Fragment key={key}>{children()}</Fragment>
  }
}

function attribute(token: Token, name: string): string | null {
  const value = token.attrGet(name)
  return value === null ? null : String(value)
}

/** Only the alignment classes `createMarkdown()` sets, never anything else. */
function alignment(value: string | null): string | undefined {
  return value === "align-left" ||
    value === "align-center" ||
    value === "align-right"
    ? value
    : undefined
}

function renderInline(
  tokens: Token[],
  context: RenderContext,
  inLink: boolean,
): ReactNode[] {
  const nodes: ReactNode[] = []
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]!
    if (token.nesting === 1) {
      const close = closing(tokens, i, tokens.length)
      const inner = renderInline(
        tokens.slice(i + 1, close),
        context,
        inLink || token.type === "link_open",
      )
      nodes.push(wrapInline(token, i, inner, context))
      i = close + 1
      continue
    }
    switch (token.type) {
      case "text":
      case "text_special":
        nodes.push(token.content)
        break
      case "softbreak":
        nodes.push("\n")
        break
      case "hardbreak":
        nodes.push(<br key={i} />)
        break
      case "code_inline":
        nodes.push(
          <code
            key={i}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
          >
            {token.content}
          </code>,
        )
        break
      case "image": {
        // An image is a link to it, with its alternative text: images from
        // elsewhere are blocked by the Content Security Policy, and the
        // catalog stores none.
        // Inside a link it is only its text, since a link cannot hold one.
        const src = attribute(token, "src") ?? ""
        const alt = plainText(token.children ?? []) || src
        nodes.push(inLink ? alt : renderLink(src, alt, i, context))
        break
      }
      default:
        if (token.content) nodes.push(token.content)
    }
    i++
  }
  return nodes
}

function wrapInline(
  token: Token,
  key: number,
  inner: ReactNode[],
  context: RenderContext,
): ReactNode {
  switch (token.type) {
    case "em_open":
      return <em key={key}>{inner}</em>
    case "strong_open":
      return (
        <strong key={key} className="font-semibold">
          {inner}
        </strong>
      )
    case "s_open":
      return <s key={key}>{inner}</s>
    case "link_open":
      return renderLink(attribute(token, "href") ?? "", inner, key, context)
    default:
      return <Fragment key={key}>{inner}</Fragment>
  }
}

const linkClass =
  "font-medium text-primary underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-3 focus-visible:ring-ring rounded-sm"

function renderLink(
  destination: string,
  children: ReactNode,
  key: number,
  context: RenderContext,
): ReactNode {
  const target = linkTarget(destination)
  if (!target) return <Fragment key={key}>{children}</Fragment>
  switch (target.kind) {
    case "external":
      return (
        <a
          key={key}
          href={target.href}
          rel="noreferrer noopener"
          className={linkClass}
        >
          {children}
        </a>
      )
    case "section":
      return (
        <a
          key={key}
          href={`#${sectionElementId(target.anchor)}`}
          className={linkClass}
        >
          {children}
        </a>
      )
    case "entity":
      return (
        <Link
          key={key}
          to={
            context.entityPath(target.id) +
            (target.anchor ? `#${sectionElementId(target.anchor)}` : "")
          }
          className={linkClass}
        >
          {children}
        </Link>
      )
  }
}

function plainText(tokens: Token[]): string {
  return tokens
    .map((t) =>
      t.children
        ? plainText(t.children)
        : t.type === "softbreak"
          ? " "
          : t.content,
    )
    .join("")
}
