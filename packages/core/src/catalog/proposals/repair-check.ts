import type {
  DocumentChange,
  EntityDocument,
  FactCheck,
  OperationProblem,
  WrittenFact,
} from "../document/index.js"

/**
 * What a workspace owner's repair may not do to fact checks (catalog §8.3;
 * identity §8.7: Shinan writes `by` from the request, nobody types it). A
 * fact check credited to anyone but the repairing owner must be one the
 * earlier text had, field for field, and cover only facts it already
 * covered there; the owner may remove facts from it, or name themselves.
 * Otherwise a repair could make a fact look checked by another member or
 * by an agent.
 */
export function repairCheckProblems(
  changes: readonly DocumentChange[],
  by: string,
): OperationProblem[] {
  const problems: OperationProblem[] = []
  for (const { before, after } of changes) {
    if (after.kind !== "entity") continue
    const earlier = before?.kind === "entity" ? groupsOf(before) : []
    for (const group of groupsOf(after)) {
      if (group.check.by === by) continue
      const same = earlier.filter((e) => e.key === group.key)
      const unused = same.flatMap((e) => e.facts)
      const added = group.facts.filter((fact) => {
        const i = unused.indexOf(fact)
        if (i < 0) return true
        unused.splice(i, 1)
        return false
      })
      if (same.length > 0 && added.length === 0) continue
      problems.push({
        operation: 0,
        kind: "invalid",
        code: "operation-invalid",
        message:
          same.length === 0
            ? `A fact check credited to ${group.check.by === undefined ? "nobody" : `"${group.check.by}"`} that the earlier text does not have: in a repair, a new or changed fact check names you (${by}) as \`by\`, since nobody types another's name. Naming yourself says you checked those facts yourself; otherwise keep the fact check as it was`
            : `The fact check credited to "${group.check.by}" covers facts it did not cover before: put them in a fact check that names you (${by}) as \`by\`, which says you checked them yourself`,
        documentId: after.id,
      })
    }
  }
  return problems
}

/** A document's fact checks, each with its fields and its facts, compared as text. */
function groupsOf(
  document: EntityDocument,
): { check: FactCheck; key: string; facts: string[] }[] {
  return document.groups.flatMap((group) =>
    group.check
      ? [
          {
            check: group.check,
            key: JSON.stringify([
              group.check.checked,
              group.check.by,
              group.check.scope,
              group.check.source,
              group.check.limits,
            ]),
            facts: document.facts
              .filter((f) => f.group === group.index)
              .map(factKey),
          },
        ]
      : [],
  )
}

function factKey(fact: WrittenFact): string {
  return JSON.stringify([
    fact.key,
    fact.state,
    fact.value,
    fact.to,
    fact.via,
    fact.note,
    fact.task,
    fact.remove,
    fact.accepted,
    Object.entries(fact.attributes).sort(([a], [b]) => (a < b ? -1 : 1)),
  ])
}
