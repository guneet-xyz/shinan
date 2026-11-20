import { Link } from "react-router"

import type { StartHereStep } from "@shinan/api-client"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { isApiError, useApi, useResource } from "../../api"
import { useCatalogAnswer } from "../../catalog-tree"
import { ErrorMessage, Loading } from "../../components/status"
import { useWorkspace } from "../workspace/context"
import { aboutDocument } from "./about"
import { EntityLink, MaybeLink } from "./facts"
import { catalogPath, entityPath, listLinkClass } from "./format"
import { Markdown } from "./markdown"
import { IndexBehind } from "./notices"
import { PageBody, PageFooter, PageHeading, ProblemsNotice } from "./PageParts"
import { VisibleText } from "./VisibleText"

/**
 * Start here, the catalog's first page (product brief on #169):
 * `start-here.md` rendered like any page, its people's steps first; without
 * it, `README.md`; an empty catalog says what to do first.
 */
export function StartHere(props: { pages: number }) {
  const api = useApi()
  const { workspace } = useWorkspace()
  const workspaceId = workspace.id
  const answer = useCatalogAnswer(
    workspaceId,
    `start-here:${workspaceId}`,
    async () => {
      const [document, people] = await Promise.all([
        api
          .catalogDocument(workspaceId, "start-here")
          .catch((error: unknown) => {
            if (isApiError(error, "not-found")) return null
            throw error
          }),
        api.catalogStartHere(workspaceId, "people"),
      ])
      return {
        catalog_commit: people.catalog_commit,
        index_behind: people.index_behind,
        document: document?.document ?? null,
        steps: people.start_here?.steps ?? [],
      }
    },
  )

  if (answer.error) return <ErrorMessage error={answer.error} />
  if (!answer.data) return <Loading />
  const { document, steps } = answer.data
  if (!document)
    return (
      <div className="flex flex-col gap-6">
        <IndexBehind behind={answer.behind} />
        {props.pages === 0 ? <EmptyCatalog /> : <Readme />}
      </div>
    )
  return (
    <article className="flex flex-col gap-6">
      <PageHeading
        title={document.title}
        id={document.id}
        summary={document.summary}
      />
      <IndexBehind behind={answer.behind} />
      <ProblemsNotice problems={document.problems} />
      {steps.length > 0 && (
        <ol className="flex flex-col gap-3">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
              >
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <StepTarget workspaceId={workspaceId} step={step} />
                <span className="wrap-anywhere text-muted-foreground">
                  <VisibleText text={step.note} oneLine />
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <PageBody
        workspaceId={workspaceId}
        sections={document.body}
        title={document.title}
      />
      <PageFooter
        workspaceId={workspaceId}
        id={document.id}
        commit={answer.data.catalog_commit}
        about={aboutDocument(workspaceId, document)}
      />
    </article>
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
        className="self-start font-semibold"
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
      className={cn(listLinkClass, "self-start")}
    >
      {title}
    </Link>
  )
}

/**
 * Without `start-here.md`, the catalog's `README.md`, its first heading as
 * the title. Without that either (or when the repository can't be read),
 * a line saying how to get a Start here page.
 */
function Readme() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const readme = useResource(`catalog-readme:${workspace.id}`, () =>
    api.catalogReadme(workspace.id),
  )
  if (readme.loading && !readme.data && !readme.error) return <Loading />
  const text = readme.data?.readme?.text
  if (!text?.trim())
    return (
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Start here</h1>
        <p className="text-muted-foreground">
          There's no Start here page yet. Open a page from the folders, or ask
          an agent to write start-here.md.
        </p>
      </header>
    )
  const heading = /^# +(.+?)\s*#*\s*$/.exec(text.split("\n", 1)[0] ?? "")
  const rest = heading ? text.slice(text.indexOf("\n") + 1) : text
  return (
    <article className="flex flex-col gap-6">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">
          <VisibleText text={heading?.[1] ?? "Start here"} oneLine />
        </h1>
        <p className="text-muted-foreground">
          From the catalog's README.md. An agent can write start-here.md to give
          the catalog its own Start here page.
        </p>
      </header>
      <Markdown
        text={rest}
        headingOffset={/^# /m.test(rest) ? 1 : 0}
        className="min-w-0 wrap-break-word"
        entityPath={(id) => entityPath(workspace.id, id)}
      />
    </article>
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
