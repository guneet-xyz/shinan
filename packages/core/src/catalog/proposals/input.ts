import { InvalidInputError } from "../../errors.js"
import {
  entityStatuses,
  factStates,
  maxDocumentBytes,
  taskIdPattern,
  utf8Length,
  workspaceLists,
} from "../document/index.js"
import type {
  CatalogOperation,
  CheckInput,
  DocumentField,
  FactExpectation,
  FactInput,
  KeyOptions,
  PresentFact,
  StartHereStepInput,
} from "../document/index.js"

/**
 * Limits on one catalog proposal (catalog §8.1). They bound the work of
 * applying and validating it, which runs in a worker with a time limit.
 * **Proposed (M2-4):** the numbers; no proposal in the `workspace`
 * repository's history comes near them.
 */
export const proposalLimits = {
  /** Operations in one proposal. */
  operations: 50,
  /** Facts in one `recheck-facts` or `create-entity`. */
  facts: 50,
  /** Steps, list items, schema keys and relation attributes in one operation. */
  items: 100,
  /** The explanation, in characters. */
  explanation: 4000,
  /** An idempotency key, in characters. */
  idempotencyKey: 200,
  /** The whole proposal as JSON, in bytes of UTF-8. */
  bytes: 256 * 1024,
} as const

/** A catalog proposal as its author sends it. */
export interface ProposalInput {
  /** Why, in a few sentences (catalog §8.1). */
  explanation: string
  /** The related task's ID, such as `SHN-12`. */
  relatedTask?: string | null
  operations: CatalogOperation[]
  /**
   * A key of the author's choosing: a retried request with the same key and
   * the same content is stored once.
   */
  idempotencyKey?: string | null
}

const operationNames = [
  "create-entity",
  "set-fact",
  "remove-fact",
  "recheck-facts",
  "edit-body",
  "set-field",
  "retire",
  "change-id",
  "create-schema",
  "set-schema-key",
  "create-start-here",
  "set-start-here-path",
] as const satisfies readonly CatalogOperation["op"][]

const documentFields = [
  "title",
  "summary",
  "status",
  "owner",
  "decision_state",
  "decided_on",
  "decided_by",
  "required",
  "sections",
] as const satisfies readonly DocumentField[]

/**
 * Checks the shape of a catalog proposal from outside core, such as an MCP
 * call's JSON: every property of every operation has the type the operation
 * types give, unknown properties are refused, and the limits hold.
 * `applyOperations` trusts its input's shape, so nothing reaches it
 * unchecked. Whether the operations make sense is `applyOperations`'s job.
 */
export function checkProposalInput(input: unknown): ProposalInput {
  const proposal = record(input, "The proposal")
  only(proposal, "The proposal", [
    "explanation",
    "relatedTask",
    "operations",
    "idempotencyKey",
  ])
  const explanation = text(proposal.explanation, "explanation")
  if (explanation.trim() === "")
    throw invalid("explanation-blank", "Explain the change in a few sentences")
  if (explanation.length > proposalLimits.explanation)
    throw invalid(
      "explanation-too-long",
      `The explanation is longer than ${proposalLimits.explanation} characters`,
    )
  const relatedTask = optionalOrNull(proposal.relatedTask, (v) => {
    const task = text(v, "relatedTask")
    if (!taskIdPattern.test(task))
      throw invalid("related-task", "relatedTask is a task ID, such as SHN-12")
    return task
  })
  const idempotencyKey = optionalOrNull(proposal.idempotencyKey, (v) => {
    const key = text(v, "idempotencyKey")
    if (key === "" || key.length > proposalLimits.idempotencyKey)
      throw invalid(
        "idempotency-key",
        `idempotencyKey has 1 to ${proposalLimits.idempotencyKey} characters`,
      )
    return key
  })
  const operations = list(
    proposal.operations,
    "operations",
    proposalLimits.operations,
  )
  if (operations.length === 0)
    throw invalid("operations-empty", "A proposal has at least one operation")
  operations.forEach((operation, index) =>
    checkOperation(operation, `operations[${index}]`),
  )
  if (utf8Length(JSON.stringify(input)) > proposalLimits.bytes)
    throw invalid(
      "too-large",
      `The proposal is larger than ${proposalLimits.bytes / 1024} KiB`,
    )
  return {
    explanation,
    relatedTask: relatedTask ?? null,
    operations: operations as CatalogOperation[],
    idempotencyKey: idempotencyKey ?? null,
  }
}

