import { useState } from "react"
import type { FormEvent } from "react"

import type { AllowlistEntry } from "@shinan/api-client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { useAccount } from "../account"
import { useAction } from "../action"
import { useApi, useResource } from "../api"
import {
  Actions,
  Confirm,
  Facts,
  PageHeader,
  Rows,
  Section,
} from "../components/page"
import { ErrorMessage, Loading } from "../components/status"
import { formatDate } from "../format"

/**
 * Installation settings, for installation operators (identity §3.2, §12):
 * the email allowlist that decides who can have an account. Being on it
 * grants nothing in any workspace; joining one still needs an invitation.
 */
export function Installation() {
  const { account } = useAccount()
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Installation settings" />
      {account.operator ? (
        <Allowlist />
      ) : (
        <p className="text-muted-foreground">
          Only installation operators change installation settings.
        </p>
      )}
    </div>
  )
}

function Allowlist() {
  const api = useApi()
  const entries = useResource("allowlist", () => api.allowlist())

  return (
    <Section
      title="Email allowlist"
      description="Only these addresses can have an account. Removing an address ends that person's sign-in sessions and stops them signing in. Operators' addresses come from the installation's configuration."
    >
      <AddAddress onAdded={entries.reload} />
      {entries.data ? (
        <Rows>
          {entries.data.map((entry) => (
            <AllowlistRow
              key={entry.email}
              entry={entry}
              reload={entries.reload}
            />
          ))}
        </Rows>
      ) : entries.error ? (
        <ErrorMessage error={entries.error} />
      ) : (
        <Loading />
      )}
    </Section>
  )
}

function AddAddress(props: { onAdded: () => void }) {
  const api = useApi()
  const [email, setEmail] = useState("")
  const add = useAction()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const address = email.trim()
    add.run(
      () => api.addToAllowlist(address),
      () => {
        setEmail("")
        props.onAdded()
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="allowlist-email" className="sr-only">
          Email address to allow
        </label>
        <Input
          id="allowlist-email"
          type="email"
          required
          placeholder="name@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" disabled={add.pending}>
          Add address
        </Button>
      </div>
      {add.error !== undefined && <ErrorMessage error={add.error} />}
    </form>
  )
}

function AllowlistRow(props: { entry: AllowlistEntry; reload: () => void }) {
  const api = useApi()
  const { entry } = props
  const remove = useAction()
  const [confirming, setConfirming] = useState(false)

  return (
    <li>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="font-medium break-all">{entry.email}</strong>
        {entry.operator && <Badge variant="secondary">Operator</Badge>}
      </div>
      <Facts>
        <dt>Account</dt>
        <dd>{entry.handle ?? "None yet"}</dd>
        <dt>Added</dt>
        <dd>{formatDate(entry.addedAt)}</dd>
      </Facts>
      {!entry.operator &&
        (confirming ? (
          <Confirm>
            <p>
              Remove {entry.email}?
              {entry.handle &&
                ` ${entry.handle} is signed out everywhere and can no longer sign in.`}
            </p>
            <Actions>
              <Button
                type="button"
                variant="destructive"
                disabled={remove.pending}
                onClick={() =>
                  remove.run(
                    () => api.removeFromAllowlist(entry.email),
                    () => {
                      setConfirming(false)
                      props.reload()
                    },
                  )
                }
              >
                Remove
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </Actions>
          </Confirm>
        ) : (
          <Actions>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setConfirming(true)}
            >
              Remove…
            </Button>
          </Actions>
        ))}
      {remove.error !== undefined && <ErrorMessage error={remove.error} />}
    </li>
  )
}
