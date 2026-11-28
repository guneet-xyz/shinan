// node mkbig.mjs <folder> [pages]: a catalog at its limits, 20,000 entity
// pages of about 2,400 bytes each (48 MB), every one linking to the next.
import { mkdirSync, writeFileSync } from "node:fs"

const [folder, count] = process.argv.slice(2)
const n = Number(count ?? 20000)
const words =
  "the host runs services for the team and keeps its data on a disk that is checked every week by an agent which records what it saw".split(
    " ",
  )
function prose(seed, length) {
  let text = ""
  let k = seed
  while (text.length < length) {
    k = (k * 1103515245 + 12345) % 2147483648
    text += words[k % words.length] + (k % 13 === 0 ? ".\n" : " ")
  }
  return text
}
const types = ["machine", "service", "project", "runbook"]
for (const t of [...types, "person"])
  mkdirSync(`${folder}/${t}`, { recursive: true })
writeFileSync(
  `${folder}/person/guneet.md`,
  "---\nid: person/guneet\ntype: person\ntitle: Guneet\nsummary: Owns the workspace.\nstatus: active\nowner: person/guneet\n---\n\n# Guneet\n",
)
for (let i = 0; i < n - 1; i++) {
  const t = types[i % 4]
  const j = (i + 1) % (n - 1)
  const next = `${types[j % 4]}/${types[j % 4][0]}${j}`
  writeFileSync(
    `${folder}/${t}/${t[0]}${i}.md`,
    `---\nid: ${t}/${t[0]}${i}\ntype: ${t}\ntitle: ${t} ${i}\nsummary: Page ${i} of a catalog at its limits.\nstatus: active\nowner: person/guneet\n---\n\n# ${t} ${i}\n\nSee [the next one](${next}).\n\n${prose(i, 2200)}\n`,
  )
}
