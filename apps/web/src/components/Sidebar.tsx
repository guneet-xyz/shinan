import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  SearchIcon,
} from "lucide-react"
import { useMemo, useState } from "react"
import type { FormEvent, ReactNode } from "react"
import {
  Link,
  NavLink,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router"

import type { CatalogTreeItem } from "@shinan/api-client"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

import { useAccount } from "../account"
import {
  catalogFolders,
  catalogState,
  folderOf,
  useCatalogTree,
} from "../catalog-tree"
import { roleNames } from "../format"
import { catalogPath, entityPath } from "../pages/catalog/format"

/**
 * The app's one navigation (Git-based catalog plan §3; owner, 2026-11-20):
 * the workspace, search, Start here, Needs attention and the catalog's
 * folders, then Settings and Your account.
 */
export function Sidebar(props: { workspaceId: string | undefined }) {
  const { account } = useAccount()
  const state = useCatalogTree()
  const workspaceId = props.workspaceId
  const navLink = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex min-h-8 items-center gap-2 rounded-md px-2 text-sm text-foreground/80 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring",
      isActive && "bg-muted font-medium text-foreground",
    )
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-4">
      <div className="flex flex-col gap-2 px-2">
        <Link
          to="/"
          className="self-start rounded-md text-base font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring"
        >
          Shinan
        </Link>
        <WorkspaceSwitcher workspaceId={workspaceId} />
      </div>
      {workspaceId && (
        <>
          <SearchBox workspaceId={workspaceId} />
          <nav aria-label="Catalog" className="flex flex-col gap-1">
            <NavLink to={catalogPath(workspaceId)} end className={navLink}>
              Start here
            </NavLink>
            <NavLink
              to={catalogPath(workspaceId, "/needs-attention")}
              className={navLink}
            >
              Needs attention
              {state?.tree.data && state.tree.data.attention > 0 && (
                <span className="ml-auto rounded-full bg-muted-foreground/15 px-2 text-xs tabular-nums">
                  {state.tree.data.attention}
                  <span className="sr-only"> things</span>
                </span>
              )}
            </NavLink>
          </nav>
          <Separator />
          {state?.tree.data &&
            catalogState(state.tree.data) !== "setting-up" && (
              <CatalogTree
                workspaceId={workspaceId}
                items={state.tree.data.items}
              />
            )}
          <Separator />
        </>
      )}
      <nav aria-label="Settings and account" className="flex flex-col gap-1">
        {workspaceId && (
          <NavLink to={`/w/${workspaceId}/settings`} className={navLink}>
            Settings
          </NavLink>
        )}
        <NavLink to="/account" className={navLink}>
          Your account
        </NavLink>
        {account.operator && (
          <NavLink to="/installation" className={navLink}>
            Installation
          </NavLink>
        )}
      </nav>
    </div>
  )
}

/** The search box at the top of the sidebar. */
function SearchBox(props: { workspaceId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const onSearch =
    location.pathname === catalogPath(props.workspaceId, "/search")
  const [text, setText] = useState(onSearch ? (params.get("q") ?? "") : "")
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (text.trim() === "") return
    void navigate(
      catalogPath(
        props.workspaceId,
        `/search?${new URLSearchParams({ q: text.trim() }).toString()}`,
      ),
    )
  }
  return (
    <form role="search" onSubmit={submit} className="relative">
      <label htmlFor="sidebar-search" className="sr-only">
        Search the catalog
      </label>
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        id="sidebar-search"
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search the catalog…"
        className="pl-8"
      />
    </form>
  )
}

function CatalogTree(props: {
  workspaceId: string
  items: readonly CatalogTreeItem[]
}) {
  const location = useLocation()
  const folders = useMemo(() => catalogFolders(props.items), [props.items])
  const current = props.items.find(
    (item) =>
      item.id !== null &&
      decodeURIComponent(location.pathname) ===
        decodeURIComponent(entityPath(props.workspaceId, item.id)),
  )
  const currentFolder = current ? folderOf(current.path) : null
  // Folders opened or closed by hand; the current page's folder is open
  // unless closed by hand since that page opened.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  )
  const [shownFolder, setShownFolder] = useState(currentFolder)
  if (shownFolder !== currentFolder) {
    setShownFolder(currentFolder)
    if (currentFolder !== null && toggled.has(currentFolder)) {
      const next = new Map(toggled)
      next.delete(currentFolder)
      setToggled(next)
    }
  }
  const isOpen = (name: string) => toggled.get(name) ?? name === currentFolder

  if (folders.length === 0)
    return <p className="px-2 text-sm text-muted-foreground">No pages yet.</p>
  return (
    <nav aria-label="Pages" className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {folders.map((folder) =>
          folder.name === "" ? (
            folder.items.map((item) => (
              <li key={item.path}>
                <PageLink workspaceId={props.workspaceId} item={item} />
              </li>
            ))
          ) : (
            <li key={folder.name}>
              <FolderToggle
                name={folder.name}
                open={isOpen(folder.name)}
                onToggle={() =>
                  setToggled((t) =>
                    new Map(t).set(folder.name, !isOpen(folder.name)),
                  )
                }
              >
                <ul className="flex flex-col gap-0.5 py-0.5 pl-5">
                  {folder.items.map((item) => (
                    <li key={item.path}>
                      <PageLink workspaceId={props.workspaceId} item={item} />
                    </li>
                  ))}
                </ul>
              </FolderToggle>
            </li>
          ),
        )}
      </ul>
    </nav>
  )
}

function FolderToggle(props: {
  name: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const Icon = props.open ? ChevronDownIcon : ChevronRightIcon
  return (
    <>
      <button
        type="button"
        aria-expanded={props.open}
        onClick={props.onToggle}
        className="flex min-h-8 w-full items-center gap-1 rounded-md px-2 text-left text-sm text-foreground/80 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate">{props.name}</span>
      </button>
      {props.open && props.children}
    </>
  )
}

function PageLink(props: { workspaceId: string; item: CatalogTreeItem }) {
  const { item } = props
  return (
    <NavLink
      to={entityPath(props.workspaceId, item.id!)}
      className={({ isActive }) =>
        cn(
          "flex min-h-8 items-center rounded-md px-2 py-1 text-sm text-foreground/80 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring",
          isActive && "bg-muted font-medium text-foreground",
        )
      }
    >
      <span className="wrap-anywhere">{item.title ?? item.id}</span>
    </NavLink>
  )
}

/**
 * Lists the person's workspaces and their role in each (human experience,
 * Creating and switching workspaces). Nothing from one workspace shows in
 * another, so switching goes to the other workspace's own pages.
 */
function WorkspaceSwitcher(props: { workspaceId: string | undefined }) {
  const { account } = useAccount()
  const current = account.workspaces.find((w) => w.id === props.workspaceId)
  if (account.workspaces.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="w-full justify-between" />}
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
                    workspace.id === props.workspaceId ? "page" : undefined
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
