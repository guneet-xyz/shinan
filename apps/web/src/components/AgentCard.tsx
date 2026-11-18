import { CheckIcon, CopyIcon } from "lucide-react"
import { useState } from "react"
import type { FormEvent } from "react"
import { Link } from "react-router"

import type { Agent, IssuedAgentToken, TokenAccess } from "@shinan/api-client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { useAction } from "../action"
import { useApi } from "../api"
import { accessNames, formatDate, formatTime } from "../format"
import { Actions, Confirm, Facts } from "./page"
import { ErrorMessage } from "./status"

/**
 * Who may do what with an agent on this screen: `own` for the person's own
 * agents (everything), `owner` for a workspace owner looking at another
 * member's agent (disable and revoke only, identity §7.5).
 */
export type AgentControl = "own" | "owner" | "none"

/**
 * One agent: its name and handle, state, and its token's use, last use
 * first, since tokens never expire and an unused one is the thing to spot
 * and revoke (human experience, Your agents).
 */
export function AgentCard(props: {
  agent: Agent
  control: AgentControl
  /** Shows the workspace, for the person's agents across workspaces. */
  showWorkspace?: boolean
  /** Shows whose agent it is, for the workspace's list. */
  showPerson?: boolean
  reload: () => void
  /** A new token was issued for the agent; it is shown once. */
  onIssued?: (issued: IssuedAgentToken) => void
}) {
  const { agent, control } = props
  const { token } = agent
  const api = useApi()
  const action = useAction()
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState<
    "replace" | "revoke" | "disable" | null
  >(null)
  const own = control === "own"

  const run = (change: () => Promise<unknown>) =>
    action.run(change, () => {
      setConfirming(null)
      props.reload()
    })
  const newToken = (access: TokenAccess) =>
    action.run(
      async () => {
        const issued = await api.issueAgentToken(
          agent.workspaceId,
          agent.id,
          access,
        )
        props.onIssued?.(issued)
      },
      () => {
        setConfirming(null)
        props.reload()
      },
    )

  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <strong className="font-medium">{agent.name}</strong>
        <span className="text-sm text-muted-foreground">{agent.handle}</span>
        {!agent.enabled ? (
          <Badge variant="outline">Disabled</Badge>
        ) : !token ? (
          <Badge variant="outline">No token</Badge>
        ) : (
          <Badge variant="secondary">{accessNames[token.access]} token</Badge>
        )}
        {token?.unused && (
          <Badge variant="destructive">Unused for 30 days</Badge>
        )}
      </div>
      {token && (
        <p className="text-sm">
          {token.lastUsedAt ? (
            <>
              <span className="font-medium">Last used</span>{" "}
              {formatTime(token.lastUsedAt)}
              {token.lastNetworkAddress && ` from ${token.lastNetworkAddress}`}
            </>
          ) : (
            <span className="font-medium">Never used</span>
          )}
        </p>
      )}
      <Facts>
        {props.showWorkspace && (
          <>
            <dt>Workspace</dt>
            <dd>{agent.workspaceName}</dd>
          </>
        )}
        {props.showPerson && (
          <>
            <dt>Acts for</dt>
            <dd>
              {agent.personName} ({agent.personHandle})
            </dd>
          </>
        )}
        <dt>Coding tool</dt>
        <dd>{agent.codingTool}</dd>
        <dt>Machine</dt>
        <dd>
          {agent.machine}
          {agent.machineEntityId && ` (${agent.machineEntityId})`}
        </dd>
        {token && (
          <>
            <dt>Token created</dt>
            <dd>{formatDate(token.createdAt)}</dd>
            <dt>Requests</dt>
            <dd>{token.requestCount.toLocaleString()}</dd>
          </>
        )}
        {!agent.enabled && agent.disabledAt && (
          <>
            <dt>Disabled</dt>
            <dd>{formatDate(agent.disabledAt)}</dd>
          </>
        )}
      </Facts>
      {renaming ? (
        <RenameForm
          agent={agent}
          onDone={() => {
            setRenaming(false)
            props.reload()
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : confirming ? (
        <Confirm>
          <p className="font-medium">
            {confirming === "replace"
              ? `Replace the token of ${agent.name}?`
              : confirming === "revoke"
                ? `Revoke the token of ${agent.name}?`
                : `Disable ${agent.name}?`}
          </p>
          <ul className="ml-5 list-disc space-y-1">
            <li>Its current token stops working on its next request.</li>
            {confirming === "replace" && (
              <li>
                The new token is shown once; put it on the machine in place of
                the old one.
              </li>
            )}
            {confirming === "disable" && (
              <li>No new token can be made for it until it is enabled.</li>
            )}
            {confirming !== "replace" && (
              <li>
                Its access to GitHub or Forgejo on that machine is not affected:
                that is its member's own sign-in there.
              </li>
            )}
          </ul>
          <Actions>
            <Button
              type="button"
              variant={confirming === "replace" ? "default" : "destructive"}
              disabled={action.pending}
              onClick={() =>
                confirming === "replace"
                  ? newToken(token?.access ?? "full")
                  : run(() =>
                      confirming === "revoke"
                        ? api.revokeAgentToken(agent.workspaceId, agent.id)
                        : api.disableAgent(agent.workspaceId, agent.id),
                    )
              }
            >
              {confirming === "replace"
                ? "Replace token"
                : confirming === "revoke"
                  ? "Revoke token"
                  : "Disable agent"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setConfirming(null)
                action.clear()
              }}
            >
              Cancel
            </Button>
          </Actions>
        </Confirm>
      ) : (
        control !== "none" && (
          <Actions>
            {own && agent.enabled && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={action.pending}
                onClick={() =>
                  token ? setConfirming("replace") : newToken("full")
                }
              >
                {token ? "Replace token…" : "New token"}
              </Button>
            )}
            {own && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRenaming(true)}
              >
                Rename
              </Button>
            )}
            {own && !agent.enabled && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={action.pending}
                onClick={() =>
                  run(() => api.enableAgent(agent.workspaceId, agent.id))
                }
              >
                Enable
              </Button>
            )}
            {token && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setConfirming("revoke")}
              >
                Revoke token…
              </Button>
            )}
            {agent.enabled && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setConfirming("disable")}
              >
                Disable…
              </Button>
            )}
          </Actions>
        )
      )}
      {action.error !== undefined && <ErrorMessage error={action.error} />}
    </li>
  )
}

