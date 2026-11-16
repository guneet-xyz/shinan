import { useState } from "react"

import type { Page, SecurityLogEntry } from "@shinan/api-client"

import { useApi, useResource } from "../../api"
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
    <section aria-labelledby="security-log-heading">
      <h2 id="security-log-heading">Security log</h2>
      <p className="muted">
        Security-relevant events in this workspace. They are kept forever and
        are never purged.
        {workspace.role !== "owner" &&
          " You see the entries you made and the entries about you."}
      </p>
      {first.data ? (
        <Entries key={workspace.id} first={first.data} />
      ) : first.error ? (
        <ErrorMessage error={first.error} />
      ) : (
        <Loading />
      )}
    </section>
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
  if (entries.length === 0) return <p className="muted">No entries yet.</p>

  return (
    <>
      <ol className="cards log">
        {entries.map((entry) => (
          <Entry key={entry.id} entry={entry} />
        ))}
      </ol>
      {next !== null && (
        <button type="button" disabled={loading} onClick={loadOlder}>
          Show older entries
        </button>
      )}
      {error !== undefined && <ErrorMessage error={error} />}
    </>
  )
}

function Entry({ entry }: { entry: SecurityLogEntry }) {
  const details = Object.entries(entry.details)
  return (
    <li className={`card outcome-${entry.outcome}`}>
      <div className="log-head">
        <strong>{actionNames[entry.action] ?? entry.action}</strong>
        <span className={`badge outcome-${entry.outcome}`}>
          {outcomeNames[entry.outcome]}
        </span>
      </div>
      <dl className="facts compact">
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
            <span className="muted"> ({entry.confidence})</span>
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
            <dd className="wrap">{entry.client}</dd>
          </>
        )}
        {details.map(([key, value]) => (
          <DetailRow key={key} name={key} value={value} />
        ))}
      </dl>
    </li>
  )
}

function DetailRow(props: { name: string; value: unknown }) {
  return (
    <>
      <dt>{props.name}</dt>
      <dd className="wrap">
        {typeof props.value === "string"
          ? props.value
          : JSON.stringify(props.value)}
      </dd>
    </>
  )
}
