import { CheckIcon, CopyIcon } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"

import { PageHeader, Section } from "../components/page"

const linkClassName = "text-foreground underline underline-offset-4"

/** Where the token is kept on the machine, readable only by its user. */
const tokenFile = "~/.config/shinan/token"

/**
 * Stores the token in bash or zsh: read without echo, so it is not on
 * screen, in scrollback or in history; written by the `printf` builtin, so
 * it is never in the process list; folder 700 and file 600 even if they
 * existed before, the file emptied and locked down before the token goes in.
 */
const storeTokenCommands = `(umask 077; mkdir -p ~/.config/shinan && chmod 700 ~/.config/shinan && IFS= read -rs t && : > ${tokenFile} && chmod 600 ${tokenFile} && printf '%s\\n' "$t" > ${tokenFile})`

/**
 * OpenCode's configuration for Shinan (agent integrations, "Setting up
 * OpenCode"): the MCP server with the token read from its file, and the
 * skill catalog. Nothing in it is secret.
 */
function openCodeConfig(origin: string): string {
  return JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        servers: {
          shinan: {
            type: "remote",
            url: `${origin}/mcp`,
            oauth: false,
            headers: { Authorization: `Bearer {file:${tokenFile}}` },
          },
        },
      },
      skills: [`${origin}/skills/`],
    },
    null,
    2,
  )
}

/**
 * Setting up OpenCode with a token made by hand (agent integrations,
 * "Setting up OpenCode"; build plan M2-9), linked from Your agents. The
 * addresses are this installation's own.
 */
export function AgentSetup() {
  const origin = window.location.origin
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Set up OpenCode">
        Connect OpenCode on one of your machines to Shinan, with a token made by
        hand. Its agent then reads your workspace's catalog through Shinan's MCP
        server and follows Shinan's skill.
      </PageHeader>
      <div className="flex flex-col gap-6">
        <Section title="1. Make a token">
          <p className="text-sm">
            In{" "}
            <Link to="/account/agents" className={linkClassName}>
              Your agents
            </Link>
            , create a token by hand for OpenCode on this machine. Choose{" "}
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
            In bash or zsh, run this, then paste the token and press Enter.
            Nothing is shown while you paste: the token stays off the screen,
            out of your shell history and off every command line, and the file
            is readable only by you, even if it was there before.
          </p>
          <CodeBlock
            label="Commands to store the token"
            code={storeTokenCommands}
          />
        </Section>
        <Section
          title="3. Configure OpenCode"
          description="Nothing here is secret: OpenCode reads the token from its file when it connects."
        >
          <p className="text-sm">
            Add this to <Code>opencode.jsonc</Code> in a folder above the
            projects that should use Shinan, or to{" "}
            <Code>~/.config/opencode/opencode.jsonc</Code> for every folder.
            Never put the token itself in a configuration or project file.
          </p>
          <CodeBlock
            label="OpenCode configuration"
            code={openCodeConfig(origin)}
          />
          <p className="text-sm text-muted-foreground">
            The MCP server is at <Code>{`${origin}/mcp`}</Code> and the skill at{" "}
            <Code>{`${origin}/skills/`}</Code>. Another coding tool sends the
            token as the header <Code>Authorization: Bearer &lt;token&gt;</Code>{" "}
            to the same address.
          </p>
        </Section>
        <Section title="4. Check it">
          <p className="text-sm">
            From a folder the configuration covers, run{" "}
            <Code>opencode mcp list</Code>. It shows{" "}
            <Code>shinan connected</Code>; if the first run finds no servers,
            run it again a few seconds later. Then ask the agent to load the{" "}
            <Code>shinan</Code> skill and call <Code>workspace_context</Code>:
            the answer names your agent and workspace.
          </p>
        </Section>
      </div>
      <Section title="Keep the token safe">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>
            The agent never needs to see the token. Never paste it into a chat,
            an issue, a project file or a command line.
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
            same way. OpenCode uses the new one on its next connection.
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
