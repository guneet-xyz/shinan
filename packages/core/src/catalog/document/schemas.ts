import { factKeyPattern, reservedTypeNames } from "./ids.js"
import type { EntityStatus, SchemaDocument } from "./model.js"
import { recheckPattern } from "./parse.js"
import { blocking } from "./problems.js"
import type { Problem } from "./problems.js"

/**
 * A relation target meaning any entity, an entity type (written
 * `schema/<type>`) or the whole workspace (written `workspace`). Only
 * `applies-to` uses it (catalog §5).
 */
export const anyTarget = "*"

/**
 * A relation target meaning a task, written as its task ID. Only `from-task`
 * uses it (catalog §5). Until tasks exist (M3), only the ID's form is checked.
 */
export const taskTarget = "task"

export interface RelationSchema {
  /** Entity types the relation may point to, or `anyTarget` or `taskTarget`. */
  targets: readonly string[]
  /** Attributes that, with the target, identify the relation (catalog §4.2). */
  identifiedBy: readonly string[]
  /** The name shown on the target for the generated inverse (catalog §5). */
  inverse: string | null
}

export interface KeySchema {
  key: string
  /** Multi-valued (catalog §4.2). */
  many: boolean
  relation: RelationSchema | null
  /** How often to recheck, in days; null for no interval (catalog §4.6). */
  recheckDays: number | null
  /** Whether the type schema names the key. Other keys are allowed but flagged (catalog §3.9). */
  inSchema: boolean
  /** Whether the key is one of Shinan's built-in keys, which cannot be changed. */
  builtIn: boolean
}

export interface TypeSchema {
  type: string
  builtIn: boolean
  /** Whether a workspace schema document adds to this built-in type. */
  extended: boolean
  /** The schema document, for custom types and extended built-in types. */
  documentId: string | null
  status: EntityStatus
  keys: ReadonlyMap<string, KeySchema>
  /** Keys every entity should record; missing ones are listed, not errors (catalog §4.8). */
  required: readonly string[]
  /** Body section conventions. */
  sections: readonly string[]
}

interface BuiltInKey {
  many?: boolean
  relation?: {
    to: readonly string[]
    inverse: string
    identifiedBy?: readonly string[]
  }
  /** Days, or null for no interval. */
  recheck: number | null
}

interface BuiltInType {
  keys: Record<string, BuiltInKey>
  required: readonly string[]
  sections: readonly string[]
}

const secretsIn: BuiltInKey = {
  relation: {
    to: ["service"],
    inverse: "secrets kept for",
    identifiedBy: ["item"],
  },
  recheck: 90,
}

/**
 * The eight built-in type schemas (catalog §3, §5). Recheck intervals are
 * proposed in M2-1 and recorded in catalog §4.6.
 */
