import { Link } from "react-router"

import { useApi, useResource } from "../../api"
import { Section } from "../../components/page"
import { ErrorMessage, Loading } from "../../components/status"
import { linkClass } from "../wiki/facts"
import { wikiPath } from "../wiki/format"
import { useWorkspace } from "./context"

/**
 * Catalog settings (human experience, workspace settings): the strict
 * setting, with links to the type schema documents and to catalog review.
 * Types are not a setting: they are type schema documents, changed by
 * catalog proposals.
 */
export function CatalogSettings() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const types = useResource(`catalog-types:${workspace.id}`, () =>
    api.catalogTypes(workspace.id),
  )
  const documents = (types.data?.items ?? []).filter((t) => t.document)
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Section
        title="Catalog approval"
        description="Which changes to the catalog wait for a person's approval."
      >
        <p className="text-sm">
          Changes apply at once, except the gated ones, which wait for a
          member's approval: rules (policies, settled decisions, type schemas,
          Start here), lifecycle (deprecating, retiring, a new ID or owner),
          people and agents, and doubtful changes such as an older fact check,
          an accepted discrepancy or a validation warning. A member's own change
          applies at once, as their approval.
        </p>
        <StrictSetting />
        <Link
          to={wikiPath(workspace.id, "/review")}
          className={`${linkClass} self-start text-sm`}
        >
          Catalog review
        </Link>
      </Section>
      <Section
        title="Type schemas"
        description="The workspace's own types and extensions of built-in ones. Change them from their type's page."
      >
        {types.error ? <ErrorMessage error={types.error} /> : null}
        {!types.data && !types.error && <Loading />}
        {types.data && documents.length === 0 && (
          <p className="text-sm text-muted-foreground">
            None yet: only the built-in types.
          </p>
        )}
        {documents.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {documents.map((t) => (
              <li key={t.type}>
                <Link
                  to={wikiPath(workspace.id, `/types/${t.type}`)}
                  className={linkClass}
                >
                  {t.type}
                </Link>{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  {t.document}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link
          to={wikiPath(workspace.id, "/new-type")}
          className={`${linkClass} self-start text-sm`}
        >
          New type
        </Link>
      </Section>
    </div>
  )
}

/**
 * The strict setting (catalog §8.2): a workspace owner turns it on when
 * catalog accuracy slips, and then every change except rechecks waits for
 * approval. Slot for M2-4b, which adds the setting; until then nothing is
 * shown, and the workspace works as with the setting off.
 */
export function StrictSetting() {
  return null
}
