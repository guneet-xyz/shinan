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
import { Section } from "../../components/page"
import { ErrorMessage } from "../../components/status"
import { VisibleText } from "../catalog/VisibleText"
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

/** Why what was typed can't be allowed. */
class InputError extends Error {}

/**
 * The fingerprint to allow: as typed, when it is one as a refusal shows it
 * (`sha256:` and 64 hexadecimal characters); otherwise the SHA-256 of the
 * value, worked out here, so the value never leaves the page (review of
 * #196). Spaces around a pasted value are left out.
 */
async function fingerprintOf(text: string): Promise<string> {
  const trimmed = text.trim()
  if (/^sha256:/i.test(trimmed)) {
    if (!/^sha256:[0-9a-f]{64}$/i.test(trimmed))
      throw new InputError(
        "That isn't a whole fingerprint: it is sha256: and 64 letters and digits, as the refusal shows it.",
      )
    return trimmed.toLowerCase()
  }
  if (!crypto.subtle)
    throw new InputError(
      "This browser can't work out the fingerprint here: open Shinan over https.",
    )
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(trimmed),
  )
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `sha256:${hex}`
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
  const [inputError, setInputError] = useState<string | null>(null)
  const add = useAction()
  const remove = useAction()
  const field = useId()
  const names = new Map(members.data?.map((m) => [m.personId, m.name]))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (text.trim() === "") return
    setInputError(null)
    add.run(async () => {
      let fingerprint: string
      try {
        fingerprint = await fingerprintOf(text)
      } catch (error) {
        if (error instanceof InputError) {
          setInputError(error.message)
          return
        }
        throw error
      }
      await api.allowCatalogValue(workspace.id, { fingerprint })
      setText("")
      values.reload()
    })
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
            {/* Masked as it is typed: it may look like a secret. */}
            <Input
              id={field}
              type="password"
              value={text}
              autoComplete="off"
              spellCheck={false}
              placeholder="The value, or sha256:… from the refusal"
              aria-invalid={inputError !== null}
              aria-describedby={`${field}-help`}
              onChange={(event) => {
                setText(event.target.value)
                setInputError(null)
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
          <FieldDescription id={`${field}-help`}>
            Shinan works out its fingerprint on this page and keeps only that,
            never the value.
          </FieldDescription>
        </Field>
        {inputError && (
          <p role="alert" className="text-sm text-destructive">
            {inputError}
          </p>
        )}
        {add.error !== undefined && <ErrorMessage error={add.error} />}
      </form>
      {values.error ? <ErrorMessage error={values.error} /> : null}
      {values.data && values.data.length === 0 && (
        <p className="text-sm text-muted-foreground">No values allowed yet.</p>
      )}
      {values.data && values.data.length > 0 && (
        <ul
          aria-label="Allowed values"
          className="flex flex-col divide-y rounded-lg border"
        >
          {values.data.map((allowed) => (
            <li
              key={allowed.fingerprint}
              // One row: the text left, Remove at the right end; on a
              // phone the text wraps above it (product review of #196).
              className="flex flex-col items-start gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:p-4"
            >
              <span className="min-w-0 text-left text-sm">
                Allowed {dateFormat.format(new Date(allowed.createdAt))} by{" "}
                <VisibleText
                  text={
                    names.get(allowed.allowedByPersonId) ?? "a former member"
                  }
                  oneLine
                />
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
                className="shrink-0 self-start sm:self-center"
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {remove.error !== undefined && <ErrorMessage error={remove.error} />}
    </Section>
  )
}
