import { useState } from "react"

import type { Page, SecurityLogEntry } from "@shinan/api-client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { useApi, useResource } from "../../api"
import { Facts, OrderedRows, Section } from "../../components/page"
import { ErrorMessage, Loading } from "../../components/status"
import { formatTime } from "../../format"
import { useWorkspace } from "./context"

const actionNames: Record<string, string> = {
  "workspace.created": "Created the workspace",
  "workspace.renamed": "Renamed the workspace",
  "member.added": "Added a member",
  "member.role-changed": "Changed a member's role",
  "member.removed": "Removed a member",
  "member.left": "Left the workspace",
  "request.refused": "Request refused",
  "agent.created": "Registered an agent",
  "agent.renamed": "Renamed an agent",
  "agent.disabled": "Disabled an agent",
  "agent.enabled": "Enabled an agent",
  "agent-token.issued": "Made an agent token",
  "agent-token.revoked": "Revoked an agent token",
  "agent-token.first-used": "Agent token first used",
  "agent-token.used": "Agent token use",
  "agent-token.failed": "Agent token refused",
  "catalog.purged": "Purged catalog text",
  "catalog.fetched": "Catalog fetches",
}

const outcomeNames: Record<SecurityLogEntry["outcome"], string> = {
  succeeded: "Succeeded",
  refused: "Refused",
  failed: "Failed",
}

/**
 * The workspace's security log (identity §11), newest first and read only.
 * Workspace owners see every entry; contributors see entries they made or
 * that are about them, without other people's network details. The server
 * decides which.
 */
export function SecurityLog() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const first = useResource(`security-log:${workspace.id}`, () =>
    api.securityLog(workspace.id),
  )

  return (
    <Section
      title="Security log"
      description={
        <>
          Security-relevant events in this workspace. They are kept forever and
          are never purged.
          {workspace.role !== "owner" &&
            " You see the entries you made and the entries about you."}
        </>
      }
    >
      {first.data ? (
        <Entries key={workspace.id} first={first.data} />
      ) : first.error ? (
        <ErrorMessage error={first.error} />
      ) : (
        <Loading />
      )}
    </Section>
  )
}

function Entries(props: { first: Page<SecurityLogEntry> }) {
  const api = useApi()
  const { workspace } = useWorkspace()
  const [older, setOlder] = useState<SecurityLogEntry[]>([])
  const [next, setNext] = useState(props.first.next)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>()

  const loadOlder = () => {
    if (next === null) return
    setLoading(true)
    setError(undefined)
    api.securityLog(workspace.id, { before: next }).then(
      (page) => {
        setOlder((entries) => [...entries, ...page.entries])
        setNext(page.next)
        setLoading(false)
      },
      (failure: unknown) => {
        setError(failure)
        setLoading(false)
      },
    )
  }

  const entries = [...props.first.entries, ...older]
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No entries yet.</p>
  }

  return (
    <>
      <OrderedRows>
        {entries.map((entry) => (
          <Entry key={entry.id} entry={entry} />
        ))}
      </OrderedRows>
      {next !== null && (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={loadOlder}
          >
            Show older entries
          </Button>
        </div>
      )}
      {error !== undefined && <ErrorMessage error={error} />}
    </>
  )
}

function Entry({ entry }: { entry: SecurityLogEntry }) {
  const details = Object.entries(entry.details)
  return (
    <li>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="font-medium">
          {actionNames[entry.action] ?? entry.action}
        </strong>
        <Badge
          variant={entry.outcome === "succeeded" ? "secondary" : "destructive"}
        >
          {outcomeNames[entry.outcome]}
        </Badge>
      </div>
      <Facts>
        <dt>When</dt>
        <dd>
          <time dateTime={entry.occurredAt}>
            {formatTime(entry.occurredAt)}
          </time>
        </dd>
        <dt>By</dt>
        <dd>
          {entry.actorLabel}
          {entry.confidence !== "recorded" && (
            <span className="text-muted-foreground"> ({entry.confidence})</span>
          )}
        </dd>
        {entry.subjectHandle && (
          <>
            <dt>About</dt>
            <dd>{entry.subjectHandle}</dd>
          </>
        )}
        {entry.networkAddress && (
          <>
            <dt>From</dt>
            <dd>{entry.networkAddress}</dd>
          </>
        )}
        {entry.client && (
          <>
            <dt>Client</dt>
            <dd>{entry.client}</dd>
          </>
        )}
        {details.map(([key, value]) => (
          <DetailRow key={key} name={key} value={value} />
        ))}
      </Facts>
    </li>
  )
}

function DetailRow(props: { name: string; value: unknown }) {
  return (
    <>
      <dt>{props.name}</dt>
      <dd>
        {typeof props.value === "string"
          ? props.value
          : JSON.stringify(props.value)}
      </dd>
    </>
  )
}
