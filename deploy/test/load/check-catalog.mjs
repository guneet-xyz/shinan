// What an operator checks in the browser after the upgrade, read as the
// signed-in owner through the API the catalog pages use: each workspace's
// state, its first change, and machine/musashi.
import { browser } from "./web.mjs"

const b = browser()
b.load()
const account = await (await b.request("/api/account")).json()
for (const w of account.workspaces ?? []) {
  const read = async (path) => {
    const r = await b.request(`/api/workspaces/${w.id}/catalog/${path}`)
    return { status: r.status, body: await r.json() }
  }
  const state = await read("state")
  const changes = await read("changes")
  const entity = await read("entity?id=machine/musashi")
  const first = changes.body.changes?.at(-1)
  console.log(
    JSON.stringify({
      workspace: w.name,
      index_behind: state.body.index_behind,
      first_change: first && {
        subject: first.subject,
        pushed_by: first.pushed_by,
        pages: first.page_count,
      },
      musashi:
        entity.status === 200 ? entity.body.entity?.summary : entity.status,
    }),
  )
}
