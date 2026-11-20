/**
 * The skill's reference of the built-in types (`references/types.md`):
 * their keys, which are multi-valued, which are relations and to what, and
 * every key's recheck interval (catalog §3, §4.6). Built-in types have no
 * schema document in a workspace's repository, so an agent reading the
 * catalog from a clone learns them here. The file is generated from the
 * code's schemas and a test compares the two, so they cannot drift apart.
 */

/** The parts of a built-in type schema the reference shows. */
export interface ReferenceTypeSchema {
  type: string
  keys: ReadonlyMap<
    string,
    {
      key: string
      many: boolean
      relation: {
        targets: readonly string[]
        identifiedBy: readonly string[]
      } | null
      recheckDays: number | null
    }
  >
  required: readonly string[]
  sections: readonly string[]
}

/** Where the generated reference lives, relative to the skill's folder. */
export const typesReferencePath = "references/types.md"

const targetNames: Record<string, string> = {
  "*": "any entity, `schema/<type>` or `workspace`",
  task: "a task ID",
}

/**
 * The reference's Markdown, before Prettier formats it: the generator and
 * the test both format it with the repository's Prettier configuration.
 */
export function renderTypesReference(
  schemas: Iterable<ReferenceTypeSchema>,
): string {
  const lines = [
    "# The built-in types",
    "",
    "<!-- Generated from Shinan's built-in type schemas by `pnpm --filter @shinan/skill generate`. Do not edit by hand. -->",
    "",
    "Built-in types have no schema document in the repository. Their keys and",
    "recheck intervals are below; a workspace may add keys to one in",
    "`schema/<type>.md`, and custom types are defined the same way.",
    "",
    "- **Recheck:** a fact of the key is due for recheck once this many days",
    '  have passed since its `checked`; "none" means it is never due, though',
    "  its age still matters.",
    '- **Values:** "one" keys hold a single value, "many" a list. Two',
    '  observations of a "one" key by different means each need their own',
    "  `via`.",
    "- **Relations** hold entity IDs of the types named, in short form",
    "  (`runs-on: machine/build-1`) or as `{ to: …, <attribute>: … }`.",
    "  Identified by: the attributes that, with the target, tell two facts of",
    "  the key apart.",
    "- **Required** keys are what an agent needs before relying on the entity;",
    "  a document without them is valid, and they are listed as not yet",
    "  recorded.",
    "",
  ]
  for (const schema of schemas) {
    lines.push(`## ${schema.type}`, "")
    lines.push(
      `Required: ${list(schema.required)}. Body sections: ${
        schema.sections.length ? schema.sections.join(", ") : "none"
      }.`,
      "",
    )
    lines.push(
      "| Key | Values | Relation to | Identified by | Recheck |",
      "| --- | --- | --- | --- | --- |",
    )
    for (const key of schema.keys.values()) {
      const relation = key.relation
      lines.push(
        `| \`${key.key}\` | ${key.many ? "many" : "one"} | ${
          relation
            ? relation.targets
                .map((t) => targetNames[t] ?? `\`${t}\``)
                .join(", ")
            : ""
        } | ${relation ? list(relation.identifiedBy, "") : ""} | ${
          key.recheckDays === null ? "none" : `${key.recheckDays} days`
        } |`,
      )
    }
    lines.push("")
  }
  return lines.join("\n")
}

function list(items: readonly string[], none = "none") {
  return items.length ? items.map((i) => `\`${i}\``).join(", ") : none
}
