import { fileURLToPath } from "node:url"

/**
 * The folder of Shinan's Git hooks, which repositories point
 * `core.hooksPath` at (build plan §2.2): `packages/git/hooks`, read-only in
 * the image (`/app/packages/git/hooks`). Each hook is a Node.js script that
 * Git starts directly (`#!/nodejs/bin/node`), so no shell is needed.
 */
export const hooksDirectory = fileURLToPath(
  new URL("../hooks", import.meta.url),
)
