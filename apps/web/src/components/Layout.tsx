import { MenuIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, Outlet, useLocation, useMatch } from "react-router"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import { useAccount } from "../account"
import { CatalogTreeContext, useCatalogTreeResource } from "../catalog-tree"
import { Sidebar } from "./Sidebar"

/** Where the workspace last open is kept, for pages outside a workspace. */
const lastWorkspaceKey = "shinan:workspace"

function rememberedWorkspace(): string | null {
  try {
    return localStorage.getItem(lastWorkspaceKey)
  } catch {
    return null
  }
}

/**
 * The workspace the sidebar shows: the one in the address, otherwise the
 * one last open, otherwise the person's first, so the navigation keeps its
 * shape on Your account and Installation.
 */
function useSidebarWorkspace(): string | undefined {
  const { account } = useAccount()
  const inAddress = useMatch("/w/:workspaceId/*")?.params.workspaceId
  const known = (id: string | null | undefined) =>
    id ? account.workspaces.find((w) => w.id === id)?.id : undefined
  const current = known(inAddress)
  useEffect(() => {
    if (!current) return
    try {
      localStorage.setItem(lastWorkspaceKey, current)
    } catch {
      // Private browsing may refuse storage: the first workspace is used.
    }
  }, [current])
  return (
    current ??
    known(rememberedWorkspace()) ??
    account.workspaces[0]?.id ??
    undefined
  )
}

/**
 * The frame around every signed-in page: the one sidebar on the left (a
 * menu on narrow screens) and the page.
 */
export function AppShell() {
  const workspaceId = useSidebarWorkspace()
  const tree = useCatalogTreeResource(workspaceId)
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  // Following a link in the menu closes it.
  const [shownAt, setShownAt] = useState(location.key)
  if (shownAt !== location.key) {
    setShownAt(location.key)
    setMenuOpen(false)
  }

  return (
    <CatalogTreeContext
      value={workspaceId && tree ? { workspaceId, tree } : null}
    >
      <div className="flex min-h-svh flex-col md:flex-row">
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-3 focus:ring-ring"
          href="#content"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background px-4 md:hidden">
          <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogTrigger render={<Button variant="outline" />}>
              <MenuIcon aria-hidden="true" />
              Menu
            </DialogTrigger>
            <DialogContent
              showCloseButton={false}
              className="top-0 left-0 h-svh max-w-[min(20rem,calc(100%-3rem))] translate-x-0 translate-y-0 gap-0 rounded-none p-0 sm:max-w-80 data-open:slide-in-from-left data-closed:slide-out-to-left"
            >
              <DialogTitle className="sr-only">Menu</DialogTitle>
              <Sidebar workspaceId={workspaceId} />
            </DialogContent>
          </Dialog>
          <Link
            to="/"
            className="rounded-md text-base font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring"
          >
            Shinan
          </Link>
        </header>
        <aside className="hidden w-72 shrink-0 border-r bg-sidebar md:block">
          <div className="sticky top-0 h-svh">
            <Sidebar workspaceId={workspaceId} />
          </div>
        </aside>
        <main
          id="content"
          className="mx-auto w-full max-w-3xl min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8"
        >
          <Outlet />
        </main>
      </div>
    </CatalogTreeContext>
  )
}
