// The agent index (catalog §12): its JSON format, the queries the catalog
// pages read it with, and its upkeep. The indexer itself, which alone writes
// the index, stays inside core: the worker's index job runs it after each
// update of `main` (Git-based catalog plan §2.7).
export type {
  AppliesJson,
  CatalogAnswer,
  DiscrepancyJson,
  EntityJson,
  EntitySummaryJson,
  FactCheckJson,
  FactJson,
  FreshnessJson,
  IncomingRelationJson,
  OutgoingRelationJson,
  ProblemJson,
  ResolvedStepJson,
  SectionJson,
  StepJson,
  TypeSchemaAnswerJson,
  TypeSchemaJson,
  TypeSchemaKeyJson,
} from "./format.js"
export {
  catalogLists,
  getCatalogEntity,
  getCatalogList,
  getCatalogNeighbours,
  getCatalogPoliciesFor,
  getCatalogStartHere,
  getCatalogTypeSchema,
  listCatalogEntities,
  listCatalogTypeSchemas,
  searchCatalog,
} from "./queries.js"
export type {
  CatalogAppliesAnswer,
  CatalogEntityAnswer,
  CatalogList,
  CatalogListInput,
  CatalogListItem,
  CatalogNeighboursAnswer,
  CatalogTypeSchemaAnswer,
  DiscrepancyItemJson,
  FactItemJson,
  ListAnswer,
  ListEntitiesInput,
  ListInput,
  NotYetRecordedItemJson,
  SearchInput,
  SearchResultJson,
  StartHereJson,
} from "./queries.js"
export {
  catalogIndexQueue,
  catchUpCatalogIndexes,
  checkCatalogIndexes,
  getCatalogIndexHealth,
  rebuildCatalogIndex,
  requestCatalogIndexRebuilds,
  updateCatalogIndex,
} from "./maintain.js"
export type {
  CatalogIndexHealth,
  CatalogIndexJob,
  CatalogIndexWorkspaceHealth,
  WorkspaceIndexCheck,
} from "./maintain.js"
export type { IndexUpdate } from "./indexer.js"
export { indexFailureReason, indexFailureReasons } from "./failure.js"
export type { IndexFailureReason } from "./failure.js"
