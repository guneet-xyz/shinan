import { currentField, settable } from "./apply.js"
import type { CatalogDocument, StartHereStep } from "./model.js"
import type {
  DocumentField,
  KeyOptions,
  StartHereStepInput,
} from "./operations.js"

/**
 * What the wiki's editors need to write a document's operations (catalog
 * §8.1, §8.5): each field, key and path as the operations expect it, read
 * from the stored text, never from the index. Facts are not here: the
 * index's facts give their expectations exactly (`presentFact` in the API
 * client, checked against `expectationOf`).
 */
export interface EditableDocument {
  kind: CatalogDocument["kind"]
  /** The fields `set-field` changes on this kind of document, as `expect.value` names them. */
  fields: Partial<Record<DocumentField, string | string[] | null>>
  /** The body as written, and its sections, as `edit-body` expects them. */
  body: {
    text: string
    sections: {
      anchor: string | null
      heading: string | null
      level: number
      text: string
    }[]
  }
  /** A type schema document's keys as written, as `set-schema-key` expects them. */
  keys?: { key: string; options: KeyOptions }[]
  /** The start-here document's paths, as `set-start-here-path` expects them. */
  paths?: { people: StartHereStepInput[]; agents: StartHereStepInput[] }
}

/** A `decision` entity's own fields, which other entities do not have. */
const decisionFields: ReadonlySet<DocumentField> = new Set([
  "decision_state",
  "decided_on",
  "decided_by",
])

export function editableDocument(document: CatalogDocument): EditableDocument {
  const fields: EditableDocument["fields"] = {}
  for (const name of Object.keys(settable[document.kind]) as DocumentField[]) {
    if (
      document.kind === "entity" &&
      document.type !== "decision" &&
      decisionFields.has(name)
    )
      continue
    const value = currentField(document, name)
    if (value !== undefined) fields[name] = value
  }
  const editable: EditableDocument = {
    kind: document.kind,
    fields,
    body: {
      text: document.body.text,
      sections: document.body.sections.map((s) => ({
        anchor: s.anchor,
        heading: s.heading,
        level: s.level,
        text: s.text,
      })),
    },
  }
  if (document.kind === "schema")
    editable.keys = document.keys.map((k) => {
      const options: KeyOptions = {}
      if (k.many !== undefined) options.many = k.many
      if (k.relation !== undefined) options.relation = k.relation
      if (k.identifiedBy !== undefined) options.identifiedBy = k.identifiedBy
      if (k.inverse !== undefined) options.inverse = k.inverse
      if (k.recheck !== undefined) options.recheck = k.recheck
      return { key: k.key, options }
    })
  if (document.kind === "start-here")
    editable.paths = {
      people: document.people.map(stepInput),
      agents: document.agents.map(stepInput),
    }
  return editable
}

function stepInput(step: StartHereStep): StartHereStepInput {
  const t = step.target
  return t.kind === "entity"
    ? { to: t.id, note: step.note }
    : t.kind === "list"
      ? { list: t.list, note: step.note }
      : { url: t.url, note: step.note }
}
