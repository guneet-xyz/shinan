import { Link } from "react-router"

import type { CatalogEntitySummary } from "@shinan/api-client"

import { cn } from "@/lib/utils"

import { usePageTitle } from "../../catalog-tree"
import { entityPath, isWebAddress, listLinkClass } from "./format"
import { TitleText, VisibleText } from "./VisibleText"

/*
 * Links on a catalog page: to another page by its title, and to a web
 * address. Text that is neither is shown as it is, hidden characters
 * marked.
 */

/**
 * A link to a page by its title when known (from the answer, else the
 * sidebar's tree), else its ID (product brief on #169: no IDs in brackets
 * after links).
 */
export function EntityLink(props: {
  workspaceId: string
  id: string
  entity?: CatalogEntitySummary | null
  className?: string
}) {
  const known = usePageTitle(props.id)
  return (
    <Link
      to={entityPath(props.workspaceId, props.id)}
      className={cn(listLinkClass, "wrap-anywhere", props.className)}
    >
      <TitleText title={props.entity?.title ?? known ?? null} id={props.id} />
    </Link>
  )
}

/** A web address as a link; any other text as it is. */
export function MaybeLink(props: { text: string }) {
  if (!isWebAddress(props.text))
    return (
      <span className="wrap-anywhere">
        <VisibleText text={props.text} oneLine />
      </span>
    )
  return (
    <a
      href={props.text}
      rel="noreferrer noopener"
      className={cn(listLinkClass, "wrap-anywhere")}
    >
      <VisibleText text={props.text} oneLine />
    </a>
  )
}
