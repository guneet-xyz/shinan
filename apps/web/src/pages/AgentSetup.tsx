import { CheckIcon, CopyIcon } from "lucide-react"
import { useId, useState } from "react"
import type { ReactNode } from "react"
import { Link, useSearchParams } from "react-router"

import {
  catalogRepositoryUrl,
  defaultCloneFolder,
  setupCommand,
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
 * "Setting up an agent with a hand-made token"; plan §2.12): four steps of
 * one sentence each, with how each works behind "What does this do?".
 * Linked from Your agents and from a token shown once (`?agent=<id>`). The
 * addresses are this installation's own; the agent chosen fills in its
 * workspace and how it writes `by`.
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
  const oneWorkspace = account.workspaces.length <= 1

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Set up an agent">
        Let a coding tool on one of your machines read and update your catalog.
        It takes about two minutes. Your agent never sees the token.
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
                {oneWorkspace
                  ? `${a.name} (${a.handle})`
                  : `${a.name} (${a.handle}), ${a.workspaceName}`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}
      <div className="flex flex-col gap-6">
        <Section title="1. Create a token for this machine">
          <p className="text-sm">
            In{" "}
            <Link to="/account/agents" className={linkClassName}>
              Your agents
            </Link>
            , pick the coding tool and the machine; choose{" "}
            <strong className="font-medium">Read-only</strong> if the agent
            should only read.
          </p>
          <WhatItDoes>
            <p>
              The token is shown once. Leave it open in its tab: the command in
              step 2 asks for it. If you lose it, make a new one.
            </p>
          </WhatItDoes>
        </Section>
        <Section title="2. Run one command on the machine">
          <p className="text-sm">
            Copy this command and run it in a terminal on the machine; when it
            asks, go back to the token, copy it and paste it (it isn&apos;t
            shown).
          </p>
          <CodeBlock
            label="Setup command"
            wrappable
            code={setupCommand({ origin, workspaceId, by })}
          />
          <WhatItDoes>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li>
                It stores the token in <Code>{tokenFile}</Code>, readable only
                by you. The token stays off the screen, out of your shell
                history and off every command line.
              </li>
              <li>
                It clones the catalog to <Code>{defaultCloneFolder}</Code>, from
                the address for agents,{" "}
                <Code>{catalogRepositoryUrl(origin, workspaceId)}</Code>. Git in
                that clone asks only Shinan&apos;s helper for a password, and
                the helper reads the token from its file; any other
                saved-password helper is switched off there.
              </li>
              <li>
                It records where the clone is, and how the agent signs its fact
                checks: <Code>{by}</Code>. Shinan refuses fact checks that name
                anyone else.
              </li>
              <li>
                Run it again with a new token to replace the old one; the clone
                stays as it is.
              </li>
            </ul>
          </WhatItDoes>
        </Section>
        <Section title="3. Add Shinan to OpenCode">
          <p className="text-sm">
            Merge this into your global OpenCode config (
            <Code>~/.config/opencode/opencode.jsonc</Code> or{" "}
            <Code>opencode.json</Code>).
          </p>
          <CodeBlock
            label="OpenCode configuration"
            code={openCodeConfig(origin)}
          />
          <WhatItDoes>
            <p>
              It loads Shinan&apos;s skill, which teaches the agent to read the
              catalog and push its changes, from{" "}
              <Code>{`${origin}/skills/`}</Code>. The rule stops OpenCode&apos;s
              file reader from opening the token&apos;s folder. Merge it with
              what the file already holds: keep your other settings, and add the
              skill and the rule to any <Code>skills</Code> and{" "}
              <Code>permissions</Code> you have. To use Shinan only for some
              projects, merge it into an <Code>opencode.jsonc</Code> in a folder
              above them instead. If an older setup added a <Code>shinan</Code>{" "}
              MCP server, remove it.
            </p>
          </WhatItDoes>
        </Section>
        <Section title="4. Check it">
          <p className="text-sm">
            If <Code>git fetch</Code> in <Code>{defaultCloneFolder}</Code>{" "}
            finishes without asking for anything, you&apos;re set. Ask your
            agent to read Start here.
          </p>
        </Section>
      </div>
      <Section title="Keep the token safe">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>Never paste it anywhere but the command in step 2.</li>
          <li>
            If it leaks or the machine is lost, revoke it in{" "}
            <Link to="/account/agents" className={linkClassName}>
              Your agents
            </Link>
            .
          </li>
          <li>To replace it, make a new token and run step 2 again.</li>
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

/** How a step works, for whoever wants to know. */
function WhatItDoes(props: { children: ReactNode }) {
  return (
    <details className="text-sm text-muted-foreground [&[open]>summary]:mb-2">
      <summary className="w-fit cursor-pointer rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring">
        What does this do?
      </summary>
      {props.children}
    </details>
  )
}

/** A block of text to copy onto the machine, with a copy button. */
function CodeBlock(props: {
  label: string
  code: string
  /** Offers to wrap a long one-line command, so it can be read whole. */
  wrappable?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [wrapped, setWrapped] = useState(false)
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
        className={`rounded-lg border bg-muted p-3 font-mono text-xs leading-relaxed sm:text-sm ${
          wrapped ? "break-all whitespace-pre-wrap" : "overflow-x-auto"
        }`}
      >
        <code>{props.code}</code>
      </pre>
      <div className="flex flex-wrap gap-2">
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
        {props.wrappable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setWrapped((w) => !w)}
          >
            {wrapped ? "Show on one line" : "Show the whole command"}
          </Button>
        )}
      </div>
    </figure>
  )
}
