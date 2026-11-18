import type { schema } from "@shinan/db"

import { dayMillis } from "../document/dates.js"
import {
  canonicalValue,
  discrepancies,
  notYetRecorded,
  parserVersion,
  resolveEntity,
} from "../document/index.js"
import type {
  CatalogDocument,
  Fact,
  ResolvedEntity,
  StartHereStep,
  TypeRegistry,
  TypeSchema,
} from "../document/index.js"
import type { AttributedSection } from "./attribution.js"
import { stepJson, typeSchemaJson } from "./format.js"

export type DocumentRow = typeof schema.catalogIndexDocuments.$inferInsert
export type FactRow = typeof schema.catalogIndexFacts.$inferInsert
export type RelationRow = typeof schema.catalogIndexRelations.$inferInsert
export type DiscrepancyRow =
  typeof schema.catalogIndexDiscrepancies.$inferInsert
export type SectionRow = typeof schema.catalogIndexSections.$inferInsert

/** Every index row one catalog document gives. */
export interface DocumentRows {
  document: DocumentRow
  facts: FactRow[]
  relations: RelationRow[]
  discrepancies: DiscrepancyRow[]
  sections: SectionRow[]
}

export interface DeriveInput {
  workspaceId: string
  documentId: string
  /** The catalog revision whose text `document` was read from. */
  revision: number
  document: CatalogDocument
  /** The type schemas of the same revision (architecture §5.2). */
  registry: TypeRegistry
  /** Credits for `document.body.sections`, in the same order. */
  attribution: readonly AttributedSection[]
}

/**
 * The index rows of one document, from its parsed text and the type schemas
 * of the same revision alone (architecture §5.2, rule 3). Pure: the same
 * input always gives the same rows, which is what the round-trip check
 * compares the stored rows with.
 */
export function deriveDocumentRows(input: DeriveInput): DocumentRows {
  const { document } = input
  const sections = document.body.sections
  if (sections.length !== input.attribution.length)
    throw new Error("Every section needs its credit")
  const base = {
    workspaceId: input.workspaceId,
    documentId: input.documentId,
    parserVersion,
  }
  const entity =
    document.kind === "entity" && document.id !== null
      ? resolveEntity(document, input.registry)
      : null

  const row: DocumentRow = {
    ...base,
    revision: input.revision,
    kind: document.kind,
    catalogId: document.id,
    type: null,
    title: document.title,
    summary: document.summary,
    status: null,
    owner: document.owner,
    replacedBy: null,
    aliases: [],
    importedFrom: document.importedFrom,
    decisionState: null,
    decidedOn: null,
    decidedBy: null,
    missingKeys: [],
    problems: [...document.problems, ...(entity?.problems ?? [])].map((p) => ({
      code: p.code,
      message: p.message,
    })),
    data: null,
    searchText: "",
  }
  const searchWords: string[] = []
  if (document.id !== null) searchWords.push(document.id, idWords(document.id))

  let facts: FactRow[] = []
  let relations: RelationRow[] = []
  let found: DiscrepancyRow[] = []
  if (document.kind === "entity") {
    row.type = document.type
    row.status = document.status
    row.replacedBy = document.replacedBy
    row.aliases = [...document.aliases]
    row.decisionState = document.decision?.state ?? null
    row.decidedOn = document.decision?.decidedOn?.text ?? null
    row.decidedBy = document.decision?.decidedBy ?? null
    for (const alias of document.aliases)
      searchWords.push(alias, idWords(alias))
    if (document.type !== null) searchWords.push(document.type)
    if (entity && document.id !== null) {
      const id = document.id
      row.missingKeys = notYetRecorded(entity).missingKeys
      facts = entity.facts.map((fact, position) =>
        factRow(base, id, fact, position),
      )
      for (const fact of entity.facts) searchWords.push(...factWords(fact))
      relations = relationRows(base, entity)
      found = discrepancies(entity).map((d) => ({
        ...base,
        entityId: id,
        key: d.key,
        values: d.values,
        identities: d.facts.map((f) => f.identity),
        accepted: d.accepted,
      }))
    }
  } else if (document.kind === "schema") {
    row.type = document.describes
    row.status = document.status
    const resolved = schemaOf(input.registry, document.id)
    row.data = resolved ? { schema: typeSchemaJson(resolved) } : null
    if (document.describes !== null) searchWords.push(document.describes)
  } else {
    row.data = {
      people: document.people.map((s: StartHereStep) => stepJson(s)),
      agents: document.agents.map((s: StartHereStep) => stepJson(s)),
    }
  }
  row.searchText = searchWords.join("\n")

  return {
    document: row,
    facts,
    relations,
    discrepancies: found,
    sections: sections.map((section, position) => {
      const credit = input.attribution[position]!
      return {
        ...base,
        position,
        catalogId: document.id,
        heading: section.heading,
        level: section.level,
        anchor: section.anchor,
        text: section.text,
        start: section.range.start,
        end: section.range.end,
        changedRevision: credit.changedRevision,
        authorKind: credit.authorKind,
        author: credit.author,
      }
    }),
  }
}

