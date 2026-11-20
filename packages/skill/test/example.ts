import { readFileSync } from "node:fs"
import { join } from "node:path"

import { skillDirectory } from "../src/index.js"

/** The example change in `references/changing.md`: the document before and after. */
export function exampleDocuments(): [string, string] {
  const changing = readFileSync(
    join(skillDirectory, "references", "changing.md"),
    "utf8",
  )
  const section = changing.slice(changing.indexOf("## An example"))
  const blocks = [...section.matchAll(/```markdown\n([\s\S]*?)```/g)].map(
    (m) => m[1]!,
  )
  if (blocks.length < 2) throw new Error("changing.md has no example change")
  return [blocks[0]!, blocks[1]!]
}

/** The `person` entity the example's owner names. */
export const examplePerson = `---
id: person/alex
type: person
title: Alex
summary: Runs the build machines.
status: active
owner: person/alex
---

# Alex
`
