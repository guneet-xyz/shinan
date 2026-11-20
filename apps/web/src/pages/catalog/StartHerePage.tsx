import { Link } from "react-router"

import type { StartHereAnswer, StartHereStep } from "@shinan/api-client"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { useApi, useResource } from "../../api"
import { PageHeader, Section } from "../../components/page"
import { ErrorMessage, Loading } from "../../components/status"
import { useWorkspace } from "../workspace/context"
import { EntityLink, linkClass, MaybeLink } from "./facts"
import { catalogPath } from "./format"
import { IndexBehind } from "./notices"

/**
 * Start here (catalog §11; human experience, start here and onboarding):
 * the people's path as numbered steps, and the agents' path. With no
 * start-here page, an empty catalog says what to do first. (The page is
 * rendered like any other later in GC-7, with the README as its fallback.)
 */
export function StartHerePage(props: { pages: number }) {
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
  if (!startHere)
    return (
      <div className="flex flex-col gap-6">
        <IndexBehind behind={people.index_behind || agents.index_behind} />
        {props.pages === 0 ? (
          <EmptyCatalog />
        ) : (
          <PageHeader title="Start here">
            There's no Start here page yet. Open a page from the folders, or ask
            an agent to write start-here.md.
          </PageHeader>
        )}
      </div>
    )
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={startHere?.title ?? "Start here"}>
        {startHere?.summary ??
          "The path through this workspace's catalog, for people and for agents."}
      </PageHeader>
      <IndexBehind behind={people.index_behind || agents.index_behind} />
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
    </div>
  )
}

/**
 * An empty catalog (product brief on #169): agents write it, so the next
 * step is setting one up.
 */
function EmptyCatalog() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">
        Your catalog is empty.
      </h1>
      <p className="text-sm">
        Agents write it. Set up an agent, then ask it to add your first machine.
      </p>
      <Link
        to="/account/agents/setup"
        className={cn(buttonVariants(), "self-start")}
      >
        Set up an agent
      </Link>
    </div>
  )
}

/** The workspace lists a step may name, as the catalog now shows them. */
const listTitles: Record<string, string> = {
  discrepancies: "These disagree",
  "due-for-recheck": "Not checked in a while",
  "known-unknowns": "Unknown",
  "recent-changes": "Recent changes",
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
  // Recent changes, from `main`'s commits, come later in GC-7: until then
  // that list has no page to open. The other lists are parts of Needs
  // attention.
  if (step.list === "recent-changes")
    return <span className="font-medium">{title}</span>
  return (
    <Link
      to={catalogPath(workspaceId, "/needs-attention")}
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
