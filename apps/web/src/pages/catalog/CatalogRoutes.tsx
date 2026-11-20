import { Navigate, Route, Routes, useParams } from "react-router"

import { NotFound } from "../NotFound"
import { PageRoute } from "./DocumentPage"
import { catalogPath } from "./format"
import { HistoryPage } from "./HistoryPage"
import { CatalogHome, NeedsAttentionPage, SearchPage } from "./pages"
import { SourcePage } from "./SourcePage"

/**
 * The catalog (human experience, the catalog): `main` shown to people as
 * pages. Its navigation is the app's sidebar. This module, with the
 * Markdown renderer, is loaded only on catalog routes.
 */
export default function CatalogRoutes() {
  return (
    <Routes>
      <Route index element={<CatalogHome />} />
      <Route path="search" element={<SearchPage />} />
      <Route path="needs-attention" element={<NeedsAttentionPage />} />
      <Route path="types/:type" element={<TypeRedirect />} />
      <Route path="p/*" element={<PageRoute />} />
      <Route path="history/*" element={<HistoryPage />} />
      <Route path="source/*" element={<SourcePage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

/** A type's page was its schema's: that is a page like any other now. */
function TypeRedirect() {
  const { workspaceId, type } = useParams()
  return (
    <Navigate replace to={catalogPath(workspaceId!, `/p/schema/${type}`)} />
  )
}