function checkOperation(value: unknown, at: string): void {
  const operation = record(value, at)
  const op = operation.op
  if (
    typeof op !== "string" ||
    !(operationNames as readonly string[]).includes(op)
  )
    throw invalid(
      "operation-unknown",
      `${at}.op is one of ${operationNames.join(", ")}`,
    )
  at = `${at} (${op})`
  const name = (key: string) => `${at}.${key}`
  switch (op as CatalogOperation["op"]) {
    case "create-entity": {
      only(operation, at, [
        "op",
        "id",
        "title",
        "summary",
        "status",
        "owner",
        "decision",
        "facts",
        "body",
      ])
      text(operation.id, name("id"))
      text(operation.title, name("title"))
      text(operation.summary, name("summary"))
      optional(operation.status, (v) =>
        oneOf(v, name("status"), entityStatuses),
      )
      text(operation.owner, name("owner"))
      optional(operation.decision, (v) => {
        const decision = record(v, name("decision"))
        only(decision, name("decision"), ["state", "decidedOn", "decidedBy"])
        text(decision.state, name("decision.state"))
        optional(decision.decidedOn, (d) => text(d, name("decision.decidedOn")))
        optional(decision.decidedBy, (d) => text(d, name("decision.decidedBy")))
      })
      optional(operation.facts, (v) =>
        list(v, name("facts"), proposalLimits.facts).forEach((item, i) => {
          const entry = record(item, name(`facts[${i}]`))
          only(entry, name(`facts[${i}]`), ["fact", "check"])
          factInput(entry.fact, name(`facts[${i}].fact`))
          optional(entry.check, (c) => checkInput(c, name(`facts[${i}].check`)))
        }),
      )
      optional(operation.body, (v) => text(v, name("body")))
      return
    }
    case "set-fact":
      only(operation, at, [
        "op",
        "document",
        "fact",
        "check",
        "expect",
        "supersedes",
      ])
      text(operation.document, name("document"))
      factInput(operation.fact, name("fact"))
      optional(operation.check, (v) => checkInput(v, name("check")))
      factExpectation(operation.expect, name("expect"))
      optional(operation.supersedes, (v) => presentFact(v, name("supersedes")))
      return
    case "remove-fact":
      only(operation, at, ["op", "document", "expect"])
      text(operation.document, name("document"))
      presentFact(operation.expect, name("expect"))
      return
    case "recheck-facts": {
      only(operation, at, ["op", "document", "facts", "check"])
      text(operation.document, name("document"))
      const facts = list(operation.facts, name("facts"), proposalLimits.facts)
      facts.forEach((f, i) => presentFact(f, name(`facts[${i}]`)))
      checkInput(operation.check, name("check"))
      return
    }
    case "edit-body": {
      only(operation, at, ["op", "document", "section", "text", "expect"])
      text(operation.document, name("document"))
      if (operation.section !== undefined && operation.section !== null)
        text(operation.section, name("section"))
      text(operation.text, name("text"))
      const expect = record(operation.expect, name("expect"))
      if ("absent" in expect) {
        only(expect, name("expect"), ["absent"])
        isTrue(expect.absent, name("expect.absent"))
      } else {
        only(expect, name("expect"), ["text"])
        text(expect.text, name("expect.text"))
      }
      return
    }
    case "set-field": {
      only(operation, at, ["op", "document", "field", "value", "expect"])
      text(operation.document, name("document"))
      oneOf(operation.field, name("field"), documentFields)
      fieldValue(operation.value, name("value"))
      const expect = record(operation.expect, name("expect"))
      only(expect, name("expect"), ["value"])
      fieldValue(expect.value, name("expect.value"))
      return
    }
    case "retire": {
      only(operation, at, ["op", "document", "replacedBy", "expect"])
      text(operation.document, name("document"))
      optional(operation.replacedBy, (v) => text(v, name("replacedBy")))
      const expect = record(operation.expect, name("expect"))
      only(expect, name("expect"), ["status"])
      oneOf(expect.status, name("expect.status"), entityStatuses)
      return
    }
    case "change-id":
      only(operation, at, ["op", "document", "id"])
      text(operation.document, name("document"))
      text(operation.id, name("id"))
      return
    case "create-schema": {
      only(operation, at, [
        "op",
        "type",
        "title",
        "summary",
        "owner",
        "status",
        "keys",
        "required",
        "sections",
        "body",
      ])
      text(operation.type, name("type"))
      text(operation.title, name("title"))
      text(operation.summary, name("summary"))
      text(operation.owner, name("owner"))
      optional(operation.status, (v) =>
        oneOf(v, name("status"), entityStatuses),
      )
      optional(operation.keys, (v) => {
        const keys = record(v, name("keys"))
        const entries = Object.entries(keys)
        if (entries.length > proposalLimits.items)
          throw tooMany(name("keys"), proposalLimits.items)
        for (const [key, options] of entries)
          keyOptions(options, name(`keys.${key}`))
      })
      optional(operation.required, (v) => texts(v, name("required")))
      optional(operation.sections, (v) => texts(v, name("sections")))
      optional(operation.body, (v) => text(v, name("body")))
      return
    }
    case "set-schema-key": {
      only(operation, at, ["op", "document", "key", "options", "expect"])
      text(operation.document, name("document"))
      text(operation.key, name("key"))
      if (operation.options !== null)
        keyOptions(operation.options, name("options"))
      const expect = record(operation.expect, name("expect"))
      if ("absent" in expect) {
        only(expect, name("expect"), ["absent"])
        isTrue(expect.absent, name("expect.absent"))
      } else {
        only(expect, name("expect"), ["options"])
        keyOptions(expect.options, name("expect.options"))
      }
      return
    }
    case "create-start-here":
      only(operation, at, [
        "op",
        "title",
        "summary",
        "owner",
        "people",
        "agents",
        "body",
      ])
      text(operation.title, name("title"))
      optional(operation.summary, (v) => text(v, name("summary")))
      optional(operation.owner, (v) => text(v, name("owner")))
      steps(operation.people, name("people"))
      steps(operation.agents, name("agents"))
      optional(operation.body, (v) => text(v, name("body")))
      return
    case "set-start-here-path": {
      only(operation, at, ["op", "path", "steps", "expect"])
      oneOf(operation.path, name("path"), ["people", "agents"] as const)
      steps(operation.steps, name("steps"))
      const expect = record(operation.expect, name("expect"))
      only(expect, name("expect"), ["steps"])
      steps(expect.steps, name("expect.steps"))
      return
    }
  }
}