const builtIns: Record<string, BuiltInType> = {
  project: {
    keys: {
      repository: { many: true, recheck: 180 },
      "docs.readme": { recheck: 180 },
      "docs.agent_instructions": { recheck: 180 },
      "docs.deployment": { recheck: 180 },
      issue_tracker: { recheck: 180 },
      "release.latest": { recheck: 30 },
      "checkout-on": {
        relation: {
          to: ["machine"],
          inverse: "checkouts",
          identifiedBy: ["path"],
        },
        recheck: 30,
      },
      provides: {
        relation: { to: ["service"], inverse: "provided by" },
        recheck: 90,
      },
      "depends-on": {
        relation: { to: ["service"], inverse: "dependents" },
        recheck: 90,
      },
      "secrets-in": secretsIn,
    },
    required: ["repository"],
    sections: ["Role", "Cautions", "Cross-project context"],
  },
  machine: {
    keys: {
      role: { recheck: 180 },
      environment: { recheck: 180 },
      provider: { recheck: 365 },
      "platform.os": { recheck: 90 },
      "platform.arch": { recheck: null },
      "platform.vm_size": { recheck: 90 },
      "access.method": { recheck: 90 },
      "access.address": { recheck: 30 },
      "access.host_key": { recheck: 90 },
      hostname: { recheck: 180 },
      "disk.root.size": { recheck: 30 },
      "disk.root.used": { recheck: 7 },
      "disk.root.free": { recheck: 7 },
      "disk.data.size": { recheck: 30 },
      "disk.data.used": { recheck: 7 },
      "disk.data.free": { recheck: 7 },
      "configured-by": {
        relation: { to: ["project"], inverse: "configures" },
        recheck: 180,
      },
      "on-network": {
        relation: { to: ["service"], inverse: "members" },
        recheck: 90,
      },
      "secrets-in": secretsIn,
    },
    required: ["role", "environment", "access.method"],
    sections: [
      "Identity and role",
      "Access prerequisites",
      "Operational constraints",
      "Cautions",
    ],
  },
  service: {
    keys: {
      endpoint: { many: true, recheck: 30 },
      environment: { recheck: 180 },
      "deployment.version": { recheck: 14 },
      "deployment.built_from": { recheck: 30 },
      "provided-by": { recheck: 365 },
      "runs-on": {
        relation: { to: ["machine"], inverse: "services" },
        recheck: 30,
      },
      "configured-by": {
        relation: { to: ["project"], inverse: "configures" },
        recheck: 180,
      },
      "depends-on": {
        relation: { to: ["service"], inverse: "dependents" },
        recheck: 90,
      },
      "secrets-in": secretsIn,
    },
    required: ["endpoint", "environment"],
    sections: [
      "Role and authority",
      "Dependencies and operational context",
      "Cautions",
    ],
  },
  runbook: {
    keys: {
      last_successful_run: { recheck: null },
      changes_deployment: { recheck: 365 },
      "applies-to": {
        relation: { to: [anyTarget], inverse: "runbooks" },
        recheck: null,
      },
    },
    required: ["last_successful_run", "changes_deployment", "applies-to"],
    sections: [
      "Purpose and owning sources",
      "Targets and prerequisites",
      "Expected impact",
      "Procedure",
      "Verification",
      "Rollback and escalation",
    ],
  },
  decision: {
    keys: {
      supersedes: {
        relation: { to: ["decision"], inverse: "superseded by" },
        recheck: null,
      },
      "applies-to": {
        relation: { to: [anyTarget], inverse: "decisions" },
        recheck: null,
      },
      "from-task": {
        relation: { to: [taskTarget], inverse: "decisions" },
        recheck: null,
      },
    },
    required: [],
    sections: [
      "Context",
      "Decision",
      "Alternatives and reasons",
      "Consequences",
      "Replacement",
    ],
  },
  policy: {
    keys: {
      enforcement: { recheck: 90 },
      "applies-to": {
        relation: { to: [anyTarget], inverse: "policies" },
        recheck: null,
      },
      "see-also": {
        relation: { to: ["runbook"], inverse: "policies" },
        recheck: null,
      },
    },
    required: ["enforcement", "applies-to"],
    sections: ["Rule", "Why", "What it covers", "Exceptions"],
  },
  person: {
    keys: {
      member: { recheck: null },
    },
    required: [],
    sections: ["Responsibilities"],
  },
  agent: {
    keys: {
      agent_record: { recheck: null },
      "on-machine": {
        many: false,
        relation: { to: ["machine"], inverse: "agents" },
        recheck: 180,
      },
    },
    required: ["agent_record", "on-machine"],
    sections: ["Use", "Conventions"],
  },
}

/** The names of the eight built-in entity types. */
export const builtInTypes: readonly string[] = Object.keys(builtIns)

/**
 * Long-form fields with their own meaning, which a relation attribute (such
 * as `path`) cannot be named.
 */
export const factOptions: ReadonlySet<string> = new Set([
  "value",
  "to",
  "via",
  "note",
  "task",
  "remove",
  "accepted",
])

function builtInSchema(type: string, definition: BuiltInType): TypeSchema {
  const keys = new Map<string, KeySchema>()
  for (const [key, k] of Object.entries(definition.keys)) {
    keys.set(key, {
      key,
      many: k.many ?? k.relation !== undefined,
      relation: k.relation
        ? {
            targets: k.relation.to,
            identifiedBy: k.relation.identifiedBy ?? [],
            inverse: k.relation.inverse,
          }
        : null,
      recheckDays: k.recheck,
      inSchema: true,
      builtIn: true,
    })
  }
  return {
    type,
    builtIn: true,
    extended: false,
    documentId: null,
    status: "active",
    keys,
    required: definition.required,
    sections: definition.sections,
  }
}

