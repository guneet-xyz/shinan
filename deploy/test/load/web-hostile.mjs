// node web-hostile.mjs <workspace ID>: 250 of the heaviest catalog reads,
// 50 at a time, from one signed-in person; counts the answers by status.
import { browser } from "./web.mjs"

const b = browser()
b.load()
const base = `/api/workspaces/${process.argv[2]}/catalog/`
const paths = [
  "tree",
  "types/machine/entities",
  "search?text=disk%20week",
  "changes",
  "history?id=machine/m4",
]
const statuses = {}
let next = 0
const started = Date.now()
await Promise.all(
  Array.from({ length: 50 }, async () => {
    while (next < 250) {
      const r = await b.request(base + paths[next++ % paths.length])
      await r.arrayBuffer()
      statuses[r.status] = (statuses[r.status] ?? 0) + 1
    }
  }),
)
console.log(
  `answers by status ${JSON.stringify(statuses)} in ${Date.now() - started} ms`,
)