function factInput(value: unknown, at: string): asserts value is FactInput {
  const fact = record(value, at)
  only(fact, at, [
    "key",
    "state",
    "value",
    "to",
    "attributes",
    "via",
    "note",
    "task",
    "remove",
    "accepted",
  ])
  text(fact.key, `${at}.key`)
  oneOf(fact.state, `${at}.state`, factStates)
  optional(fact.value, (v) => scalar(v, `${at}.value`))
  optional(fact.attributes, (v) => {
    const attributes = record(v, `${at}.attributes`)
    const entries = Object.entries(attributes)
    if (entries.length > proposalLimits.items)
      throw tooMany(`${at}.attributes`, proposalLimits.items)
    for (const [name, attribute] of entries)
      scalar(attribute, `${at}.attributes.${name}`)
  })
  for (const key of ["to", "via", "note", "task", "accepted"] as const)
    optional(fact[key], (v) => text(v, `${at}.${key}`))
  optional(fact.remove, (v) => boolean(v, `${at}.remove`))
}

function checkInput(value: unknown, at: string): asserts value is CheckInput {
  const check = record(value, at)
  only(check, at, ["checked", "scope", "source", "limits"])
  text(check.checked, `${at}.checked`)
  text(check.scope, `${at}.scope`)
  text(check.source, `${at}.source`)
  optional(check.limits, (v) => text(v, `${at}.limits`))
}

function factExpectation(
  value: unknown,
  at: string,
): asserts value is FactExpectation {
  const expect = record(value, at)
  if ("absent" in expect) {
    only(expect, at, ["identity", "absent"])
    text(expect.identity, `${at}.identity`)
    isTrue(expect.absent, `${at}.absent`)
    return
  }
  presentFact(expect, at)
}

