import { CheckIcon, CopyIcon } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"

import { catalogRepositoryUrl } from "@shinan/skill/setup"

import { Button } from "@/components/ui/button"

import { Section } from "../../components/page"
import { useWorkspace } from "./context"

/**
 * Settings › Catalog (product brief on #169), for every member: the
 * address for agents, to copy. The "not a secret" values and removing text
 * from the catalog's history join it with their packages (GC-3, GC-8).
 */
export function CatalogSettings() {
  const { workspace } = useWorkspace()
  // The same address the setup command clones (`@shinan/skill/setup`).
  const address = catalogRepositoryUrl(window.location.origin, workspace.id)
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(address).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Section title="Address for agents">
        <div className="flex flex-col gap-2">
          {/* Wrapped, not cut off: a person can read it whole on a phone. */}
          <code className="block rounded-md border bg-muted px-3 py-2 font-mono text-sm wrap-anywhere">
            {address}
          </code>
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
