import { ChevronsUpDownIcon } from "lucide-react"
import { Link, NavLink, Outlet, useParams } from "react-router"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

import { useAccount } from "../account"
import { roleNames } from "../format"

/** The frame around every signed-in page: the top bar and the content. */
export function AppShell() {
  return (
    <div className="flex min-h-svh flex-col">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-3 focus:ring-ring"
        href="#content"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/95 supports-backdrop-filter:bg-background/80 supports-backdrop-filter:backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <Link
            to="/"
            className="rounded-md text-base font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring"
          >
            Shinan
          </Link>
          <WorkspaceSwitcher />
          <nav aria-label="Account" className="ml-auto">
            <NavLink
              to="/account"
              className={({ isActive }) =>
                cn(buttonVariants({ variant: "ghost" }), isActive && "bg-muted")
              }
            >
              Your account
            </NavLink>
          </nav>
        </div>
      </header>
      <main
        id="content"
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
      >
        <Outlet />
      </main>
    </div>
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
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            className="max-w-48 min-w-0 shrink sm:max-w-64"
          />
        }
      >
        <span className="truncate">
          {current ? current.name : "Workspaces"}
        </span>
        <span className="sr-only"> (switch workspace)</span>
        <ChevronsUpDownIcon
          aria-hidden="true"
          className="text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto max-w-[calc(100vw-2rem)] min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {account.workspaces.map((workspace) => (
            <DropdownMenuLinkItem
              key={workspace.id}
              render={
                <Link
                  to={`/w/${workspace.id}`}
                  aria-current={
                    workspace.id === workspaceId ? "page" : undefined
                  }
                />
              }
              className="justify-between gap-4 aria-[current=page]:font-medium"
            >
              <span className="truncate">{workspace.name}</span>
              <span className="text-xs text-foreground/70">
                {roleNames[workspace.role]}
              </span>
            </DropdownMenuLinkItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
