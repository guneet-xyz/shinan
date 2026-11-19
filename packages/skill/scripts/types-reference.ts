import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { format } from "prettier"

import { builtInSchemas } from "@shinan/core"

import { skillDirectory } from "../src/index.js"
import { renderTypesReference, typesReferencePath } from "../src/types.js"

/**
 * The built-in types reference as it should be: rendered from core's
 * schemas and formatted as `pnpm format:write` would (the repository's
 * Prettier options for Markdown are Prettier's defaults).
 */
export async function expectedTypesReference(): Promise<string> {
  return format(renderTypesReference(builtInSchemas.values()), {
    parser: "markdown",
  })
}

export const typesReferenceFile = join(skillDirectory, typesReferencePath)

export async function currentTypesReference(): Promise<string> {
  return readFile(typesReferenceFile, "utf8")
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await writeFile(typesReferenceFile, await expectedTypesReference())
  console.log(`Wrote ${typesReferencePath}`)
}
