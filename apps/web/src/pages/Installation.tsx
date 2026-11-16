import { useState } from "react"
import type { FormEvent } from "react"

import type { AllowlistEntry } from "@shinan/api-client"

import { useAccount } from "../account"
import { useAction } from "../action"
import { useApi, useResource } from "../api"
import { ErrorMessage, Loading } from "../components/status"
import { formatDate } from "../format"

/**
 * Installation settings, for installation operators (identity §3.2, §12):
 * the email allowlist that decides who can have an account. Being on it
 * grants nothing in any workspace; joining one still needs an invitation.
 */
export function Installation() {
  const { account } = useAccount()
  if (!account.operator) {
    return (
      <>
        <h1>Installation settings</h1>
        <p>Only installation operators change installation settings.</p>
      </>
    )
  }
  return (
    <>
      <h1>Installation settings</h1>
      <Allowlist />
    </>
  )
}

function Allowlist() {
  const api = useApi()
  const entries = useResource("allowlist", () => api.allowlist())

  return (
    <section aria-labelledby="allowlist-heading">
      <h2 id="allowlist-heading">Email allowlist</h2>
      <p>
        Only these addresses can have an account. Removing an address ends that
        person&apos;s sign-in sessions and stops them signing in.
        Operators&apos; addresses come from the installation&apos;s
        configuration.
      </p>
      <AddAddress onAdded={entries.reload} />
      {entries.data ? (
        <ul className="cards">
          {entries.data.map((entry) => (
            <AllowlistRow
              key={entry.email}
              entry={entry}
              reload={entries.reload}
            />
          ))}
        </ul>
      ) : entries.error ? (
        <ErrorMessage error={entries.error} />
      ) : (
        <Loading />
      )}
    </section>
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
    <form onSubmit={submit} className="inline">
      <label htmlFor="allowlist-email" className="visually-hidden">
        Email address to allow
      </label>
      <input
        id="allowlist-email"
        type="email"
        required
        placeholder="name@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button type="submit" disabled={add.pending}>
        Add address
      </button>
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
    <li className="card">
      <div>
        <strong>{entry.email}</strong>
        {entry.operator && <span className="badge"> Operator</span>}
      </div>
      <dl className="facts compact">
        <dt>Account</dt>
        <dd>{entry.handle ?? "None yet"}</dd>
        <dt>Added</dt>
        <dd>{formatDate(entry.addedAt)}</dd>
      </dl>
      {!entry.operator &&
        (confirming ? (
          <div className="confirm">
            <p>
              Remove {entry.email}?
              {entry.handle &&
                ` ${entry.handle} is signed out everywhere and can no longer sign in.`}
            </p>
            <div className="actions">
              <button
                type="button"
                className="danger"
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
              </button>
              <button
                type="button"
                className="quiet"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="actions">
            <button
              type="button"
              className="danger"
              onClick={() => setConfirming(true)}
            >
              Remove…
            </button>
          </div>
        ))}
      {remove.error !== undefined && <ErrorMessage error={remove.error} />}
    </li>
  )
}
