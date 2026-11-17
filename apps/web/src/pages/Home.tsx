import { Navigate } from "react-router"

import { useAccount } from "../account"
import { CreateWorkspace } from "../components/CreateWorkspace"
import { PageHeader, Section } from "../components/page"

/** The start page: the person's first workspace, if they have one. */
export function Home() {
  const { account } = useAccount()
  const [first] = account.workspaces
  if (first) return <Navigate to={`/w/${first.id}`} replace />

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={`Welcome, ${account.person.name}`} />
      <Section
        title="Workspaces"
        description="You are not a member of any workspace yet. Joining a workspace needs an invitation from one of its workspace owners; it arrives by email. Or create a workspace of your own, and become its workspace owner."
      >
        <CreateWorkspace />
      </Section>
    </div>
  )
}
