import { Link } from "react-router"

import type { StartHereAnswer, StartHereStep } from "@shinan/api-client"

import { useApi, useResource } from "../../api"
import { PageHeader, Section } from "../../components/page"
import { ErrorMessage, Loading } from "../../components/status"
import { useWorkspace } from "../workspace/context"
import { EntityLink, linkClass, MaybeLink } from "./facts"
import { wikiPath } from "./format"
import { IndexBehind, PageNotice } from "./notices"

/**
 * Start here (catalog §11; human experience, start here and onboarding):
 * the people's path as numbered steps, and the agents' path.
 */
export function StartHerePage() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const paths = useResource(`start-here:${workspace.id}`, async () => {
    const [people, agents] = await Promise.all([
      api.catalogStartHere(workspace.id, "people"),
      api.catalogStartHere(workspace.id, "agents"),
    ])
    return { people, agents }
  })

  if (paths.error) return <ErrorMessage error={paths.error} />
  if (!paths.data) return <Loading />
  const { people, agents } = paths.data
  const startHere = people.start_here
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={startHere?.title ?? "Start here"}>
        {startHere?.summary ??
          "The path through this workspace's catalog, for people and for agents."}
      </PageHeader>
      <IndexBehind behind={people.index_behind || agents.index_behind} />
      {!startHere ? (
        <PageNotice>
          This workspace has no start-here document yet. It is written like any
          catalog document.
        </PageNotice>
      ) : (
        <>
          <Section title="For people">
            {startHere.steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No steps yet.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {startHere.steps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span
                      aria-hidden="true"
                      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
                    >
                      {i + 1}
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <StepTarget workspaceId={workspace.id} step={step} />
                      <span className="text-muted-foreground">{step.note}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
          <AgentsPath workspaceId={workspace.id} answer={agents} />
        </>
      )}
    </div>
  )
}

const listTitles: Record<string, string> = {
  discrepancies: "Discrepancies",
  "due-for-recheck": "Due for recheck",
  "known-unknowns": "Known unknowns",
  "recent-changes": "Recent changes",
  "waiting-for-approval": "Waiting for approval",
}

function StepTarget(props: { workspaceId: string; step: StartHereStep }) {
  const { step, workspaceId } = props
  if ("to" in step)
    return (
      <EntityLink
        workspaceId={workspaceId}
        id={step.to}
        entity={step.entity}
        className="font-semibold"
      />
    )
  if ("url" in step) return <MaybeLink text={step.url} />
  const title = listTitles[step.list] ?? step.list
  // Catalog approval is gone (D-060): nothing waits for it, so that list
  // has no page to open.
  if (step.list === "waiting-for-approval")
    return <span className="font-medium">{title}</span>
  return (
    <Link
      to={wikiPath(
        workspaceId,
        step.list === "recent-changes" ? "/changes" : `/lists/${step.list}`,
      )}
      className={linkClass}
    >
      {title}
    </Link>
  )
}

/** The agents' path. */
function AgentsPath(props: { workspaceId: string; answer: StartHereAnswer }) {
  const steps = props.answer.start_here?.steps ?? []
  return (
    <Section title="For agents">
      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No steps yet.</p>
      ) : (
        <ol className="flex list-decimal flex-col gap-2 pl-6 text-sm">
          {steps.map((step, i) => (
            <li key={i}>
              <StepTarget workspaceId={props.workspaceId} step={step} />
              <span className="text-muted-foreground"> — {step.note}</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}
