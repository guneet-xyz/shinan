// Catalog purge (catalog §9; architecture §4.4): only the operations, their
// types and limits are public, and the scanner the Git container's history
// rewrite matches the text with, so both find it by the same rules.
export {
  forgetPurgedCatalogText,
  listCatalogPurges,
  previewCatalogPurge,
  purgeCatalogText,
  watchCatalogPurges,
} from "./purge.js"
export type { CatalogPurge, CatalogPurgePreview } from "./purge.js"
export {
  purgeLimits,
  purgeMarker,
  purgeNameMarker,
  PurgeScanner,
} from "./scanner.js"