/** The built-in type schemas, without any workspace extensions. */
export const builtInSchemas: ReadonlyMap<string, TypeSchema> = new Map(
  Object.entries(builtIns).map(([type, d]) => [type, builtInSchema(type, d)]),
)

/**
 * The type schemas of one catalog revision: the built-in types, extended and
 * joined by the workspace's type schema documents of the same revision
 * (catalog §3.9; architecture §5.2: one parser reads schemas and entities
 * from the same revision).
 */
export interface TypeRegistry {
  types: ReadonlyMap<string, TypeSchema>
  /** What in the schema documents could not be applied. All are blocking. */
  problems: Problem[]
}

export function buildTypeRegistry(
  documents: readonly SchemaDocument[],
): TypeRegistry {
  const problems: Problem[] = []
  const types = new Map<string, TypeSchema>()
  for (const [type, schema] of builtInSchemas) types.set(type, schema)

  const seen = new Set<string>()
  const pending: { document: SchemaDocument; schema: TypeSchema }[] = []
  for (const document of documents) {
    const type = document.describes
    if (type === null || seen.has(type)) continue
    seen.add(type)
    const problem = (
      message: string,
      range = document.fields.get("id")?.value.range,
    ) => problems.push(blocking("schema-invalid", message, document.id, range))

    if (reservedTypeNames.has(type)) {
      problem(`"${type}" is reserved and cannot be a type name`)
      continue
    }
    const builtIn = builtInSchemas.get(type)
    if (builtIn && document.status === "retired") continue

    const keys = new Map<string, KeySchema>(builtIn?.keys ?? [])
    for (const definition of document.keys) {
      if (builtIn?.keys.has(definition.key)) {
        problem(
          `"${definition.key}" is a built-in key of ${type}; built-in types can be extended, not changed`,
          definition.range,
        )
        continue
      }
      const recheck = definition.recheck
        ? recheckPattern.exec(definition.recheck)
        : null
      const relation = definition.relation
        ? {
            targets: definition.relation,
            identifiedBy: definition.identifiedBy ?? [],
            inverse: definition.inverse ?? null,
          }
        : null
      for (const attribute of relation?.identifiedBy ?? []) {
        if (!factKeyPattern.test(attribute) || factOptions.has(attribute))
          problem(
            `"${attribute}" cannot name a relation attribute`,
            definition.range,
          )
      }
      keys.set(definition.key, {
        key: definition.key,
        many: definition.many ?? relation !== null,
        relation,
        recheckDays: recheck ? Number(recheck[1]) : null,
        inSchema: true,
        builtIn: false,
      })
    }
    const schema: TypeSchema = {
      type,
      builtIn: builtIn !== undefined,
      extended: builtIn !== undefined,
      documentId: document.id,
      status: builtIn ? "active" : (document.status ?? "active"),
      keys,
      required: [...(builtIn?.required ?? []), ...document.required],
      sections: [...(builtIn?.sections ?? []), ...document.sections],
    }
    types.set(type, schema)
    pending.push({ document, schema })
  }

  // Checked once every type is known, since schemas may point to each other.
  for (const { document, schema } of pending) {
    for (const key of schema.keys.values()) {
      for (const target of key.relation?.targets ?? []) {
        if (!key.builtIn && !types.has(target))
          problems.push(
            blocking(
              "schema-invalid",
              `"${key.key}" points to the type "${target}", which does not exist`,
              document.id,
              document.keys.find((k) => k.key === key.key)?.range,
            ),
          )
      }
    }
    for (const required of document.required) {
      if (!schema.keys.has(required))
        problems.push(
          blocking(
            "schema-invalid",
            `The required key "${required}" is not a key of ${schema.type}`,
            document.id,
            document.fields.get("required")?.value.range,
          ),
        )
    }
  }
  return { types, problems }
}

/** The schema of `key` on an entity of `schema`'s type; keys outside the schema are single-valued values. */
export function keySchema(schema: TypeSchema | null, key: string): KeySchema {
  return (
    schema?.keys.get(key) ?? {
      key,
      many: false,
      relation: null,
      recheckDays: null,
      inSchema: false,
      builtIn: false,
    }
  )
}
