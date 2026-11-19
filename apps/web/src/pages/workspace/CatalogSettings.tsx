import { useState } from "react"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"

import { useAction } from "../../action"
import { useApi, useResource } from "../../api"
import { Actions, Confirm, Section } from "../../components/page"
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
 * catalog accuracy slips, and then every change except a recheck waits for
 * a person's approval, and approval works in bulk. Every member sees it;
 * only owners change it, after a recent sign-in.
 */
export function StrictSetting() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const settings = useResource(`catalog-settings:${workspace.id}`, () =>
    api.catalogSettings(workspace.id),
  )
  const [confirming, setConfirming] = useState(false)
  const changing = useAction()
  if (settings.error) return <ErrorMessage error={settings.error} />
  if (!settings.data) return <Loading />
  const strict = settings.data.strict
  const owner = workspace.role === "owner"
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 text-sm sm:p-4">
      <p>
        <span className="font-medium">
          Strict setting: {strict ? "on" : "off"}.
        </span>{" "}
        {strict
          ? "Every change except a recheck waits for a person's approval; catalog review approves them in bulk."
          : "Turn it on if catalog accuracy slips: then every change except a recheck waits for a person's approval."}
      </p>
      {owner && !confirming && (
        <Actions>
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirming(true)}
          >
            {strict
              ? "Turn the strict setting off…"
              : "Turn the strict setting on…"}
          </Button>
        </Actions>
      )}
      {owner && confirming && (
        <Confirm>
          <p>
            {strict
              ? "Changes outside the gated classes will apply at once again, for agents too. What already waits stays waiting."
              : "From now on, agents' changes wait for a member's approval, except rechecks. Members' own changes still apply at once, as their approval."}
          </p>
          <Actions>
            <Button
              type="button"
              disabled={changing.pending}
              onClick={() =>
                changing.run(
                  () => api.setCatalogStrict(workspace.id, !strict),
                  () => {
                    setConfirming(false)
                    settings.reload()
                  },
                )
              }
            >
              {strict ? "Turn it off" : "Turn it on"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setConfirming(false)
                changing.clear()
              }}
            >
              Cancel
            </Button>
          </Actions>
        </Confirm>
      )}
      {!owner && (
        <p className="text-muted-foreground">A workspace owner changes it.</p>
      )}
      {changing.error !== undefined && <ErrorMessage error={changing.error} />}
    </div>
  )
}