function presentFact(value: unknown, at: string): asserts value is PresentFact {
  const fact = record(value, at)
  only(fact, at, ["identity", "value", "check"])
  text(fact.identity, `${at}.identity`)
  text(fact.value, `${at}.value`)
  if (fact.check === null) return
  const check = record(fact.check, `${at}.check`)
  // The check as the fact has it, so `by` is expected here.
  only(check, `${at}.check`, ["checked", "by", "scope", "source", "limits"])
  if (check.checked !== null) text(check.checked, `${at}.check.checked`)
  for (const key of ["by", "scope", "source"] as const)
    optional(check[key], (v) => text(v, `${at}.check.${key}`))
  if (check.limits !== undefined && check.limits !== null)
    text(check.limits, `${at}.check.limits`)
}

function keyOptions(value: unknown, at: string): asserts value is KeyOptions {
  const options = record(value, at)
  only(options, at, ["many", "relation", "identifiedBy", "inverse", "recheck"])
  optional(options.many, (v) => boolean(v, `${at}.many`))
  optional(options.relation, (v) => texts(v, `${at}.relation`))
  optional(options.identifiedBy, (v) => texts(v, `${at}.identifiedBy`))
  optional(options.inverse, (v) => text(v, `${at}.inverse`))
  optional(options.recheck, (v) => text(v, `${at}.recheck`))
}

function steps(
  value: unknown,
  at: string,
): asserts value is StartHereStepInput[] {
  list(value, at, proposalLimits.items).forEach((item, i) => {
    const step = record(item, `${at}[${i}]`)
    const target = ["to", "list", "url"].filter((k) => k in step)
    if (target.length !== 1)
      throw invalid(
        "operation-shape",
        `${at}[${i}] has exactly one of to, list and url`,
      )
    only(step, `${at}[${i}]`, [target[0]!, "note"])
    if (target[0] === "list")
      oneOf(step.list, `${at}[${i}].list`, workspaceLists)
    else text(step[target[0]!], `${at}[${i}].${target[0]}`)
    text(step.note, `${at}[${i}].note`)
  })
}

function fieldValue(value: unknown, at: string): void {
  if (value === null) return
  if (Array.isArray(value)) texts(value, at)
  else text(value, at)
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw invalid("operation-shape", `${at} is an object`)
  return value as Record<string, unknown>
}

function only(
  value: Record<string, unknown>,
  at: string,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue
    if (key === "by")
      throw invalid(
        "operation-shape",
        `${at}.by is written by Shinan, from who sends the proposal`,
      )
    throw invalid(
      "operation-shape",
      `${at} has no property ${JSON.stringify(key.slice(0, 50))}`,
    )
  }
}

function list(value: unknown, at: string, limit: number): unknown[] {
  if (!Array.isArray(value)) throw invalid("operation-shape", `${at} is a list`)
  if (value.length > limit) throw tooMany(at, limit)
  return value
}

function texts(value: unknown, at: string): void {
  list(value, at, proposalLimits.items).forEach((v, i) =>
    text(v, `${at}[${i}]`),
  )
}

function text(value: unknown, at: string): string {
  if (typeof value !== "string")
    throw invalid("operation-shape", `${at} is text`)
  // No catalog document holds more, so no single text in an operation may.
  if (value.length > maxDocumentBytes)
    throw invalid("too-large", `${at} is longer than a catalog document may be`)
  return value
}

function scalar(value: unknown, at: string): void {
  if (typeof value === "string") text(value, at)
  else if (typeof value === "boolean") return
  else if (typeof value !== "number" || !Number.isFinite(value))
    throw invalid("operation-shape", `${at} is text, a number or true/false`)
}

function boolean(value: unknown, at: string): void {
  if (typeof value !== "boolean")
    throw invalid("operation-shape", `${at} is true or false`)
}

function isTrue(value: unknown, at: string): void {
  if (value !== true) throw invalid("operation-shape", `${at} is true`)
}

function oneOf(value: unknown, at: string, allowed: readonly string[]): void {
  if (typeof value !== "string" || !allowed.includes(value))
    throw invalid("operation-shape", `${at} is one of ${allowed.join(", ")}`)
}

function optional<T>(
  value: unknown,
  check: (value: unknown) => T,
): T | undefined {
  return value === undefined ? undefined : check(value)
}

function optionalOrNull<T>(
  value: unknown,
  check: (value: unknown) => T,
): T | undefined {
  return value === null ? undefined : optional(value, check)
}

function tooMany(at: string, limit: number): InvalidInputError {
  return invalid("too-many", `${at} has more than ${limit} items`)
}

function invalid(rule: string, message: string): InvalidInputError {
  return new InvalidInputError(rule, message)
}
