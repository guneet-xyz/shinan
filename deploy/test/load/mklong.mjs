// node mklong.mjs [commits] | git fast-import: a history of that many
// commits on main (default 1,000,000). Each changes one of 100 pages;
// machine/rare.md is written only in the first, so its History walks the
// whole history.
const n = Number(process.argv[2] ?? 1000000)
const page = (id, extra) =>
  `---\nid: machine/${id}\ntype: machine\ntitle: Machine ${id}\nsummary: Machine ${id}.\nstatus: active\nowner: person/guneet\n---\n\n# Machine ${id}\n${extra}`
const write = (s) =>
  process.stdout.write(s)
    ? undefined
    : new Promise((resolve) => process.stdout.once("drain", resolve))
const t = 1763700000
for (let c = 0; c < n; c++) {
  let files = ""
  if (c === 0) {
    files += `M 100644 inline machine/rare.md\ndata <<EOF\n${page("rare", "\nChanged once.\n")}\nEOF\n`
    files +=
      "M 100644 inline person/guneet.md\ndata <<EOF\n---\nid: person/guneet\ntype: person\ntitle: Guneet\nsummary: Owner.\nstatus: active\nowner: person/guneet\n---\n\n# Guneet\nEOF\n"
  }
  files += `M 100644 inline machine/m${c % 100}.md\ndata <<EOF\n${page(`m${c % 100}`, `\nRound ${c}.\n`)}\nEOF\n`
  await write(
    `commit refs/heads/main\ncommitter Agent <agent@example.com> ${t + c} +0000\ndata <<EOF\nCommit ${c}\nEOF\n${files}\n`,
  )
}
