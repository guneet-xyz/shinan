// The agent index (catalog §12): its JSON format, the queries agents and the
// wiki read it with, and its upkeep. The indexer itself, which alone writes
// the index, stays inside core: catalog proposals (M2-4) call it through
// `appendCatalogRevision` in the transaction that applies them.
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
  getCatalogChanges,
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
  CatalogChangeJson,
  CatalogChangesAnswer,
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
  catalogIndexRebuildQueue,
  checkCatalogIndexes,
  getCatalogIndexHealth,
  rebuildCatalogIndex,
  requestCatalogIndexRebuilds,
} from "./maintain.js"
export type {
  CatalogIndexHealth,
  CatalogIndexRebuildJob,
  CatalogIndexWorkspaceHealth,
  WorkspaceIndexCheck,
} from "./maintain.js"
export {
  agentAnswerText,
  agentCatalogList,
  agentCatalogLists,
  agentGetEntity,
  agentSearchCatalog,
  agentWorkspaceContext,
} from "./agent.js"
export type {
  AgentCatalogList,
  AgentCatalogListInput,
  AgentGetEntityInput,
  AgentSearchInput,
  AgentWorkspaceContext,
} from "./agent.js"
export { outsideLabel, shinanLabel } from "./labels.js"
export type { TrustLabel } from "./labels.js"
