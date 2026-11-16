import { Navigate } from "react-router"

import { useAccount } from "../account"

/** The start page: the person's first workspace, if they have one. */
export function Home() {
  const { account } = useAccount()
  const [first] = account.workspaces
  if (first) return <Navigate to={`/w/${first.id}`} replace />

  return (
    <section className="narrow">
      <h1>Welcome, {account.person.name}</h1>
      <p>
        You are not a member of any workspace yet. Joining a workspace needs an
        invitation from one of its workspace owners; it arrives by email.
      </p>
    </section>
  )
}
