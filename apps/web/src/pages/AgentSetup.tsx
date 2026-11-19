import { CheckIcon, CopyIcon } from "lucide-react"
import { useId, useState } from "react"
import { Link, useSearchParams } from "react-router"

import {
  catalogRepositoryUrl,
  cloneCommands,
  defaultCloneFolder,
  storeTokenCommand,
  tokenFile,
  writtenAgent,
} from "@shinan/skill/setup"

import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

import { useAccount } from "../account"
import { useApi, useResource } from "../api"
import { PageHeader, Section } from "../components/page"

const linkClassName = "text-foreground underline underline-offset-4"

/**
 * OpenCode's configuration for Shinan (agent integrations, "Setting up an
 * agent"): the skill catalog, and a rule that keeps OpenCode's own `read`
 * tool away from the token's folder. No MCP server: agents reach the
 * catalog through Git (D-063). Nothing in it is secret.
 */
function openCodeConfig(origin: string): string {
  return JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      skills: [`${origin}/skills/`],
      permissions: [
        {
          action: "read",
          resource: "~/.config/shinan/*",
          effect: "deny",
        },
      ],
    },
    null,
    2,
  )
}

/**
 * Setting up an agent with a token made by hand (agent integrations,
 * "Setting up an agent with a hand-made token"; plan §2.12), linked from
 * Your agents and from a token shown once (`?agent=<id>`). The addresses
 * are this installation's own; the agent chosen fills in its workspace and
 * how it writes `by`.
 */
export function AgentSetup() {
  const origin = window.location.origin
  const api = useApi()
  const { account } = useAccount()
  const agents = useResource("your-agents", () => api.yourAgents())
  const [params] = useSearchParams()
  const [chosen, setChosen] = useState(params.get("agent") ?? "")
  const selectId = useId()

  const list = agents.data ?? []
  const agent = list.find((a) => a.id === chosen) ?? list[0]
  const workspaceId =
    agent?.workspaceId ?? account.workspaces[0]?.id ?? "<workspace ID>"
  const by = writtenAgent(
    agent?.personHandle ?? account.person.handle,
    agent?.handle ?? "<agent handle>",
  )

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Set up an agent">
        Connect a coding tool on one of your machines to your workspace's
        catalog, with a token made by hand. The catalog is a Git repository: the
        agent keeps a clone on the machine, reads it, and pushes its changes.
        Git gets the token from a file, so the agent never sees it.
      </PageHeader>
      {list.length > 1 && (
        <div className="flex flex-col gap-2">
          <label htmlFor={selectId} className="text-sm font-medium">
            Agent
          </label>
          <NativeSelect
            id={selectId}
            value={agent?.id ?? ""}
            onChange={(event) => setChosen(event.target.value)}
          >
            {list.map((a) => (
              <NativeSelectOption key={a.id} value={a.id}>
                {`${a.name} (${a.handle}), ${a.workspaceName}`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}
      <div className="flex flex-col gap-6">
        <Section title="1. Make a token">
          <p className="text-sm">
            In{" "}
            <Link to="/account/agents" className={linkClassName}>
              Your agents
            </Link>
            , create a token by hand for the coding tool on this machine. Choose{" "}
            <strong className="font-medium">Read-only</strong> if the agent
            should only read the catalog. Keep the page open: the token is shown
            once.
          </p>
        </Section>
        <Section
          title="2. Store it on the machine"
          description="In a terminal on that machine, not in the coding tool's chat."
        >
          <p className="text-sm">
            Run this in any shell (it uses bash, which almost every Linux and
            macOS machine has), then paste the token and press Enter. Nothing is
            shown while you paste: the token stays off the screen, out of your
            shell history and off every command line, and the file is readable
            only by you, even if it was there before.
          </p>
          <CodeBlock
            label="Commands to store the token"
            code={storeTokenCommand}
          />
        </Section>
        <Section
          title="3. Clone the catalog"
          description="One clone per machine. Agents never edit it directly: each task works in a worktree beside it."
        >
          <p className="text-sm">
            This clones the catalog to <Code>{defaultCloneFolder}</Code> with a
            credential helper in the clone&apos;s own settings: Git asks it, and
            only it, for Shinan&apos;s password, and it answers with the token
            from <Code>{tokenFile}</Code>. Any other helper for this address,
            such as one that saves passwords, is switched off for the clone. The
            last two lines record where the clone is and how the agent names
            itself when it records a fact check, <Code>{by}</Code>. Shinan
            refuses fact checks that name anyone else.
          </p>
          <CodeBlock
            label="Commands to clone the catalog"
            code={cloneCommands({ origin, workspaceId, by })}
          />
          <p className="text-sm text-muted-foreground">
            The repository is{" "}
            <Code>{catalogRepositoryUrl(origin, workspaceId)}</Code>. Agents run
            Git with <Code>GIT_TERMINAL_PROMPT=0</Code>, so a missing or revoked
            token fails at once instead of asking for a password.
          </p>
        </Section>
        <Section
          title="4. Configure OpenCode"
          description="Nothing here is secret."
        >
          <p className="text-sm">
            Add this to <Code>opencode.jsonc</Code> in a folder above the
            projects that should use Shinan, or to{" "}
            <Code>~/.config/opencode/opencode.jsonc</Code> for every folder. If
            an older setup added a <Code>shinan</Code> MCP server, remove it.
            The rule stops OpenCode's own file reader from opening the token's
            folder; the skill tells the agent never to touch it either.
          </p>
          <CodeBlock
            label="OpenCode configuration"
            code={openCodeConfig(origin)}
          />
          <p className="text-sm text-muted-foreground">
            The skill is at <Code>{`${origin}/skills/`}</Code>. Another coding
            tool uses the same clone and the same skill.
          </p>
        </Section>
        <Section title="5. Check it">
          <p className="text-sm">
            In the clone, run <Code>GIT_TERMINAL_PROMPT=0 git fetch</Code>: it
            finishes without asking for anything. Then ask the agent to load the{" "}
            <Code>shinan</Code> skill and read the catalog&apos;s start-here
            document.
          </p>
        </Section>
      </div>
      <Section title="Keep the token safe">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>
            The agent never needs to see the token. Never paste it into a chat,
            an issue, a project file, a command line or a Git remote address.
          </li>
          <li>
            If it leaks, or the machine is lost, revoke it in{" "}
            <Link to="/account/agents" className={linkClassName}>
              Your agents
            </Link>
            : it stops working at once.
          </li>
          <li>
            To replace it, make a new token for the same agent and store it the
            same way. Git uses the new one on its next fetch or push.
          </li>
        </ul>
      </Section>
      <p className="text-sm text-muted-foreground">
        <Link to="/account/agents" className={linkClassName}>
          Back to your agents
        </Link>
      </p>
    </div>
  )
}

function Code(props: { children: string }) {
  return (
    <code className="font-mono text-[0.9em] wrap-anywhere text-foreground">
      {props.children}
    </code>
  )
}

/** A block of text to copy onto the machine, with a copy button. */
function CodeBlock(props: { label: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(props.code).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="sr-only">{props.label}</figcaption>
      <pre
        tabIndex={0}
        className="overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-xs leading-relaxed sm:text-sm"
      >
        <code>{props.code}</code>
      </pre>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copy}
          // The visible word first, so the name contains what is shown.
          aria-label={`${copied ? "Copied" : "Copy"} ${props.label}`}
        >
          {copied ? (
            <CheckIcon aria-hidden="true" />
          ) : (
            <CopyIcon aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </figure>
  )
}