function RenameForm(props: {
  agent: Agent
  onDone: () => void
  onCancel: () => void
}) {
  const api = useApi()
  const [name, setName] = useState(props.agent.name)
  const rename = useAction()
  const id = `rename-${props.agent.id}`

  const submit = (event: FormEvent) => {
    event.preventDefault()
    rename.run(
      () =>
        api.renameAgent(props.agent.workspaceId, props.agent.id, name.trim()),
      props.onDone,
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        New name for {props.agent.handle}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          required
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Actions className="flex-nowrap">
          <Button type="submit" disabled={rename.pending}>
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
        </Actions>
      </div>
      <p className="text-sm text-muted-foreground">
        Its handle, {props.agent.handle}, stays the same in every record.
      </p>
      {rename.error !== undefined && <ErrorMessage error={rename.error} />}
    </form>
  )
}

/**
 * A token just made, shown this once (identity §7.4): Shinan keeps only its
 * hash. The person copies it straight to the machine.
 */
export function TokenShownOnce(props: {
  issued: IssuedAgentToken
  onDismiss: () => void
}) {
  const { issued } = props
  const [copied, setCopied] = useState(false)
  const id = `token-${issued.agent.id}`

  const copy = () => {
    void navigator.clipboard?.writeText(issued.token).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }

  return (
    <Alert>
      <AlertTitle>
        Token for {issued.agent.name} ({issued.agent.handle})
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3 text-foreground">
        <p>
          Copy it now and put it on the machine. It will not be shown again.
          {issued.replacedToken &&
            " The agent's previous token stopped working."}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor={id} className="sr-only">
            Agent token
          </label>
          <Input
            id={id}
            readOnly
            value={issued.token}
            className="font-mono"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button type="button" variant="outline" onClick={copy}>
            {copied ? (
              <CheckIcon aria-hidden="true" />
            ) : (
              <CopyIcon aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-muted-foreground">
          The coding tool sends it as the header{" "}
          <code className="font-mono text-foreground">
            Authorization: Bearer &lt;token&gt;
          </code>
          . Keep it in a file only you can read, never in a project file, chat
          or issue.{" "}
          <Link
            to="/account/agents/setup"
            target="_blank"
            rel="noopener"
            className="text-foreground underline underline-offset-4"
          >
            How to set up OpenCode (opens in a new tab)
          </Link>
        </p>
        <div>
          <Button type="button" onClick={props.onDismiss}>
            Done
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
