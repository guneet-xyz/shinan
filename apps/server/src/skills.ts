import { Hono } from "hono"

import type { SkillCatalog } from "@shinan/skill"

import { errorResponse } from "./api/errors.js"

/**
 * How long OpenCode, and any cache in between, may keep a file before
 * asking again: five minutes (**proposed**, M2-9). The skill changes only
 * with a release, and the ETag makes asking again cheap.
 */
const cacheControl = "public, max-age=300"

/**
 * The skill's files at `/skills/` (D-056), served without sign-in because
 * OpenCode loads HTTP skill catalogs without credentials. Only the exact
 * paths of the built catalog are served, `index.json` and
 * `shinan/<file>`, from memory: there is no directory listing and nothing
 * reaches the file system or the database, so the path can expose nothing
 * but the skill. Everything else under it, other methods included, is 404.
 */
export function createSkills(catalog: SkillCatalog) {
  const skills = new Hono()
  skills.all("*", (c) => {
    const file =
      c.req.method === "GET" || c.req.method === "HEAD"
        ? catalog.files.get(c.req.path.slice("/skills/".length))
        : undefined
    if (!c.req.path.startsWith("/skills/") || !file)
      return errorResponse(c, 404, { error: "not-found", message: "Not found" })
    const headers = {
      "content-type": file.contentType,
      "cache-control": cacheControl,
      etag: file.etag,
      // A search engine has no use for these files.
      "x-robots-tag": "noindex",
    }
    const match = c.req.header("if-none-match")
    if (
      match !== undefined &&
      match.split(",").some((tag) => tag.trim() === file.etag)
    )
      return c.body(null, 304, headers)
    return c.body(file.body, 200, headers)
  })
  return skills
}
