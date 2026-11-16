import { Link, NavLink, Outlet, useParams } from "react-router"

import { useAccount } from "../account"
import { roleNames } from "../format"

/** The frame around every signed-in page: the top bar and the content. */
export function AppShell() {
  return (
    <>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="topbar">
        <Link to="/" className="brand">
          Shinan
        </Link>
        <WorkspaceSwitcher />
        <nav aria-label="Account" className="topbar-end">
          <NavLink to="/account">Your account</NavLink>
        </nav>
      </header>
      <main id="content" className="page">
        <Outlet />
      </main>
    </>
  )
}

/**
 * Lists the person's workspaces and their role in each (human experience,
 * Creating and switching workspaces). Nothing from one workspace shows in
 * another, so switching goes to the other workspace's own pages.
 */
function WorkspaceSwitcher() {
  const { account } = useAccount()
  const { workspaceId } = useParams()
  const current = account.workspaces.find((w) => w.id === workspaceId)
  if (account.workspaces.length === 0) return null

  return (
    <details className="switcher">
      <summary>
        {current ? current.name : "Workspaces"}
        <span className="visually-hidden"> (switch workspace)</span>
      </summary>
      <ul>
        {account.workspaces.map((workspace) => (
          <li key={workspace.id}>
            <Link
              to={`/w/${workspace.id}`}
              aria-current={workspace.id === workspaceId ? "page" : undefined}
            >
              <span>{workspace.name}</span>
              <span className="muted">{roleNames[workspace.role]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  )
}
