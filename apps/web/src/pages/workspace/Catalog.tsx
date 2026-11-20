import { CheckIcon, CopyIcon } from "lucide-react"
import { useId, useState } from "react"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { Section } from "../../components/page"
import { useWorkspace } from "./context"

/**
 * The address agents clone the workspace's catalog from, through `web`'s
 * Git endpoint (Git-based catalog plan §2.2): `/git/<workspace ID>.git`
 * on this installation.
 */
function cloneAddress(workspaceId: string, origin: string): string {
  return `${origin}/git/${workspaceId}.git`
}

/**
 * Settings › Catalog (product brief on #169), for every member: the
 * address for agents, to copy. The "not a secret" values and removing text
 * from the catalog's history join it with their packages (GC-3, GC-8).
 */
export function CatalogSettings() {
  const { workspace } = useWorkspace()
  const address = cloneAddress(workspace.id, window.location.origin)
  const [copied, setCopied] = useState(false)
  const field = useId()
  const copy = () => {
    void navigator.clipboard?.writeText(address).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Section title="Address for agents">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor={field} className="sr-only">
            Address for agents
          </label>
          <Input
            id={field}
            readOnly
            value={address}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs sm:text-sm"
          />
          <Button
            type="button"
            variant="outline"
            onClick={copy}
            className="self-start"
          >
            {copied ? (
              <CheckIcon aria-hidden="true" />
            ) : (
              <CopyIcon aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Agents clone the catalog from here.{" "}
          <Link
            to="/account/agents/setup"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Set up an agent →
          </Link>
        </p>
      </Section>
    </div>
  )
}
