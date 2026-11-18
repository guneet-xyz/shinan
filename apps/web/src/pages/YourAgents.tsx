import { useState } from "react"
import type { FormEvent } from "react"
import { Link } from "react-router"

import type { IssuedAgentToken, TokenAccess } from "@shinan/api-client"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

import { useAccount } from "../account"
import { useAction } from "../action"
import { useApi, useResource } from "../api"
import { AgentCard, TokenShownOnce } from "../components/AgentCard"
import { PageHeader, Rows, Section } from "../components/page"
import { ErrorMessage, Loading } from "../components/status"
import { accessNames } from "../format"

/** Coding tools offered by name; any other can be typed. */
const codingTools = [
  { value: "opencode", label: "OpenCode" },
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "gemini-cli", label: "Gemini CLI" },
] as const

const otherTool = "other"

/**
 * Your agents (human experience, Your agents): the person's agents in every
 * workspace, with their tokens' last use shown first, and a token made by
 * hand. Browser approval from the plugin or CLI comes with them (M4).
 */
export function YourAgents() {
  const api = useApi()
  const agents = useResource("your-agents", () => api.yourAgents())
  const [issued, setIssued] = useState<IssuedAgentToken>()

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Your agents">
        An agent is one coding tool on one machine, acting for you in one
        workspace. Its token lasts until it is revoked.
      </PageHeader>
      {issued && (
        <TokenShownOnce
          issued={issued}
          onDismiss={() => setIssued(undefined)}
        />
      )}
      <Section title="Agents">
        {agents.data ? (
          agents.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You have no agents yet. Create a token below for a coding tool on
              one of your machines.
            </p>
          ) : (
            <Rows>
              {agents.data.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  control="own"
                  showWorkspace
                  reload={agents.reload}
                  onIssued={setIssued}
                />
              ))}
            </Rows>
          )
        ) : agents.error ? (
          <ErrorMessage error={agents.error} />
        ) : (
          <Loading />
        )}
      </Section>
      <CreateToken
        onIssued={(created) => {
          setIssued(created)
          agents.reload()
        }}
      />
      <p className="text-sm text-muted-foreground">
        <Link
          to="/account"
          className="text-foreground underline underline-offset-4"
        >
          Back to your account
        </Link>
      </p>
    </div>
  )
}

/**
 * A token made by hand (identity §6.2): the person picks the workspace,
 * coding tool and machine, and full or read-only, and signs in again.
 */
function CreateToken(props: { onIssued: (issued: IssuedAgentToken) => void }) {
  const api = useApi()
  const { account } = useAccount()
  const [workspaceId, setWorkspaceId] = useState(
    account.workspaces[0]?.id ?? "",
  )
  const [tool, setTool] = useState<string>(codingTools[0].value)
  const [otherToolName, setOtherToolName] = useState("")
  const [machine, setMachine] = useState("")
  const [name, setName] = useState("")
  const [access, setAccess] = useState<TokenAccess>("full")
  const create = useAction()

  if (account.workspaces.length === 0) {
    return (
      <Section title="Create a token by hand">
        <p className="text-sm text-muted-foreground">
          Agents belong to a workspace. Join or create one first.
        </p>
      </Section>
    )
  }

  const toolLabel =
    tool === otherTool
      ? otherToolName.trim()
      : codingTools.find((t) => t.value === tool)!.label
  const suggestedName =
    toolLabel && machine.trim() ? `${toolLabel} on ${machine.trim()}` : ""

  const submit = (event: FormEvent) => {
    event.preventDefault()
    let created: IssuedAgentToken | undefined
    create.run(
      async () => {
        created = await api.createAgentToken(workspaceId, {
          codingTool: tool === otherTool ? otherToolName : tool,
          machine,
          name: name.trim() || suggestedName,
          access,
        })
      },
      () => {
        setMachine("")
        setName("")
        props.onIssued(created!)
      },
    )
  }

  return (
    <Section
      title="Create a token by hand"
      description="For a coding tool that sends a header to Shinan's MCP server. If you already have an agent for that tool and machine, it gets the new token and its old one stops working. You will be asked to sign in again."
    >
      <form onSubmit={submit}>
        <FieldGroup>
          {account.workspaces.length > 1 && (
            <Field>
              <FieldLabel htmlFor="agent-workspace">Workspace</FieldLabel>
              <NativeSelect
                id="agent-workspace"
                className="w-full sm:w-64"
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
              >
                {account.workspaces.map((w) => (
                  <NativeSelectOption key={w.id} value={w.id}>
                    {w.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="agent-tool">Coding tool</FieldLabel>
            <NativeSelect
              id="agent-tool"
              className="w-full sm:w-64"
              value={tool}
              onChange={(event) => setTool(event.target.value)}
            >
              {codingTools.map((t) => (
                <NativeSelectOption key={t.value} value={t.value}>
                  {t.label}
                </NativeSelectOption>
              ))}
              <NativeSelectOption value={otherTool}>
                Another tool
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          {tool === otherTool && (
            <Field>
              <FieldLabel htmlFor="agent-tool-name">
                Name of the coding tool
              </FieldLabel>
              <Input
                id="agent-tool-name"
                required
                maxLength={32}
                value={otherToolName}
                onChange={(event) => setOtherToolName(event.target.value)}
              />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="agent-machine">Machine</FieldLabel>
            <Input
              id="agent-machine"
              required
              maxLength={32}
              aria-describedby="agent-machine-description"
              value={machine}
              onChange={(event) => setMachine(event.target.value)}
            />
            <FieldDescription id="agent-machine-description">
              The computer it runs on, such as Daedalus. With the tool it makes
              the agent's handle, such as opencode-daedalus, which never
              changes.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="agent-name">Name (optional)</FieldLabel>
            <Input
              id="agent-name"
              maxLength={100}
              placeholder={suggestedName || "OpenCode on Daedalus"}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="agent-access">Access</FieldLabel>
            <NativeSelect
              id="agent-access"
              className="w-full sm:w-64"
              aria-describedby="agent-access-description"
              value={access}
              onChange={(event) => setAccess(event.target.value as TokenAccess)}
            >
              <NativeSelectOption value="full">
                {accessNames.full}
              </NativeSelectOption>
              <NativeSelectOption value="read-only">
                {accessNames["read-only"]}
              </NativeSelectOption>
            </NativeSelect>
            <FieldDescription id="agent-access-description">
              Read-only lets the agent read everything in the workspace but
              change nothing, which limits what a leaked token can do.
            </FieldDescription>
          </Field>
          <div>
            <Button type="submit" disabled={create.pending}>
              Create token
            </Button>
          </div>
          {create.error !== undefined && <ErrorMessage error={create.error} />}
        </FieldGroup>
      </form>
    </Section>
  )
}
