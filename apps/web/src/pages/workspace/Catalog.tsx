import { CheckIcon, CopyIcon } from "lucide-react"
import { useId, useState } from "react"
import type { FormEvent } from "react"
import { Link } from "react-router"

import { catalogRepositoryUrl } from "@shinan/skill/setup"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { useAction } from "../../action"
import { useApi, useResource } from "../../api"
import { Rows, Section } from "../../components/page"
import { ErrorMessage } from "../../components/status"
import { useWorkspace } from "./context"

/**
 * Settings › Catalog (product brief on #169): the address for agents, to
 * copy, for every member; for owners, the values that aren't secrets.
 * Removing text from the catalog's history (GC-8) is a page of its own,
 * behind a quiet link at the bottom (agreed on #170).
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
      {workspace.role === "owner" && <AllowedValues />}
      {/* GC-8: an owners-only "Remove text from the catalog's history →" link here. */}
    </div>
  )
}

/** A fingerprint as a refusal shows it, or a value to allow as it is. */
function allowInput(text: string): { value: string } | { fingerprint: string } {
  const trimmed = text.trim()
  return /^(?:sha256:)?[0-9a-f]{64}$/i.test(trimmed)
    ? { fingerprint: trimmed }
    : { value: text }
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
})

/**
 * Values that aren't secrets (GQ-2; product brief on #169), owners only:
 * a value the push checks took for a secret, allowed by the value or by
 * the fingerprint the refusal showed. Only fingerprints are kept, so the
 * list never shows a value. Adding and removing ask for a recent sign-in.
 */
function AllowedValues() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const values = useResource(`catalog-allowed-values:${workspace.id}`, () =>
    api.catalogAllowedValues(workspace.id),
  )
  const members = useResource(`members:${workspace.id}`, () =>
    api.members(workspace.id),
  )
  const [text, setText] = useState("")
  const add = useAction()
  const remove = useAction()
  const field = useId()
  const names = new Map(members.data?.map((m) => [m.personId, m.name]))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (text.trim() === "") return
    add.run(
      () => api.allowCatalogValue(workspace.id, allowInput(text)),
      () => {
        setText("")
        values.reload()
      },
    )
  }

  return (
    <Section
      title="Values that aren't secrets"
      description="If Shinan refused a push because something looked like a secret but isn't, add it here so the next push goes through."
    >
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Field>
          <FieldLabel htmlFor={field}>The value, or its fingerprint</FieldLabel>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={field}
              value={text}
              autoComplete="off"
              spellCheck={false}
              placeholder="sha256:… from the refusal"
              onChange={(event) => {
                setText(event.target.value)
                add.clear()
              }}
              className="font-mono"
            />
            <Button
              type="submit"
              disabled={add.pending || text.trim() === ""}
              className="self-start"
            >
              Allow
            </Button>
          </div>
          <FieldDescription>
            Shinan keeps only its fingerprint, never the value.
          </FieldDescription>
        </Field>
        {add.error !== undefined && <ErrorMessage error={add.error} />}
      </form>
      {values.error ? <ErrorMessage error={values.error} /> : null}
      {values.data && values.data.length === 0 && (
        <p className="text-sm text-muted-foreground">No values allowed yet.</p>
      )}
      {values.data && values.data.length > 0 && (
        <Rows aria-label="Allowed values">
          {values.data.map((allowed) => (
            <li
              key={allowed.fingerprint}
              className="sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="min-w-0 text-sm">
                Allowed {dateFormat.format(new Date(allowed.createdAt))} by{" "}
                {names.get(allowed.allowedByPersonId) ?? "a former member"}
                {" · "}
                <code
                  className="font-mono text-xs wrap-anywhere"
                  title={`sha256:${allowed.fingerprint}`}
                >
                  sha256:{allowed.fingerprint.slice(0, 12)}…
                </code>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={remove.pending}
                aria-label={`Remove sha256:${allowed.fingerprint.slice(0, 12)}…`}
                onClick={() =>
                  remove.run(
                    () =>
                      api.removeCatalogAllowedValue(
                        workspace.id,
                        allowed.fingerprint,
                      ),
                    () => values.reload(),
                  )
                }
                className="self-start"
              >
                Remove
              </Button>
            </li>
          ))}
        </Rows>
      )}
      {remove.error !== undefined && <ErrorMessage error={remove.error} />}
    </Section>
  )
}
