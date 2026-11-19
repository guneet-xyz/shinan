import { NavLink, Route, Routes, useParams } from "react-router"

import { cn } from "@/lib/utils"

import { NotFound } from "../NotFound"
import { useWorkspace } from "../workspace/context"
import { NewEntity } from "./edit/NewEntity"
import { RecordCheck } from "./edit/RecordCheck"
import { StartHereEditor } from "./edit/StartHereEditor"
import { SuggestChange } from "./edit/SuggestChange"
import { EditType, NewType } from "./edit/TypeEditor"
import { EntityPage } from "./EntityPage"
import { wikiPath } from "./format"
import { ChangesPage, ListPage, SearchPage, WikiHome } from "./pages"
import { RepairPage } from "./RepairPage"
import { ProposalPage, ReviewPage } from "./review/ReviewPage"
import { StartHerePage } from "./StartHerePage"
import { TypePage } from "./TypePage"

/**
 * The wiki (human experience, the wiki): the catalog shown to people. This
 * module, with the Markdown renderer, is loaded only on wiki routes.
 */
export default function WikiRoutes() {
  const { workspace } = useWorkspace()
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-md px-2 py-1 text-sm text-foreground/70 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring",
      isActive && "font-medium text-foreground",
    )
  return (
    <div className="flex flex-col gap-6">
      <nav
        aria-label="Wiki"
        className="-mt-2 flex flex-wrap gap-1 border-b pb-2"
      >
        <NavLink to={wikiPath(workspace.id)} end className={tab}>
          Wiki home
        </NavLink>
        <NavLink to={wikiPath(workspace.id, "/start-here")} className={tab}>
          Start here
        </NavLink>
        <NavLink to={wikiPath(workspace.id, "/changes")} className={tab}>
          Recent changes
        </NavLink>
        <NavLink to={wikiPath(workspace.id, "/search")} className={tab}>
          Search
        </NavLink>
        <NavLink to={wikiPath(workspace.id, "/review")} className={tab}>
          Review
        </NavLink>
      </nav>
      <Routes>
        <Route index element={<WikiHome />} />
        <Route path="start-here" element={<StartHerePage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="changes" element={<ChangesPage />} />
        <Route path="types/:type" element={<TypePage />} />
        <Route path="lists/:list" element={<ListPage />} />
        <Route path="e/*" element={<EntityPage />} />
        <Route path="repair/*" element={<RepairPage />} />
        <Route path="edit/*" element={<EditPage />} />
        <Route path="check/*" element={<RecordCheck />} />
        <Route path="new" element={<NewEntity />} />
        <Route path="new-type" element={<NewType />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="proposals/:proposalId" element={<ProposalPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  )
}

/** Suggest a change, for an entity, a type schema document or Start here. */
function EditPage() {
  const id = useParams()["*"] ?? ""
  if (id === "start-here") return <StartHereEditor />
  const type = /^schema\/([a-z][a-z0-9-]*)$/.exec(id)?.[1]
  if (type) return <EditType type={type} />
  return <SuggestChange />
}