type Base = Pick<FactRow, "workspaceId" | "documentId" | "parserVersion">

function factRow(
  base: Base,
  entityId: string,
  fact: Fact,
  position: number,
): FactRow {
  const checked = fact.check?.checked
  const checkedAt = checked ? checked.at : null
  const recheckDays = fact.schema.recheckDays
  return {
    ...base,
    position,
    entityId,
    identity: fact.identity,
    key: fact.key,
    state: fact.state,
    form: fact.form,
    value: fact.value === undefined ? null : [fact.value],
    to: fact.to ?? null,
    via: fact.via ?? null,
    note: fact.note ?? null,
    task: fact.task ?? null,
    remove: fact.remove,
    accepted: fact.accepted ?? null,
    attributes: { ...fact.attributes },
    groupIndex: fact.group,
    many: fact.schema.many,
    relation: fact.schema.relation !== null,
    inSchema: fact.schema.inSchema,
    recheckDays,
    hasCheck: fact.check !== null,
    checked: checked ? checked.text : null,
    checkedAt: checkedAt === null ? null : new Date(checkedAt),
    by: fact.check?.by ?? null,
    scope: fact.check?.scope ?? null,
    source: fact.check?.source ?? null,
    limits: fact.check?.limits ?? null,
    dueAt:
      fact.state === "planned" || checkedAt === null || recheckDays === null
        ? null
        : new Date(checkedAt + recheckDays * dayMillis),
  }
}

/** The inverses the wiki shows for entity fields (catalog §5). */
export const fieldInverses = { owner: "owns", replaced_by: "replaces" } as const

function relationRows(base: Base, entity: ResolvedEntity): RelationRow[] {
  const document = entity.document
  const fromId = document.id!
  const rows: RelationRow[] = []
  for (const fact of entity.facts) {
    if (!fact.schema.relation || fact.to === undefined) continue
    rows.push({
      ...base,
      position: rows.length,
      fromId,
      fromType: document.type,
      key: fact.key,
      toId: fact.to,
      state: fact.state,
      identity: fact.identity,
      attributes: { ...fact.attributes },
      inverse: fact.schema.relation.inverse,
      field: false,
    })
  }
  const fields = [
    ["owner", document.owner],
    ["replaced_by", document.replacedBy],
  ] as const
  for (const [key, target] of fields) {
    if (target === null || target === "unknown") continue
    rows.push({
      ...base,
      position: rows.length,
      fromId,
      fromType: document.type,
      key,
      toId: target,
      state: null,
      identity: null,
      attributes: {},
      inverse: fieldInverses[key],
      field: true,
    })
  }
  return rows
}

function schemaOf(
  registry: TypeRegistry,
  documentId: string | null,
): TypeSchema | null {
  if (documentId === null) return null
  for (const type of registry.types.values())
    if (type.documentId === documentId) return type
  return null
}

/** `machine/musashi` as the words `machine musashi`. */
function idWords(id: string): string {
  return id.replace(/[/._-]+/g, " ")
}

function factWords(fact: Fact): string[] {
  const words = [fact.key, idWords(fact.key)]
  const add = (v: string | number | boolean | null | undefined) => {
    if (v !== undefined && v !== null) words.push(canonicalValue(v))
  }
  add(fact.value)
  add(fact.to)
  add(fact.via)
  add(fact.note)
  for (const value of Object.values(fact.attributes)) add(value)
  return words
}
