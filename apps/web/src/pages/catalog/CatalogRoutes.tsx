import { Route, Routes } from "react-router"

import { NotFound } from "../NotFound"
import { EntityPage } from "./EntityPage"
import { CatalogHome, NeedsAttentionPage, SearchPage } from "./pages"
import { TypePage } from "./TypePage"

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
      <Route path="types/:type" element={<TypePage />} />
      <Route path="p/*" element={<EntityPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
