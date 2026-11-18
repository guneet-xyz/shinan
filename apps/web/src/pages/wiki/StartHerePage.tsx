import { useState } from "react"
import { Link } from "react-router"

import type { StartHereAnswer, StartHereStep } from "@shinan/api-client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { useApi, useResource } from "../../api"
import { PageHeader, Section } from "../../components/page"
import { ErrorMessage, Loading } from "../../components/status"
import { useWorkspace } from "../workspace/context"
import { EntityLink, linkClass, MaybeLink } from "./facts"
import { agentPathWarningBytes, sizeText, wikiPath } from "./format"
import { IndexBehind, PageNotice } from "./notices"

/**
 * Start here (catalog §11; human experience, start here and onboarding):
 * the people's path as numbered steps, each saying whether the person has
 * opened it and whether it changed since; the agents' path with "Preview as
 * agent" and its size.
 */
export function StartHerePage() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const paths = useResource(`start-here:${workspace.id}`, async () => {
    const [people, agents] = await Promise.all([
      api.catalogStartHere(workspace.id, "people"),
      api.catalogStartHere(workspace.id, "agents"),
    ])
    const ids = (people.start_here?.steps ?? []).flatMap((s) =>
      "to" in s ? [s.to] : [],
    )
    const opened =
      ids.length === 0
        ? { items: [] }
        : await api.catalogPagesOpened(workspace.id, ids)
    return { people, agents, opened: opened.items }
  })

  if (paths.error) return <ErrorMessage error={paths.error} />
  if (!paths.data) return <Loading />
  const { people, agents, opened } = paths.data
  const document = people.start_here
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={document?.title ?? "Start here"}>
        {document?.summary ??
          "The path through this workspace's catalog, for people and for agents."}
      </PageHeader>
      <IndexBehind behind={people.index_behind || agents.index_behind} />
      {!document ? (
        <PageNotice>
          This workspace has no start-here document yet. It is written like any
          catalog document, and changing it needs catalog approval.
        </PageNotice>
      ) : (
        <>
          <Section
            title="For people"
            description="Each step says whether you have opened it, and whether it changed since you did."
          >
            {document.steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No steps yet.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {document.steps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span
                      aria-hidden="true"
                      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
                    >
                      {i + 1}
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <StepTarget workspaceId={workspace.id} step={step} />
                        {"to" in step && (
                          <Marker
                            opened={opened.find((o) => o.id === step.to)}
                          />
                        )}
                      </span>
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

function Marker(props: {
  opened: { revision: number; opened_revision: number | null } | undefined
}) {
  const { opened } = props
  if (!opened) return null
  if (opened.opened_revision === null)
    return <Badge variant="outline">not opened yet</Badge>
  if (opened.revision > opened.opened_revision)
    return <Badge variant="destructive">changed since you opened it</Badge>
  return <Badge variant="secondary">opened</Badge>
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
  if (step.list === "waiting-for-approval")
    // Catalog review comes with catalog proposals (M2-4, M2-8).
    return <span className="font-semibold">{title}</span>
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

/** The agents' path, its size, and exactly what an agent is given. */
function AgentsPath(props: { workspaceId: string; answer: StartHereAnswer }) {
  const [preview, setPreview] = useState(false)
  const steps = props.answer.start_here?.steps ?? []
  const given = JSON.stringify(props.answer.start_here, null, 2)
  const bytes = new TextEncoder().encode(given).length
  return (
    <Section
      title="For agents"
      description={`Agents read this whole path when they start. Its size: ${sizeText(bytes)}.`}
    >
      {bytes > agentPathWarningBytes && (
        <PageNotice warning>
          The agents' path is large ({sizeText(bytes)}). Every agent session
          reads all of it; consider linking to fewer, more focused pages.
        </PageNotice>
      )}
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
      <Button
        variant="outline"
        className="self-start"
        aria-expanded={preview}
        aria-controls="agent-preview"
        onClick={() => setPreview((p) => !p)}
      >
        {preview ? "Hide the preview" : "Preview as agent"}
      </Button>
      {preview && (
        <pre
          id="agent-preview"
          tabIndex={0}
          aria-label="What an agent is given"
          className="max-h-96 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs/5"
        >
          {given}
        </pre>
      )}
    </Section>
  )
}
