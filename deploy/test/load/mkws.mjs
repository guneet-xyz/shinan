// node mkws.mjs <name>: the signed-in owner creates a workspace.
import { browser } from "./web.mjs"

const b = browser()
b.load()
const r = await b.request("/api/workspaces", {
  body: { name: process.argv[2] },
})
console.log(`workspace ${process.argv[2]}: ${r.status}`)
