import { factIdentityKey } from "./identity.js"
import type { FactIdentityKey } from "./identity.js"
import type { EntityDocument, FactCheck, WrittenFact } from "./model.js"
import { blocking } from "./problems.js"
import type { Problem } from "./problems.js"
import { keySchema } from "./schemas.js"
import type { KeySchema, TypeRegistry, TypeSchema } from "./schemas.js"

/**
 * A fact with its key's type schema applied: cardinality, whether it is a
 * relation, its identity key and its fact check (catalog §4).
 */
export interface Fact extends WrittenFact {
  identity: FactIdentityKey
  /** The key's schema; for keys outside the type schema, `inSchema` is false. */
  schema: KeySchema
  /** The fact check of its group, or null for facts with no check. */
  check: FactCheck | null
}

/** An entity document read with the type schemas of the same revision. */
export interface ResolvedEntity {
  document: EntityDocument
  /** Null when the type is not a known type. */
  schema: TypeSchema | null
  /** The current facts (catalog §4.2): every fact in the document, in document order. */
  facts: Fact[]
  /** What does not fit the type schema. All are blocking. */
  problems: Problem[]
}

export function resolveEntity(
  document: EntityDocument,
  registry: TypeRegistry,
): ResolvedEntity {
  const schema =
    document.type === null ? null : (registry.types.get(document.type) ?? null)
  const problems: Problem[] = []
  const problem = (
    code: "fact-invalid" | "cardinality",
    message: string,
    fact: WrittenFact,
  ) => problems.push(blocking(code, message, document.id, fact.range))
  const listed = new Set<string>()

  const facts = document.facts.map((written): Fact => {
    const key = keySchema(schema, written.key)
    let fact: WrittenFact = written
    if (key.relation) {
      if (written.form === "short") {
        if (written.value !== undefined && typeof written.value !== "string")
          problem(
            "fact-invalid",
            `"${written.key}" is a relation; its value is an entity ID`,
            written,
          )
        fact = {
          ...written,
          value: undefined,
          to: typeof written.value === "string" ? written.value : undefined,
        }
      } else if (written.value !== undefined) {
        problem(
          "fact-invalid",
          `"${written.key}" is a relation; name its target with \`to\`, not \`value\``,
          written,
        )
      }
    } else {
      if (written.to !== undefined)
        problem(
          "fact-invalid",
          `"${written.key}" is not a relation, so it has a \`value\`, not \`to\``,
          written,
        )
      const extra = Object.keys(written.attributes)
      if (extra.length > 0)
        problem(
          "fact-invalid",
          `"${written.key}" is not a relation, so it cannot have ${extra.map((a) => `"${a}"`).join(", ")}; a fact's long form has value, via, note, task, remove and accepted`,
          written,
        )
    }
    if (!key.many && written.item !== null) {
      const where = `${written.group}:${written.state}:${written.key}`
      if (!listed.has(where)) {
        listed.add(where)
        problem(
          "cardinality",
          `"${written.key}" holds one value, not a list`,
          written,
        )
      }
    }
    const check =
      document.groups.find((g) => g.index === written.group)?.check ?? null
    return {
      ...fact,
      identity: factIdentityKey({
        key: fact.key,
        state: fact.state,
        many: key.many,
        relation: key.relation,
        value: fact.value,
        to: fact.to,
        via: fact.via,
        attributes: fact.attributes,
      }),
      schema: key,
      check,
    }
  })
  return { document, schema, facts, problems }
}

/** The current facts with this identity key: one, or more if the document repeats a fact. */
export function factsWithIdentity(
  entity: ResolvedEntity,
  identity: FactIdentityKey,
): Fact[] {
  return entity.facts.filter((f) => f.identity === identity)
}
