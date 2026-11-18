// The pure catalog document model (catalog §2 to §5, §11): no database and no
// I/O. Everything derived from catalog text goes through here.
export {
  comparableValue,
  discrepancies,
  freshness,
  knownUnknowns,
  notYetRecorded,
} from "./analysis.js"
export type { Discrepancy, Freshness, NotYetRecorded } from "./analysis.js"
export { referenceTarget } from "./body.js"
export type { Body, BodyLink, Section } from "./body.js"
export { readCatalog } from "./catalog.js"
export type { Catalog } from "./catalog.js"
export { parseCatalogTime } from "./dates.js"
export type { CatalogTime } from "./dates.js"
export { factsWithIdentity, resolveEntity } from "./entity.js"
export type { Fact, ResolvedEntity } from "./entity.js"
export {
  canonicalValue,
  factIdentityKey,
  identityWithoutState,
  parseFactIdentityKey,
} from "./identity.js"
export type {
  FactIdentityKey,
  IdentityInput,
  ParsedFactIdentityKey,
} from "./identity.js"
export {
  factKeyPattern,
  isAttributeName,
  isEntityId,
  parseEntityId,
  reservedTypeNames,
  schemaId,
  schemaType,
  slugPattern,
  startHereId,
  taskIdPattern,
  typeNamePattern,
  workspaceTarget,
} from "./ids.js"
export type { EntityId } from "./ids.js"
export {
  checkFields,
  decisionStates,
  entityStatuses,
  factStates,
  workspaceLists,
} from "./model.js"
export type {
  CatalogDocument,
  CheckField,
  DecisionFields,
  DecisionState,
  EntityDocument,
  EntityStatus,
  FactCheck,
  FactGroup,
  FactState,
  SchemaDocument,
  SchemaKeyDefinition,
  StartHereDocument,
  StartHereStep,
  StartHereTarget,
  WorkspaceList,
  WrittenFact,
} from "./model.js"
export {
  maxDocumentBytes,
  parseCatalogDocument,
  parserVersion,
} from "./parse.js"
export type { Problem, ProblemCode, Severity } from "./problems.js"
export {
  anyTarget,
  buildTypeRegistry,
  builtInSchemas,
  builtInTypes,
  factOptions,
  keySchema,
  taskTarget,
} from "./schemas.js"
export type {
  KeySchema,
  RelationSchema,
  TypeRegistry,
  TypeSchema,
} from "./schemas.js"
export {
  bodyShape,
  maxContainerBlocks,
  maxLazyLines,
  maxNestedContainers,
  maxNesting,
  maxUnderlines,
  tooComplex,
} from "./limits.js"
export type { BodyShape } from "./limits.js"
export { lineRange, positionAt, utf8Length } from "./source.js"
export type { Position, Range } from "./source.js"
export type {
  ScalarValue,
  YamlEntry,
  YamlList,
  YamlMap,
  YamlNode,
  YamlScalar,
} from "./yaml.js"
