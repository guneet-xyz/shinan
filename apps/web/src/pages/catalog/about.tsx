import type { CatalogDocument, CatalogEntity } from "@shinan/api-client"

import { EntityLink } from "./facts"
import { Code } from "./PageParts"
import type { AboutPart } from "./PageParts"

/*
 * "About this page" (product brief on #169): the quiet line at the foot of
 * a page with its file, ID, old IDs, owner and status.
 */

/** About this page: its file, ID, old IDs, owner and status. */
export function aboutEntity(
  workspaceId: string,
  entity: CatalogEntity,
): AboutPart[] {
  const parts: AboutPart[] = [
    { label: "File", value: <Code text={entity.path} /> },
    { label: "ID", value: <Code text={entity.id} /> },
  ]
  if (entity.aliases.length > 0)
    parts.push({
      label: entity.aliases.length === 1 ? "Old ID" : "Old IDs",
      value: <Code text={entity.aliases.join(", ")} />,
    })
  if (entity.owner && entity.owner !== "unknown")
    parts.push({
      label: "Owner",
      value: <EntityLink workspaceId={workspaceId} id={entity.owner} />,
    })
  parts.push({ label: "Status", value: entity.status ?? "unknown" })
  if (entity.type === "decision" && entity.decision_state)
    parts.push({
      label: "Decision",
      value: `${entity.decision_state}${entity.decided_on ? ` on ${entity.decided_on}` : ""}`,
    })
  return parts
}

/** About a document: its file, ID, owner and status. */
export function aboutDocument(
  workspaceId: string,
  document: CatalogDocument,
): AboutPart[] {
  const parts: AboutPart[] = [
    { label: "File", value: <Code text={document.path} /> },
    { label: "ID", value: <Code text={document.id} /> },
  ]
  if (document.owner && document.owner !== "unknown")
    parts.push({
      label: "Owner",
      value: <EntityLink workspaceId={workspaceId} id={document.owner} />,
    })
  if (document.status) parts.push({ label: "Status", value: document.status })
  return parts
}
